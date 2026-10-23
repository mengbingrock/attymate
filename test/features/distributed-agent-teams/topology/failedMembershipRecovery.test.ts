// @vitest-environment node
/* eslint-disable @typescript-eslint/require-await -- Test doubles implement asynchronous runtime ports. */
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  teamIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import {
  type CodexAppServerNotification,
  startAgentTeamsWorker,
  type WorkerCodexAppServerSession,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

describe('failed membership assignments', () => {
  it('keeps failure terminal across heartbeats and reconnects until an explicit recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-teams-failed-membership-'));
    const nodeId = nodeIdSchema.parse(randomUUID());
    const teamId = teamIdSchema.parse(randomUUID());
    const listeners = new Set<(notification: CodexAppServerNotification) => void>();
    let starts = 0;
    const session: WorkerCodexAppServerSession = {
      request: async <T>(method: string): Promise<T> => {
        if (method === 'thread/start') return { thread: { id: randomUUID() } } as T;
        if (method === 'turn/start') {
          starts += 1;
          return { turn: { id: randomUUID(), status: 'inProgress' } } as T;
        }
        return {} as T;
      },
      notify: () => undefined,
      onNotification: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onRequest: () => () => undefined,
      onClose: () => () => undefined,
      respondToRequest: () => undefined,
      close: async () => undefined,
    };
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(root, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 2_000,
    });
    const options = {
      relayUrl: relay.wsUrl,
      dataDir: join(root, 'worker'),
      nodeId,
      organizationId: organizationIdSchema.parse(randomUUID()),
      personId: personIdSchema.parse(randomUUID()),
      workerInstanceId: workerInstanceIdSchema.parse(randomUUID()),
      workerGeneration: 1,
      label: 'Failure recovery test',
      codexRuntime: { cwd: join(root, 'workspace'), sessionFactory: { open: async () => session } },
    };
    let worker = await startAgentTeamsWorker(options);
    try {
      await worker.ready;
      const joined = await relay.app.inject({
        method: 'POST',
        url: `/v2/teams/${teamId}/members`,
        payload: { targetNodeId: nodeId, role: 'lead', title: 'Synthetic failure test' },
      });
      expect(joined.statusCode).toBe(201);
      const membershipId = joined.json().membership.membershipId;
      await vi.waitFor(() => expect(worker.listAssignments()[0]?.state).toBe('running'));
      const active = worker.listRuntimeBindings()[0];
      for (const listener of listeners)
        listener({
          method: 'turn/completed',
          params: {
            threadId: active.threadId,
            turn: {
              id: active.turnId,
              status: 'failed',
              error: { message: '429 Too Many Requests' },
            },
          },
        });
      await vi.waitFor(() => expect(worker.listAssignments()[0]?.state).toBe('failed'));
      const heartbeat = worker.getStatus().lastHeartbeatSequence;
      await vi.waitFor(() =>
        expect(worker.getStatus().lastHeartbeatSequence).toBeGreaterThan(heartbeat + 3)
      );
      expect(worker.listAssignments()).toHaveLength(1);
      expect(starts).toBe(1);

      await worker.stop();
      worker = await startAgentTeamsWorker(options);
      await worker.ready;
      await vi.waitFor(() => expect(worker.getStatus().lastHeartbeatSequence).toBeGreaterThan(3));
      expect(worker.listAssignments()).toHaveLength(1);
      expect(starts).toBe(1);

      const recovered = await relay.app.inject({
        method: 'POST',
        url: `/v2/teams/${teamId}/members`,
        payload: {
          targetNodeId: nodeId,
          membershipId,
          workspaceId: joined.json().membership.workspaceId,
          role: 'lead',
          title: 'Explicit recovery',
        },
      });
      expect(recovered.statusCode).toBe(201);
      await vi.waitFor(() => expect(starts).toBe(2));
      expect(worker.listAssignments()).toHaveLength(2);
    } finally {
      await worker.stop();
      await relay.close();
    }
  });
});
