import type { DistributedRelayLeaseDto } from '../../contracts';
import type { DistributedTeamAssignmentDetail } from '../adapters/buildDistributedTeamDetail';

const hasActiveRuntimeLease = (
  assignment: DistributedTeamAssignmentDetail,
  leases: readonly DistributedRelayLeaseDto[]
): boolean =>
  assignment.attemptId !== undefined &&
  assignment.leaseEpoch !== undefined &&
  leases.some(
    (lease) =>
      lease.assignmentId === assignment.assignmentId &&
      (lease.status === 'granted' || lease.status === 'active')
  );

export function selectDistributedRuntimeAssignment(
  assignments: readonly DistributedTeamAssignmentDetail[],
  leases: readonly DistributedRelayLeaseDto[],
  selectedRuntimeNodeId: string | null
): DistributedTeamAssignmentDetail | undefined {
  if (selectedRuntimeNodeId !== null) {
    return assignments.find(
      (assignment) =>
        assignment.targetNodeId === selectedRuntimeNodeId &&
        hasActiveRuntimeLease(assignment, leases)
    );
  }

  return assignments.find((assignment) => hasActiveRuntimeLease(assignment, leases));
}
