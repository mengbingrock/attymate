// Real Windows installation against a fresh local relay/home/workspace, without model turns.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';

if (process.platform !== 'win32') throw new Error('Run this smoke on a Windows runner');
const kit = resolve(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), 'agent-teams-windows-smoke-'));
const install = join(root, 'installation with spaces');
const home = join(root, 'existing codex login');
mkdirSync(home);
writeFileSync(
  join(home, 'auth.json'),
  JSON.stringify({ OPENAI_API_KEY: 'sk-test-only-no-provider-calls' })
);
const manager = randomBytes(32).toString('hex');
const workerToken = randomBytes(32).toString('hex');
const env = {
  ...process.env,
  OPENAI_API_KEY: 'sk-test-only-no-provider-calls',
  CODEX_HOME: home,
  AGENT_TEAMS_RELAY_MANAGER_TOKEN: manager,
  AGENT_TEAMS_RELAY_WORKER_TOKEN: workerToken,
};
const waitFor = async (test, timeout = 60000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await test();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Smoke timed out');
};
const relay = spawn(
  process.execPath,
  [
    join(kit, 'mac-relay-test.mjs'),
    '--host',
    '127.0.0.1',
    '--port',
    '0',
    '--data-dir',
    join(root, 'relay'),
  ],
  { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
);
let output = '';
relay.stdout.on('data', (chunk) => {
  output += chunk;
});
relay.stderr.on('data', (chunk) => {
  output += chunk;
});
const sockets = [];
try {
  const address = await waitFor(() => {
    if (relay.exitCode !== null) throw new Error('Test relay exited: ' + output);
    for (const line of output.split('\n')) {
      try {
        const value = JSON.parse(line);
        if (value.event === 'relay.started') return value;
      } catch {
        /* incomplete */
      }
    }
  });
  const created = await fetch(address.httpUrl + '/v2/team-directory', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + manager, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Windows installer smoke', coordination: 'leaderless' }),
  }).then((r) => r.json());
  assert.ok(created.team?.teamId);
  const installer = join(root, 'join.ps1');
  const template = readFileSync('packages/agent-teams-worker/installer/install-windows.ps1', 'utf8')
    .replace('__RELAY_URL__', address.wsUrl)
    .replace('__WORKER_TOKEN__', created.joinToken)
    .replace('__TEAM_ID__', created.team.teamId);
  const archive = readFileSync(process.argv[3]);
  writeFileSync(
    installer,
    template +
      '\n' +
      archive
        .toString('base64')
        .match(/.{1,65536}/g)
        .join('\n') +
      '\n#>\n'
  );
  const installed = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      installer,
      '-Dir',
      install,
      '-Label',
      'Windows isolated smoke',
      '-NoService',
    ],
    { env, encoding: 'utf8', timeout: 180000, windowsHide: true }
  );
  writeFileSync(
    join(root, 'installer-output.log'),
    (installed.stdout || '') + (installed.stderr || '')
  );
  if (installed.status !== 0) {
    const logs = ['supervisor.log', 'app-server.log']
      .map((name) => {
        const path = join(install, 'logs', name);
        return existsSync(path) ? name + ':\n' + readFileSync(path, 'utf8').slice(-5000) : '';
      })
      .join('\n');
    throw new Error('Installer failed: ' + installed.stdout + installed.stderr + '\n' + logs);
  }
  const config = JSON.parse(readFileSync(join(install, 'config.json'), 'utf8'));
  assert.equal(config.home, home);
  assert.equal(existsSync(join(install, 'codex-home')), false);
  const url = JSON.parse(readFileSync(join(install, 'data', 'app-server.json'), 'utf8')).url;
  await waitFor(async () => {
    const result = await fetch(address.httpUrl + '/v2/workers', {
      headers: { authorization: 'Bearer ' + manager },
    }).then((r) => r.json());
    return result.workers?.some(
      (w) => w.identity?.nodeId === config.nodeId || w.nodeId === config.nodeId
    );
  });
  assert.ok(existsSync(join(install, 'data', 'desktop-pairing-code')));
  const unauthorized = new WebSocket(url);
  await new Promise((resolve, reject) => {
    unauthorized.once('unexpected-response', (_req, res) => {
      assert.equal(res.statusCode, 401);
      res.destroy();
      unauthorized.terminate();
      resolve();
    });
    unauthorized.on('error', () => {});
    unauthorized.once('open', () =>
      reject(new Error('Unauthenticated App Server connection accepted'))
    );
  });
  for (let i = 0; i < 2; i++) {
    const socket = new WebSocket(url, {
      headers: { authorization: 'Bearer ' + config.serverToken },
    });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const initialized = new Promise((resolve, reject) => {
      socket.on('message', (data) => {
        const value = JSON.parse(data.toString());
        if (value.id === 1)
          value.error ? reject(new Error(JSON.stringify(value.error))) : resolve(value.result);
      });
    });
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'windows-smoke-' + i, version: '1' },
          capabilities: { experimentalApi: true },
        },
      })
    );
    await initialized;
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));
  }
  console.log(
    'WINDOWS_INSTALLER_SMOKE_OK: native fork, private install with spaces, relay connection, two authenticated clients, rejected missing token, pairing code, shared existing-home selection verified.'
  );
} finally {
  for (const socket of sockets) socket.terminate();
  if (existsSync(join(install, 'config.json')))
    spawnSync(process.execPath, [join(install, 'worker', 'windows-install.mjs'), 'stop', install], {
      stdio: 'inherit',
      windowsHide: true,
    });
  relay.kill();
  console.log('Smoke artifacts: ' + root);
}
