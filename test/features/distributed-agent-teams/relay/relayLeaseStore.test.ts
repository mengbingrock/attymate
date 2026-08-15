import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RelayLeaseStore } from '@claude-teams/agent-teams-relay';
import { describe, expect, it } from 'vitest';

describe('RelayLeaseStore', () => {
  it('reserves one execution slot per node and increments fencing epochs', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-relay-leases-'));
    const store = new RelayLeaseStore(dataDir, 60_000);
    const nodeId = '00000000-0000-4000-8000-000000000001';
    const firstAssignmentId = '00000000-0000-4000-8000-000000000002';
    const secondAssignmentId = '00000000-0000-4000-8000-000000000003';

    try {
      const first = store.grantIfCapacity({
        assignmentId: firstAssignmentId,
        assignmentRevision: 2,
        nodeId,
      });
      expect(first).toMatchObject({
        lease: { assignmentId: firstAssignmentId, leaseEpoch: 1, status: 'granted' },
        command: {
          assignmentId: firstAssignmentId,
          leaseEpoch: 1,
          type: 'assignment.lease_grant',
          payload: { assignmentRevision: 2 },
        },
      });
      expect(
        store.grantIfCapacity({
          assignmentId: secondAssignmentId,
          assignmentRevision: 2,
          nodeId,
        })
      ).toBeUndefined();

      store.markActive(firstAssignmentId, first!.lease.attemptId, 1);
      expect(store.listAll()[0]?.status).toBe('active');
      const renewed = store.reconcileHeartbeatLease(
        nodeId,
        {
          assignmentId: firstAssignmentId,
          attemptId: first!.lease.attemptId,
          leaseId: first!.lease.leaseId,
          leaseEpoch: 1,
        },
        new Date(Date.parse(first!.lease.issuedAt) + 1_000)
      );
      expect(renewed).toMatchObject({
        action: 'renewed',
        assignmentId: firstAssignmentId,
        leaseId: first!.lease.leaseId,
      });
      expect(store.get(first!.lease.leaseId)?.expiresAt).toBe(
        renewed.action === 'renewed' ? renewed.expiresAt : undefined
      );
      expect(
        store.reconcileHeartbeatLease(nodeId, {
          assignmentId: firstAssignmentId,
          attemptId: first!.lease.attemptId,
          leaseId: '00000000-0000-4000-8000-000000000099',
          leaseEpoch: 1,
        })
      ).toMatchObject({ action: 'fence', reason: 'lease_identity_mismatch' });
      store.release(firstAssignmentId, first!.lease.attemptId, 1);
      expect(
        store.reconcileHeartbeatLease(nodeId, {
          assignmentId: firstAssignmentId,
          attemptId: first!.lease.attemptId,
          leaseId: first!.lease.leaseId,
          leaseEpoch: 1,
        })
      ).toMatchObject({ action: 'fence', reason: 'lease_released' });
      const second = store.grantIfCapacity({
        assignmentId: secondAssignmentId,
        assignmentRevision: 4,
        nodeId,
      });
      expect(second?.lease).toMatchObject({
        assignmentId: secondAssignmentId,
        leaseEpoch: 1,
        status: 'granted',
      });
      store.release(secondAssignmentId);
      const retry = store.grantIfCapacity({
        assignmentId: secondAssignmentId,
        assignmentRevision: 4,
        nodeId,
      });
      expect(retry?.lease.leaseEpoch).toBe(2);
      expect(
        store.reconcileHeartbeatLease(
          nodeId,
          {
            assignmentId: secondAssignmentId,
            attemptId: retry!.lease.attemptId,
            leaseId: retry!.lease.leaseId,
            leaseEpoch: 2,
          },
          new Date(Date.parse(retry!.lease.expiresAt) + 1)
        )
      ).toMatchObject({ action: 'fence', reason: 'lease_expired' });
    } finally {
      store.close();
    }
  });
});
