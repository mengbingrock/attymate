import type {
  DistributedAssignmentEventDto,
  DistributedAssignmentEventsDto,
  DistributedAssignmentState,
  DistributedTopologyDto,
} from '../../contracts';

const ACTIVE_ASSIGNMENT_STATES = new Set<DistributedAssignmentState>([
  'running',
  'waiting_local_approval',
  'verifying',
  'committing',
  'awaiting_push',
  'reporting',
]);

export interface DistributedTeamWorkerSummary {
  nodeId: string;
  label: string;
  status: 'connected' | 'stale' | 'offline';
}

export interface DistributedTeamSummary {
  teamId: string;
  displayName: string;
  relayUrl: string;
  workers: DistributedTeamWorkerSummary[];
  connectedWorkerCount: number;
  assignmentCount: number;
  activeAssignmentCount: number;
  lastActivityAt: string;
}

export function latestDistributedAssignments(
  events: DistributedAssignmentEventDto[]
): DistributedAssignmentEventDto[] {
  const latestByAssignment = new Map<string, DistributedAssignmentEventDto>();
  for (const event of events) {
    const previous = latestByAssignment.get(event.assignmentId);
    if (!previous || event.cursor > previous.cursor) {
      latestByAssignment.set(event.assignmentId, event);
    }
  }
  return [...latestByAssignment.values()].sort((left, right) => right.cursor - left.cursor);
}

function teamDisplayName(teamId: string, teamCount: number): string {
  if (teamCount === 1) return 'Distributed Team';
  return `Distributed Team ${teamId.slice(0, 8)}`;
}

export function buildDistributedTeamSummaries(
  topology: DistributedTopologyDto | null,
  assignmentEvents: DistributedAssignmentEventsDto | null
): DistributedTeamSummary[] {
  const eventsByTeam = new Map<string, DistributedAssignmentEventDto[]>();
  for (const event of assignmentEvents?.events ?? []) {
    if (!event.teamId) continue;
    const events = eventsByTeam.get(event.teamId) ?? [];
    events.push(event);
    eventsByTeam.set(event.teamId, events);
  }

  const workerByNodeId = new Map(
    (topology?.workers ?? []).map((worker) => [worker.nodeId.toLowerCase(), worker] as const)
  );
  const teamCount = eventsByTeam.size;

  return [...eventsByTeam.entries()]
    .map(([teamId, events]): DistributedTeamSummary => {
      const latestAssignments = latestDistributedAssignments(events);
      const workerNodeIds = [...new Set(events.map((event) => event.sourceNodeId.toLowerCase()))];
      const workers = workerNodeIds
        .map((nodeId): DistributedTeamWorkerSummary => {
          const worker = workerByNodeId.get(nodeId);
          return {
            nodeId,
            label: worker?.label ?? `Worker ${nodeId.slice(0, 8)}`,
            status: worker?.status ?? 'offline',
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label));
      const newestEvent = events.reduce((newest, event) =>
        event.cursor > newest.cursor ? event : newest
      );

      return {
        teamId,
        displayName: teamDisplayName(teamId, teamCount),
        relayUrl: topology?.relayUrl ?? 'Relay unavailable',
        workers,
        connectedWorkerCount: workers.filter((worker) => worker.status === 'connected').length,
        assignmentCount: latestAssignments.length,
        activeAssignmentCount: latestAssignments.filter((event) =>
          ACTIVE_ASSIGNMENT_STATES.has(event.state)
        ).length,
        lastActivityAt: newestEvent.receivedAt,
      };
    })
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt));
}
