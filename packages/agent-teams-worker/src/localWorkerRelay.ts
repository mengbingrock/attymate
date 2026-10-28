import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { WebSocket, WebSocketServer, type RawData } from 'ws';

const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;

export interface LocalWorkerRelay {
  readonly url: string;
  readonly close: () => Promise<void>;
}

/** A loopback transport gateway. AWS remains the owner of teams, leases, and replay cursors. */
export const startLocalWorkerRelay = async (options: {
  readonly upstreamUrl: string;
  readonly token: string;
  readonly maxBufferedBytes?: number;
}): Promise<LocalWorkerRelay> => {
  const upstreamUrl = new URL(options.upstreamUrl);
  if (
    !['wss:', 'ws:'].includes(upstreamUrl.protocol) ||
    (upstreamUrl.protocol === 'ws:' &&
      !['127.0.0.1', '[::1]', 'localhost'].includes(upstreamUrl.hostname)) ||
    upstreamUrl.username ||
    upstreamUrl.password ||
    upstreamUrl.search ||
    upstreamUrl.hash ||
    !options.token ||
    /[^\x21-\x7e]/.test(options.token)
  )
    throw new Error('Local relay requires a private token and a TLS or loopback upstream URL');

  const limit = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_BUFFERED_BYTES)
    throw new Error('Invalid local relay buffer limit');
  const expected = Buffer.from(`Bearer ${options.token}`);
  const sockets = new Set<WebSocket>();
  const server = createServer((_request, response) => {
    response.writeHead(404, { 'cache-control': 'no-store' });
    response.end();
  });
  const gateway = new WebSocketServer({ noServer: true, maxPayload: limit });
  let stopping = false;

  server.on('upgrade', (request, socket, head) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (
      stopping ||
      request.url !== '/v2/worker-stream' ||
      request.headers.origin !== undefined ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected) ||
      sockets.size >= 8
    ) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    gateway.handleUpgrade(request, socket, head, (worker) => {
      const upstream = new WebSocket(upstreamUrl, {
        headers: { authorization: `Bearer ${options.token}` },
        maxPayload: limit,
        handshakeTimeout: 10_000,
        followRedirects: false,
      });
      sockets.add(worker);
      sockets.add(upstream);
      let pending: { data: RawData; binary: boolean }[] = [];
      let pendingBytes = 0;
      let closed = false;
      const disconnect = () => {
        if (closed) return;
        closed = true;
        pending = [];
        pendingBytes = 0;
        for (const peer of [worker, upstream]) {
          if (peer.readyState === WebSocket.OPEN) peer.close(1013, 'Relay connection closed');
          else if (peer.readyState === WebSocket.CONNECTING) peer.terminate();
        }
        // Bound shutdown even if the remote peer never completes its close handshake.
        const timer = setTimeout(() => {
          worker.terminate();
          upstream.terminate();
        }, 1_000);
        timer.unref();
      };
      const send = (target: WebSocket, data: RawData, binary: boolean) => {
        const bytes = Array.isArray(data)
          ? data.reduce((size, part) => size + part.byteLength, 0)
          : data.byteLength;
        if (
          closed ||
          target.readyState !== WebSocket.OPEN ||
          target.bufferedAmount + bytes > limit
        ) {
          disconnect();
          return;
        }
        target.send(data, { binary }, (error) => {
          if (error) disconnect();
        });
      };
      for (const peer of [worker, upstream]) {
        peer.on('error', disconnect);
        peer.on('close', () => {
          sockets.delete(peer);
          disconnect();
        });
      }
      worker.on('message', (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN) send(upstream, data, binary);
        else if (!closed) {
          pendingBytes += Array.isArray(data)
            ? data.reduce((size, part) => size + part.byteLength, 0)
            : data.byteLength;
          if (pendingBytes > limit || pending.length >= 1024) disconnect();
          else pending.push({ data, binary });
        }
      });
      upstream.on('open', () => {
        for (const message of pending) send(upstream, message.data, message.binary);
        pending = [];
        pendingBytes = 0;
      });
      upstream.on('message', (data, binary) => send(worker, data, binary));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local relay did not bind');
  return {
    url: `ws://127.0.0.1:${address.port}/v2/worker-stream`,
    close: async () => {
      if (stopping) return;
      stopping = true;
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
};
