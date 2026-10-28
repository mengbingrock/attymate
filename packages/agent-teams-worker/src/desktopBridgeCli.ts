import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { attachDesktopTransport } from './desktopTransport';
import { CodexAppServerDaemonFactory } from './codexAppServerClient';
import { checkDesktopCompatibility } from './desktopCompatibility';

const [socket, control, home, userData, executable, ...args] = process.argv.slice(2);
if (!socket || !control || !home || !userData || !executable)
  throw new Error('Desktop launcher arguments missing');
await checkDesktopCompatibility(
  new CodexAppServerDaemonFactory({
    binaryPath: process.execPath,
    codexHome: home,
    socketPath: socket,
    ensureDaemon: false,
  })
);
const capability = '/' + randomBytes(32).toString('hex');
const server = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});
const closeTransport = attachDesktopTransport(server, capability, socket, control);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Desktop bridge did not bind');
const env = {
  ...process.env,
  CODEX_HOME: home,
  CODEX_APP_SERVER_WS_URL: `ws://127.0.0.1:${address.port}${capability}`,
  CODEX_ELECTRON_USER_DATA_PATH: userData,
};
delete env.CODEX_APP_SERVER_FORCE_CLI;
delete env.CODEX_CLI_PATH;
const child = spawn(executable, args, { env, stdio: 'inherit' });
const pidFile = join(userData, 'team-desktop.pid');
if (child.pid) writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
const cleanup = () => {
  closeTransport();
  server.close();
  try {
    unlinkSync(pidFile);
  } catch {
    /* already closed */
  }
};
child.on('error', () => {
  process.exitCode = 1;
  cleanup();
});
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
  cleanup();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    child.kill(signal);
    cleanup();
  });
