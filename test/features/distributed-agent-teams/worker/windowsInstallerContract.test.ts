// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const installer = resolve('packages/agent-teams-worker/installer/windows-install.mjs');
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

// Execute installer orchestration with Windows process primitives supplied explicitly.
// This covers selection, persisted ownership, and child arguments; native platform QA is separate.
describe('Windows installer runtime contracts', () => {
  let root: string;
  let executable: string;
  let calls: { binary: string; args: string[] }[];
  let children: (EventEmitter & { kill: ReturnType<typeof vi.fn> })[];
  let callbacks: Map<string, () => void>;
  let livePids: Set<number>;
  let loginStatus: number;
  let killHook: ((pid: number) => void) | undefined;
  let spawnHook:
    | ((
        child: EventEmitter & {
          kill: ReturnType<typeof vi.fn>;
          pid: number;
          exitCode: number | null;
        }
      ) => void)
    | undefined;

  beforeEach(async () => {
    root = await mkdtemp('/tmp/agt-windows-contract-');
    executable = join(root, 'stock', 'codex.exe');
    await mkdir(join(root, 'stock'));
    await mkdir(join(root, 'worker'));
    await writeFile(executable, 'stock executable fixture');
    await chmod(executable, 0o700);
    calls = [];
    children = [];
    callbacks = new Map();
    livePids = new Set([123456]);
    loginStatus = 0;
    killHook = undefined;
    spawnHook = undefined;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const execute = async (command: string, overrides: Record<string, string> = {}) => {
    const env = {
      ...process.env,
      APPDATA: join(root, 'app-data'),
      LOCALAPPDATA: join(root, 'local-data'),
      CODEX_HOME: join(root, 'personal-home'),
      AGENT_TEAMS_INSTALL_RUNTIME: 'stock',
      AGENT_TEAMS_INSTALL_CODEX_BINARY: executable,
      AGENT_TEAMS_INSTALL_RELAY: 'wss://relay.example.test/v2/worker-stream',
      AGENT_TEAMS_INSTALL_TOKEN: 'fixture-enrollment',
      AGENT_TEAMS_INSTALL_TEAM: '40000000-0000-4000-8000-000000000001',
      AGENT_TEAMS_INSTALL_NO_SERVICE: 'True',
      AGENT_TEAMS_INSTALL_NO_START: 'True',
      ...overrides,
    };
    const spawnSync = (binary: string, args: string[]) => {
      calls.push({ binary, args });
      return {
        status: args[0] === 'login' && args[1] === 'status' ? loginStatus : 0,
        stdout: '--listen --remote --ws-auth',
        stderr: '',
      };
    };
    const spawn = (binary: string, args: string[]) => {
      calls.push({ binary, args });
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(),
        unref: vi.fn(),
        pid: 123457 + children.length,
        exitCode: null as number | null,
      });
      children.push(child);
      spawnHook?.(child);
      return child;
    };
    const fakeProcess = {
      platform: 'win32',
      argv: ['node', installer, command, root],
      env,
      execPath: process.execPath,
      pid: 123456,
      on: (event: string, callback: () => void) => {
        callbacks.set(event, callback);
      },
      kill: (pid: number) => {
        killHook?.(pid);
        if (livePids.has(pid)) return true;
        throw Object.assign(new Error('No fixture supervisor is running'), { code: 'ESRCH' });
      },
      exit: (status: number) => {
        throw new Error(`fixture_exit:${status}`);
      },
    };
    const bindings = {
      createHash,
      randomBytes,
      randomUUID,
      spawn,
      spawnSync,
      execFileSync: vi.fn(() => Buffer.from('')),
      createServer: () => ({
        listen: (_port: number, _host: string, ready: () => void) => ready(),
        address: () => ({ port: 43199 }),
        close: (done: () => void) => done(),
      }),
      linkSync: fs.linkSync,
      existsSync: fs.existsSync,
      mkdirSync: fs.mkdirSync,
      readFileSync: fs.readFileSync,
      writeFileSync: fs.writeFileSync,
      readdirSync: fs.readdirSync,
      lstatSync: fs.lstatSync,
      openSync: fs.openSync,
      closeSync: fs.closeSync,
      realpathSync: fs.realpathSync,
      unlinkSync: fs.unlinkSync,
      homedir: () => join(root, 'personal-home'),
      join,
      resolve,
      fileURLToPath,
    };
    const source = (await readFile(installer, 'utf8'))
      .replace(/^import[\s\S]*?from 'node:[^']+';\n/gm, '')
      .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(installer).href));
    try {
      await new AsyncFunction(...Object.keys(bindings), 'process', 'fetch', source)(
        ...Object.values(bindings),
        fakeProcess,
        async () => ({ ok: true })
      );
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'fixture_exit:0') throw error;
    }
  };

  it('installs stock without a fork archive and persists private identity and MCP registration', async () => {
    await execute('install');
    const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
    expect(config).toMatchObject({
      runtimeKind: 'stock',
      serverOwnership: 'managed',
      binary: executable,
    });
    expect(config.home).toBe(join(root, 'personal-home'));
    expect(config.controlMcpName).toBe(
      'agent_teams_control_' + config.installationId.replaceAll('-', '')
    );
    const setup = calls.find(({ args }) => args[1] === 'setup');
    expect(setup?.args).toContain(config.controlMcpName);
    expect(setup?.args).toContain(join(root, 'data'));
    expect(
      calls.filter(({ args }) => args[0] === 'login').every(({ binary }) => binary === executable)
    ).toBe(true);
    await expect(readFile(join(root, 'bin', 'attach.ps1'), 'utf8')).resolves.toContain('attach');
    await expect(execute('desktop')).rejects.toThrow(/installed Codex desktop/);
  });

  it('reuses an explicit existing stock login without launching authentication', async () => {
    await execute('install', {
      AGENT_TEAMS_INSTALL_CODEX_HOME: join(root, 'personal-home'),
    });
    expect(calls.filter(({ args }) => args[0] === 'login').map(({ args }) => args)).toEqual([
      ['login', 'status'],
    ]);
    await expect(readFile(join(root, 'codex-home/auth.json'))).rejects.toThrow();
  });

  it('does not start a new sign-in when the existing stock login cannot be used', async () => {
    loginStatus = 1;
    await expect(execute('install')).rejects.toThrow('No new sign-in was started');
    expect(calls.filter(({ args }) => args[0] === 'login').map(({ args }) => args)).toEqual([
      ['login', 'status'],
    ]);
  });

  it('launches stock desktop with the selected existing login and App Server endpoint', async () => {
    await execute('install');
    const app = join(root, 'local-data', 'Programs', 'Codex', 'Codex.exe');
    await mkdir(join(root, 'local-data', 'Programs', 'Codex'), { recursive: true });
    await writeFile(app, 'desktop executable fixture');
    await writeFile(
      join(root, 'data', 'app-server.json'),
      JSON.stringify({ url: 'ws://127.0.0.1:45678' })
    );
    await execute('desktop');
    const desktop = calls.find(
      ({ args }) => args[0] === join(root, 'worker', 'desktopBridgeCli.js')
    );
    expect(desktop?.args).toContain('ws://127.0.0.1:45678');
    expect(desktop?.args).toContain(join(root, 'personal-home'));
    expect(desktop?.args).toContain(app);
  });

  it('passes the exact control socket to uninstall even before its first Worker start', async () => {
    await execute('install');
    const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
    await execute('uninstall');
    const remove = calls.find(({ args }) => args[1] === 'mcp-remove')!;
    expect(remove.args[remove.args.indexOf('--data-dir') + 1]).toBe(join(root, 'data'));
    expect(remove.args[remove.args.indexOf('--control-socket') + 1]).toBe(config.control);
  });

  it('allows an explicitly operator-owned personal home only for an external server', async () => {
    const token = join(root, 'external-token');
    await writeFile(token, 'external-capability');
    await execute('install', {
      AGENT_TEAMS_INSTALL_SERVER_OWNERSHIP: 'external',
      AGENT_TEAMS_INSTALL_APP_SERVER_SOCKET: 'ws://127.0.0.1:43200',
      AGENT_TEAMS_INSTALL_APP_SERVER_TOKEN_FILE: token,
      AGENT_TEAMS_INSTALL_CODEX_HOME: join(root, 'personal-home'),
    });
    expect(JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))).toMatchObject({
      serverOwnership: 'external',
      home: join(root, 'personal-home'),
    });
  });

  it('restarts a custom dedicated home even when the supervisor child inherits that override', async () => {
    const home = join(root, 'custom-dedicated-home');
    await execute('install', { AGENT_TEAMS_INSTALL_CODEX_HOME: home });
    await execute('run', { CODEX_HOME: home });
    const workerStart = calls.find(
      ({ args }) => args[0] === join(root, 'worker', 'localWorkerCli.js')
    );
    expect(workerStart?.args).toContain('--relay');
    expect(workerStart?.args).toContain('wss://relay.example.test/v2/worker-stream');
    expect(JSON.parse(await readFile(join(root, 'data/supervisor.pid'), 'utf8')).pid).toBe(123456);
    callbacks.get('exit')?.();
  });

  it('reclaims a dead supervisor, clears stale readiness, and rejects a second live owner', async () => {
    await execute('install');
    const pidFile = join(root, 'data/supervisor.pid');
    await writeFile(pidFile, '2147483647');
    await writeFile(pidFile + '.reclaim', '');
    await mkdir(pidFile + '.reclaims');
    await writeFile(
      join(pidFile + '.reclaims', '0000000000000001.json'),
      JSON.stringify({ pid: 2147483647, token: 'dead-reclaimer' })
    );
    await writeFile(join(root, 'data/worker-status.json'), '{"state":"connected"}');
    await writeFile(join(root, 'data/app-server.json'), '{"url":"ws://old-server"}');
    await execute('run');
    const owner = JSON.parse(await readFile(pidFile, 'utf8'));
    const endpoint = JSON.parse(await readFile(join(root, 'data/app-server.json'), 'utf8'));
    expect(owner).toMatchObject({ pid: 123456, token: expect.any(String) });
    expect(endpoint).toMatchObject({ supervisorPid: owner.pid, supervisorToken: owner.token });
    await expect(readFile(join(root, 'data/worker-status.json'))).rejects.toThrow();
    const cleanup = callbacks.get('exit')!;
    const original = await readFile(pidFile, 'utf8');
    await expect(execute('run')).rejects.toThrow(/another live process/);
    expect(await readFile(pidFile, 'utf8')).toBe(original);
    cleanup();
    await expect(readFile(pidFile)).rejects.toThrow();
  });

  it('fails closed on an incomplete primary lock and a live reclamation generation', async () => {
    await execute('install');
    const pidFile = join(root, 'data/supervisor.pid');
    await writeFile(pidFile, '');
    await expect(execute('run')).rejects.toThrow('Incomplete supervisor lock');
    expect(await readFile(pidFile, 'utf8')).toBe('');
    await rm(pidFile + '.reclaims', { recursive: true, force: true });
    await writeFile(pidFile, '2147483647');
    await mkdir(pidFile + '.reclaims');
    await writeFile(
      join(pidFile + '.reclaims', '0000000000000001.json'),
      JSON.stringify({ pid: 123499, token: 'live-reclaimer' })
    );
    livePids.add(123499);
    await expect(execute('run')).rejects.toThrow('recovery is already in progress');
    expect(await readFile(pidFile, 'utf8')).toBe('2147483647');
    livePids.delete(123499);
    await execute('run');
    expect(JSON.parse(await readFile(pidFile, 'utf8')).pid).toBe(123456);
    callbacks.get('exit')?.();
  });

  it('does not erase a new owner when startup loses a stale-owner race', async () => {
    await execute('install');
    const pidFile = join(root, 'data/supervisor.pid');
    const endpoint = join(root, 'data/app-server.json');
    await writeFile(pidFile, '2147483647');
    const winner = JSON.stringify({ pid: 123499, token: 'winning-supervisor' });
    const publication = JSON.stringify({
      url: 'ws://127.0.0.1:43201',
      supervisorPid: 123499,
      supervisorToken: 'winning-supervisor',
    });
    killHook = (pid) => {
      if (pid !== 2147483647) return;
      fs.writeFileSync(pidFile, winner);
      fs.writeFileSync(endpoint, publication);
      livePids.add(123499);
      killHook = undefined;
    };
    spawnHook = (child) => {
      child.exitCode = 1;
    };
    await expect(execute('start')).rejects.toThrow('Supervisor failed to start');
    expect(await readFile(pidFile, 'utf8')).toBe(winner);
    expect(await readFile(endpoint, 'utf8')).toBe(publication);
  });

  it('leaves replacement-owner metadata intact during an old supervisor cleanup', async () => {
    await execute('install');
    await execute('run');
    const cleanup = callbacks.get('exit')!;
    const replacement = JSON.stringify({ pid: 123499, token: 'replacement-supervisor' });
    const endpoint = JSON.stringify({
      url: 'ws://replacement-server',
      supervisorPid: 123499,
      supervisorToken: 'replacement-supervisor',
    });
    await writeFile(join(root, 'data/supervisor.pid'), replacement);
    await writeFile(join(root, 'data/app-server.json'), endpoint);
    cleanup();
    expect(await readFile(join(root, 'data/supervisor.pid'), 'utf8')).toBe(replacement);
    expect(await readFile(join(root, 'data/app-server.json'), 'utf8')).toBe(endpoint);
    expect(children.every((child) => child.kill.mock.calls.length === 1)).toBe(true);
  });

  it('refuses a missing selected stock executable without falling back to a fork', async () => {
    await mkdir(join(root, 'worker', 'codex-runtime', 'win32-x64', 'bin'), { recursive: true });
    await writeFile(join(root, 'worker', 'codex-runtime', 'win32-x64', 'bin', 'codex.exe'), 'fork');
    await expect(
      execute('install', { AGENT_TEAMS_INSTALL_CODEX_BINARY: join(root, 'missing.exe') })
    ).rejects.toThrow(/Install official Codex/);
    expect(calls).toHaveLength(0);
  });

  it('connects only the Worker to an external authenticated server and cleanup leaves server ownership external', async () => {
    const token = join(root, 'external-token');
    await writeFile(token, 'external-capability');
    await execute('install', {
      AGENT_TEAMS_INSTALL_SERVER_OWNERSHIP: 'external',
      AGENT_TEAMS_INSTALL_APP_SERVER_SOCKET: 'ws://127.0.0.1:43200',
      AGENT_TEAMS_INSTALL_APP_SERVER_TOKEN_FILE: token,
      AGENT_TEAMS_INSTALL_CODEX_HOME: join(root, 'external-home'),
    });
    const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
    expect(config.serverToken).toBe('external-capability');
    calls = [];
    await execute('run');
    expect(calls).toHaveLength(1);
    expect(calls[0].binary).toBe(process.execPath);
    expect(calls[0].args).toContain('ws://127.0.0.1:43200');
    expect(calls[0].args).toContain('--app-server-connect-only');
    expect(calls[0].args).toContain('external');
    expect(calls[0].args).toContain(config.installationId);
    callbacks.get('exit')?.();
    expect(children[0].kill).toHaveBeenCalledOnce();
    expect(await readFile(token, 'utf8')).toBe('external-capability');
    expect(JSON.parse(await readFile(join(root, 'config.json'), 'utf8')).serverOwnership).toBe(
      'external'
    );
  });

  it('keeps the default fork package validation and selected-home behavior', async () => {
    const runtime = join(root, 'worker', 'codex-runtime', 'win32-x64');
    await mkdir(join(runtime, 'bin'), { recursive: true });
    const fork = 'fork executable fixture';
    await writeFile(join(runtime, 'bin', 'codex.exe'), fork);
    await writeFile(
      join(runtime, 'runtime-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        platform: 'win32-x64',
        revision: 'fixture-fork',
        files: { 'bin/codex.exe': createHash('sha256').update(fork).digest('hex') },
      })
    );
    await execute('install', {
      AGENT_TEAMS_INSTALL_RUNTIME: 'fork',
      AGENT_TEAMS_INSTALL_CODEX_BINARY: '',
    });
    const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
    expect(config.runtimeKind).toBe('fork');
    expect(config.binary).toBe(join(runtime, 'bin', 'codex.exe'));
    expect(config.home).toBe(join(root, 'personal-home'));
  });
});
