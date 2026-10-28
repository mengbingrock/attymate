// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

import { attachDesktopTransport } from '../../../../packages/agent-teams-worker/src/desktopTransport';

it.each(['socket', 'websocket'])(
  'injects the selected team and saves its binding over %s',
  async (transport) => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-ws-'));
    const upstreamServer = createServer();
    const upstream = new WebSocketServer({ server: upstreamServer });
    let received: Record<string, unknown> | undefined;
    let authorization: string | undefined;
    const token = 'b'.repeat(64);
    vi.stubEnv('AGENT_TEAMS_APP_SERVER_TOKEN', token);
    const threadId = randomUUID();
    upstream.on('connection', (socket, request) => {
      authorization = request.headers.authorization;
      socket.on('message', (data) => {
        received = JSON.parse(data.toString());
        socket.send(JSON.stringify({ id: received!.id, result: { thread: { id: threadId } } }));
      });
    });
    if (transport === 'socket') upstreamServer.listen(join(root, 'app.sock'));
    else upstreamServer.listen(0, '127.0.0.1');
    await once(upstreamServer, 'listening');
    let bindingSaved = false;
    let denyTurn = false;
    const preparedMethods: string[] = [];
    const control = createServer((req, res) => {
      let body = '';
      req.on('data', (data) => {
        body += data;
      });
      req.on('end', () => {
        if (req.url?.endsWith('/prepare')) {
          const { method } = JSON.parse(body) as { method: string };
          preparedMethods.push(method);
          if (method === 'turn/start' && denyTurn) {
            res.statusCode = 403;
            res.end('{"error":"Membership MCP inventory leaked server"}');
            return;
          }
          res.end(
            JSON.stringify({
              bindingId: 'binding',
              config: { mcp_servers: { 'agent-teams-runtime': { enabled: true } } },
            })
          );
        } else {
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
      transport === 'socket'
        ? join(root, 'app.sock')
        : `ws://127.0.0.1:${(upstreamServer.address() as { port: number }).port}`,
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
      expect(authorization).toBe(transport === 'websocket' ? `Bearer ${token}` : undefined);
      expect(JSON.parse(bytes.toString()).result.thread.id).toBe(threadId);
      expect(received).toMatchObject({
        params: {
          config: {
            model: 'user-choice',
            mcp_servers: { 'agent-teams-runtime': { enabled: true } },
          },
        },
      });
      const started = received;
      denyTurn = true;
      const deniedTurn = once(client, 'message');
      client.send(JSON.stringify({ id: 2, method: 'turn/start', params: { threadId, input: [] } }));
      const [deniedBytes] = await deniedTurn;
      expect(JSON.parse(deniedBytes.toString())).toMatchObject({ id: 2, error: { code: -32000 } });
      expect(preparedMethods).toEqual(['thread/start', 'turn/start']);
      expect(received).toBe(started);
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
      vi.unstubAllEnvs();
    }
  }
);
