// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsWorker } from '@claude-teams/agent-teams-worker';
import { expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

it('omits session fields with an older relay and reconnects when acknowledgements stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'presence-old-relay-'));
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let connections = 0;
  const heartbeats: Record<string, unknown>[] = [];
  wss.on('connection', (socket) => {
    connections++;
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'worker.hello')
        socket.send(
          JSON.stringify({
            type: 'relay.welcome',
            protocolVersion: 2,
            insecureLanMode: true,
            heartbeatIntervalMs: 100,
            connectedAt: new Date().toISOString(),
          })
        );
      if (message.type === 'worker.heartbeat') {
        heartbeats.push(message);
        if (heartbeats.length === 1)
          socket.send(
            JSON.stringify({
              type: 'relay.heartbeat_ack',
              protocolVersion: 2,
              sequence: message.sequence,
              receivedAt: new Date().toISOString(),
              leaseReconciliation: { action: 'none' },
            })
          );
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const worker = await startAgentTeamsWorker({
    relayUrl: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
    dataDir: root,
    organizationId: organizationIdSchema.parse(randomUUID()),
    personId: personIdSchema.parse(randomUUID()),
    nodeId: nodeIdSchema.parse(randomUUID()),
    workerInstanceId: workerInstanceIdSchema.parse(randomUUID()),
    workerGeneration: 1,
    label: 'Old relay fixture',
    reconnectDelayMs: 10,
  });
  try {
    await worker.ready;
    await vi.waitFor(() => expect(connections).toBeGreaterThan(1), { timeout: 2000 });
    expect(heartbeats.length).toBeGreaterThan(1);
    expect(heartbeats.every((message) => !Object.hasOwn(message, 'sessions'))).toBe(true);
    expect(worker.getStatus().lastHeartbeatSequence).toBeGreaterThan(0);
  } finally {
    await worker.stop();
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
