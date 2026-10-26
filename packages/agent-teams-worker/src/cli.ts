import { openDesktopChat } from './openDesktopChat';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  teamIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';

import {
  installCodexMcpRegistration,
  readCodexMcpRegistrationState,
  removeCodexMcpRegistration,
} from './codexMcpRegistration';
import {
  CodexAppServerDaemonFactory,
  CodexAppServerProcessFactory,
  defaultCodexDaemonSocketPath,
  resolveCodexAppServerMode,
} from './codexAppServerClient';
import { startAgentTeamsWorker } from './workerDaemon';
import { resolveWorkerBridgeLaunch } from './workerBridgeLaunch';
import { prepareWorkerCodexHome, resolveWorkerCodexHomePath } from './workerCodexHome';
import { diagnoseAgentTeamsWorker } from './workerDiagnostics';
import { readRuntimeConnectionPolicy } from './codexRuntimeConnections';
import { readLocalAccessPolicy } from './localAccessPolicy';
import { nativeComputerUseEnvironment, withNativeComputerUse } from './nativeComputerUse';

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

const configuredCodexHome = (dataDir: string): string =>
  resolveWorkerCodexHomePath(dataDir, valueAfter('--codex-home'));

/**
 * `--app-server-mode private-stdio` (default) spawns a private App Server child per session.
 * `--app-server-mode shared-daemon` drives the managed daemon of the Worker's Codex home instead,
 * so the owner can later attach to the same threads with `CODEX_HOME=<home> codex agents`.
 * `--app-server-socket <path>` overrides the daemon control socket location.
 * `--app-server-connect-only` requires that explicit socket and never starts a daemon.
 */
const configuredAppServer = (
  codexHome: string
): {
  readonly mode: 'private-stdio' | 'shared-daemon';
  readonly socketPath?: string;
  readonly connectOnly?: boolean;
} => {
  const mode = resolveCodexAppServerMode(valueAfter('--app-server-mode'));
  if (
    process.argv.includes('--app-server-connect-only') &&
    (mode !== 'shared-daemon' || valueAfter('--app-server-socket') === undefined)
  ) {
    throw new Error(
      '--app-server-connect-only requires shared-daemon mode and --app-server-socket'
    );
  }
  if (mode !== 'shared-daemon') return { mode };
  const explicitSocket = valueAfter('--app-server-socket');
  return {
    mode,
    connectOnly: process.argv.includes('--app-server-connect-only'),
    socketPath:
      explicitSocket === undefined
        ? defaultCodexDaemonSocketPath(codexHome)
        : resolveSocketPath(explicitSocket),
  };
};

const runSetup = async (): Promise<void> => {
  const dataDir = defaultDataDir();
  const controlSocketPath = defaultControlSocketPath(dataDir);
  const bridgeLaunch = resolveWorkerBridgeLaunch(import.meta.url, 'controlMcpCli');
  const explicitArgs = valuesAfter('--bridge-arg');
  const result = await installCodexMcpRegistration(defaultCodexConfigPath(), {
    command: valueAfter('--bridge-command', bridgeLaunch.command)!,
    args:
      explicitArgs.length > 0
        ? explicitArgs
        : [...bridgeLaunch.args, '--socket', controlSocketPath],
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
    codexHome: configuredCodexHome(dataDir),
    appServer: configuredAppServer(configuredCodexHome(dataDir)),
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
    codexHomePath: configuredCodexHome(dataDir),
  });
  printJson({ command: 'diagnose', ...report });
  if (!report.ok) process.exitCode = 1;
};

const runMcpRemove = async (): Promise<void> => {
  printJson({
    command: 'mcp-remove',
    ...(await removeCodexMcpRegistration(defaultCodexConfigPath())),
  });
};

const configuredConnections = () => {
  const path = valueAfter('--connections-config');
  return path === undefined ? undefined : readRuntimeConnectionPolicy(resolve(path));
};

const runWorker = async (): Promise<void> => {
  const relayUrl = valueAfter('--relay', 'ws://127.0.0.1:43170/v2/worker-stream')!;
  const relayToken = valueAfter('--relay-token', process.env.AGENT_TEAMS_RELAY_WORKER_TOKEN);
  const dataDir = defaultDataDir();
  const label = valueAfter('--label', 'Local Worker')!;
  const controlSocketPath = defaultControlSocketPath(dataDir);
  const workerCodexHome = await prepareWorkerCodexHome({
    dataDir,
    codexHome: valueAfter('--codex-home'),
  });
  const organizationId = organizationIdSchema.parse(valueAfter('--organization-id', randomUUID()));
  const personId = personIdSchema.parse(valueAfter('--person-id', randomUUID()));
  const nodeId = nodeIdSchema.parse(valueAfter('--node-id', randomUUID()));
  const workerInstanceId = workerInstanceIdSchema.parse(
    valueAfter('--worker-instance-id', randomUUID())
  );
  const runtimeCwd = valueAfter('--runtime-cwd');
  const autoJoinTeamIdValue = valueAfter(
    '--auto-join-team',
    process.env.AGENT_TEAMS_AUTO_JOIN_TEAM_ID
  );
  const autoJoinTeamId =
    autoJoinTeamIdValue === undefined ? undefined : teamIdSchema.parse(autoJoinTeamIdValue);
  const runtimeBridgeLaunch = resolveWorkerBridgeLaunch(import.meta.url, 'runtimeMcpCli');
  const runtimeMcpCommand = valueAfter('--runtime-mcp-command');
  const appServer = configuredAppServer(workerCodexHome.codexHome);
  const selectedConnections = await configuredConnections();
  const connections = process.argv.includes('--computer-use')
    ? await withNativeComputerUse(workerCodexHome.codexHome, selectedConnections)
    : selectedConnections;
  const runtimeEnv = nativeComputerUseEnvironment(workerCodexHome.env);
  const localAccessPath = valueAfter('--local-access-config');
  const localAccess =
    localAccessPath === undefined
      ? undefined
      : await readLocalAccessPolicy(resolve(localAccessPath));
  const worker = await startAgentTeamsWorker({
    relayUrl,
    ...(relayToken === undefined ? {} : { relayToken }),
    dataDir,
    label,
    controlSocketPath,
    organizationId,
    personId,
    nodeId,
    workerInstanceId,
    workerGeneration: 1,
    ...(autoJoinTeamId === undefined ? {} : { autoJoinTeamId }),
    reconnectDelayMs: 1_000,
    ...(runtimeCwd === undefined
      ? {}
      : {
          codexRuntime: {
            cwd: resolve(runtimeCwd),
            ...(process.platform === 'darwin' && valueAfter('--desktop-launcher')
              ? {
                  openDesktop: (threadId: string) =>
                    openDesktopChat(resolve(valueAfter('--desktop-launcher')!), threadId),
                }
              : {}),
            ...(localAccess === undefined ? {} : { localAccess }),
            sessionFactory:
              appServer.mode === 'shared-daemon'
                ? new CodexAppServerDaemonFactory({
                    connections,
                    binaryPath: valueAfter('--codex-binary', 'codex')!,
                    codexHome: workerCodexHome.codexHome,
                    env: runtimeEnv,
                    ensureDaemon: !process.argv.includes('--app-server-connect-only'),
                    ...(valueAfter('--app-server-socket') === undefined
                      ? {}
                      : { socketPath: appServer.socketPath }),
                  })
                : new CodexAppServerProcessFactory({
                    connections,
                    binaryPath: valueAfter('--codex-binary', 'codex')!,
                    env: runtimeEnv,
                  }),
            runtimeMcp: {
              connections,
              command: runtimeMcpCommand ?? runtimeBridgeLaunch.command,
              args: [
                ...(runtimeMcpCommand === undefined
                  ? runtimeBridgeLaunch.args
                  : [runtimeBridgeLaunch.entryPath]),
                '--socket',
                controlSocketPath,
              ],
              ...(appServer.mode === 'shared-daemon'
                ? { tokenFile: join(dataDir, 'runtime-session.token') }
                : {}),
            },
            ...(valueAfter('--runtime-model') === undefined
              ? {}
              : { model: valueAfter('--runtime-model') }),
          },
        }),
  });
  await worker.ready;
  printJson({
    event: 'worker.connected',
    ...worker.getStatus(),
    dataDir,
    codexHome: workerCodexHome.codexHome,
    appServer,
    controlSocketPath,
  });

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
