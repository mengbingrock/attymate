import {
  buildDistributedTeamSummaries,
  latestDistributedAssignments,
} from './buildDistributedTeamSummaries';

import type {
  DistributedAssignmentEventsDto,
  DistributedAssignmentState,
  DistributedDebugSnapshotDto,
  DistributedMembershipRouteDto,
  DistributedRelayCommandDto,
  DistributedRelayEventDto,
  DistributedRelayLeaseDto,
  DistributedTopologyDto,
  DistributedWorkerDto,
} from '../../contracts';
import type { DistributedTeamSummary } from './buildDistributedTeamSummaries';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export interface DistributedTeamAssignmentDetail {
  assignmentId: string;
  title: string;
  description?: string;
  targetNodeId: string;
  workerLabel: string;
  state: DistributedAssignmentState | 'offered';
  reason: string;
  revision: number;
  commandStatus: DistributedRelayCommandDto['status'];
  membershipId?: string;
  workspaceId?: string;
  attemptId?: string;
  leaseId?: string;
  leaseEpoch?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DistributedTeamMessageDetail {
  messageId: string;
  senderLabel: string;
  recipientLabel: string;
  message: string;
  sentAt: string;
  deliveryStatus: DistributedRelayCommandDto['status'] | 'not-routed';
}

export interface DistributedTeamActivityEntry {
  id: string;
  kind: 'command' | 'event';
  nodeId: string;
  type: string;
  status: string;
  timestamp: string;
  assignmentId?: string;
  payload: unknown;
}

export interface DistributedTeamDetailModel {
  teamId: string;
  summary: DistributedTeamSummary | null;
  workers: DistributedWorkerDto[];
  assignments: DistributedTeamAssignmentDetail[];
  messages: DistributedTeamMessageDetail[];
  activity: DistributedTeamActivityEntry[];
  commands: DistributedRelayCommandDto[];
  events: DistributedRelayEventDto[];
  leases: DistributedRelayLeaseDto[];
  membershipRoutes: DistributedMembershipRouteDto[];
}

export function buildDistributedTeamDetail(
  teamId: string,
  topology: DistributedTopologyDto | null,
  assignmentEvents: DistributedAssignmentEventsDto | null,
  debugSnapshot: DistributedDebugSnapshotDto | null
): DistributedTeamDetailModel {
  const normalizedTeamId = teamId.toLowerCase();
  const summary =
    buildDistributedTeamSummaries(topology, assignmentEvents).find(
      (candidate) => candidate.teamId.toLowerCase() === normalizedTeamId
    ) ?? null;
  const commands = (debugSnapshot?.commands ?? []).filter(
    (command) => command.teamId?.toLowerCase() === normalizedTeamId
  );
  const events = (debugSnapshot?.events ?? []).filter(
    (event) => event.teamId?.toLowerCase() === normalizedTeamId
  );
  const leases = (debugSnapshot?.leases ?? []).filter(
    (lease) => lease.teamId?.toLowerCase() === normalizedTeamId
  );
  const membershipRoutes = (debugSnapshot?.membershipRoutes ?? []).filter(
    (route) => route.teamId.toLowerCase() === normalizedTeamId
  );
  const workerByNodeId = new Map(
    (topology?.workers ?? []).map((worker) => [worker.nodeId.toLowerCase(), worker] as const)
  );
  const workerNodeIds = new Set([
    ...membershipRoutes.map((route) => route.nodeId.toLowerCase()),
    ...events.map((event) => event.sourceNodeId.toLowerCase()),
    ...commands.map((command) => command.targetNodeId.toLowerCase()),
  ]);
  const workers = [...workerNodeIds]
    .map((nodeId) => workerByNodeId.get(nodeId))
    .filter((worker): worker is DistributedWorkerDto => Boolean(worker))
    .sort((left, right) => left.label.localeCompare(right.label));

  const latestEvents = new Map(
    latestDistributedAssignments(
      (assignmentEvents?.events ?? []).filter(
        (event) => event.teamId?.toLowerCase() === normalizedTeamId
      )
    ).map((event) => [event.assignmentId, event] as const)
  );
  const offers = commands.filter(
    (command) => command.type === 'assignment.offer' && command.assignmentId
  );
  const assignments = offers
    .map((offer): DistributedTeamAssignmentDetail => {
      const payload = asRecord(offer.payload);
      const event = latestEvents.get(offer.assignmentId!);
      const lease = leases.find((candidate) => candidate.assignmentId === offer.assignmentId);
      return {
        assignmentId: offer.assignmentId!,
        title: optionalText(payload.title) ?? `Assignment ${offer.assignmentId!.slice(0, 8)}`,
        ...(optionalText(payload.description) === undefined
          ? {}
          : { description: optionalText(payload.description) }),
        targetNodeId: offer.targetNodeId,
        workerLabel:
          workerByNodeId.get(offer.targetNodeId.toLowerCase())?.label ??
          `Worker ${offer.targetNodeId.slice(0, 8)}`,
        state: event?.state ?? 'offered',
        reason: event?.reason ?? `relay_${offer.status}`,
        revision: event?.revision ?? 0,
        commandStatus: offer.status,
        ...(optionalText(payload.membershipId) === undefined
          ? {}
          : { membershipId: optionalText(payload.membershipId) }),
        ...(optionalText(payload.workspaceId) === undefined
          ? {}
          : { workspaceId: optionalText(payload.workspaceId) }),
        ...(lease === undefined
          ? {}
          : {
              attemptId: lease.attemptId,
              leaseId: lease.leaseId,
              leaseEpoch: lease.leaseEpoch,
            }),
        createdAt: offer.createdAt,
        updatedAt:
          event?.receivedAt ?? offer.acknowledgedAt ?? offer.deliveredAt ?? offer.createdAt,
      };
    })
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  const routeByMembershipId = new Map(
    membershipRoutes.map((route) => [route.membershipId, route] as const)
  );
  const labelForMembership = (membershipId: string): string => {
    const route = routeByMembershipId.get(membershipId);
    if (!route) return `Member ${membershipId.slice(0, 8)}`;
    return (
      workerByNodeId.get(route.nodeId.toLowerCase())?.label ?? `Worker ${route.nodeId.slice(0, 8)}`
    );
  };
  const messages = events
    .filter((event) => event.type === 'team.message')
    .map((event): DistributedTeamMessageDetail => {
      const payload = asRecord(event.payload);
      const senderMembershipId = optionalText(payload.senderMembershipId) ?? '';
      const recipientMembershipId = optionalText(payload.recipientMembershipId) ?? '';
      const delivery = commands.find(
        (command) =>
          command.type === 'team.message.deliver' &&
          asRecord(command.payload).messageId === event.eventId
      );
      return {
        messageId: event.eventId,
        senderLabel: labelForMembership(senderMembershipId),
        recipientLabel: labelForMembership(recipientMembershipId),
        message: optionalText(payload.message) ?? '(empty message)',
        sentAt: event.occurredAt,
        deliveryStatus: delivery?.status ?? 'not-routed',
      };
    })
    .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt));

  const activity: DistributedTeamActivityEntry[] = [
    ...commands.map(
      (command): DistributedTeamActivityEntry => ({
        id: `command:${command.commandId}`,
        kind: 'command',
        nodeId: command.targetNodeId,
        type: command.type,
        status: command.status,
        timestamp: command.acknowledgedAt ?? command.deliveredAt ?? command.createdAt,
        ...(command.assignmentId === undefined ? {} : { assignmentId: command.assignmentId }),
        payload: command.payload,
      })
    ),
    ...events.map(
      (event): DistributedTeamActivityEntry => ({
        id: `event:${event.eventId}`,
        kind: 'event',
        nodeId: event.sourceNodeId,
        type: event.type,
        status: 'received',
        timestamp: event.receivedAt,
        ...(event.assignmentId === undefined ? {} : { assignmentId: event.assignmentId }),
        payload: event.payload,
      })
    ),
  ].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));

  return {
    teamId,
    summary,
    workers,
    assignments,
    messages,
    activity,
    commands,
    events,
    leases,
    membershipRoutes,
  };
}
