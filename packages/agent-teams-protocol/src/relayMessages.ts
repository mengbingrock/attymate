import { z } from 'zod';

import {
  commandIdSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from './ids';
import { commandEnvelopeSchema } from './envelopes';

const timestampSchema = z.iso.datetime({ offset: true });

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
  })
  .strict();

export const relayWelcomeMessageSchema = z
  .object({
    type: z.literal('relay.welcome'),
    protocolVersion: z.literal(2),
    insecureLanMode: z.literal(true),
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

export const workerToRelayMessageSchema = z.discriminatedUnion('type', [
  workerHelloMessageSchema,
  workerHeartbeatMessageSchema,
  workerCommandAckMessageSchema,
]);

export const relayToWorkerMessageSchema = z.discriminatedUnion('type', [
  relayWelcomeMessageSchema,
  relayHeartbeatAckMessageSchema,
  relayCommandMessageSchema,
  relayErrorMessageSchema,
]);

export type WorkerHelloMessage = z.infer<typeof workerHelloMessageSchema>;
export type WorkerHeartbeatMessage = z.infer<typeof workerHeartbeatMessageSchema>;
export type WorkerCommandAckMessage = z.infer<typeof workerCommandAckMessageSchema>;
export type RelayWelcomeMessage = z.infer<typeof relayWelcomeMessageSchema>;
export type RelayHeartbeatAckMessage = z.infer<typeof relayHeartbeatAckMessageSchema>;
export type RelayCommandMessage = z.infer<typeof relayCommandMessageSchema>;
export type RelayErrorMessage = z.infer<typeof relayErrorMessageSchema>;
export type WorkerToRelayMessage = z.infer<typeof workerToRelayMessageSchema>;
export type RelayToWorkerMessage = z.infer<typeof relayToWorkerMessageSchema>;
