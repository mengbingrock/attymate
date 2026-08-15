import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assignmentIdSchema,
  commandIdSchema,
  nodeIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import {
  type WorkerAssignment,
  type WorkerAssignmentActivity,
  WorkerOutboxAcknowledgementError,
  WorkerOutboxStore,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

describe('WorkerOutboxStore', () => {
  it('projects assignment activity idempotently and persists acknowledgements', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-outbox-'));
    const nodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000001');
    const workerInstanceId = workerInstanceIdSchema.parse('00000000-0000-4000-8000-000000000002');
    const assignmentId = assignmentIdSchema.parse('00000000-0000-4000-8000-000000000003');
    const assignment: WorkerAssignment = {
      assignmentId,
      offerCommandId: commandIdSchema.parse('00000000-0000-4000-8000-000000000004'),
      targetNodeId: nodeId,
      title: 'Review an outbox change',
      state: 'deferred',
      revision: 1,
      offeredAt: '2026-08-14T20:00:00.000Z',
      updatedAt: '2026-08-14T20:01:00.000Z',
      deferredUntil: '2026-08-15T20:00:00.000Z',
    };
    const activity: WorkerAssignmentActivity = {
      id: 7,
      assignmentId,
      revision: 1,
      fromState: 'proposed',
      toState: 'deferred',
      reason: 'owner_deferred',
      occurredAt: '2026-08-14T20:01:00.000Z',
    };
    let store = new WorkerOutboxStore(dataDir, { nodeId, workerInstanceId });

    const first = store.projectAssignmentActivity(assignment, activity);
    expect(first.envelope).toMatchObject({
      sequence: 1,
      sourceNodeId: nodeId,
      workerInstanceId,
      assignmentId,
      type: 'assignment.state_changed',
      payload: {
        state: 'deferred',
        revision: 1,
        deferredUntil: assignment.deferredUntil,
      },
    });
    expect(store.projectAssignmentActivity(assignment, activity).eventId).toBe(first.eventId);
    expect(store.listPending()).toHaveLength(1);
    store.close();

    store = new WorkerOutboxStore(dataDir, { nodeId, workerInstanceId });
    try {
      expect(store.listPending()[0]?.eventId).toBe(first.eventId);
      expect(() => store.acknowledge(first.eventId, 2)).toThrow(WorkerOutboxAcknowledgementError);
      expect(store.acknowledge(first.eventId, 1).acknowledgedAt).toEqual(expect.any(String));
      expect(store.acknowledge(first.eventId, 1).acknowledgedAt).toEqual(expect.any(String));
      expect(store.lastAcknowledgedSequence()).toBe(1);
      expect(store.listPending()).toHaveLength(0);
    } finally {
      store.close();
    }
  });
});
