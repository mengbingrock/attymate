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
  it('renews one active assignment and fences it without starting queued work offline', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-single-slot-'));
    const nodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000001');
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 160,
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
      reconnectDelayMs: 1_000,
      leaseSweepIntervalMs: 10,
    });
    const assignmentIds = [
      '00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000006',
    ];

    let relayClosed = false;
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
      const originalExpiry = relay.listLeases()[0]!.expiresAt;
      worker.acceptAssignment({ assignmentId: assignmentIds[1]!, expectedRevision: 0 });
      expect(worker.listAssignments()[1]).toMatchObject({ state: 'queued', revision: 2 });
      expect(relay.listLeases()).toHaveLength(1);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(worker.listAssignments()[0]).toMatchObject({ state: 'leased', leaseEpoch: 1 });
      expect(worker.listAssignments()[1]).toMatchObject({ state: 'queued', revision: 2 });
      expect(Date.parse(relay.listLeases()[0]!.expiresAt)).toBeGreaterThan(
        Date.parse(originalExpiry)
      );

      await relay.close();
      relayClosed = true;
      await vi.waitFor(
        () => expect(worker.listAssignments()[0]).toMatchObject({ state: 'fenced' }),
        { timeout: 2_000 }
      );
      expect(worker.listAssignments()[1]).toMatchObject({ state: 'queued', revision: 2 });
    } finally {
      await worker.stop();
      if (!relayClosed) await relay.close();
    }
  });
});
