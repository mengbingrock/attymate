// @vitest-environment node
import { once } from 'node:events';
import { createServer } from 'node:http';

import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { startLocalWorkerRelay } from '../../../../packages/agent-teams-worker/src/localWorkerRelay';

const token = 'test-worker-capability';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});
const upstream = async () => {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener');
  cleanups.push(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { url: `ws://127.0.0.1:${address.port}/next/v2/worker-stream`, wss };
};
const localRelay = async (url: string, maxBufferedBytes?: number) => {
  const relay = await startLocalWorkerRelay({ upstreamUrl: url, token, maxBufferedBytes });
  cleanups.push(relay.close);
  return relay;
};
const connect = (url: string, headers = { authorization: `Bearer ${token}` }) => {
  const client = new WebSocket(url, { headers });
  cleanups.push(async () => client.terminate());
  return client;
};

it('forwards authenticated text and binary frames in order through a loopback-only endpoint', async () => {
  const remote = await upstream();
  const connections: { path: string; authorization: string | undefined }[] = [];
  remote.wss.on('connection', (socket, request) => {
    connections.push({ path: request.url!, authorization: request.headers.authorization });
    socket.on('message', (data, binary) => socket.send(data, { binary }));
  });
  const relay = await localRelay(remote.url);
  expect(relay.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/v2\/worker-stream$/);
  const client = connect(relay.url);
  await once(client, 'open');
  const received: { text: string; binary: boolean }[] = [];
  client.on('message', (data, binary) => received.push({ text: data.toString(), binary }));
  // These can arrive locally before the upstream handshake has completed.
  client.send('{"type":"worker.hello"}');
  client.send(Buffer.from([1, 2, 3]));
  client.send('{"type":"worker.heartbeat"}');
  await vi.waitFor(() => expect(received).toHaveLength(3));
  expect(received).toEqual([
    { text: '{"type":"worker.hello"}', binary: false },
    { text: '\x01\x02\x03', binary: true },
    { text: '{"type":"worker.heartbeat"}', binary: false },
  ]);
  expect(connections).toEqual([
    { path: '/next/v2/worker-stream', authorization: `Bearer ${token}` },
  ]);
});

it('rejects missing/wrong capabilities, browser origins, and other paths before contacting AWS', async () => {
  const remote = await upstream();
  const connected = vi.fn();
  remote.wss.on('connection', connected);
  const relay = await localRelay(remote.url);
  for (const [url, headers] of [
    [relay.url, {}],
    [relay.url, { authorization: 'Bearer wrong' }],
    [relay.url, { authorization: `Bearer ${token}`, origin: 'https://attacker.example' }],
    [relay.url + '?other=1', { authorization: `Bearer ${token}` }],
  ] as const) {
    const client = new WebSocket(url, { headers });
    await expect(once(client, 'open')).rejects.toThrow('401');
  }
  expect(connected).not.toHaveBeenCalled();
});

it('disconnects the Worker when AWS disconnects and supports a fresh connection for replay', async () => {
  const remote = await upstream();
  remote.wss.on('connection', (socket) =>
    socket.on('message', (data) => socket.send(data.toString()))
  );
  const relay = await localRelay(remote.url);
  const client = connect(relay.url);
  await once(client, 'open');
  client.send('cursor=4');
  expect((await once(client, 'message'))[0].toString()).toBe('cursor=4');
  const disconnected = once(client, 'close');
  for (const socket of remote.wss.clients) socket.terminate();
  expect((await disconnected)[0]).toBe(1013);
  const replacement = connect(relay.url);
  await once(replacement, 'open');
  replacement.send('cursor=5');
  expect((await once(replacement, 'message'))[0].toString()).toBe('cursor=5');
});

it('bounds buffered frames and closes failed upstream connections without claiming connectivity', async () => {
  const remote = await upstream();
  const relay = await localRelay(remote.url, 64);
  const client = connect(relay.url);
  await once(client, 'open');
  const closed = once(client, 'close');
  client.send('x'.repeat(65));
  expect((await closed)[0]).toBe(1009);
  const unavailable = await localRelay('ws://127.0.0.1:1/v2/worker-stream');
  const offlineClient = connect(unavailable.url);
  const offlineClosed = once(offlineClient, 'close');
  await once(offlineClient, 'open');
  expect((await offlineClosed)[0]).toBe(1013);
});

it('refuses unsafe upstream URLs and invalid queue limits before opening a listener', async () => {
  for (const url of [
    'ws://relay.example/v2/worker-stream',
    'wss://user:secret@relay.example/v2/worker-stream',
    'https://relay.example/',
  ])
    await expect(startLocalWorkerRelay({ upstreamUrl: url, token })).rejects.toThrow(
      /TLS or loopback/
    );
  await expect(
    startLocalWorkerRelay({ upstreamUrl: 'wss://relay.example/', token: '' })
  ).rejects.toThrow(/token/);
  await expect(
    startLocalWorkerRelay({ upstreamUrl: 'wss://relay.example/', token, maxBufferedBytes: 0 })
  ).rejects.toThrow(/buffer/);
});
