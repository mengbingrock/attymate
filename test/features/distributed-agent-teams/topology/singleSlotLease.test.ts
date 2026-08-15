// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commandEnvelopeSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import { startAgentTeamsWorker } from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

describe('single-slot Worker execution leases', () => {
  it('leases one queued assignment and fences it before starting the next', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-single-slot-'));
    const nodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000001');
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 300,
    });
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'worker'),
      organizationId: organizationIdSchema.parse('00000000-0000-4000-8000-000000000002'),
      personId: personIdSchema.parse('00000000-0000-4000-8000-000000000003'),
      nodeId,
      workerInstanceId: workerInstanceIdSchema.parse('00000000-0000-4000-8000-000000000004'),
      workerGeneration: 1,
      label: 'Single Slot Worker',
      reconnectDelayMs: 20,
      leaseSweepIntervalMs: 10,
    });
    const assignmentIds = [
      '00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000006',
    ];

    try {
      await worker.ready;
      assignmentIds.forEach((assignmentId, index) => {
        relay.enqueueCommand(
          commandEnvelopeSchema.parse({
            protocolVersion: 2,
            commandId: `00000000-0000-4000-8000-00000000001${index}`,
            sequence: index + 1,
            targetNodeId: nodeId,
            assignmentId,
            type: 'assignment.offer',
            payload: { assignmentId, title: `Queued assignment ${index + 1}` },
          })
        );
      });
      await vi.waitFor(() => expect(worker.listAssignments()).toHaveLength(2));

      worker.acceptAssignment({ assignmentId: assignmentIds[0]!, expectedRevision: 0 });
      await vi.waitFor(() => {
        expect(worker.listAssignments()[0]).toMatchObject({ state: 'leased', leaseEpoch: 1 });
        expect(relay.listLeases()).toHaveLength(1);
      });
      worker.acceptAssignment({ assignmentId: assignmentIds[1]!, expectedRevision: 0 });
      expect(worker.listAssignments()[1]).toMatchObject({ state: 'queued', revision: 2 });
      expect(relay.listLeases()).toHaveLength(1);

      await vi.waitFor(
        () => {
          expect(worker.listAssignments()[0]).toMatchObject({ state: 'fenced' });
          expect(worker.listAssignments()[1]).toMatchObject({ state: 'leased', leaseEpoch: 1 });
          expect(relay.listLeases()).toHaveLength(2);
        },
        { timeout: 2_000 }
      );
    } finally {
      await worker.stop();
      await relay.close();
    }
  });
});
