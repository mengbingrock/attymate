import { selectDistributedRuntimeAssignment } from '@features/distributed-agent-teams/renderer/utils/selectDistributedRuntimeAssignment';
import { describe, expect, it } from 'vitest';

import type { DistributedRelayLeaseDto } from '@features/distributed-agent-teams/contracts';
import type { DistributedTeamAssignmentDetail } from '@features/distributed-agent-teams/renderer/adapters/buildDistributedTeamDetail';

const assignment = (
  assignmentId: string,
  targetNodeId: string
): DistributedTeamAssignmentDetail => ({
  assignmentId,
  targetNodeId,
  title: assignmentId,
  workerLabel: targetNodeId,
  state: 'running',
  reason: 'test',
  revision: 1,
  commandStatus: 'acknowledged',
  attemptId: `attempt-${assignmentId}`,
  leaseEpoch: 1,
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
});

const lease = (
  assignmentId: string,
  nodeId: string,
  status: DistributedRelayLeaseDto['status']
): DistributedRelayLeaseDto => ({
  leaseId: `lease-${assignmentId}`,
  assignmentId,
  attemptId: `attempt-${assignmentId}`,
  nodeId,
  leaseEpoch: 1,
  assignmentRevision: 1,
  status,
  issuedAt: '2026-09-02T00:00:00.000Z',
  expiresAt: '2026-09-02T01:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
});

describe('selectDistributedRuntimeAssignment', () => {
  const leadAssignment = assignment('lead-assignment', 'local-lead');
  const remoteAssignment = assignment('remote-assignment', 'mengbing-device');
  const assignments = [leadAssignment, remoteAssignment];
  const leases = [
    lease('lead-assignment', 'local-lead', 'active'),
    lease('remote-assignment', 'mengbing-device', 'released'),
  ];

  it('does not substitute another worker when the selected worker has no active lease', () => {
    expect(
      selectDistributedRuntimeAssignment(assignments, leases, 'mengbing-device')
    ).toBeUndefined();
  });

  it('selects the requested worker when that worker has an active lease', () => {
    const activeLeases = [
      lease('lead-assignment', 'local-lead', 'active'),
      lease('remote-assignment', 'mengbing-device', 'granted'),
    ];

    expect(
      selectDistributedRuntimeAssignment(assignments, activeLeases, 'mengbing-device')
    ).toBe(remoteAssignment);
  });

  it('chooses the first active assignment only while no worker is explicitly selected', () => {
    expect(selectDistributedRuntimeAssignment(assignments, leases, null)).toBe(leadAssignment);
  });
});
