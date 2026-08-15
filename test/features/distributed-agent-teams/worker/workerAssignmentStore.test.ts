import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commandEnvelopeSchema } from '@claude-teams/agent-teams-protocol';
import {
  WorkerAssignmentRevisionConflictError,
  WorkerAssignmentStore,
  type WorkerInboxCommand,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

const NODE_ID = '00000000-0000-4000-8000-000000000001';

const offerCommand = (
  assignmentId: string,
  commandId: string,
  title: string
): WorkerInboxCommand => {
  const envelope = commandEnvelopeSchema.parse({
    protocolVersion: 2,
    commandId,
    sequence: 1,
    targetNodeId: NODE_ID,
    type: 'assignment.offer',
    payload: { assignmentId, title },
  });
  return {
    cursor: 1,
    commandId: envelope.commandId,
    envelope,
    receivedAt: '2026-08-14T20:00:00.000Z',
  };
};

describe('WorkerAssignmentStore', () => {
  it('projects an offer idempotently and records accepted queue transitions', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-assignment-store-'));
    const store = new WorkerAssignmentStore(dataDir);
    const assignmentId = '00000000-0000-4000-8000-000000000002';
    const command = offerCommand(
      assignmentId,
      '00000000-0000-4000-8000-000000000003',
      'Review a teammate change'
    );

    try {
      expect(store.projectOffer(command)).toMatchObject({
        assignmentId,
        state: 'proposed',
        revision: 0,
      });
      expect(store.projectOffer(command)).toMatchObject({ assignmentId, revision: 0 });
      expect(store.list()).toHaveLength(1);

      expect(store.accept({ assignmentId, expectedRevision: 0 })).toMatchObject({
        state: 'queued',
        revision: 2,
        decisionReason: 'serial_queue_entered',
      });
      expect(store.listActivity(assignmentId).map((event) => event.toState)).toEqual([
        'proposed',
        'accepted',
        'queued',
      ]);
      expect(() => store.accept({ assignmentId, expectedRevision: 0 })).toThrow(
        WorkerAssignmentRevisionConflictError
      );
      const leaseGrant = {
        assignmentId,
        attemptId: '00000000-0000-4000-8000-000000000008',
        leaseEpoch: 1,
        expiresAt: '2026-08-14T20:05:00.000Z',
        payload: {
          leaseId: '00000000-0000-4000-8000-000000000009',
          assignmentRevision: 2,
        },
      };
      expect(store.grantLease(leaseGrant)).toMatchObject({
        state: 'leased',
        revision: 3,
        leaseEpoch: 1,
        leaseExpiresAt: '2026-08-14T20:05:00.000Z',
      });
      expect(store.grantLease(leaseGrant)).toMatchObject({ state: 'leased', revision: 3 });
      expect(store.fenceExpired(new Date('2026-08-14T20:05:01.000Z'))).toEqual([
        expect.objectContaining({ state: 'fenced', revision: 4 }),
      ]);
    } finally {
      store.close();
    }
  });

  it('persists a deferred decision and can later accept it after restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-assignment-resume-'));
    const assignmentId = '00000000-0000-4000-8000-000000000004';
    const command = offerCommand(
      assignmentId,
      '00000000-0000-4000-8000-000000000005',
      'Prepare a release note'
    );
    let store = new WorkerAssignmentStore(dataDir);

    store.projectOffer(command);
    expect(
      store.defer({
        assignmentId,
        expectedRevision: 0,
        reason: 'After the customer call',
        deferredUntil: '2026-08-15T17:00:00-07:00',
      })
    ).toMatchObject({
      state: 'deferred',
      revision: 1,
      deferredUntil: '2026-08-16T00:00:00.000Z',
    });
    store.close();

    store = new WorkerAssignmentStore(dataDir);
    try {
      expect(store.accept({ assignmentId, expectedRevision: 1 })).toMatchObject({
        state: 'queued',
        revision: 3,
      });
    } finally {
      store.close();
    }
  });

  it('keeps rejection terminal', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-assignment-reject-'));
    const store = new WorkerAssignmentStore(dataDir);
    const assignmentId = '00000000-0000-4000-8000-000000000006';
    store.projectOffer(
      offerCommand(
        assignmentId,
        '00000000-0000-4000-8000-000000000007',
        'Work outside local policy'
      )
    );

    try {
      expect(store.reject({ assignmentId, reason: 'Repository is not approved' })).toMatchObject({
        state: 'rejected',
        revision: 1,
      });
      expect(() => store.accept({ assignmentId, expectedRevision: 1 })).toThrow(
        'Assignment cannot transition from rejected to accepted'
      );
    } finally {
      store.close();
    }
  });
});
