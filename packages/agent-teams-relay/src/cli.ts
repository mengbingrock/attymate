import { resolve } from 'node:path';

import { startAgentTeamsRelay } from './relayServer';

const valueAfter = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const host = valueAfter('--host', '127.0.0.1')!;
const port = Number(valueAfter('--port', '43170'));
const dataDir = resolve(valueAfter('--data-dir', './.agent-teams-relay')!);
const managerToken = valueAfter('--manager-token', process.env.AGENT_TEAMS_RELAY_MANAGER_TOKEN);
const workerToken = valueAfter('--worker-token', process.env.AGENT_TEAMS_RELAY_WORKER_TOKEN);

if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error(`Invalid --port value: ${String(port)}`);
}

if ((managerToken === undefined) !== (workerToken === undefined)) {
  throw new Error('Relay authentication requires both manager and Worker tokens');
}

const relay = await startAgentTeamsRelay({
  host,
  port,
  dataDir,
  logger: false,
  ...(managerToken === undefined || workerToken === undefined
    ? {}
    : { auth: { managerToken, workerToken } }),
});
process.stdout.write(
  `${JSON.stringify({ event: 'relay.started', httpUrl: relay.httpUrl, wsUrl: relay.wsUrl, dataDir, insecureLanMode: managerToken === undefined })}\n`
);

let stopping = false;
const stop = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`${JSON.stringify({ event: 'relay.stopping', signal })}\n`);
  await relay.close();
  process.exitCode = 0;
};

process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
