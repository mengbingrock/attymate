import { openDesktopChat } from './openDesktopChat';
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
  controlMcpServerNameForInstallation,
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
import { readRuntimeOwnerKeyring } from './runtimeOwnerAuthorization';
import { createOwnerRuntimeClient } from './ownerRuntimeClient';
import { readFile } from 'node:fs/promises';
import { runtimeControlSchema } from '@claude-teams/agent-teams-protocol';
import { nativeComputerUseEnvironment, withNativeComputerUse } from './nativeComputerUse';
import {
  inspectRuntimeBinary,
  messageDeliveryModeSchema,
  prepareWorkerIdentity,
  readRuntimeInstallation,
  runtimeKindSchema,
  serverOwnershipSchema,
  saveRuntimeControlMcpTarget,
  writeRuntimeInstallation,
  type RuntimeInstallation,
} from './runtimeInstallation';
import { probeStockCodexCompatibility } from './codexRuntimeCompatibility';
import { randomUUID } from 'node:crypto';
import { acquireWorkerProcessLock } from './workerProcessLock';

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

const defaultCodexConfigPath = (installation?: RuntimeInstallation): string => {
  const codexRoot =
    installation?.codexHome ?? (process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'));
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
  codexHome: string,
  installation?: RuntimeInstallation
): {
  readonly mode: 'private-stdio' | 'shared-daemon';
  readonly socketPath?: string;
  readonly connectOnly?: boolean;
} => {
  const mode = resolveCodexAppServerMode(
    valueAfter('--app-server-mode', installation?.appServerMode)
  );
  const ownership = serverOwnershipSchema.parse(
    valueAfter('--server-ownership', installation?.serverOwnership ?? 'managed')
  );
  const explicitSocket = valueAfter('--app-server-socket', installation?.endpoint);
  const connectOnly =
    process.argv.includes('--app-server-connect-only') || ownership === 'external';
  if (connectOnly && (mode !== 'shared-daemon' || explicitSocket === undefined)) {
    throw new Error(
      '--app-server-connect-only requires shared-daemon mode and --app-server-socket'
    );
  }
  if (mode !== 'shared-daemon') return { mode };
  return {
    mode,
    connectOnly,
    socketPath:
      explicitSocket === undefined
        ? defaultCodexDaemonSocketPath(codexHome)
        : explicitSocket.startsWith('ws:')
          ? explicitSocket
          : resolveSocketPath(explicitSocket),
  };
};

const runSetup = async (): Promise<void> => {
  const dataDir = defaultDataDir();
  const installation = await readRuntimeInstallation(dataDir);
  const controlSocketPath =
    valueAfter('--control-socket', installation?.controlSocketPath) ??
    defaultControlSocketPath(dataDir);
  const bridgeLaunch = resolveWorkerBridgeLaunch(import.meta.url, 'controlMcpCli');
  const explicitArgs = valuesAfter('--bridge-arg');
  const spec = {
    serverName: valueAfter('--control-mcp-name', installation?.controlMcpName),
    command: valueAfter('--bridge-command', bridgeLaunch.command)!,
    args:
      explicitArgs.length > 0
        ? explicitArgs
        : [...bridgeLaunch.args, '--socket', controlSocketPath],
  };
  const result = await installCodexMcpRegistration(defaultCodexConfigPath(installation), spec);
  if (
    installation &&
    result.state.status === 'managed' &&
    (spec.serverName ?? 'agent-teams-control') === installation.controlMcpName
  ) {
    await saveRuntimeControlMcpTarget(dataDir, installation.controlMcpName, {
      command: spec.command,
      args: [...spec.args],
    });
  }
  printJson({ command: 'setup', controlSocketPath, ...result });
  if (result.state.status === 'conflict' || result.state.status === 'invalid') {
    process.exitCode = 2;
  }
};

const runStatus = async (): Promise<void> => {
  const dataDir = defaultDataDir();
  const installation = await readRuntimeInstallation(dataDir);
  const codexHome =
    valueAfter('--codex-home', installation?.codexHome) ?? configuredCodexHome(dataDir);
  printJson({
    command: 'status',
    dataDir,
    codexHome,
    appServer: configuredAppServer(codexHome, installation),
    ...(installation ? { runtimeInstallation: installation } : {}),
    controlSocketPath:
      valueAfter('--control-socket', installation?.controlSocketPath) ??
      defaultControlSocketPath(dataDir),
    codexMcp: {
      configPath: defaultCodexConfigPath(installation),
      state: await readCodexMcpRegistrationState(
        defaultCodexConfigPath(installation),
        valueAfter('--control-mcp-name', installation?.controlMcpName)
      ),
    },
  });
};

const runDiagnose = async (): Promise<void> => {
  const dataDir = defaultDataDir();
  const installation = await readRuntimeInstallation(dataDir);
  const report = await diagnoseAgentTeamsWorker({
    codexMcpServerName: valueAfter('--control-mcp-name', installation?.controlMcpName),
    codexConfigPath: defaultCodexConfigPath(installation),
    statusPath: join(dataDir, 'worker-status.json'),
    controlSocketPath:
      valueAfter('--control-socket', installation?.controlSocketPath) ??
      defaultControlSocketPath(dataDir),
    codexHomePath:
      valueAfter('--codex-home', installation?.codexHome) ?? configuredCodexHome(dataDir),
  });
  printJson({
    command: 'diagnose',
    ...(installation ? { runtimeInstallation: installation } : {}),
    ...report,
  });
  if (!report.ok) process.exitCode = 1;
};

const runMcpRemove = async (): Promise<void> => {
  const installation = await readRuntimeInstallation(defaultDataDir());
  const serverName = valueAfter('--control-mcp-name', installation?.controlMcpName);
  const savedTarget =
    serverName === installation?.controlMcpName ? installation?.controlMcpTarget : undefined;
  // NoStart installations may have registered control MCP before their first Worker launch.
  // An explicit socket/bridge identifies the expected owner even without runtime metadata.
  const explicitArgs = valuesAfter('--bridge-arg');
  const bridgeLaunch = resolveWorkerBridgeLaunch(import.meta.url, 'controlMcpCli');
  const expectedTarget =
    savedTarget ??
    (valueAfter('--control-socket') || valueAfter('--bridge-command') || explicitArgs.length
      ? {
          command: valueAfter('--bridge-command', bridgeLaunch.command)!,
          args: explicitArgs.length
            ? explicitArgs
            : [...bridgeLaunch.args, '--socket', defaultControlSocketPath(defaultDataDir())],
        }
      : undefined);
  const result = await removeCodexMcpRegistration(
    defaultCodexConfigPath(installation),
    serverName,
    expectedTarget
  );
  printJson({ command: 'mcp-remove', ...result });
  if (result.state.status === 'conflict' || result.state.status === 'invalid') process.exitCode = 2;
};

const configuredConnections = () => {
  const path = valueAfter('--connections-config');
  return path === undefined ? undefined : readRuntimeConnectionPolicy(resolve(path));
};

const runWorker = async (): Promise<void> => {
  const relayUrl = valueAfter('--relay', 'ws://127.0.0.1:43170/v2/worker-stream')!;
  const relayToken = valueAfter('--relay-token', process.env.AGENT_TEAMS_RELAY_WORKER_TOKEN);
  const dataDir = defaultDataDir();
  const releaseProcessLock = await acquireWorkerProcessLock(dataDir);
  process.once('exit', releaseProcessLock);
  const previousInstallation = await readRuntimeInstallation(dataDir);
  const serverOwnership = serverOwnershipSchema.parse(
    valueAfter('--server-ownership', previousInstallation?.serverOwnership ?? 'managed')
  );
  if (
    serverOwnership === 'external' &&
    valueAfter('--codex-home', previousInstallation?.codexHome) === undefined
  ) {
    throw new Error(
      'External App Server connections require an explicit --codex-home matching that server'
    );
  }
  const kindValue = valueAfter('--runtime-kind', previousInstallation?.runtimeKind);
  const runtimeKind = kindValue === undefined ? undefined : runtimeKindSchema.parse(kindValue);
  const messageDeliveryMode = messageDeliveryModeSchema.parse(
    valueAfter(
      '--message-delivery-mode',
      previousInstallation?.messageDeliveryMode ??
        (runtimeKind === 'stock' ? 'mcp-inbox' : 'inline')
    )
  );
  if (previousInstallation && runtimeKind !== previousInstallation.runtimeKind) {
    throw new Error(
      'This data directory belongs to another runtime kind; choose a separate --data-dir'
    );
  }
  const label = valueAfter('--label', 'Local Worker')!;
  const controlSocketPath =
    valueAfter('--control-socket', previousInstallation?.controlSocketPath) ??
    defaultControlSocketPath(dataDir);
  const workerCodexHome = await prepareWorkerCodexHome({
    dataDir,
    codexHome: valueAfter('--codex-home', previousInstallation?.codexHome),
    reuseExistingLogin: runtimeKind === 'stock',
  });
  const identity = await prepareWorkerIdentity(dataDir, {
    ...(valueAfter('--organization-id')
      ? { organizationId: organizationIdSchema.parse(valueAfter('--organization-id')) }
      : {}),
    ...(valueAfter('--person-id')
      ? { personId: personIdSchema.parse(valueAfter('--person-id')) }
      : {}),
    ...(valueAfter('--node-id') ? { nodeId: nodeIdSchema.parse(valueAfter('--node-id')) } : {}),
    ...(valueAfter('--worker-instance-id')
      ? { workerInstanceId: workerInstanceIdSchema.parse(valueAfter('--worker-instance-id')) }
      : {}),
  });
  const runtimeCwd = valueAfter('--runtime-cwd', previousInstallation?.runtimeCwd);
  const autoJoinTeamIdValue = valueAfter(
    '--auto-join-team',
    process.env.AGENT_TEAMS_AUTO_JOIN_TEAM_ID
  );
  const autoJoinTeamId =
    autoJoinTeamIdValue === undefined ? undefined : teamIdSchema.parse(autoJoinTeamIdValue);
  const runtimeBridgeLaunch = resolveWorkerBridgeLaunch(import.meta.url, 'runtimeMcpCli');
  const runtimeMcpCommand = valueAfter('--runtime-mcp-command');
  const appServer = configuredAppServer(workerCodexHome.codexHome, previousInstallation);
  const selectedConnections = await configuredConnections();
  const connections = process.argv.includes('--computer-use')
    ? await withNativeComputerUse(workerCodexHome.codexHome, selectedConnections)
    : selectedConnections;
  const runtimeEnv = nativeComputerUseEnvironment(workerCodexHome.env);
  const binary =
    runtimeKind === undefined
      ? undefined
      : await inspectRuntimeBinary(
          valueAfter('--codex-binary', previousInstallation?.binaryPath ?? 'codex')!,
          runtimeEnv
        );
  const binaryPath = binary?.binaryPath ?? valueAfter('--codex-binary', 'codex')!;
  const sessionFactory =
    appServer.mode === 'shared-daemon'
      ? new CodexAppServerDaemonFactory({
          connections,
          binaryPath,
          codexHome: workerCodexHome.codexHome,
          env: runtimeEnv,
          ensureDaemon: !appServer.connectOnly,
          ...(appServer.socketPath === undefined ? {} : { socketPath: appServer.socketPath }),
        })
      : new CodexAppServerProcessFactory({ connections, binaryPath, env: runtimeEnv });
  if (runtimeKind !== undefined && binary !== undefined) {
    const installationId = valueAfter(
      '--installation-id',
      previousInstallation?.installationId ?? randomUUID()
    )!;
    const probe =
      runtimeKind === 'stock'
        ? await probeStockCodexCompatibility({
            binaryPath,
            env: runtimeEnv,
            factory: sessionFactory,
            shared: appServer.mode === 'shared-daemon',
            expectedVersion: binary.binaryVersion,
          })
        : { checks: ['version'] };
    await writeRuntimeInstallation(dataDir, {
      schemaVersion: 1,
      installationId,
      runtimeKind,
      messageDeliveryMode,
      serverOwnership,
      appServerMode: appServer.mode,
      controlSocketPath,
      ...(runtimeCwd ? { runtimeCwd: resolve(runtimeCwd) } : {}),
      ...(appServer.socketPath === undefined ? {} : { endpoint: appServer.socketPath }),
      codexHome: workerCodexHome.codexHome,
      ...binary,
      controlMcpName: valueAfter(
        '--control-mcp-name',
        previousInstallation?.controlMcpName ?? controlMcpServerNameForInstallation(installationId)
      )!,
      checkedAt: new Date().toISOString(),
      ...(previousInstallation?.controlMcpTarget
        ? { controlMcpTarget: previousInstallation.controlMcpTarget }
        : {}),
      ...probe,
      checks: [...probe.checks],
    });
  }
  const localAccessPath = valueAfter('--local-access-config');
  const localAccess =
    localAccessPath === undefined
      ? undefined
      : await readLocalAccessPolicy(resolve(localAccessPath));
  const worker = await startAgentTeamsWorker({
    ...(valueAfter('--owner-keyring')
      ? { runtimeOwnerKeys: await readRuntimeOwnerKeyring(resolve(valueAfter('--owner-keyring')!)) }
      : {}),
    relayUrl,
    ...(relayToken === undefined ? {} : { relayToken }),
    dataDir,
    messageDeliveryMode,
    label,
    controlSocketPath,
    ...identity,
    organizationId: organizationIdSchema.parse(identity.organizationId),
    personId: personIdSchema.parse(identity.personId),
    nodeId: nodeIdSchema.parse(identity.nodeId),
    workerInstanceId: workerInstanceIdSchema.parse(identity.workerInstanceId),
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
            sessionFactory,
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
    releaseProcessLock();
    process.off('exit', releaseProcessLock);
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
  case 'owner-runtime': {
    const dataDir = defaultDataDir();
    const installation = await readRuntimeInstallation(dataDir);
    const client = await createOwnerRuntimeClient(
      valueAfter('--control-socket', installation?.controlSocketPath) ??
        defaultControlSocketPath(dataDir),
      valueAfter('--relay-http-url')
    );
    const controlFile = valueAfter('--control-file');
    if (controlFile) {
      const control = runtimeControlSchema.parse(
        JSON.parse(await readFile(resolve(controlFile), 'utf8'))
      );
      printJson(await client.control(control));
    } else {
      // This is the device owner's local interface, not a shared management projection.
      printJson(await client.read());
    }
    break;
  }
  case 'start':
    await runWorker();
    break;
  default:
    throw new Error(`Unknown agent-teams-worker command: ${command}`);
}
