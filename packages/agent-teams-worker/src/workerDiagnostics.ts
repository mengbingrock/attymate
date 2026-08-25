import { lstat, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  readCodexMcpRegistrationState,
  type CodexMcpRegistrationState,
} from './codexMcpRegistration';
import { requestWorkerControl } from './workerControlServer';
import type { AgentTeamsWorkerStatus } from './workerDaemon';

export interface WorkerDiagnosticReport {
  readonly ok: boolean;
  readonly codexRuntime: {
    readonly homePath: string;
    readonly state: 'ready' | 'missing' | 'invalid';
    readonly private: boolean;
    readonly authJsonPresent: boolean;
    readonly error?: string;
  };
  readonly codexMcp: {
    readonly configPath: string;
    readonly state: CodexMcpRegistrationState;
  };
  readonly persistedStatus:
    | { readonly available: true; readonly status: AgentTeamsWorkerStatus }
    | { readonly available: false; readonly error: string };
  readonly controlSocket:
    | { readonly reachable: true; readonly socketPath: string; readonly status: AgentTeamsWorkerStatus }
    | { readonly reachable: false; readonly socketPath: string; readonly error: string };
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const inspectCodexRuntimeHome = async (
  homePath: string
): Promise<WorkerDiagnosticReport['codexRuntime']> => {
  try {
    const homeStat = await lstat(homePath);
    const isPrivate = process.platform === 'win32' || (homeStat.mode & 0o077) === 0;
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink() || !isPrivate) {
      return {
        homePath,
        state: 'invalid',
        private: isPrivate,
        authJsonPresent: false,
        error: 'Worker Codex home must be a private, non-symbolic-link directory',
      };
    }

    let authJsonPresent = false;
    try {
      authJsonPresent = (await stat(join(homePath, 'auth.json'))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return { homePath, state: 'ready', private: true, authJsonPresent };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        homePath,
        state: 'missing',
        private: false,
        authJsonPresent: false,
      };
    }
    return {
      homePath,
      state: 'invalid',
      private: false,
      authJsonPresent: false,
      error: errorMessage(error),
    };
  }
};

export const diagnoseAgentTeamsWorker = async (input: {
  readonly codexConfigPath: string;
  readonly statusPath: string;
  readonly controlSocketPath: string;
  readonly codexHomePath: string;
}): Promise<WorkerDiagnosticReport> => {
  const codexState = await readCodexMcpRegistrationState(input.codexConfigPath);
  const codexRuntime = await inspectCodexRuntimeHome(input.codexHomePath);
  let persistedStatus: WorkerDiagnosticReport['persistedStatus'];
  try {
    persistedStatus = {
      available: true,
      status: JSON.parse(await readFile(input.statusPath, 'utf8')) as AgentTeamsWorkerStatus,
    };
  } catch (error) {
    persistedStatus = { available: false, error: errorMessage(error) };
  }

  let controlSocket: WorkerDiagnosticReport['controlSocket'];
  try {
    controlSocket = {
      reachable: true,
      socketPath: input.controlSocketPath,
      status: await requestWorkerControl<AgentTeamsWorkerStatus>(
        input.controlSocketPath,
        '/v2/worker-status'
      ),
    };
  } catch (error) {
    controlSocket = {
      reachable: false,
      socketPath: input.controlSocketPath,
      error: errorMessage(error),
    };
  }

  return {
    ok: codexState.status === 'managed' && controlSocket.reachable,
    codexRuntime,
    codexMcp: { configPath: input.codexConfigPath, state: codexState },
    persistedStatus,
    controlSocket,
  };
};
