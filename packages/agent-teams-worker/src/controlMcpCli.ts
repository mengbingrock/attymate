import { resolve } from 'node:path';

import { createAgentTeamsControlMcpServer } from './controlMcpServer';

const valueAfter = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const rawSocketPath = valueAfter(
  '--socket',
  process.env.AGENT_TEAMS_WORKER_CONTROL_SOCKET ?? './worker-control.sock'
)!;
const socketPath = rawSocketPath.startsWith('\\\\.\\pipe\\')
  ? rawSocketPath
  : resolve(rawSocketPath);
const server = createAgentTeamsControlMcpServer(socketPath);
await server.start({ transportType: 'stdio' });
