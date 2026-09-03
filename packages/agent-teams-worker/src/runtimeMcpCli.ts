import { resolve } from 'node:path';

import { createAgentTeamsRuntimeMcpServer } from './runtimeMcpServer';

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
const token = process.env.AGENT_TEAMS_RUNTIME_SESSION_TOKEN;
if (token === undefined) throw new Error('AGENT_TEAMS_RUNTIME_SESSION_TOKEN is required');
const teamRole = process.env.AGENT_TEAMS_RUNTIME_TEAM_ROLE;
if (teamRole !== 'lead' && teamRole !== 'member') {
  throw new Error('AGENT_TEAMS_RUNTIME_TEAM_ROLE must be lead or member');
}

const server = createAgentTeamsRuntimeMcpServer(socketPath, token, teamRole);
await server.start({ transportType: 'stdio' });
