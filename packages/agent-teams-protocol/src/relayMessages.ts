import { z } from 'zod';

import {
  assignmentIdSchema,
  attemptIdSchema,
  commandIdSchema,
  eventIdSchema,
  leaseIdSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from './ids';
import { commandEnvelopeSchema, eventEnvelopeSchema } from './envelopes';
import {
  relayRuntimeControlMessageSchema,
  runtimeSessionCapabilitySchema,
  workerRuntimeEventMessageSchema,
} from './runtimeSession';

const timestampSchema = z.iso.datetime({ offset: true });

export const executionLeaseIdentitySchema = z
  .object({
    assignmentId: assignmentIdSchema,
    attemptId: attemptIdSchema,
    leaseId: leaseIdSchema,
    leaseEpoch: z.number().int().positive(),
  })
  .strict();

export const leaseReconciliationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('none') }).strict(),
  executionLeaseIdentitySchema
    .extend({
      action: z.literal('renewed'),
      expiresAt: timestampSchema,
    })
    .strict(),
  executionLeaseIdentitySchema
    .extend({
      action: z.literal('fence'),
      reason: z.enum(['lease_expired', 'lease_released', 'lease_identity_mismatch']),
    })
    .strict(),
]);

export const workerHelloMessageSchema = z
  .object({
    type: z.literal('worker.hello'),
    protocolVersion: z.literal(2),
    organizationId: organizationIdSchema,
    personId: personIdSchema,
    nodeId: nodeIdSchema,
    workerInstanceId: workerInstanceIdSchema,
    workerGeneration: z.number().int().positive(),
    label: z.string().trim().min(1).max(128),
    runtimeCapabilities: z.array(runtimeSessionCapabilitySchema).max(32).optional(),
    lastInboundCursor: z.number().int().nonnegative(),
    sentAt: timestampSchema,
  })
  .strict();

export const workerHeartbeatMessageSchema = z
  .object({
    type: z.literal('worker.heartbeat'),
    protocolVersion: z.literal(2),
    sequence: z.number().int().nonnegative(),
    sentAt: timestampSchema,
    activeLease: executionLeaseIdentitySchema.optional(),
  })
  .strict();

export const relayWelcomeMessageSchema = z
  .object({
    type: z.literal('relay.welcome'),
    protocolVersion: z.literal(2),
    insecureLanMode: z.boolean(),
    heartbeatIntervalMs: z.number().int().positive(),
    connectedAt: timestampSchema,
  })
  .strict();

export const relayHeartbeatAckMessageSchema = z
  .object({
    type: z.literal('relay.heartbeat_ack'),
    protocolVersion: z.literal(2),
    sequence: z.number().int().nonnegative(),
    receivedAt: timestampSchema,
    leaseReconciliation: leaseReconciliationSchema,
  })
  .strict();

export const relayErrorMessageSchema = z
  .object({
    type: z.literal('relay.error'),
    protocolVersion: z.literal(2),
    code: z.string().trim().min(1).max(64),
    message: z.string().trim().min(1).max(512),
  })
  .strict();

export const workerCommandAckMessageSchema = z
  .object({
    type: z.literal('worker.command_ack'),
    protocolVersion: z.literal(2),
    commandId: commandIdSchema,
    cursor: z.number().int().positive(),
    status: z.enum(['received', 'rejected']),
    receivedAt: timestampSchema,
    error: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const relayCommandMessageSchema = z
  .object({
    type: z.literal('relay.command'),
    protocolVersion: z.literal(2),
    cursor: z.number().int().positive(),
    envelope: commandEnvelopeSchema,
  })
  .strict();

export const workerEventMessageSchema = z
  .object({
    type: z.literal('worker.event'),
    protocolVersion: z.literal(2),
    envelope: eventEnvelopeSchema,
  })
  .strict();

export const relayEventAckMessageSchema = z
  .object({
    type: z.literal('relay.event_ack'),
    protocolVersion: z.literal(2),
    eventId: eventIdSchema,
    sequence: z.number().int().positive(),
    receivedAt: timestampSchema,
  })
  .strict();

export const workerToRelayMessageSchema = z.discriminatedUnion('type', [
  workerHelloMessageSchema,
  workerHeartbeatMessageSchema,
  workerCommandAckMessageSchema,
  workerEventMessageSchema,
  workerRuntimeEventMessageSchema,
]);

export const relayToWorkerMessageSchema = z.discriminatedUnion('type', [
  relayWelcomeMessageSchema,
  relayHeartbeatAckMessageSchema,
  relayCommandMessageSchema,
  relayEventAckMessageSchema,
  relayErrorMessageSchema,
  relayRuntimeControlMessageSchema,
]);

export type WorkerHelloMessage = z.infer<typeof workerHelloMessageSchema>;
export type ExecutionLeaseIdentity = z.infer<typeof executionLeaseIdentitySchema>;
export type LeaseReconciliation = z.infer<typeof leaseReconciliationSchema>;
export type WorkerHeartbeatMessage = z.infer<typeof workerHeartbeatMessageSchema>;
export type WorkerCommandAckMessage = z.infer<typeof workerCommandAckMessageSchema>;
export type WorkerEventMessage = z.infer<typeof workerEventMessageSchema>;
export type RelayWelcomeMessage = z.infer<typeof relayWelcomeMessageSchema>;
export type RelayHeartbeatAckMessage = z.infer<typeof relayHeartbeatAckMessageSchema>;
export type RelayCommandMessage = z.infer<typeof relayCommandMessageSchema>;
export type RelayEventAckMessage = z.infer<typeof relayEventAckMessageSchema>;
export type RelayErrorMessage = z.infer<typeof relayErrorMessageSchema>;
export type WorkerToRelayMessage = z.infer<typeof workerToRelayMessageSchema>;
export type RelayToWorkerMessage = z.infer<typeof relayToWorkerMessageSchema>;
