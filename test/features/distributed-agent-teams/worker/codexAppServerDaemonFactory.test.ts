import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  buildCodexDaemonStartArgs,
  CodexAppServerDaemonFactory,
  defaultCodexDaemonSocketPath,
  ensureCodexHomeFeatureDisables,
  parseDaemonSocketPath,
  resolveCodexAppServerMode,
} from '@claude-teams/agent-teams-worker';

describe('Codex App Server mode helpers', () => {
  it('defaults to a private stdio child and accepts the shared daemon mode', () => {
    expect(resolveCodexAppServerMode(undefined)).toBe('private-stdio');
    expect(resolveCodexAppServerMode('')).toBe('private-stdio');
    expect(resolveCodexAppServerMode('private-stdio')).toBe('private-stdio');
    expect(resolveCodexAppServerMode(' shared-daemon ')).toBe('shared-daemon');
    expect(() => resolveCodexAppServerMode('attach')).toThrow(/expected one of/);
  });

  it('derives the daemon control socket from the Codex home', () => {
    expect(defaultCodexDaemonSocketPath('/tmp/home')).toBe(
      '/tmp/home/app-server-control/app-server-control.sock'
    );
  });

  it('keeps the feature disables ahead of the daemon start subcommand', () => {
    expect(buildCodexDaemonStartArgs({ launcherArgs: ['--profile', 'x'] })).toEqual([
      '--profile',
      'x',
      '--disable',
      'apps',
      '--disable',
      'plugins',
      '--disable',
      'remote_plugin',
      'app-server',
      'daemon',
      'start',
    ]);
    expect(buildCodexDaemonStartArgs({ disableRemotePlugins: false })).not.toContain(
      'remote_plugin'
    );
  });

  it('asks for a restart instead of a start when the home config changed', () => {
    expect(buildCodexDaemonStartArgs({ restart: true }).slice(-3)).toEqual([
      'app-server',
      'daemon',
      'restart',
    ]);
  });

  it('reads the socket path from the last JSON line that carries one', () => {
    const output = [
      '{"stage":"pid_write","outcome":"succeeded"}',
      'not json',
      '{"status":"started","socketPath":"/tmp/a.sock"}',
      '{"status":"running","socketPath":"/tmp/b.sock"}',
    ].join('\n');
    expect(parseDaemonSocketPath(output)).toBe('/tmp/b.sock');
    expect(parseDaemonSocketPath('{"status":"running"}')).toBeUndefined();
  });
});

describe('CodexAppServerDaemonFactory', () => {
  let dir: string;
  let server: Server;
  let wss: WebSocketServer;
  let socketPath: string;
  const received: unknown[] = [];
  let lastClient: WebSocket | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agt-daemon-'));
    socketPath = join(dir, 'd.sock');
    server = createServer();
    wss = new WebSocketServer({ server });
    wss.on('connection', (client) => {
      lastClient = client;
      client.on('message', (data) => {
        const message = JSON.parse(data.toString()) as {
          id?: number;
          method?: string;
          params?: unknown;
          result?: unknown;
        };
        received.push(message);
        if (message.method === 'initialize') {
          client.send(JSON.stringify({ id: message.id, result: { codexHome: dir } }));
        } else if (message.method === 'thread/list') {
          client.send(JSON.stringify({ id: message.id, result: { data: [{ id: 't1' }] } }));
        } else if (message.method === 'explode') {
          client.send(
            JSON.stringify({ id: message.id, error: { code: 7, message: 'boom', data: null } })
          );
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  afterAll(async () => {
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it('connects over the Unix control socket, initializes, and round-trips requests', async () => {
    const factory = new CodexAppServerDaemonFactory({
      binaryPath: 'codex-not-used',
      codexHome: dir,
      resolveSocketPath: async () => socketPath,
    });
    const session = await factory.open();
    const initialize = received.find(
      (message) => (message as { method?: string }).method === 'initialize'
    ) as { params: { clientInfo: { name: string } } };
    expect(initialize.params.clientInfo.name).toBe('agent_teams_worker');
    const threads = await session.request<{ data: { id: string }[] }>('thread/list', {});
    expect(threads.data[0]?.id).toBe('t1');
    // The socket is FIFO, so by the time thread/list answered the daemon had seen `initialized`.
    expect(
      received.some((message) => (message as { method?: string }).method === 'initialized')
    ).toBe(true);
    await expect(session.request('explode', {})).rejects.toMatchObject({
      name: 'CodexAppServerRequestError',
      code: 7,
    });
    await session.close();
  });

  it('delivers daemon-initiated requests and notifications, and reports unexpected closes', async () => {
    const factory = new CodexAppServerDaemonFactory({
      binaryPath: 'codex-not-used',
      codexHome: dir,
      resolveSocketPath: async () => socketPath,
      onServerRequest: async (request) => ({ echoed: request.method }),
    });
    const session = await factory.open();
    const notifications: string[] = [];
    session.onNotification((notification) => notifications.push(notification.method));
    const closed = new Promise<string>((resolve) =>
      session.onClose((event) => resolve(event.error.message))
    );
    const client = lastClient!;
    const reply = new Promise<unknown>((resolve) => {
      client.on('message', (data) => {
        const message = JSON.parse(data.toString()) as { id?: unknown; result?: unknown };
        if (message.id === 'srv-1') resolve(message.result);
      });
    });
    client.send(JSON.stringify({ id: 'srv-1', method: 'item/commandApproval', params: {} }));
    client.send(JSON.stringify({ method: 'turn/completed', params: {} }));
    expect(await reply).toEqual({ echoed: 'item/commandApproval' });
    await vi.waitFor(() => expect(notifications).toContain('turn/completed'));
    client.close(4000, 'daemon restart');
    expect(await closed).toMatch(/connection closed .*4000/);
  });
});

describe('ensureCodexHomeFeatureDisables', () => {
  it('appends a managed [features] block to a home without one and is idempotent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agt-home-'));
    await writeFile(join(home, 'config.toml'), '[tui]\nscreen_reader_detection_done = true\n');
    const first = await ensureCodexHomeFeatureDisables(home);
    expect(first.changed).toBe(true);
    const written = await readFile(first.configPath, 'utf8');
    expect(written).toContain('[tui]');
    expect(written).toMatch(/\[features\]\napps = false\nplugins = false\nremote_plugin = false/);
    const second = await ensureCodexHomeFeatureDisables(home);
    expect(second.changed).toBe(false);
    await rm(home, { recursive: true, force: true });
  });

  it('accepts a hand-written [features] table that already has the disables', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agt-home-'));
    await writeFile(
      join(home, 'config.toml'),
      '[features]\napps = false\nplugins = false\nremote_plugin = false\n'
    );
    expect((await ensureCodexHomeFeatureDisables(home)).changed).toBe(false);
    await rm(home, { recursive: true, force: true });
  });

  it('refuses to clobber a foreign [features] table that enables something', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agt-home-'));
    await writeFile(join(home, 'config.toml'), '[features]\napps = true\n');
    await expect(ensureCodexHomeFeatureDisables(home)).rejects.toThrow(/already defines \[features\]/);
    await rm(home, { recursive: true, force: true });
  });

  it('creates the config when the home has none yet', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agt-home-'));
    const result = await ensureCodexHomeFeatureDisables(home, { disableRemotePlugins: false });
    expect(result.changed).toBe(true);
    const written = await readFile(result.configPath, 'utf8');
    expect(written).toContain('apps = false');
    expect(written).not.toContain('remote_plugin');
    await rm(home, { recursive: true, force: true });
  });
});
