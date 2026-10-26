// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

import { attachDesktopTransport } from '../../../../packages/agent-teams-worker/src/desktopTransport';

it('injects the selected team and saves its binding before returning a JSON text response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-ws-'));
  const upstreamServer = createServer();
  const upstream = new WebSocketServer({ server: upstreamServer });
  let received: Record<string, unknown> | undefined;
  const threadId = randomUUID();
  upstream.on('connection', (socket) =>
    socket.on('message', (data) => {
      received = JSON.parse(data.toString());
      socket.send(JSON.stringify({ id: received!.id, result: { thread: { id: threadId } } }));
    })
  );
  upstreamServer.listen(join(root, 'app.sock'));
  await once(upstreamServer, 'listening');
  let bindingSaved = false;
  const control = createServer((req, res) => {
    let body = '';
    req.on('data', (data) => {
      body += data;
    });
    req.on('end', () => {
      if (req.url?.endsWith('/prepare'))
        res.end(
          JSON.stringify({
            bindingId: 'binding',
            config: { mcp_servers: { 'agent-teams-runtime': { enabled: true } } },
          })
        );
      else {
        expect(JSON.parse(body).threadId).toBe(threadId);
        bindingSaved = true;
        res.end('{"ok":true}');
      }
    });
  });
  control.listen(join(root, 'control.sock'));
  await once(control, 'listening');
  const server = createServer();
  const close = attachDesktopTransport(
    server,
    '/private-capability',
    join(root, 'app.sock'),
    join(root, 'control.sock')
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const client = new WebSocket(`ws://127.0.0.1:${port}/private-capability`);
  try {
    await once(client, 'open');
    const response = once(client, 'message');
    client.send(
      JSON.stringify({
        id: 1,
        method: 'thread/start',
        params: { config: { model: 'user-choice' } },
      })
    );
    const [bytes, binary] = await response;
    expect(binary).toBe(false);
    expect(bindingSaved).toBe(true);
    expect(JSON.parse(bytes.toString()).result.thread.id).toBe(threadId);
    expect(received).toMatchObject({
      params: {
        config: { model: 'user-choice', mcp_servers: { 'agent-teams-runtime': { enabled: true } } },
      },
    });
    const denied = new WebSocket(`ws://127.0.0.1:${port}/wrong`);
    const [error] = await once(denied, 'error');
    expect(error.message).toContain('401');
  } finally {
    client.terminate();
    close();
    for (const socket of upstream.clients) socket.terminate();
    upstream.close();
    await Promise.all([
      new Promise<void>((r) => server.close(() => r())),
      new Promise<void>((r) => upstreamServer.close(() => r())),
      new Promise<void>((r) => control.close(() => r())),
    ]);
  }
});
