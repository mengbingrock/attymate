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
import { startAgentTeamsRelay, type StartedAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import { startAgentTeamsWorker } from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

const eventStates = (relay: StartedAgentTeamsRelay): unknown[] =>
  relay.listEvents().map((event) => (event.envelope.payload as { state?: unknown }).state);

describe('assignment decision event replay', () => {
  it('persists offline owner decisions and publishes them after Relay restart', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-decision-replay-'));
    const relayDataDir = join(dataRoot, 'relay');
    let relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: relayDataDir,
      heartbeatIntervalMs: 25,
    });
    let relayIsRunning = true;
    const relayPort = Number(new URL(relay.httpUrl).port);
    const nodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000001');
    const workerInstanceId = workerInstanceIdSchema.parse('00000000-0000-4000-8000-000000000002');
    const assignmentId = '00000000-0000-4000-8000-000000000003';
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'worker'),
      organizationId: organizationIdSchema.parse('00000000-0000-4000-8000-000000000004'),
      personId: personIdSchema.parse('00000000-0000-4000-8000-000000000005'),
      nodeId,
      workerInstanceId,
      workerGeneration: 1,
      label: 'Decision Replay Worker',
      reconnectDelayMs: 25,
    });

    try {
      await worker.ready;
      relay.enqueueCommand(
        commandEnvelopeSchema.parse({
          protocolVersion: 2,
          commandId: '00000000-0000-4000-8000-000000000006',
          sequence: 1,
          targetNodeId: nodeId,
          assignmentId,
          type: 'assignment.offer',
          payload: { assignmentId, title: 'Exercise durable decision replay' },
        })
      );
      await vi.waitFor(() => {
        expect(eventStates(relay)).toEqual(['proposed']);
      });

      expect(worker.deferAssignment({ assignmentId, expectedRevision: 0 })).toMatchObject({
        state: 'deferred',
        revision: 1,
      });
      await vi.waitFor(() => {
        expect(eventStates(relay)).toEqual(['proposed', 'deferred']);
        expect(worker.listOutboxEvents().every((event) => event.acknowledgedAt !== undefined)).toBe(
          true
        );
      });

      await relay.close();
      relayIsRunning = false;
      await vi.waitFor(() => expect(worker.getStatus().state).toBe('reconnecting'));
      expect(worker.acceptAssignment({ assignmentId, expectedRevision: 1 })).toMatchObject({
        state: 'queued',
        revision: 3,
      });
      expect(
        worker.listOutboxEvents().filter((event) => event.acknowledgedAt === undefined)
      ).toHaveLength(2);

      relay = await startAgentTeamsRelay({
        host: '127.0.0.1',
        port: relayPort,
        dataDir: relayDataDir,
        heartbeatIntervalMs: 25,
      });
      relayIsRunning = true;
      await vi.waitFor(() => {
        expect(eventStates(relay)).toEqual([
          'proposed',
          'deferred',
          'accepted',
          'queued',
          'leased',
        ]);
        expect(worker.listAssignments()[0]).toMatchObject({
          state: 'leased',
          leaseEpoch: 1,
        });
        expect(worker.listOutboxEvents().every((event) => event.acknowledgedAt !== undefined)).toBe(
          true
        );
      });
    } finally {
      await worker.stop();
      if (relayIsRunning) await relay.close();
    }
  });
});
