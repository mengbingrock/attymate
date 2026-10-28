// @vitest-environment node
import { once } from 'node:events';
import { createServer } from 'node:http';

import { createPilotIngress } from '@features/microsoft-teams/main';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const servers: Server[] = [];
const listen = async (server: Server): Promise<number> => {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
};

afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('single-domain pilot ingress', () => {
  it('preserves Teams authentication and body while serving only its two notices', async () => {
    const teams = await listen(
      createServer((request, response) => {
        if (request.url?.startsWith('/pilot-info/')) {
          response.end('Pilot notice');
          return;
        }
        if (request.headers.authorization !== 'Bearer synthetic-bot-token') {
          response.writeHead(401).end();
          return;
        }
        request.pipe(response);
      })
    );
    const port = await listen(createPilotIngress({ teamsPort: teams, relayPort: 1 }));
    const base = `http://127.0.0.1:${port}`;
    const result = await fetch(`${base}/api/messages`, {
      method: 'POST',
      headers: { authorization: 'Bearer synthetic-bot-token', 'content-type': 'application/json' },
      body: '{"synthetic":true}',
    });
    expect(await result.text()).toBe('{"synthetic":true}');
    expect((await fetch(`${base}/api/messages`, { method: 'POST' })).status).toBe(401);
    for (const name of ['privacy', 'terms'])
      expect(await (await fetch(`${base}/pilot-info/${name}.html`)).text()).toBe('Pilot notice');
  });

  it('does not expose manager APIs, arbitrary files, encoded paths, or other methods', async () => {
    let forwarded = 0;
    const upstream = await listen(
      createServer((_request, response) => {
        forwarded++;
        response.end('Private API');
      })
    );
    const port = await listen(createPilotIngress({ teamsPort: upstream, relayPort: upstream }));
    for (const path of [
      '/v2/debug/snapshot',
      '/v2/runtime-sessions',
      '/v2/runtime-owner/authorize',
      '/v2/runtime-owner/revoke',
      '/v2/runtime-sessions/not-a-session/controls',
      '/api/messages?extra=1',
      '/pilot-info/other.html',
      '/%61pi/messages',
      '/v2/worker-stream',
      '/pilot-updates/config.json',
      '/pilot-updates/' + 'a'.repeat(64) + '.zip?extra=1',
      '/pilot-updates/',
    ])
      expect((await fetch(`http://127.0.0.1:${port}${path}`)).status).toBe(404);
    expect(forwarded).toBe(0);
  });

  it('serves only a hash-addressed code update with GET or HEAD', async () => {
    const upstream = await listen(
      createServer((_request, response) => response.end('code-only zip'))
    );
    const port = await listen(createPilotIngress({ teamsPort: upstream, relayPort: 1 }));
    const url = `http://127.0.0.1:${port}/pilot-updates/${'a'.repeat(64)}.zip`;
    expect(await (await fetch(url)).text()).toBe('code-only zip');
    expect((await fetch(url, { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(url, { method: 'POST' })).status).toBe(404);
  });

  it('forwards only owner-runtime routes to the Relay with their authorization intact', async () => {
    const relay = await listen(
      createServer((request, response) => {
        if (request.headers.authorization !== 'Bearer owner-session-capability') {
          response.writeHead(403).end();
          return;
        }
        request.pipe(response);
      })
    );
    const port = await listen(createPilotIngress({ teamsPort: 1, relayPort: relay }));
    const base = `http://127.0.0.1:${port}`;
    const session = '42000000-0000-4000-8000-000000000001';
    for (const path of ['/v2/runtime-sessions', `/v2/runtime-sessions/${session}/controls`]) {
      expect((await fetch(base + path, { method: 'POST' })).status).toBe(403);
      const result = await fetch(base + path, {
        method: 'POST',
        headers: { authorization: 'Bearer owner-session-capability' },
        body: 'signed-fixture',
      });
      expect(await result.text()).toBe('signed-fixture');
    }
    expect(
      (
        await fetch(`${base}/v2/runtime-sessions/${session}/events?after=0`, {
          headers: { authorization: 'Bearer owner-session-capability' },
        })
      ).status
    ).toBe(200);
    expect((await fetch(`${base}/v2/runtime-sessions/${session}/events?extra=1`)).status).toBe(404);
  });

  it('forwards authenticated WebSocket frames and preserves unauthorized upgrade rejection', async () => {
    const relay = createServer();
    const sockets = new WebSocketServer({ noServer: true });
    relay.on('upgrade', (request, socket, head) => {
      if (request.headers.authorization !== 'Bearer synthetic-worker-token') {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      sockets.handleUpgrade(request, socket, head, (client) => {
        client.on('message', (message) => client.send(message));
      });
    });
    const relayPort = await listen(relay);
    const port = await listen(createPilotIngress({ teamsPort: 1, relayPort }));
    const endpoint = `ws://127.0.0.1:${port}/v2/worker-stream`;
    const client = new WebSocket(endpoint, {
      headers: { authorization: 'Bearer synthetic-worker-token' },
    });
    await once(client, 'open');
    const message = once(client, 'message');
    client.send('synthetic peer frame');
    const [reply] = (await message) as [Buffer];
    expect(reply.toString()).toBe('synthetic peer frame');
    client.close();
    await once(client, 'close');
    const unauthorized = new WebSocket(endpoint);
    unauthorized.on('error', () => undefined);
    const status = await new Promise<number | undefined>((resolve) => {
      unauthorized.on('unexpected-response', (request, response) => {
        resolve(response.statusCode);
        request.destroy();
      });
    });
    expect(status).toBe(401);
    sockets.close();
  });
});
