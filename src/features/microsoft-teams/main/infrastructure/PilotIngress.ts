import { createServer, request } from 'node:http';

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

interface PilotIngressOptions {
  teamsPort: number;
  relayPort: number;
}

const rejectUpgrade = (socket: Duplex, status: number, message: string): void => {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};

const responseHead = (response: IncomingMessage): string => {
  const lines = [
    `HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? 'Bad Gateway'}`,
  ];
  for (let index = 0; index < response.rawHeaders.length; index += 2)
    lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
  return `${lines.join('\r\n')}\r\n\r\n`;
};

/** Shares one public development domain without exposing the Relay manager API. */
export const createPilotIngress = ({ teamsPort, relayPort }: PilotIngressOptions): Server => {
  const server = createServer((incoming, outgoing) => {
    const messages = incoming.method === 'POST' && incoming.url === '/api/messages';
    const notice =
      (incoming.method === 'GET' || incoming.method === 'HEAD') &&
      (incoming.url === '/pilot-info/privacy.html' || incoming.url === '/pilot-info/terms.html');
    const update =
      (incoming.method === 'GET' || incoming.method === 'HEAD') &&
      /^\/pilot-updates\/[a-f0-9]{64}\.zip$/.test(incoming.url ?? '');
    if (!messages && !notice && !update) {
      outgoing.writeHead(404).end();
      return;
    }
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: teamsPort,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: `127.0.0.1:${teamsPort}` },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      }
    );
    upstream.setTimeout(30_000, () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on('aborted', () => upstream.destroy());
    outgoing.on('close', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  server.on('upgrade', (incoming, client, head) => {
    if (
      incoming.method !== 'GET' ||
      incoming.url !== '/v2/worker-stream' ||
      incoming.headers.upgrade?.toLowerCase() !== 'websocket'
    ) {
      rejectUpgrade(client, 404, 'Not Found');
      return;
    }
    const upstream = request({
      hostname: '127.0.0.1',
      port: relayPort,
      path: '/v2/worker-stream',
      method: 'GET',
      headers: { ...incoming.headers, host: `127.0.0.1:${relayPort}` },
    });
    upstream.setTimeout(15_000, () => upstream.destroy(new Error('Upgrade timeout')));
    let upgraded = false;
    upstream.on('upgrade', (response, remote, remoteHead) => {
      upgraded = true;
      remote.setTimeout(0);
      client.write(responseHead(response));
      if (remoteHead.length) client.write(remoteHead);
      if (head.length) remote.write(head);
      client.on('error', () => remote.destroy());
      remote.on('error', () => client.destroy());
      client.on('close', () => remote.destroy());
      remote.on('close', () => client.destroy());
      client.pipe(remote).pipe(client);
    });
    upstream.on('response', (response) => {
      client.write(responseHead(response));
      response.pipe(client);
    });
    upstream.on('error', () => {
      if (upgraded) client.destroy();
      else rejectUpgrade(client, 502, 'Bad Gateway');
    });
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
    upstream.end();
  });
  server.maxHeadersCount = 64;
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  return server;
};
