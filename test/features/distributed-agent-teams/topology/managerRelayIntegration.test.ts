// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import { startAgentTeamsWorker } from '@claude-teams/agent-teams-worker';
import { createDistributedAgentTeamsFeature } from '@features/distributed-agent-teams/main';
import { describe, expect, it, vi } from 'vitest';

describe('Manager, Relay, and headless Workers', () => {
  it('discovers two Workers and delivers a remote assignment offer', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-manager-relay-'));
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 50,
    });
    const organizationId = organizationIdSchema.parse('11111111-1111-4111-8111-111111111111');
    const workers = await Promise.all(
      [
        {
          label: 'Alice Worker',
          personId: '22222222-2222-4222-8222-222222222222',
          nodeId: '33333333-3333-4333-8333-333333333333',
          instanceId: '44444444-4444-4444-8444-444444444444',
        },
        {
          label: 'Bob Worker',
          personId: '55555555-5555-4555-8555-555555555555',
          nodeId: '66666666-6666-4666-8666-666666666666',
          instanceId: '77777777-7777-4777-8777-777777777777',
        },
      ].map((input, index) =>
        startAgentTeamsWorker({
          relayUrl: relay.wsUrl,
          dataDir: join(dataRoot, `worker-${index + 1}`),
          organizationId,
          personId: personIdSchema.parse(input.personId),
          nodeId: nodeIdSchema.parse(input.nodeId),
          workerInstanceId: workerInstanceIdSchema.parse(input.instanceId),
          workerGeneration: 1,
          label: input.label,
          reconnectDelayMs: 50,
        })
      )
    );

    try {
      await Promise.all(workers.map((worker) => worker.ready));
      const manager = createDistributedAgentTeamsFeature({ relayUrl: relay.httpUrl });

      await expect(manager.getTopology()).resolves.toMatchObject({
        degraded: false,
        workers: [
          { label: 'Alice Worker', status: 'connected' },
          { label: 'Bob Worker', status: 'connected' },
        ],
      });
      await manager.createRemoteAssignment({
        targetNodeId: '66666666-6666-4666-8666-666666666666',
        title: 'Review the distributed Manager slice',
      });

      await vi.waitFor(() => {
        expect(workers[1]?.listInboxCommands()).toHaveLength(1);
      });
      expect(workers[1]?.listInboxCommands()[0]?.envelope).toMatchObject({
        type: 'assignment.offer',
        payload: { title: 'Review the distributed Manager slice' },
      });
      expect(workers[0]?.listInboxCommands()).toHaveLength(0);
    } finally {
      await Promise.all(workers.map((worker) => worker.stop()));
      await relay.close();
    }
  });
});
