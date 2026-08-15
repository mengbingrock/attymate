import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';

import {
  installCodexMcpRegistration,
  readCodexMcpRegistrationState,
  removeCodexMcpRegistration,
} from './codexMcpRegistration';
import { startAgentTeamsWorker } from './workerDaemon';
import { diagnoseAgentTeamsWorker } from './workerDiagnostics';

const valueAfter = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const valuesAfter = (name: string): readonly string[] => {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1]!);
    }
  }
  return values;
};

const resolveSocketPath = (value: string): string =>
  value.startsWith('\\\\.\\pipe\\') ? value : resolve(value);

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const defaultDataDir = (): string =>
  resolve(valueAfter('--data-dir', join(homedir(), '.agent-teams-worker'))!);

const defaultCodexConfigPath = (): string => {
  const codexRoot = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
  return resolve(valueAfter('--codex-config', join(codexRoot, 'config.toml'))!);
};

const defaultControlSocketPath = (dataDir: string): string =>
  resolveSocketPath(valueAfter('--control-socket', join(dataDir, 'control.sock'))!);

const runSetup = async (): Promise<void> => {
  const dataDir = defaultDataDir();
  const controlSocketPath = defaultControlSocketPath(dataDir);
  const bridgeScript = fileURLToPath(new URL('./controlMcpCli.js', import.meta.url));
  const explicitArgs = valuesAfter('--bridge-arg');
  const result = await installCodexMcpRegistration(defaultCodexConfigPath(), {
    command: valueAfter('--bridge-command', process.execPath)!,
    args:
      explicitArgs.length > 0
        ? explicitArgs
        : [bridgeScript, '--socket', controlSocketPath],
  });
  printJson({ command: 'setup', controlSocketPath, ...result });
  if (result.state.status === 'conflict' || result.state.status === 'invalid') {
    process.exitCode = 2;
  }
};

const runStatus = async (): Promise<void> => {
  const dataDir = defaultDataDir();
  printJson({
    command: 'status',
    dataDir,
    controlSocketPath: defaultControlSocketPath(dataDir),
    codexMcp: {
      configPath: defaultCodexConfigPath(),
      state: await readCodexMcpRegistrationState(defaultCodexConfigPath()),
    },
  });
};

const runDiagnose = async (): Promise<void> => {
  const dataDir = defaultDataDir();
  const report = await diagnoseAgentTeamsWorker({
    codexConfigPath: defaultCodexConfigPath(),
    statusPath: join(dataDir, 'worker-status.json'),
    controlSocketPath: defaultControlSocketPath(dataDir),
  });
  printJson({ command: 'diagnose', ...report });
  if (!report.ok) process.exitCode = 1;
};

const runMcpRemove = async (): Promise<void> => {
  printJson({ command: 'mcp-remove', ...(await removeCodexMcpRegistration(defaultCodexConfigPath())) });
};

const runWorker = async (): Promise<void> => {
  const relayUrl = valueAfter('--relay', 'ws://127.0.0.1:43170/v2/worker-stream')!;
  const dataDir = defaultDataDir();
  const label = valueAfter('--label', 'Local Worker')!;
  const controlSocketPath = defaultControlSocketPath(dataDir);
  const organizationId = organizationIdSchema.parse(
    valueAfter('--organization-id', randomUUID())
  );
  const personId = personIdSchema.parse(valueAfter('--person-id', randomUUID()));
  const nodeId = nodeIdSchema.parse(valueAfter('--node-id', randomUUID()));
  const workerInstanceId = workerInstanceIdSchema.parse(
    valueAfter('--worker-instance-id', randomUUID())
  );

  const worker = await startAgentTeamsWorker({
    relayUrl,
    dataDir,
    label,
    controlSocketPath,
    organizationId,
    personId,
    nodeId,
    workerInstanceId,
    workerGeneration: 1,
    reconnectDelayMs: 1_000,
  });
  await worker.ready;
  printJson({ event: 'worker.connected', ...worker.getStatus(), dataDir, controlSocketPath });

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    printJson({ event: 'worker.stopping', label, signal });
    await worker.stop();
    process.exitCode = 0;
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
};

const command = process.argv[2]?.startsWith('--') ? 'start' : (process.argv[2] ?? 'start');
switch (command) {
  case 'setup':
    await runSetup();
    break;
  case 'status':
    await runStatus();
    break;
  case 'diagnose':
    await runDiagnose();
    break;
  case 'mcp-remove':
    await runMcpRemove();
    break;
  case 'start':
    await runWorker();
    break;
  default:
    throw new Error(`Unknown agent-teams-worker command: ${command}`);
}
