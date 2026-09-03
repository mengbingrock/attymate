import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { nodeIdSchema, teamIdSchema } from '@claude-teams/agent-teams-protocol';

import type {
  DistributedLocalLeadRecoveryPort,
  RecoverDistributedLocalLeadRequest,
  RecoverDistributedLocalLeadResult,
} from '../../core/application/ports/DistributedLocalLeadRecoveryPort';

interface PersistentLeadManifest {
  readonly version: 1;
  readonly teamId: string;
  readonly nodeId: string;
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

const defaultProcessExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'EPERM'
    );
  }
};

const parseManifest = (input: unknown): PersistentLeadManifest => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('Persistent lead manifest must be an object');
  }
  const record = input as Record<string, unknown>;
  if (record.version !== 1) throw new TypeError('Unsupported persistent lead manifest version');
  return {
    version: 1,
    teamId: teamIdSchema.parse(record.teamId),
    nodeId: nodeIdSchema.parse(record.nodeId),
  };
};

const readPid = async (path: string): Promise<number | undefined> => {
  try {
    const value = Number((await readFile(path, 'utf8')).trim());
    return Number.isSafeInteger(value) && value > 1 ? value : undefined;
  } catch {
    return undefined;
  }
};

const assertDirectory = async (path: string, label: string): Promise<void> => {
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a directory`);
  }
};

const assertRegularFile = async (
  path: string,
  label: string,
  executable = false
): Promise<void> => {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (executable && (stats.mode & 0o100) === 0) {
    throw new Error(`${label} must be executable by its owner`);
  }
};

export class PersistentLocalLeadRecoveryAdapter implements DistributedLocalLeadRecoveryPort {
  private readonly root: string;
  private readonly spawnProcess: SpawnProcess;
  private readonly processExists: (pid: number) => boolean;
  private readonly inFlight = new Map<string, Promise<RecoverDistributedLocalLeadResult>>();

  constructor(
    input: {
      readonly root?: string;
      readonly spawnProcess?: SpawnProcess;
      readonly processExists?: (pid: number) => boolean;
    } = {}
  ) {
    this.root = resolve(
      input.root ?? join(homedir(), '.local', 'share', 'agent-teams', 'distributed-leads')
    );
    this.spawnProcess = input.spawnProcess ?? spawn;
    this.processExists = input.processExists ?? defaultProcessExists;
  }

  async reconnect(
    request: RecoverDistributedLocalLeadRequest
  ): Promise<RecoverDistributedLocalLeadResult> {
    const teamId = teamIdSchema.parse(request.teamId);
    const nodeId = nodeIdSchema.parse(request.nodeId);
    const existing = this.inFlight.get(teamId);
    if (existing !== undefined) return existing;
    const recovery = this.reconnectOnce({ teamId, nodeId });
    this.inFlight.set(teamId, recovery);
    try {
      return await recovery;
    } finally {
      if (this.inFlight.get(teamId) === recovery) this.inFlight.delete(teamId);
    }
  }

  private async reconnectOnce(
    request: RecoverDistributedLocalLeadRequest
  ): Promise<RecoverDistributedLocalLeadResult> {
    const directory = join(this.root, request.teamId);
    const manifestPath = join(directory, 'lead.json');
    const launcherPath = join(directory, 'start-worker.sh');
    const pidPath = join(directory, 'worker.pid');
    await assertDirectory(this.root, 'Persistent lead root');
    await assertDirectory(directory, 'Persistent lead directory');
    await assertRegularFile(manifestPath, 'Persistent lead manifest');
    await assertRegularFile(launcherPath, 'Persistent lead launcher', true);
    const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
    if (manifest.teamId !== request.teamId || manifest.nodeId !== request.nodeId) {
      throw new Error('Persistent lead configuration does not match the active Relay lead');
    }
    const pid = await readPid(pidPath);
    if (pid !== undefined && this.processExists(pid)) return { status: 'already-running' };

    const child = this.spawnProcess(launcherPath, [], {
      cwd: directory,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AGENT_TEAMS_PERSISTENT_LEAD_ROOT: directory },
    });
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn);
      child.once('error', rejectSpawn);
    });
    child.unref();
    return { status: 'started' };
  }
}
