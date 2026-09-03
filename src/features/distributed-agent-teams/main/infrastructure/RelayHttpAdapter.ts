import { randomUUID } from 'node:crypto';

import {
  assignmentAcceptPayloadSchema,
  assignmentIdSchema,
  assignmentStateChangedPayloadSchema,
  attemptIdSchema,
  commandEnvelopeSchema,
  commandIdSchema,
  eventEnvelopeSchema,
  eventIdSchema,
  leaseIdSchema,
  membershipIdSchema,
  nodeIdSchema,
  runtimeControlSchema,
  runtimeSessionCapabilitySchema,
  runtimeSessionCreatedSchema,
  runtimeSessionEventRecordSchema,
  teamIdSchema,
  workspaceIdSchema,
} from '@claude-teams/agent-teams-protocol';

import type {
  CreateRemoteAssignmentRequest,
  DistributedAssignmentEventDto,
  DistributedMembershipRouteDto,
  DistributedRelayCommandDto,
  DistributedRelayEventDto,
  DistributedRelayLeaseDto,
  DistributedRuntimeControlReceiptDto,
  DistributedRuntimeSessionDto,
  DistributedWorkerDto,
  GetDistributedRuntimeSessionRequest,
  JoinDistributedTeamMemberReceiptDto,
  JoinDistributedTeamMemberRequest,
  LeaveDistributedTeamMemberReceiptDto,
  LeaveDistributedTeamMemberRequest,
  RemoteAssignmentReceiptDto,
  SendDistributedRuntimeControlRequest,
} from '../../contracts';
import type { DistributedRelayPort } from '../../core/application/ports/DistributedRelayPort';

// Remote Relays may need several seconds to serialize accumulated command and event history.
// Keep the timeout bounded, but long enough that detail-view polling does not degrade on WAN links.
const REQUEST_TIMEOUT_MS = 15_000;

type CachedRuntimeSession = {
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly scope: DistributedRuntimeSessionDto['scope'];
  readonly capabilities: DistributedRuntimeSessionDto['capabilities'];
  readonly expiresAt: string;
};

class RelayHttpError extends Error {
  constructor(readonly status: number) {
    super(`Relay request failed with HTTP ${status}`);
    this.name = 'RelayHttpError';
  }
}

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${field}`);
  return value;
};

const requiredNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${field}`);
  return value;
};

const requiredPositiveInteger = (value: unknown, field: string): number => {
  const parsed = requiredNumber(value, field);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${field}`);
  return parsed;
};

const requiredNonnegativeInteger = (value: unknown, field: string): number => {
  const parsed = requiredNumber(value, field);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid ${field}`);
  return parsed;
};

const optionalString = (value: unknown, field: string): string | undefined =>
  value === undefined ? undefined : requiredString(value, field);

const parseWorker = (input: unknown): DistributedWorkerDto => {
  const value = asRecord(input, 'Relay worker');
  const status = value.status;
  if (status !== 'connected' && status !== 'stale') throw new Error('Invalid worker status');
  return {
    organizationId: requiredString(value.organizationId, 'organizationId'),
    personId: requiredString(value.personId, 'personId'),
    nodeId: nodeIdSchema.parse(value.nodeId),
    workerInstanceId: requiredString(value.workerInstanceId, 'workerInstanceId'),
    workerGeneration: requiredNumber(value.workerGeneration, 'workerGeneration'),
    label: requiredString(value.label, 'label'),
    connectedAt: requiredString(value.connectedAt, 'connectedAt'),
    lastHeartbeatAt: requiredString(value.lastHeartbeatAt, 'lastHeartbeatAt'),
    lastHeartbeatSequence: requiredNumber(value.lastHeartbeatSequence, 'lastHeartbeatSequence'),
    status,
    ...(optionalString(value.autoJoinTeamId, 'autoJoinTeamId') === undefined
      ? {}
      : { autoJoinTeamId: teamIdSchema.parse(value.autoJoinTeamId) }),
    runtimeCapabilities: Array.isArray(value.runtimeCapabilities)
      ? value.runtimeCapabilities.map((capability) =>
          runtimeSessionCapabilitySchema.parse(capability)
        )
      : [],
  };
};

const parseMembershipRoute = (input: unknown): DistributedMembershipRouteDto => {
  const record = asRecord(input, 'Relay membership route');
  const role = record.role;
  const status = record.status;
  if (role !== 'lead' && role !== 'member') throw new Error('Invalid membership role');
  if (status !== 'active' && status !== 'left') throw new Error('Invalid membership status');
  return {
    membershipId: membershipIdSchema.parse(record.membershipId),
    teamId: teamIdSchema.parse(record.teamId),
    nodeId: nodeIdSchema.parse(record.nodeId),
    workspaceId: workspaceIdSchema.parse(record.workspaceId),
    label: requiredString(record.label, 'label'),
    role,
    status,
    revision: requiredPositiveInteger(record.revision, 'revision'),
    createdAt: requiredString(record.createdAt, 'createdAt'),
    updatedAt: requiredString(record.updatedAt, 'updatedAt'),
    ...(optionalString(record.leftAt, 'leftAt') === undefined
      ? {}
      : { leftAt: requiredString(record.leftAt, 'leftAt') }),
  };
};

export const normalizeRelayBaseUrl = (input: string): string => {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Relay URL must use http or https');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Relay URL must not contain credentials, query, or fragment');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
};

export class RelayHttpAdapter implements DistributedRelayPort {
  readonly relayUrl: string;
  readonly insecureLanMode: boolean;
  private lastSequence = Date.now();
  private readonly runtimeSessions = new Map<string, CachedRuntimeSession>();
  private readonly pendingRuntimeSessions = new Map<string, Promise<CachedRuntimeSession>>();

  constructor(
    relayUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly managerToken?: string
  ) {
    this.relayUrl = normalizeRelayBaseUrl(relayUrl);
    this.insecureLanMode = managerToken === undefined;
  }

  async listWorkers(): Promise<readonly DistributedWorkerDto[]> {
    const payload = asRecord(await this.request('/v2/workers'), 'Relay workers response');
    if (!Array.isArray(payload.workers)) throw new Error('Relay workers response is invalid');
    return payload.workers.map(parseWorker);
  }

  async listAssignmentEvents(): Promise<readonly DistributedAssignmentEventDto[]> {
    const payload = asRecord(await this.request('/v2/events'), 'Relay events response');
    if (!Array.isArray(payload.events)) throw new Error('Relay events response is invalid');
    return payload.events.flatMap((input): DistributedAssignmentEventDto[] => {
      const record = asRecord(input, 'Relay event');
      const envelope = eventEnvelopeSchema.parse(record.envelope);
      if (envelope.type !== 'assignment.state_changed') return [];
      if (envelope.assignmentId === undefined) {
        throw new Error('Relay assignment event is missing assignmentId');
      }
      const eventId = eventIdSchema.parse(record.eventId);
      const sourceNodeId = nodeIdSchema.parse(record.sourceNodeId);
      if (eventId !== envelope.eventId || sourceNodeId !== envelope.sourceNodeId) {
        throw new Error('Relay assignment event identity is inconsistent');
      }
      const event = assignmentStateChangedPayloadSchema.parse(envelope.payload);
      return [
        {
          cursor: requiredPositiveInteger(record.cursor, 'cursor'),
          eventId,
          assignmentId: envelope.assignmentId,
          sourceNodeId,
          workerInstanceId: envelope.workerInstanceId,
          ...(envelope.teamId === undefined ? {} : { teamId: envelope.teamId }),
          occurredAt: envelope.occurredAt,
          receivedAt: requiredString(record.receivedAt, 'receivedAt'),
          revision: event.revision,
          fromState: event.fromState,
          state: event.state,
          reason: event.reason,
          ...(event.deferredUntil === undefined ? {} : { deferredUntil: event.deferredUntil }),
        },
      ];
    });
  }

  async listCommands(): Promise<readonly DistributedRelayCommandDto[]> {
    const payload = asRecord(await this.request('/v2/commands'), 'Relay commands response');
    if (!Array.isArray(payload.commands)) throw new Error('Relay commands response is invalid');
    return payload.commands.map((input): DistributedRelayCommandDto => {
      const record = asRecord(input, 'Relay command');
      const envelope = commandEnvelopeSchema.parse(record.envelope);
      const status = record.status;
      if (
        status !== 'pending' &&
        status !== 'delivered' &&
        status !== 'acknowledged' &&
        status !== 'rejected'
      ) {
        throw new Error('Relay command status is invalid');
      }
      return {
        cursor: requiredPositiveInteger(record.cursor, 'cursor'),
        commandId: envelope.commandId,
        targetNodeId: envelope.targetNodeId,
        sequence: envelope.sequence,
        ...(envelope.teamId === undefined ? {} : { teamId: envelope.teamId }),
        ...(envelope.assignmentId === undefined ? {} : { assignmentId: envelope.assignmentId }),
        ...(envelope.attemptId === undefined ? {} : { attemptId: envelope.attemptId }),
        ...(envelope.leaseEpoch === undefined ? {} : { leaseEpoch: envelope.leaseEpoch }),
        type: envelope.type,
        payload: envelope.payload,
        status,
        createdAt: requiredString(record.createdAt, 'createdAt'),
        ...(optionalString(record.deliveredAt, 'deliveredAt') === undefined
          ? {}
          : { deliveredAt: requiredString(record.deliveredAt, 'deliveredAt') }),
        ...(optionalString(record.acknowledgedAt, 'acknowledgedAt') === undefined
          ? {}
          : { acknowledgedAt: requiredString(record.acknowledgedAt, 'acknowledgedAt') }),
        ...(optionalString(record.rejectionError, 'rejectionError') === undefined
          ? {}
          : { rejectionError: requiredString(record.rejectionError, 'rejectionError') }),
      };
    });
  }

  async listEvents(): Promise<readonly DistributedRelayEventDto[]> {
    const payload = asRecord(await this.request('/v2/events'), 'Relay events response');
    if (!Array.isArray(payload.events)) throw new Error('Relay events response is invalid');
    return payload.events.map((input): DistributedRelayEventDto => {
      const record = asRecord(input, 'Relay event');
      const envelope = eventEnvelopeSchema.parse(record.envelope);
      return {
        cursor: requiredPositiveInteger(record.cursor, 'cursor'),
        eventId: envelope.eventId,
        sourceNodeId: envelope.sourceNodeId,
        workerInstanceId: envelope.workerInstanceId,
        sequence: envelope.sequence,
        ...(envelope.teamId === undefined ? {} : { teamId: envelope.teamId }),
        ...(envelope.assignmentId === undefined ? {} : { assignmentId: envelope.assignmentId }),
        ...(envelope.attemptId === undefined ? {} : { attemptId: envelope.attemptId }),
        ...(envelope.leaseEpoch === undefined ? {} : { leaseEpoch: envelope.leaseEpoch }),
        type: envelope.type,
        payload: envelope.payload,
        occurredAt: envelope.occurredAt,
        receivedAt: requiredString(record.receivedAt, 'receivedAt'),
      };
    });
  }

  async listLeases(): Promise<readonly DistributedRelayLeaseDto[]> {
    const payload = asRecord(await this.request('/v2/leases'), 'Relay leases response');
    if (!Array.isArray(payload.leases)) throw new Error('Relay leases response is invalid');
    return payload.leases.map((input): DistributedRelayLeaseDto => {
      const record = asRecord(input, 'Relay lease');
      const status = record.status;
      if (
        status !== 'granted' &&
        status !== 'active' &&
        status !== 'expired' &&
        status !== 'released'
      ) {
        throw new Error('Relay lease status is invalid');
      }
      return {
        leaseId: leaseIdSchema.parse(record.leaseId),
        assignmentId: assignmentIdSchema.parse(record.assignmentId),
        attemptId: attemptIdSchema.parse(record.attemptId),
        nodeId: nodeIdSchema.parse(record.nodeId),
        ...(record.teamId === undefined ? {} : { teamId: teamIdSchema.parse(record.teamId) }),
        leaseEpoch: requiredPositiveInteger(record.leaseEpoch, 'leaseEpoch'),
        assignmentRevision: requiredNonnegativeInteger(
          record.assignmentRevision,
          'assignmentRevision'
        ),
        status,
        issuedAt: requiredString(record.issuedAt, 'issuedAt'),
        expiresAt: requiredString(record.expiresAt, 'expiresAt'),
        updatedAt: requiredString(record.updatedAt, 'updatedAt'),
      };
    });
  }

  async listMembershipRoutes(): Promise<readonly DistributedMembershipRouteDto[]> {
    const payload = asRecord(
      await this.request('/v2/membership-routes'),
      'Relay membership routes response'
    );
    if (!Array.isArray(payload.routes)) {
      throw new Error('Relay membership routes response is invalid');
    }
    return payload.routes.map(parseMembershipRoute);
  }

  async joinTeamMember(
    request: JoinDistributedTeamMemberRequest
  ): Promise<JoinDistributedTeamMemberReceiptDto> {
    const payload = asRecord(
      await this.request(`/v2/teams/${encodeURIComponent(request.teamId)}/members`, {
        method: 'POST',
        body: JSON.stringify({
          targetNodeId: request.targetNodeId,
          ...(request.membershipId === undefined ? {} : { membershipId: request.membershipId }),
          ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
          ...(request.role === undefined ? {} : { role: request.role }),
          ...(request.title === undefined ? {} : { title: request.title }),
          ...(request.description === undefined ? {} : { description: request.description }),
        }),
      }),
      'Join team member response'
    );
    if (!Array.isArray(payload.commandIds)) {
      throw new Error('Join team member response commandIds are invalid');
    }
    return {
      membership: parseMembershipRoute(payload.membership),
      assignmentId: assignmentIdSchema.parse(payload.assignmentId),
      commandIds: payload.commandIds.map((commandId) => commandIdSchema.parse(commandId)),
    };
  }

  async leaveTeamMember(
    request: LeaveDistributedTeamMemberRequest
  ): Promise<LeaveDistributedTeamMemberReceiptDto> {
    const payload = asRecord(
      await this.request(
        `/v2/teams/${encodeURIComponent(request.teamId)}/members/${encodeURIComponent(request.membershipId)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            ...(request.expectedRevision === undefined
              ? {}
              : { expectedRevision: request.expectedRevision }),
            ...(request.successorMembershipId === undefined
              ? {}
              : { successorMembershipId: request.successorMembershipId }),
            ...(request.reason === undefined ? {} : { reason: request.reason }),
          }),
        }
      ),
      'Leave team member response'
    );
    if (!Array.isArray(payload.releasedAssignmentIds)) {
      throw new Error('Leave team member response assignment list is invalid');
    }
    return {
      membership: parseMembershipRoute(payload.membership),
      releasedAssignmentIds: payload.releasedAssignmentIds.map((assignmentId) =>
        assignmentIdSchema.parse(assignmentId)
      ),
    };
  }

  async getRuntimeSession(
    request: GetDistributedRuntimeSessionRequest
  ): Promise<DistributedRuntimeSessionDto> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.ensureRuntimeSession(request);
      try {
        const payload = asRecord(
          await this.request(
            `/v2/runtime-sessions/${encodeURIComponent(session.sessionId)}/events?after=${request.afterCursor ?? 0}`,
            { headers: { authorization: `Bearer ${session.sessionToken}` } }
          ),
          'Runtime session events response'
        );
        if (!Array.isArray(payload.events)) {
          throw new Error('Runtime session events response is invalid');
        }
        return {
          sessionId: session.sessionId,
          scope: session.scope,
          capabilities: [...session.capabilities],
          expiresAt: session.expiresAt,
          events: payload.events.map((event) => runtimeSessionEventRecordSchema.parse(event)),
          truncated: payload.truncated === true,
          nextCursor: requiredNonnegativeInteger(payload.nextCursor, 'nextCursor'),
        };
      } catch (error) {
        this.discardDeniedRuntimeSession(request, session.sessionId, error);
        if (attempt === 0 && this.isRevokedRuntimeSession(error)) continue;
        throw error;
      }
    }
    throw new Error('Runtime session retry was exhausted');
  }

  async sendRuntimeControl(
    request: SendDistributedRuntimeControlRequest
  ): Promise<DistributedRuntimeControlReceiptDto> {
    const control = runtimeControlSchema.parse(request.control);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.ensureRuntimeSession(request.session);
      try {
        const payload = asRecord(
          await this.request(
            `/v2/runtime-sessions/${encodeURIComponent(session.sessionId)}/controls`,
            {
              method: 'POST',
              headers: { authorization: `Bearer ${session.sessionToken}` },
              body: JSON.stringify(control),
            }
          ),
          'Runtime control response'
        );
        if (payload.accepted !== true || payload.controlId !== control.controlId) {
          throw new Error('Runtime control response is invalid');
        }
        return { accepted: true, controlId: control.controlId };
      } catch (error) {
        this.discardDeniedRuntimeSession(request.session, session.sessionId, error);
        if (attempt === 0 && this.isRevokedRuntimeSession(error)) continue;
        throw error;
      }
    }
    throw new Error('Runtime control retry was exhausted');
  }

  async createRemoteAssignment(
    request: CreateRemoteAssignmentRequest
  ): Promise<RemoteAssignmentReceiptDto> {
    this.lastSequence = Math.max(this.lastSequence + 1, Date.now());
    const assignmentId = randomUUID();
    const command = commandEnvelopeSchema.parse({
      protocolVersion: 2,
      commandId: randomUUID(),
      sequence: this.lastSequence,
      targetNodeId: nodeIdSchema.parse(request.targetNodeId),
      ...(request.teamId === undefined ? {} : { teamId: teamIdSchema.parse(request.teamId) }),
      assignmentId,
      type: 'assignment.offer',
      payload: {
        assignmentId,
        title: request.title,
        ...(request.description === undefined ? {} : { description: request.description }),
        ...(request.membershipId === undefined ? {} : { membershipId: request.membershipId }),
        ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
        ...(request.teamRole === undefined ? {} : { teamRole: request.teamRole }),
      },
    });
    const payload = asRecord(
      await this.request('/v2/commands', { method: 'POST', body: JSON.stringify(command) }),
      'Relay command response'
    );
    const record = asRecord(payload.command, 'Relay command record');
    const status = record.status;
    if (
      status !== 'pending' &&
      status !== 'delivered' &&
      status !== 'acknowledged' &&
      status !== 'rejected'
    ) {
      throw new Error('Relay command status is invalid');
    }
    return {
      commandId: requiredString(record.commandId, 'commandId'),
      targetNodeId: nodeIdSchema.parse(record.targetNodeId),
      cursor: requiredNumber(record.cursor, 'cursor'),
      status,
      createdAt: requiredString(record.createdAt, 'createdAt'),
    };
  }

  async acceptRemoteAssignment(input: {
    teamId: string;
    targetNodeId: string;
    assignmentId: string;
    expectedRevision: number;
  }): Promise<RemoteAssignmentReceiptDto> {
    this.lastSequence = Math.max(this.lastSequence + 1, Date.now());
    const assignmentId = assignmentIdSchema.parse(input.assignmentId);
    const command = commandEnvelopeSchema.parse({
      protocolVersion: 2,
      commandId: randomUUID(),
      sequence: this.lastSequence,
      targetNodeId: nodeIdSchema.parse(input.targetNodeId),
      teamId: teamIdSchema.parse(input.teamId),
      assignmentId,
      type: 'assignment.accept',
      payload: assignmentAcceptPayloadSchema.parse({
        assignmentId,
        expectedRevision: input.expectedRevision,
        reason: 'manager_started_team',
      }),
    });
    const payload = asRecord(
      await this.request('/v2/commands', { method: 'POST', body: JSON.stringify(command) }),
      'Relay command response'
    );
    const record = asRecord(payload.command, 'Relay command record');
    const status = record.status;
    if (
      status !== 'pending' &&
      status !== 'delivered' &&
      status !== 'acknowledged' &&
      status !== 'rejected'
    ) {
      throw new Error('Relay command status is invalid');
    }
    return {
      commandId: requiredString(record.commandId, 'commandId'),
      targetNodeId: nodeIdSchema.parse(record.targetNodeId),
      cursor: requiredNumber(record.cursor, 'cursor'),
      status,
      createdAt: requiredString(record.createdAt, 'createdAt'),
    };
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.relayUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(this.managerToken === undefined
            ? {}
            : { authorization: `Bearer ${this.managerToken}` }),
          ...init?.headers,
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new RelayHttpError(response.status);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async ensureRuntimeSession(
    request: GetDistributedRuntimeSessionRequest
  ): Promise<CachedRuntimeSession> {
    const key = this.runtimeSessionKey(request);
    const existing = this.runtimeSessions.get(key);
    if (existing !== undefined && Date.parse(existing.expiresAt) > Date.now()) return existing;
    const pending = this.pendingRuntimeSessions.get(key);
    if (pending !== undefined) return await pending;

    const creation = (async (): Promise<CachedRuntimeSession> => {
      const created = runtimeSessionCreatedSchema.parse(
        await this.request('/v2/runtime-sessions', {
          method: 'POST',
          body: JSON.stringify({
            teamId: request.teamId,
            nodeId: request.nodeId,
            assignmentId: request.assignmentId,
            attemptId: request.attemptId,
            leaseEpoch: request.leaseEpoch,
          }),
        })
      );
      this.runtimeSessions.set(key, created);
      return created;
    })();
    this.pendingRuntimeSessions.set(key, creation);
    try {
      return await creation;
    } finally {
      if (this.pendingRuntimeSessions.get(key) === creation) {
        this.pendingRuntimeSessions.delete(key);
      }
    }
  }

  private discardDeniedRuntimeSession(
    request: GetDistributedRuntimeSessionRequest,
    deniedSessionId: string,
    error: unknown
  ): void {
    if (error instanceof RelayHttpError && [401, 409].includes(error.status)) {
      const key = this.runtimeSessionKey(request);
      if (this.runtimeSessions.get(key)?.sessionId === deniedSessionId) {
        this.runtimeSessions.delete(key);
      }
    }
  }

  private isRevokedRuntimeSession(error: unknown): boolean {
    return error instanceof RelayHttpError && error.status === 401;
  }

  private runtimeSessionKey(request: GetDistributedRuntimeSessionRequest): string {
    return [
      request.teamId,
      request.nodeId,
      request.assignmentId,
      request.attemptId,
      request.leaseEpoch,
    ].join(':');
  }
}
