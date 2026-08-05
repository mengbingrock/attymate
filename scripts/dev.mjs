#!/usr/bin/env node

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureMinimumNodeOldSpaceEnv } from './lib/node-options.mjs';
import { spawnSyncWithWindowsShell } from './lib/windows-shell-spawn.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiRepoRoot = path.resolve(scriptDir, '..');
const scriptArgs = process.argv.slice(2);
const electronViteArgs = scriptArgs.filter((arg) => arg !== '--');
const remoteDebuggingPortArg = '--remoteDebuggingPort';
const terminalPlatformRootEnv = 'CLAUDE_TERMINAL_PLATFORM_ROOT';
const legacyTerminalPlatformRootEnv = 'TERMINAL_PLATFORM_ROOT';
const terminalDaemonBinaryEnv = 'CLAUDE_TERMINAL_DAEMON_BINARY';
const organizationDemoEnv = 'AGENT_TEAMS_ORG_DEMO';

function prependPathEntries(entries) {
  const currentPath = process.env.PATH ?? '';
  const currentEntries = new Set(currentPath.split(path.delimiter).filter(Boolean));
  const nextEntries = [];

  for (const entry of entries) {
    if (!entry || currentEntries.has(entry) || !fs.existsSync(entry)) {
      continue;
    }
    nextEntries.push(entry);
  }

  if (nextEntries.length > 0) {
    process.env.PATH = [...nextEntries, currentPath].filter(Boolean).join(path.delimiter);
  }
}

function augmentToolPath() {
  const bunInstall = process.env.BUN_INSTALL?.trim();
  const home = os.homedir();
  prependPathEntries([
    bunInstall ? path.join(bunInstall, 'bin') : '',
    home ? path.join(home, '.bun', 'bin') : '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]);
}

function runOrExit(cmd, args, options = {}) {
  const result = spawnSyncWithWindowsShell(cmd, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    console.error(`Failed to run ${cmd}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveOrganizationDemoMode() {
  const rawValue = process.env[organizationDemoEnv]?.trim().toLowerCase() ?? '';

  if (!rawValue || ['0', 'false', 'no', 'off'].includes(rawValue)) {
    return 'off';
  }

  if (['1', 'true', 'yes', 'on', 'seed', 'demo'].includes(rawValue)) {
    return 'seed';
  }

  if (['restore', 'reset'].includes(rawValue)) {
    return 'restore';
  }

  console.error(`${organizationDemoEnv} must be one of: 1, true, seed, restore, 0, false, off.`);
  process.exit(1);
}

function applyOrganizationDemoMode() {
  const demoMode = resolveOrganizationDemoMode();

  if (demoMode === 'off') {
    return false;
  }

  const seedArgs = [path.join(scriptDir, 'seed-organization-map-demo.mjs')];
  if (demoMode === 'restore') {
    seedArgs.push('--restore');
  }

  runOrExit(process.execPath, seedArgs, {
    cwd: uiRepoRoot,
    env: process.env,
  });

  return demoMode === 'restore';
}

function hasTerminalPlatformOverride() {
  return Boolean(
    process.env[terminalPlatformRootEnv]?.trim() ||
      process.env[legacyTerminalPlatformRootEnv]?.trim() ||
      process.env[terminalDaemonBinaryEnv]?.trim()
  );
}

function ensureTerminalPlatformRuntime(env) {
  if (hasTerminalPlatformOverride()) {
    const overrideName = process.env[terminalDaemonBinaryEnv]?.trim()
      ? terminalDaemonBinaryEnv
      : process.env[terminalPlatformRootEnv]?.trim()
        ? terminalPlatformRootEnv
        : legacyTerminalPlatformRootEnv;
    process.stdout.write(`Using terminal-platform runtime from ${overrideName}\n`);
    return;
  }

  runOrExit(process.execPath, [path.join(scriptDir, 'ensure-terminal-platform-runtime.mjs')], {
    cwd: uiRepoRoot,
    env,
  });
}

function readPackageManagerCommand(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const rawPackageJson = fs.readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(rawPackageJson);
  const rawPackageManager = packageJson.packageManager;

  if (typeof rawPackageManager !== 'string' || rawPackageManager.trim().length === 0) {
    return 'pnpm';
  }

  const [packageManagerName] = rawPackageManager.trim().split('@', 1);
  if (!packageManagerName) {
    return 'pnpm';
  }

  return packageManagerName;
}

function parseRemoteDebuggingPortArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === remoteDebuggingPortArg) {
      const rawPort = args[index + 1];
      const port = Number.parseInt(rawPort ?? '', 10);
      return Number.isFinite(port) && port > 0
        ? { index, valueIndex: index + 1, port, style: 'split' }
        : null;
    }

    const prefix = `${remoteDebuggingPortArg}=`;
    if (arg.startsWith(prefix)) {
      const port = Number.parseInt(arg.slice(prefix.length), 10);
      return Number.isFinite(port) && port > 0 ? { index, port, style: 'equals' } : null;
    }
  }

  return null;
}

function isTcpPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;

    const finish = (available) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(available);
    };

    server.unref();
    server.once('error', () => finish(false));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => finish(true));
    });
  });
}

async function findAvailableTcpPort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (await isTcpPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available remote debugging port near ${preferredPort}`);
}

async function resolveElectronViteArgs(args) {
  const remoteDebuggingPort = parseRemoteDebuggingPortArg(args);
  if (!remoteDebuggingPort) {
    return args;
  }

  const availablePort = await findAvailableTcpPort(remoteDebuggingPort.port);
  if (availablePort === remoteDebuggingPort.port) {
    return args;
  }

  process.stdout.write(
    `Remote debugging port ${remoteDebuggingPort.port} is busy; using ${availablePort}.\n`
  );

  const nextArgs = [...args];
  if (remoteDebuggingPort.style === 'split') {
    nextArgs[remoteDebuggingPort.valueIndex] = String(availablePort);
  } else {
    nextArgs[remoteDebuggingPort.index] = `${remoteDebuggingPortArg}=${availablePort}`;
  }

  return nextArgs;
}

async function main() {
  augmentToolPath();

  if (applyOrganizationDemoMode()) {
    return;
  }

  const uiEnv = {
    ...process.env,
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE?.trim() || '16',
  };
  ensureMinimumNodeOldSpaceEnv(uiEnv);
  const uiPackageManager = readPackageManagerCommand(uiRepoRoot);
  const resolvedElectronViteArgs = await resolveElectronViteArgs(electronViteArgs);

  runOrExit(process.execPath, [path.join(scriptDir, 'ensure-electron-install.cjs'), '--strict'], {
    cwd: uiRepoRoot,
    env: uiEnv,
  });

  ensureTerminalPlatformRuntime(uiEnv);

  runOrExit(uiPackageManager, ['exec', 'electron-vite', 'dev', ...resolvedElectronViteArgs], {
    cwd: uiRepoRoot,
    env: uiEnv,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
