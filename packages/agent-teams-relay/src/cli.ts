import { readFileSync } from 'node:fs';
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

/**
 * The public join portal is off unless --public-url is given. --join-installer-template and
 * --join-worker-bundle (a .tgz of cli.js, controlMcpCli.js, runtimeMcpCli.js) enable installer
 * downloads; --join-repo-url with --join-repo-branch enables the clone-and-run instructions.
 */
const publicUrl = valueAfter('--public-url');
const installerTemplatePath = valueAfter('--join-installer-template');
const workerBundlePath = valueAfter('--join-worker-bundle');
const repoUrl = valueAfter('--join-repo-url');
const repoBranch = valueAfter('--join-repo-branch');
if ((installerTemplatePath === undefined) !== (workerBundlePath === undefined)) {
  throw new Error('--join-installer-template and --join-worker-bundle must be given together');
}
if ((repoUrl === undefined) !== (repoBranch === undefined)) {
  throw new Error('--join-repo-url and --join-repo-branch must be given together');
}
const joinPortal =
  publicUrl === undefined
    ? undefined
    : {
        publicUrl,
        ...(installerTemplatePath === undefined || workerBundlePath === undefined
          ? {}
          : {
              installer: {
                template: readFileSync(resolve(installerTemplatePath), 'utf8'),
                workerBundleTgz: readFileSync(resolve(workerBundlePath)),
              },
            }),
        ...(repoUrl === undefined || repoBranch === undefined
          ? {}
          : { repository: { url: repoUrl, branch: repoBranch } }),
      };

const relay = await startAgentTeamsRelay({
  host,
  port,
  dataDir,
  logger: false,
  ...(managerToken === undefined || workerToken === undefined
    ? {}
    : { auth: { managerToken, workerToken } }),
  ...(joinPortal === undefined ? {} : { joinPortal }),
});
process.stdout.write(
  `${JSON.stringify({ event: 'relay.started', httpUrl: relay.httpUrl, wsUrl: relay.wsUrl, dataDir, insecureLanMode: managerToken === undefined, joinPortal: joinPortal === undefined ? 'off' : { publicUrl, installer: joinPortal.installer !== undefined, repository: joinPortal.repository !== undefined } })}\n`
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
