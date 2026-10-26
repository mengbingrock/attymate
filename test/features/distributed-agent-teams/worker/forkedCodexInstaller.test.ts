// @vitest-environment node
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const installerRoot = resolve('packages/agent-teams-worker/installer');
const wsModule = createRequire(import.meta.url).resolve('ws');
const team = '40000000-0000-4000-8000-000000000001';
const platform = `${process.platform}-${process.arch}`;

describe.skipIf(process.platform === 'win32')('forked Codex deployment', () => {
  let root: string;
  let source: string;
  let bundle: string;
  let install: string;
  let installer: string;
  let longTemporaryDirectory: string;
  let supervisorPid: number | undefined;

  beforeEach(async () => {
    root = await mkdtemp('/tmp/agt-fork-');
    source = join(root, 'fork');
    bundle = join(root, 'bundle');
    install = join(root, 'member with spaces');
    installer = join(root, 'install.sh');
    longTemporaryDirectory = join(root, 'macos-user-temporary-directory-' + 'x'.repeat(80));
    await mkdir(longTemporaryDirectory);
    await mkdir(join(source, 'bin'), { recursive: true });
    await mkdir(bundle);
    await mkdir(join(root, '.codex'), { mode: 0o700 });
    await writeFile(join(root, '.codex/config.toml'), 'model = "personal-model"\n');
    await writeFile(join(root, '.codex/auth.json'), '{"testCredential":"do-not-copy"}');
    // Fake fork: real Unix WebSocket transport, no provider calls or personal Codex home.
    await writeFile(
      join(source, 'bin/codex'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const { createServer } = require('node:http');
const { WebSocket, WebSocketServer } = require(${JSON.stringify(wsModule)});
const args = process.argv.slice(2);
const rawArgs = [...args];
while (args[0] === '-c') args.splice(0, 2);
fs.appendFileSync(${JSON.stringify(join(root, 'fork-calls.jsonl'))}, JSON.stringify({ args, rawArgs, home: process.env.CODEX_HOME }) + '\\n');
if (args[0] === '--version') console.log('codex-cli test-fork');
else if (args[0] === 'login') process.exit(0);
else if (args[0] === 'app-server') {
  if (args[1] !== '--listen') throw new Error('Unexpected daemon launch');
  const socket = args[2].slice('unix://'.length);
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', client => client.on('message', data => {
    const message = JSON.parse(data.toString());
    client.send(JSON.stringify({ id: message.id, result: { userAgent: 'test-fork' } }));
  }));
  server.listen(socket);
  process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(join(root, 'server-stopped'))}, 'stopped'); process.exit(0); });
} else if (args[0] === 'agents') {
  if (args[1] !== '--remote') throw new Error('Client did not explicitly attach');
  const socket = args[2].slice('unix://'.length);
  const client = new WebSocket('ws+unix://' + socket + ':/');
  client.on('open', () => client.send(JSON.stringify({ id: 1, method: 'initialize' })));
  client.on('message', data => { console.log(data.toString()); client.close(); });
} else throw new Error('Unexpected fork invocation');
`
    );
    await chmod(join(source, 'bin/codex'), 0o700);
    await writeFile(
      join(bundle, 'cli.js'),
      `
const fs = require('node:fs');
const args = process.argv.slice(2);
const data = args[args.indexOf('--data-dir') + 1];
fs.writeFileSync(${JSON.stringify(join(root, 'worker.json'))}, JSON.stringify({args, parent: process.ppid}));
fs.writeFileSync(data + '/worker-status.json', JSON.stringify({state: 'connected'}));
setInterval(() => {}, 1000);
`
    );
    await writeFile(join(bundle, 'controlMcpCli.js'), '// fixture');
    await writeFile(join(bundle, 'runtimeMcpCli.js'), '// fixture');
  });

  afterEach(async () => {
    if (supervisorPid !== undefined) {
      process.kill(supervisorPid, 'SIGTERM');
      await vi.waitFor(
        async () => expect(await readFile(join(root, 'server-stopped'), 'utf8')).toBe('stopped'),
        { timeout: 5_000 }
      );
      supervisorPid = undefined;
    }
    await rm(root, { recursive: true, force: true });
  });

  const stageAndBuild = async () => {
    await exec(process.execPath, [
      join(installerRoot, 'stage-codex-runtime.mjs'),
      '--source',
      source,
      '--bundle-dir',
      bundle,
      '--platform',
      platform,
      '--revision',
      'test-fork-123',
    ]);
    await exec('bash', [
      join(installerRoot, 'build-installer.sh'),
      '--bundle-dir',
      bundle,
      '--relay',
      'wss://relay.example.test/v2/worker-stream',
      '--token',
      'test-token',
      '--team',
      team,
      '--out',
      installer,
    ]);
  };

  const installFork = (extraArgs: string[] = []) =>
    exec(
      'bash',
      [installer, '--dir', install, '--label', 'Test member', '--no-service', ...extraArgs],
      {
        env: {
          ...process.env,
          HOME: root,
          CODEX_HOME: join(root, '.codex'),
          TMPDIR: longTemporaryDirectory,
        },
        timeout: 15_000,
      }
    );

  it('packages the fork, starts its server, and attaches the client to the worker socket', async () => {
    await stageAndBuild();
    const result = await installFork();
    const worker = JSON.parse(await readFile(join(root, 'worker.json'), 'utf8')) as {
      args: string[];
      parent: number;
    };
    supervisorPid = worker.parent;
    expect(result.stdout).toContain('Codex fork: test-fork-123');
    expect(worker.args).toContain('--app-server-connect-only');
    expect(worker.args[worker.args.indexOf('--codex-home') + 1]).toBe(join(root, '.codex'));
    expect(worker.args[worker.args.indexOf('--codex-binary') + 1]).toBe(
      join(install, 'worker/codex-runtime', platform, 'bin/codex')
    );
    const socket = worker.args[worker.args.indexOf('--app-server-socket') + 1];
    expect(socket.startsWith('/tmp/agent-teams-')).toBe(true);
    expect(socket.length).toBeLessThan(100);
    const client = await exec('bash', [join(install, 'bin/attach.sh')]);
    expect(JSON.parse(client.stdout).result.userAgent).toBe('test-fork');
    const desktopProbe = join(root, 'desktop-probe.cjs');
    await writeFile(
      desktopProbe,
      `const { WebSocket } = require(${JSON.stringify(wsModule)});
const endpoint = process.env.CODEX_APP_SERVER_WS_URL;
fetch(new URL('/', endpoint.replace(/^ws:/, 'http:'))).then(async response => {
  if (response.status !== 404) throw new Error('Unexpected HTTP response');
  const rejected = new WebSocket(new URL('/wrong-capability', endpoint));
  rejected.on('error', () => {});
  rejected.on('unexpected-response', (_request, response) => {
    if (response.statusCode !== 401) throw new Error('Unauthenticated bridge accepted');
    response.resume();
    _request.destroy();
    const client = new WebSocket(endpoint);
    client.on('open', () => client.send(JSON.stringify({ id: 1, method: 'initialize' })));
    client.on('message', data => {
      console.log(JSON.stringify({ result: JSON.parse(data).result, home: process.env.CODEX_HOME,
        binary: process.env.CODEX_CLI_PATH, userData: process.env.CODEX_ELECTRON_USER_DATA_PATH,
        forceCli: process.env.CODEX_APP_SERVER_FORCE_CLI, host: new URL(endpoint).hostname,
        profileFlag: process.argv.includes('--user-data-dir=' + process.env.CODEX_ELECTRON_USER_DATA_PATH) }));
      client.close();
    });
  });
});`
    );
    const desktop = await exec(
      process.execPath,
      [
        join(install, 'bin/desktop-bridge.mjs'),
        socket,
        worker.args[worker.args.indexOf('--codex-binary') + 1],
        join(root, '.codex'),
        join(install, 'desktop-data'),
        process.execPath,
        desktopProbe,
      ],
      {
        env: { ...process.env, CODEX_APP_SERVER_FORCE_CLI: '1', CODEX_CLI_PATH: 'unrelated-cli' },
        timeout: 10_000,
      }
    );
    expect(JSON.parse(desktop.stdout)).toEqual({
      result: { userAgent: 'test-fork' },
      home: join(root, '.codex'),
      userData: join(install, 'desktop-data'),
      host: '127.0.0.1',
      profileFlag: false,
    });
    if (process.platform === 'darwin') {
      const app = join(root, 'Desktop probe.app');
      await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
      await writeFile(
        join(app, 'Contents/Info.plist'),
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Probe</string></dict></plist>'
      );
      const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      await writeFile(
        join(app, 'Contents/MacOS/Probe'),
        `#!/bin/bash\nexec ${shellQuote(process.execPath)} ${shellQuote(desktopProbe)} "$@"\n`
      );
      await chmod(join(app, 'Contents/MacOS/Probe'), 0o700);
      const gui = await exec('bash', [join(install, 'bin/desktop.sh'), app], {
        timeout: 10_000,
      });
      expect(JSON.parse(gui.stdout)).toMatchObject({
        result: { userAgent: 'test-fork' },
        profileFlag: true,
      });
    }
    const reattached = await exec('bash', [join(install, 'bin/attach.sh')]);
    expect(JSON.parse(reattached.stdout).result.userAgent).toBe('test-fork');
    const calls = (await readFile(join(root, 'fork-calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls.find((call) => call.args[0] === 'app-server').args).toEqual([
      'app-server',
      '--listen',
      `unix://${socket}`,
    ]);
    expect(calls.filter((call) => call.args[0] === 'app-server')).toHaveLength(1);
    expect(calls.find((call) => call.args[0] === 'agents').args).toEqual([
      'agents',
      '--remote',
      `unix://${socket}`,
    ]);
    expect(
      calls.every((call) => call.args[0] === '--version' || call.home === join(root, '.codex'))
    ).toBe(true);
    expect(calls.filter((call) => call.args[0] === 'login').map((call) => call.args)).toEqual([
      ['login', 'status'],
    ]);
    const sqlite = 'sqlite_home=' + JSON.stringify(join(install, 'codex-state'));
    expect(calls.find((call) => call.args[0] === 'app-server').rawArgs).toContain(sqlite);
    expect(calls.find((call) => call.args[0] === 'agents').rawArgs).toContain(sqlite);
    expect(await readFile(join(root, '.codex/config.toml'), 'utf8')).toBe(
      'model = "personal-model"\n'
    );
    expect(await readFile(join(root, '.codex/auth.json'), 'utf8')).toBe(
      '{"testCredential":"do-not-copy"}'
    );
    await expect(readFile(join(install, 'codex-home/auth.json'))).rejects.toThrow();
    await expect(installFork()).rejects.toThrow(/Stop this installation before updating/);
  });

  it('keeps an explicit private-home option for a separate sign-in', async () => {
    await stageAndBuild();
    await installFork(['--private-codex-home']);
    const worker = JSON.parse(await readFile(join(root, 'worker.json'), 'utf8')) as {
      args: string[];
      parent: number;
    };
    supervisorPid = worker.parent;
    expect(worker.args[worker.args.indexOf('--codex-home') + 1]).toBe(join(install, 'codex-home'));
    expect(await readFile(join(root, '.codex/auth.json'), 'utf8')).toBe(
      '{"testCredential":"do-not-copy"}'
    );
  });

  it('refuses an altered fork before executing it', async () => {
    await stageAndBuild();
    await writeFile(
      join(bundle, 'codex-runtime', platform, 'bin/codex'),
      '#!/bin/sh\necho tampered\n'
    );
    await exec('bash', [
      join(installerRoot, 'build-installer.sh'),
      '--bundle-dir',
      bundle,
      '--relay',
      'wss://relay.example.test/v2/worker-stream',
      '--token',
      'test-token',
      '--team',
      team,
      '--out',
      installer,
    ]);
    await expect(installFork()).rejects.toThrow(/Runtime checksum mismatch/);
    await expect(readFile(join(root, 'fork-calls.jsonl'), 'utf8')).rejects.toThrow();
  });

  it('refuses to build an installer without the fork', async () => {
    await expect(
      exec('bash', [
        join(installerRoot, 'build-installer.sh'),
        '--bundle-dir',
        bundle,
        '--relay',
        'wss://relay.example.test/v2/worker-stream',
        '--token',
        'test-token',
        '--team',
        team,
        '--out',
        installer,
      ])
    ).rejects.toThrow(/Stage the fork/);
  });
});
