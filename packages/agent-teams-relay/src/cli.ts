import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startAgentTeamsRelay } from './relayServer';
import { INSTALLER_PLATFORM_LABELS, type InstallerPlatform } from './relayJoinPortal';
import { startInstallerPortal } from './installerPortalServer';

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
const googleClientFile = process.env.AGENT_TEAMS_GOOGLE_CLIENT_FILE;
const googleClient = googleClientFile
  ? (JSON.parse(readFileSync(resolve(googleClientFile), 'utf8')).web as
      | { client_id?: string; client_secret?: string }
      | undefined)
  : undefined;
if (googleClientFile && (!googleClient?.client_id || !googleClient?.client_secret))
  throw new Error('Google OAuth client file must contain a web client ID and secret');
const accountsEnabled = process.argv.includes('--accounts') || googleClient !== undefined;
const readDistribution = (prefix: '--join' | '--join-stock') => {
  const templatePath = valueAfter(prefix + '-installer-template');
  const windowsTemplatePath = valueAfter(prefix + '-windows-installer-template');
  const bundlePath = valueAfter(prefix + '-worker-bundle');
  const platformBundles: Partial<Record<InstallerPlatform, Buffer>> = {};
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] !== prefix + '-worker-bundle-platform') continue;
    const entry = process.argv[index + 1] ?? '';
    const separator = entry.indexOf('=');
    const platform = entry.slice(0, separator);
    const path = entry.slice(separator + 1);
    if (separator < 1 || !path || !Object.hasOwn(INSTALLER_PLATFORM_LABELS, platform)) {
      throw new Error(prefix + '-worker-bundle-platform requires a supported platform=path');
    }
    if (platformBundles[platform as InstallerPlatform] !== undefined)
      throw new Error(`Duplicate installer platform: ${platform}`);
    platformBundles[platform as InstallerPlatform] = readFileSync(resolve(path));
  }
  const hasBundle = bundlePath !== undefined || Object.keys(platformBundles).length > 0;
  if (
    (templatePath !== undefined) !== hasBundle ||
    (windowsTemplatePath !== undefined && !hasBundle)
  ) {
    throw new Error(
      prefix +
        '-installer-template requires ' +
        prefix +
        '-worker-bundle or ' +
        prefix +
        '-worker-bundle-platform, and vice versa'
    );
  }
  return templatePath === undefined
    ? undefined
    : {
        template: readFileSync(resolve(templatePath), 'utf8'),
        ...(windowsTemplatePath === undefined
          ? {}
          : { windowsTemplate: readFileSync(resolve(windowsTemplatePath), 'utf8') }),
        ...(bundlePath === undefined ? {} : { workerBundleTgz: readFileSync(resolve(bundlePath)) }),
        platformBundles,
      };
};
const forkInstaller = readDistribution('--join');
const stockInstaller = readDistribution('--join-stock');
const repoUrl = valueAfter('--join-repo-url');
const repoBranch = valueAfter('--join-repo-branch');
if ((repoUrl === undefined) !== (repoBranch === undefined)) {
  throw new Error('--join-repo-url and --join-repo-branch must be given together');
}
const joinPortal =
  publicUrl === undefined
    ? undefined
    : {
        publicUrl,
        ...(accountsEnabled
          ? {
              accounts:
                googleClient?.client_id && googleClient.client_secret
                  ? {
                      google: {
                        clientId: googleClient.client_id,
                        clientSecret: googleClient.client_secret,
                      },
                    }
                  : {},
            }
          : {}),
        ...(forkInstaller === undefined && stockInstaller === undefined
          ? {}
          : {
              installer: {
                ...(forkInstaller ?? { template: stockInstaller!.template }),
                ...(stockInstaller === undefined ? {} : { stock: stockInstaller }),
              },
            }),
        ...(repoUrl === undefined || repoBranch === undefined
          ? {}
          : { repository: { url: repoUrl, branch: repoBranch } }),
      };

const portalOnly = process.argv.includes('--installer-portal-only');
if (portalOnly && joinPortal === undefined)
  throw new Error('--installer-portal-only requires --public-url and installer bundles');
const relay = portalOnly
  ? await startInstallerPortal({
      host,
      port,
      upstreamUrl: valueAfter('--upstream-url', 'http://127.0.0.1:43181')!,
      joinPortal: joinPortal!,
    })
  : await startAgentTeamsRelay({
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
