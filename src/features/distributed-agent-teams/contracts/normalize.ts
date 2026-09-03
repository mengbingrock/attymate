import {
  runtimeControlSchema,
  runtimeSessionCreateRequestSchema,
} from '@claude-teams/agent-teams-protocol';

import type {
  CreateRemoteAssignmentRequest,
  GetDistributedRuntimeSessionRequest,
  JoinDistributedTeamMemberRequest,
  LeaveDistributedTeamMemberRequest,
  ReconnectDistributedLeadRequest,
  SendDistributedRuntimeControlRequest,
  StartDistributedTeamRequest,
} from './dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const requiredTrimmedString = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new TypeError(`${field} must contain 1-${maxLength} characters`);
  }
  return trimmed;
};

const optionalTrimmedString = (
  value: unknown,
  field: string,
  maxLength: number
): string | undefined => {
  if (value === undefined) return undefined;
  return requiredTrimmedString(value, field, maxLength);
};

const uuid = (value: unknown, field: string): string => {
  const parsed = requiredTrimmedString(value, field, 64);
  if (!UUID_PATTERN.test(parsed)) throw new TypeError(`${field} must be a UUID`);
  return parsed.toLowerCase();
};

export const normalizeCreateRemoteAssignmentRequest = (
  input: unknown
): CreateRemoteAssignmentRequest => {
  const record = asRecord(input);
  if (record === null) throw new TypeError('Remote assignment request must be an object');
  const description = optionalTrimmedString(record.description, 'description', 20_000);
  const teamId = record.teamId === undefined ? undefined : uuid(record.teamId, 'teamId');
  const membershipId =
    record.membershipId === undefined ? undefined : uuid(record.membershipId, 'membershipId');
  const workspaceId =
    record.workspaceId === undefined ? undefined : uuid(record.workspaceId, 'workspaceId');
  if ((membershipId === undefined) !== (workspaceId === undefined)) {
    throw new TypeError('membershipId and workspaceId must be supplied together');
  }
  if (membershipId !== undefined && teamId === undefined) {
    throw new TypeError('teamId is required for a team membership assignment');
  }
  if (record.teamRole !== undefined && record.teamRole !== 'lead' && record.teamRole !== 'member') {
    throw new TypeError('teamRole must be lead or member');
  }
  return {
    targetNodeId: uuid(record.targetNodeId, 'targetNodeId'),
    title: requiredTrimmedString(record.title, 'title', 240),
    ...(description === undefined ? {} : { description }),
    ...(teamId === undefined ? {} : { teamId }),
    ...(membershipId === undefined ? {} : { membershipId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(record.teamRole === undefined ? {} : { teamRole: record.teamRole as 'lead' | 'member' }),
  };
};

export const normalizeJoinDistributedTeamMemberRequest = (
  input: unknown
): JoinDistributedTeamMemberRequest => {
  const record = asRecord(input);
  if (record === null) throw new TypeError('Join team member request must be an object');
  const membershipId =
    record.membershipId === undefined ? undefined : uuid(record.membershipId, 'membershipId');
  const workspaceId =
    record.workspaceId === undefined ? undefined : uuid(record.workspaceId, 'workspaceId');
  if ((membershipId === undefined) !== (workspaceId === undefined)) {
    throw new TypeError('membershipId and workspaceId must be supplied together');
  }
  if (record.role !== undefined && record.role !== 'lead' && record.role !== 'member') {
    throw new TypeError('role must be lead or member');
  }
  const title = optionalTrimmedString(record.title, 'title', 240);
  const description = optionalTrimmedString(record.description, 'description', 20_000);
  return {
    teamId: uuid(record.teamId, 'teamId'),
    targetNodeId: uuid(record.targetNodeId, 'targetNodeId'),
    ...(membershipId === undefined ? {} : { membershipId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(record.role === undefined ? {} : { role: record.role as 'lead' | 'member' }),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
  };
};

export const normalizeLeaveDistributedTeamMemberRequest = (
  input: unknown
): LeaveDistributedTeamMemberRequest => {
  const record = asRecord(input);
  if (record === null) throw new TypeError('Leave team member request must be an object');
  if (
    record.expectedRevision !== undefined &&
    (!Number.isInteger(record.expectedRevision) || (record.expectedRevision as number) <= 0)
  ) {
    throw new TypeError('expectedRevision must be a positive integer');
  }
  const successorMembershipId =
    record.successorMembershipId === undefined
      ? undefined
      : uuid(record.successorMembershipId, 'successorMembershipId');
  const reason = optionalTrimmedString(record.reason, 'reason', 2_000);
  return {
    teamId: uuid(record.teamId, 'teamId'),
    membershipId: uuid(record.membershipId, 'membershipId'),
    ...(record.expectedRevision === undefined
      ? {}
      : { expectedRevision: record.expectedRevision as number }),
    ...(successorMembershipId === undefined ? {} : { successorMembershipId }),
    ...(reason === undefined ? {} : { reason }),
  };
};

export const normalizeStartDistributedTeamRequest = (
  input: unknown
): StartDistributedTeamRequest => {
  const record = asRecord(input);
  if (record === null) throw new TypeError('Start distributed team request must be an object');
  return { teamId: uuid(record.teamId, 'teamId') };
};

export const normalizeReconnectDistributedLeadRequest = (
  input: unknown
): ReconnectDistributedLeadRequest => {
  const record = asRecord(input);
  if (record === null) throw new TypeError('Reconnect distributed lead request must be an object');
  return { teamId: uuid(record.teamId, 'teamId') };
};

export const normalizeGetDistributedRuntimeSessionRequest = (
  input: unknown
): GetDistributedRuntimeSessionRequest => {
  const record = asRecord(input);
  if (record === null) throw new TypeError('Runtime session request must be an object');
  const scope = runtimeSessionCreateRequestSchema.parse({
    teamId: record.teamId,
    nodeId: record.nodeId,
    assignmentId: record.assignmentId,
    attemptId: record.attemptId,
    leaseEpoch: record.leaseEpoch,
  });
  if (
    record.afterCursor !== undefined &&
    (!Number.isInteger(record.afterCursor) || (record.afterCursor as number) < 0)
  ) {
    throw new TypeError('afterCursor must be a non-negative integer');
  }
  return {
    ...scope,
    ...(record.afterCursor === undefined ? {} : { afterCursor: record.afterCursor as number }),
  };
};

export const normalizeSendDistributedRuntimeControlRequest = (
  input: unknown
): SendDistributedRuntimeControlRequest => {
  const record = asRecord(input);
  if (record === null) throw new TypeError('Runtime control request must be an object');
  return {
    session: normalizeGetDistributedRuntimeSessionRequest(record.session),
    control: runtimeControlSchema.parse(record.control),
  };
};
