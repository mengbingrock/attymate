// @vitest-environment node
import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { CodexAppServerDaemonFactory } from '../../../../packages/agent-teams-worker/src/codexAppServerClient';
import { localAppServerWebSocket } from '../../../../packages/agent-teams-worker/src/localAppServerWebSocket';

it('connects to the explicit Windows loopback server with capability authentication', async () => {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const token = 'a'.repeat(64);
  let authorization: string | undefined;
  wss.on('connection', (socket, request) => {
    authorization = request.headers.authorization;
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.id !== undefined)
        socket.send(
          JSON.stringify({
            id: message.id,
            result: message.method === 'initialize' ? {} : { ok: true },
          })
        );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  try {
    const session = await new CodexAppServerDaemonFactory({
      binaryPath: 'must-not-start',
      codexHome: 'must-not-read',
      ensureDaemon: false,
      socketPath: `ws://127.0.0.1:${address.port}`,
      env: { AGENT_TEAMS_APP_SERVER_TOKEN: token },
    }).open();
    try {
      expect(authorization).toBe(`Bearer ${token}`);
      await expect(session.request('probe')).resolves.toEqual({ ok: true });
    } finally {
      await session.close();
    }
  } finally {
    wss.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

it('refuses unprotected or non-loopback endpoints before sending credentials', () => {
  for (const url of [
    'ws://example.com:1234',
    'wss://127.0.0.1:1234',
    'ws://127.0.0.1:1234/secret',
    'ws://user@127.0.0.1:1234',
  ])
    expect(() => localAppServerWebSocket(url, 'a'.repeat(64))).toThrow(/loopback/);
  expect(() => localAppServerWebSocket('ws://127.0.0.1:1234')).toThrow(/token/);
});
