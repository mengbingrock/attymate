import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';

import { startAgentTeamsWorker } from './workerDaemon';

const valueAfter = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const relayUrl = valueAfter('--relay', 'ws://127.0.0.1:43170/v2/worker-stream')!;
const dataDir = resolve(valueAfter('--data-dir', './.agent-teams-worker')!);
const label = valueAfter('--label', 'Local Worker')!;
const rawControlSocketPath = valueAfter('--control-socket', join(dataDir, 'control.sock'))!;
const controlSocketPath = rawControlSocketPath.startsWith('\\\\.\\pipe\\')
  ? rawControlSocketPath
  : resolve(rawControlSocketPath);
const organizationId = organizationIdSchema.parse(valueAfter('--organization-id', randomUUID()));
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
process.stdout.write(
  `${JSON.stringify({ event: 'worker.connected', ...worker.getStatus(), dataDir, controlSocketPath })}\n`
);

let stopping = false;
const stop = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`${JSON.stringify({ event: 'worker.stopping', label, signal })}\n`);
  await worker.stop();
  process.exitCode = 0;
};

process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
