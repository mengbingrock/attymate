import { randomUUID } from 'node:crypto';

import {
  assignmentStateChangedPayloadSchema,
  commandEnvelopeSchema,
  eventEnvelopeSchema,
  eventIdSchema,
  nodeIdSchema,
  teamIdSchema,
} from '@claude-teams/agent-teams-protocol';

import type {
  CreateRemoteAssignmentRequest,
  DistributedAssignmentEventDto,
  DistributedWorkerDto,
  RemoteAssignmentReceiptDto,
} from '../../contracts';
import type { DistributedRelayPort } from '../../core/application/ports/DistributedRelayPort';

const REQUEST_TIMEOUT_MS = 5_000;

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
  private lastSequence = Date.now();

  constructor(
    relayUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.relayUrl = normalizeRelayBaseUrl(relayUrl);
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

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.relayUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Relay request failed with HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}
