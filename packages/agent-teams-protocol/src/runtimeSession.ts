import { z } from 'zod';

import {
  assignmentIdSchema,
  attemptIdSchema,
  leaseIdSchema,
  nodeIdSchema,
  teamIdSchema,
} from './ids';

const timestampSchema = z.iso.datetime({ offset: true });
const opaqueRuntimeIdSchema = z.string().trim().min(1).max(256);
const relativeWorkspacePathSchema = z
  .string()
  .max(4_096)
  .refine((value) => !value.includes('\0'), 'Workspace path must not contain NUL')
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.split('/').includes('..'),
    'Workspace path must remain relative to the assigned workspace'
  );

export const runtimeSessionIdSchema = z.uuid();
export const runtimeControlIdSchema = z.uuid();
export const runtimeEventIdSchema = z.uuid();

export const runtimeSessionScopeSchema = z
  .object({
    teamId: teamIdSchema,
    nodeId: nodeIdSchema,
    assignmentId: assignmentIdSchema,
    attemptId: attemptIdSchema,
    leaseId: leaseIdSchema,
    leaseEpoch: z.number().int().positive(),
  })
  .strict();

export const runtimeSessionCreateRequestSchema = runtimeSessionScopeSchema
  .omit({ leaseId: true })
  .strict();

export const DISTRIBUTED_RUNTIME_CAPABILITIES = [
  'events.read',
  'turn.start',
  'turn.steer',
  'turn.interrupt',
  'approval.resolve',
  'changes.read',
  'review.start',
  'filesystem.read',
  'filesystem.write',
] as const;

export const runtimeSessionCapabilitySchema = z.enum(DISTRIBUTED_RUNTIME_CAPABILITIES);

export const runtimeControlSchema = z.discriminatedUnion('type', [
  z
    .object({
      controlId: runtimeControlIdSchema,
      type: z.literal('runtime.snapshot'),
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      controlId: runtimeControlIdSchema,
      type: z.literal('turn.start'),
      payload: z
        .object({
          threadId: opaqueRuntimeIdSchema,
          appServerGeneration: z.number().int().positive(),
          message: z.string().trim().min(1).max(20_000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      controlId: runtimeControlIdSchema,
      type: z.literal('turn.steer'),
      payload: z
        .object({
          threadId: opaqueRuntimeIdSchema,
          expectedTurnId: opaqueRuntimeIdSchema,
          appServerGeneration: z.number().int().positive(),
          message: z.string().trim().min(1).max(20_000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      controlId: runtimeControlIdSchema,
      type: z.literal('turn.interrupt'),
      payload: z.object({ reason: z.string().trim().min(1).max(512) }).strict(),
    })
    .strict(),
  z
    .object({
      controlId: runtimeControlIdSchema,
      type: z.literal('approval.resolve'),
      payload: z
        .object({
          approvalRequestId: z.union([
            z.number().int().nonnegative(),
            z.string().trim().min(1).max(256),
          ]),
          decision: z.enum(['accept', 'acceptForSession', 'decline', 'cancel']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      controlId: runtimeControlIdSchema,
      type: z.literal('review.start'),
      payload: z.object({ threadId: opaqueRuntimeIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      controlId: runtimeControlIdSchema,
      type: z.literal('filesystem.list'),
      payload: z.object({ path: relativeWorkspacePathSchema }).strict(),
    })
    .strict(),
  z
    .object({
      controlId: runtimeControlIdSchema,
      type: z.literal('filesystem.read'),
      payload: z.object({ path: relativeWorkspacePathSchema }).strict(),
    })
    .strict(),
  z
    .object({
      controlId: runtimeControlIdSchema,
      type: z.literal('filesystem.write'),
      payload: z
        .object({
          path: relativeWorkspacePathSchema,
          content: z.string().max(1_048_576),
          expectedRevision: z.string().trim().min(1).max(128).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export const runtimeSessionCreatedSchema = z
  .object({
    sessionId: runtimeSessionIdSchema,
    sessionToken: z.string().min(32).max(512),
    scope: runtimeSessionScopeSchema,
    capabilities: z.array(runtimeSessionCapabilitySchema),
    expiresAt: timestampSchema,
  })
  .strict();

export const relayRuntimeControlMessageSchema = z
  .object({
    type: z.literal('relay.runtime_control'),
    protocolVersion: z.literal(2),
    sessionId: runtimeSessionIdSchema,
    scope: runtimeSessionScopeSchema,
    control: runtimeControlSchema,
  })
  .strict();

export const runtimeEventSchema = z
  .object({
    kind: z.enum([
      'runtime.snapshot',
      'app-server.notification',
      'app-server.request',
      'control.result',
      'filesystem.changed',
    ]),
    payload: z.unknown(),
  })
  .strict();

export const workerRuntimeEventMessageSchema = z
  .object({
    type: z.literal('worker.runtime_event'),
    protocolVersion: z.literal(2),
    eventId: runtimeEventIdSchema,
    sequence: z.number().int().positive(),
    scope: runtimeSessionScopeSchema,
    sessionId: runtimeSessionIdSchema.optional(),
    occurredAt: timestampSchema,
    event: runtimeEventSchema,
  })
  .strict();

export const runtimeSessionEventRecordSchema = workerRuntimeEventMessageSchema
  .omit({ type: true, protocolVersion: true })
  .extend({ cursor: z.number().int().positive(), receivedAt: timestampSchema })
  .strict();

export type RuntimeSessionScope = z.infer<typeof runtimeSessionScopeSchema>;
export type RuntimeSessionCreateRequest = z.infer<typeof runtimeSessionCreateRequestSchema>;
export type RuntimeSessionCapability = z.infer<typeof runtimeSessionCapabilitySchema>;
export type RuntimeControl = z.infer<typeof runtimeControlSchema>;
export type RuntimeSessionCreated = z.infer<typeof runtimeSessionCreatedSchema>;
export type RelayRuntimeControlMessage = z.infer<typeof relayRuntimeControlMessageSchema>;
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;
export type WorkerRuntimeEventMessage = z.infer<typeof workerRuntimeEventMessageSchema>;
export type RuntimeSessionEventRecord = z.infer<typeof runtimeSessionEventRecordSchema>;
