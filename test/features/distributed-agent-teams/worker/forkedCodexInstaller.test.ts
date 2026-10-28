// @vitest-environment node
import { execFile, spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
if (args.includes('--help')) console.log('--listen --remote');
else if (args[0] === '--version') console.log('codex-cli test-fork');
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
  setTimeout(() => server.listen(socket), Number(process.env.TEST_FORK_SERVER_DELAY_MS || 0));
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
if (args[0] !== 'start') { fs.writeFileSync(${JSON.stringify(join(root, 'control-operation.json'))}, JSON.stringify(args)); process.exit(0); }
fs.writeFileSync(${JSON.stringify(join(root, 'worker.json'))}, JSON.stringify({args, parent: process.ppid}));
fs.writeFileSync(data + '/worker-args.json', JSON.stringify({args, parent: process.ppid}));
fs.writeFileSync(data + '/worker-status.json', JSON.stringify({state: 'connected', relayUrl: args[args.indexOf('--relay') + 1]}));
fs.writeFileSync(data + '/desktop-pairing-code', 'test-only-pairing-code');
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
        async () =>
          expect(await readFile(join(root, 'server-stopped'), 'utf8')).toContain('stopped'),
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

  const installFork = (extraArgs: string[] = [], extraEnv: Record<string, string> = {}) =>
    exec(
      'bash',
      [
        installer,
        '--dir',
        install,
        '--label',
        'Test member',
        '--no-service',
        '--no-desktop',
        ...extraArgs,
      ],
      {
        env: {
          ...process.env,
          HOME: root,
          CODEX_HOME: join(root, '.codex'),
          TMPDIR: longTemporaryDirectory,
          ...extraEnv,
        },
        timeout: 30_000,
      }
    );

  it('allows database initialization beyond the former ten-second startup deadline', async () => {
    await stageAndBuild();
    const installing = installFork([], { TEST_FORK_SERVER_DELAY_MS: '12000' });
    void installing.catch(() => undefined);
    await vi.waitFor(
      async () => {
        supervisorPid = Number(
          (await readFile(join(install, 'data/supervisor.pid'), 'utf8')).trim()
        );
        expect(supervisorPid).toBeGreaterThan(1);
      },
      { timeout: 5_000 }
    );
    const result = await installing;
    const worker = JSON.parse(await readFile(join(root, 'worker.json'), 'utf8'));
    expect(worker.parent).toBe(supervisorPid);
    expect(result.stdout).toContain('Worker connected to ws://127.0.0.1:');
    expect(await readFile(join(install, 'logs/worker.log'), 'utf8')).toContain(
      'database backfill may still be running'
    );
    expect(await readFile(join(install, 'bin/start.sh'), 'utf8')).toContain(
      'APP_SERVER_START_TIMEOUT_SECONDS=1800'
    );
  }, 30_000);

  it('packages the fork, starts its server, and attaches the client to the worker socket', async () => {
    await stageAndBuild();
    const result = await installFork();
    const worker = JSON.parse(await readFile(join(root, 'worker.json'), 'utf8')) as {
      args: string[];
      parent: number;
    };
    supervisorPid = worker.parent;
    expect(result.stdout).toContain('Codex fork: test-fork-123');
    expect(worker.args[worker.args.indexOf('--relay') + 1]).toMatch(
      /^ws:\/\/127\.0\.0\.1:\d+\/v2\/worker-stream$/
    );
    expect(result.stdout).toContain(
      'Waiting for the worker to connect to its local relay on 127.0.0.1'
    );
    expect(result.stdout).toContain('Worker connected to ws://127.0.0.1:');
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
    const oldSupervisor = supervisorPid;
    const updated = await installFork();
    const restarted = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
    supervisorPid = restarted.parent;
    expect(updated.stdout).toContain('Stopping the existing installation before updating');
    expect(supervisorPid).not.toBe(oldSupervisor);
    expect(
      JSON.parse((await exec('bash', [join(install, 'bin/attach.sh')])).stdout).result.userAgent
    ).toBe('test-fork');
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

  it('recovers a dead supervisor PID after reboot without replacing live owners', async () => {
    await stageAndBuild();
    await installFork();
    await exec('bash', [join(install, 'bin/stop.sh')]);
    await writeFile(join(install, 'data/supervisor.pid'), '2147483647\n');
    await writeFile(join(install, 'data/supervisor.pid.reclaim'), '');
    await mkdir(join(install, 'data/supervisor.pid.reclaims'));
    await writeFile(
      join(install, 'data/supervisor.pid.reclaims/0000000000000001.json'),
      JSON.stringify({ pid: 2147483647, token: 'dead-reclaimer' })
    );
    const restarted = spawn('bash', [join(install, 'bin/start.sh')], { stdio: 'ignore' });
    supervisorPid = restarted.pid;
    await vi.waitFor(
      async () => {
        const worker = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
        expect(worker.parent).toBe(restarted.pid);
      },
      { timeout: 5000 }
    );
    const attached = await exec('bash', [join(install, 'bin/attach.sh')]);
    expect(JSON.parse(attached.stdout).result.userAgent).toBe('test-fork');
    await exec('bash', [join(install, 'bin/stop.sh')]);
    supervisorPid = undefined;
    // A reused PID must never authorize cleanup of an unrelated live process.
    await writeFile(join(install, 'data/supervisor.pid'), String(process.pid) + '\n');
    await expect(exec('bash', [join(install, 'bin/start.sh')])).rejects.toThrow(
      /another live process/
    );
    expect(await readFile(join(install, 'data/supervisor.pid'), 'utf8')).toBe(
      String(process.pid) + '\n'
    );
    process.kill(process.pid, 0);
  });

  it('passes installation data to setup so uninstall can verify the saved MCP target', async () => {
    await writeFile(join(bundle, 'desktopBridgeCli.js'), '// fixture only enables control setup');
    await stageAndBuild();
    await installFork();
    const worker = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
    supervisorPid = worker.parent;
    const setup = JSON.parse(
      await readFile(join(root, 'control-operation.json'), 'utf8')
    ) as string[];
    expect(setup[0]).toBe('setup');
    expect(setup[setup.indexOf('--data-dir') + 1]).toBe(join(install, 'data'));
    await exec('bash', [join(install, 'bin/uninstall.sh')]);
    supervisorPid = undefined;
    const remove = JSON.parse(
      await readFile(join(root, 'control-operation.json'), 'utf8')
    ) as string[];
    expect(remove[0]).toBe('mcp-remove');
    expect(remove[remove.indexOf('--data-dir') + 1]).toBe(join(install, 'data'));
  });

  it('invalidates old connected status before a failed Worker restart', async () => {
    await stageAndBuild();
    await installFork();
    await exec('bash', [join(install, 'bin/stop.sh')]);
    await writeFile(
      join(install, 'data/worker-status.json'),
      JSON.stringify({ state: 'connected' })
    );
    await writeFile(join(install, 'worker/cli.js'), 'process.exit(23);\n');
    await expect(exec('bash', [join(install, 'bin/start.sh')])).rejects.toThrow();
    await expect(readFile(join(install, 'data/worker-status.json'))).rejects.toThrow();
    await expect(readFile(join(install, 'data/supervisor.pid'))).rejects.toThrow();
  });

  it('does not stop an unrelated process whose arguments mention the supervisor launcher', async () => {
    await stageAndBuild();
    await installFork();
    await exec('bash', [join(install, 'bin/stop.sh')]);
    const unrelated = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', '--', join(install, 'bin/start.sh')],
      { stdio: 'ignore' }
    );
    try {
      await writeFile(join(install, 'data/supervisor.pid'), String(unrelated.pid) + '\n');
      await expect(exec('bash', [join(install, 'bin/stop.sh')])).rejects.toThrow(/does not belong/);
      const before = await readFile(join(install, 'worker/cli.js'), 'utf8');
      await writeFile(
        join(bundle, 'cli.js'),
        '// replacement must not be unpacked when shutdown fails'
      );
      await rm(join(bundle, 'codex-runtime'), { recursive: true });
      await stageAndBuild();
      await expect(installFork()).rejects.toThrow(/Could not stop this installation/);
      expect(await readFile(join(install, 'worker/cli.js'), 'utf8')).toBe(before);
      process.kill(unrelated.pid!, 0);
    } finally {
      unrelated.kill('SIGTERM');
      await new Promise<void>((done) => unrelated.once('exit', () => done()));
    }
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

  const buildStock = async () => {
    await exec('bash', [
      join(installerRoot, 'build-installer.sh'),
      '--runtime',
      'stock',
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
    const stock = join(root, 'stock-codex');
    await writeFile(stock, await readFile(join(source, 'bin/codex')));
    await chmod(stock, 0o700);
    return stock;
  };

  it('uses the existing stock login by default without copying credentials or signing in again', async () => {
    const stock = await buildStock();
    await installFork(['--codex-binary', stock]);
    const worker = JSON.parse(await readFile(join(root, 'worker.json'), 'utf8'));
    supervisorPid = worker.parent;
    expect(worker.args[worker.args.indexOf('--codex-home') + 1]).toBe(join(root, '.codex'));
    expect(await readFile(join(root, '.codex/auth.json'), 'utf8')).toBe(
      '{"testCredential":"do-not-copy"}'
    );
    const calls = (await readFile(join(root, 'fork-calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls.filter((call) => call.args[0] === 'login').map((call) => call.args)).toEqual([
      ['login', 'status'],
    ]);
    await expect(readFile(join(install, 'codex-home/auth.json'))).rejects.toThrow();
  });

  it('does not initiate another stock sign-in when the existing login is unavailable', async () => {
    const stock = await buildStock();
    const source = await readFile(stock, 'utf8');
    await writeFile(
      stock,
      source.replace(
        "else if (args[0] === 'login') process.exit(0);",
        "else if (args[0] === 'login') process.exit(1);"
      )
    );
    await expect(installFork(['--codex-binary', stock])).rejects.toThrow(
      'No new sign-in was started'
    );
    const calls = (await readFile(join(root, 'fork-calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls.filter((call) => call.args[0] === 'login').map((call) => call.args)).toEqual([
      ['login', 'status'],
    ]);
  });

  it.runIf(process.platform === 'darwin')(
    'uses the desktop app bundled stock server and existing login when opening the app',
    async () => {
      const stock = await buildStock();
      const app = join(root, 'Stock desktop.app');
      const executable = join(app, 'Contents/MacOS/Probe');
      await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
      const bundledCodex = join(app, 'Contents/Resources/codex-cli/bin/codex');
      await mkdir(join(app, 'Contents/Resources/codex-cli/bin'), { recursive: true });
      await copyFile(stock, bundledCodex);
      await writeFile(
        join(app, 'Contents/Info.plist'),
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Probe</string></dict></plist>'
      );
      await writeFile(
        executable,
        `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(join(root, 'auto-desktop.json'))}, JSON.stringify({home:process.env.CODEX_HOME,endpoint:process.env.CODEX_APP_SERVER_WS_URL}));\n`
      );
      await chmod(executable, 0o700);
      await installFork(['--desktop-app', app]);
      const worker = JSON.parse(await readFile(join(root, 'worker.json'), 'utf8'));
      supervisorPid = worker.parent;
      expect(worker.args[worker.args.indexOf('--codex-binary') + 1]).toBe(bundledCodex);
      expect(worker.args).toContain('--desktop-launcher');
      await vi.waitFor(async () => {
        const desktop = JSON.parse(await readFile(join(root, 'auto-desktop.json'), 'utf8'));
        expect(desktop.home).toBe(join(root, '.codex'));
        expect(desktop.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:/);
      });
    }
  );

  it('quotes systemd launcher paths and escapes literal specifiers and environment syntax', async () => {
    const stock = await buildStock();
    install = join(root, 'member %t $USER with spaces');
    const commands = join(root, 'test-commands');
    await mkdir(commands);
    await writeFile(
      join(commands, 'uname'),
      '#!/bin/bash\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) /usr/bin/uname "$@" ;; esac\n'
    );
    await writeFile(
      join(commands, 'systemctl'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const path = require('node:path');
if (process.argv.includes('enable')) {
  const unit = fs.readFileSync(path.join(process.env.HOME, '.config/systemd/user', process.argv.at(-1)), 'utf8');
  fs.writeFileSync(${JSON.stringify(join(root, 'captured-unit'))}, unit);
  const prefix = 'ExecStart=/bin/bash ';
  const encoded = unit.split(String.fromCharCode(10)).find(line => line.startsWith(prefix)).slice(prefix.length);
  const launcher = JSON.parse(encoded).split('%%').join('%').split('$$').join('$');
  if (!fs.existsSync(launcher)) throw new Error('Incorrectly quoted systemd launcher');
  spawn('/bin/bash', [launcher], {stdio:'ignore', detached:true, env:process.env}).unref();
}
`
    );
    await chmod(join(commands, 'uname'), 0o700);
    await chmod(join(commands, 'systemctl'), 0o700);
    await exec(
      'bash',
      [installer, '--dir', install, '--label', 'Service test', '--codex-binary', stock],
      {
        env: {
          ...process.env,
          HOME: root,
          CODEX_HOME: join(root, '.codex'),
          PATH: commands + ':' + process.env.PATH,
        },
        timeout: 15000,
      }
    );
    const worker = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
    supervisorPid = worker.parent;
    const unit = await readFile(join(root, 'captured-unit'), 'utf8');
    const encoded = unit.split('\n').find((line) => line.startsWith('ExecStart='))!;
    expect(encoded).toBe(
      'ExecStart=/bin/bash ' +
        JSON.stringify(join(install, 'bin/start.sh'))
          .replaceAll('%', '%%')
          .replaceAll('$', () => '$$')
    );
    expect((await exec('bash', [join(install, 'bin/attach.sh')])).stdout).toContain('test-fork');
  });

  it('builds a worker-only stock installer and attaches the selected stock client', async () => {
    const stock = await buildStock();
    await installFork(['--codex-binary', stock]);
    const worker = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
    supervisorPid = worker.parent;
    expect(worker.args[worker.args.indexOf('--codex-binary') + 1]).toBe(stock);
    expect(worker.args[worker.args.indexOf('--runtime-kind') + 1]).toBe('stock');
    expect(worker.args[worker.args.indexOf('--codex-home') + 1]).toBe(join(root, '.codex'));
    expect(worker.args.includes('--desktop-launcher')).toBe(process.platform === 'darwin');
    const metadata = JSON.parse(await readFile(join(install, 'installation.json'), 'utf8'));
    expect(metadata.runtimeKind).toBe('stock');
    expect(metadata.controlMcpName).toMatch(/^agent_teams_control_[a-f0-9]{32}$/);
    await expect(
      readFile(join(install, 'worker/codex-runtime', platform, 'bin/codex'))
    ).rejects.toThrow();
    const attached = await exec('bash', [join(install, 'bin/attach.sh')]);
    expect(JSON.parse(attached.stdout).result.userAgent).toBe('test-fork');
    await expect(
      exec('bash', [join(install, 'bin/desktop.sh'), join(root, 'Missing desktop.app')])
    ).rejects.toThrow(/Install Codex desktop|supports macOS/);
    await stageAndBuild();
    await expect(installFork()).rejects.toThrow(/runtime differs/);
  });

  it('keeps a manually started stock server alive when its Worker stops', async () => {
    const stock = await buildStock();
    const socket = join(root, 'manual.sock');
    const server = spawn(stock, ['app-server', '--listen', 'unix://' + socket], {
      env: { ...process.env, CODEX_HOME: join(root, '.codex') },
      stdio: 'ignore',
    });
    try {
      await vi.waitFor(async () =>
        expect((await import('node:fs/promises')).stat(socket)).resolves.toBeDefined()
      );
      await installFork([
        '--codex-binary',
        stock,
        '--server-ownership',
        'external',
        '--app-server-socket',
        socket,
        '--codex-home',
        join(root, '.codex'),
      ]);
      const worker = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
      expect(worker.args[worker.args.indexOf('--server-ownership') + 1]).toBe('external');
      await installFork([
        '--codex-binary',
        stock,
        '--server-ownership',
        'external',
        '--app-server-socket',
        socket,
        '--codex-home',
        join(root, '.codex'),
      ]);
      const restarted = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
      expect(restarted.parent).not.toBe(worker.parent);
      process.kill(server.pid!, 0);
      await exec('bash', [join(install, 'bin/stop.sh')]);
      await vi.waitFor(async () =>
        expect(readFile(join(install, 'data/supervisor.pid'))).rejects.toThrow()
      );
      process.kill(server.pid!, 0);
      const attached = await exec('bash', [join(install, 'bin/attach.sh')]);
      expect(JSON.parse(attached.stdout).result.userAgent).toBe('test-fork');
      const calls = (await readFile(join(root, 'fork-calls.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(
        calls.filter((call) => call.args[0] === 'app-server' && !call.args.includes('--help'))
      ).toHaveLength(1);
    } finally {
      server.kill('SIGTERM');
      await new Promise<void>((resolve) => server.once('exit', () => resolve()));
    }
  });

  it('runs stock and fork installations concurrently with distinct identities and endpoints', async () => {
    await stageAndBuild();
    await installFork();
    const fork = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
    supervisorPid = fork.parent;
    const forkInstall = install;
    const stock = await buildStock();
    install = join(root, 'stock member');
    let stockPid: number | undefined;
    try {
      await installFork(['--codex-binary', stock]);
      const other = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
      stockPid = other.parent;
      for (const flag of [
        '--node-id',
        '--control-socket',
        '--app-server-socket',
        '--control-mcp-name',
      ]) {
        expect(other.args[other.args.indexOf(flag) + 1]).not.toBe(
          fork.args[fork.args.indexOf(flag) + 1]
        );
      }
      const metadata = await readFile(join(install, 'installation.json'), 'utf8');
      await installFork(['--codex-binary', stock]);
      const restarted = JSON.parse(await readFile(join(install, 'data/worker-args.json'), 'utf8'));
      stockPid = restarted.parent;
      expect(restarted.parent).not.toBe(other.parent);
      expect(await readFile(join(install, 'installation.json'), 'utf8')).toBe(metadata);
      for (const flag of ['--node-id', '--control-mcp-name', '--app-server-socket'])
        expect(restarted.args[restarted.args.indexOf(flag) + 1]).toBe(
          other.args[other.args.indexOf(flag) + 1]
        );
      process.kill(fork.parent, 0);
      await exec('bash', [join(install, 'bin/uninstall.sh')]);
      await vi.waitFor(async () =>
        expect(readFile(join(install, 'data/supervisor.pid'))).rejects.toThrow()
      );
      stockPid = undefined;
      const attached = await exec('bash', [join(forkInstall, 'bin/attach.sh')]);
      expect(JSON.parse(attached.stdout).result.userAgent).toBe('test-fork');
    } finally {
      if (stockPid !== undefined) process.kill(stockPid, 'SIGTERM');
    }
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
