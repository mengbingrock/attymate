import { z } from 'zod';

import {
  assignmentIdSchema,
  attemptIdSchema,
  commandIdSchema,
  eventIdSchema,
  nodeIdSchema,
  teamIdSchema,
  workerInstanceIdSchema,
} from './ids';

const envelopeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_.-]*$/);
const sequenceSchema = z.number().int().nonnegative();
const revisionSchema = z.number().int().nonnegative();
const leaseEpochSchema = z.number().int().nonnegative();
const timestampSchema = z.iso.datetime({ offset: true });

export const commandEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(2),
    commandId: commandIdSchema,
    sequence: sequenceSchema,
    teamId: teamIdSchema.optional(),
    targetNodeId: nodeIdSchema,
    expectedRevision: revisionSchema.optional(),
    assignmentId: assignmentIdSchema.optional(),
    attemptId: attemptIdSchema.optional(),
    leaseEpoch: leaseEpochSchema.optional(),
    expiresAt: timestampSchema.optional(),
    type: envelopeTypeSchema,
    payload: z.unknown(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasAttemptIdentity = value.attemptId !== undefined || value.leaseEpoch !== undefined;
    if (
      hasAttemptIdentity &&
      (value.assignmentId === undefined ||
        value.attemptId === undefined ||
        value.leaseEpoch === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'attemptId and leaseEpoch require the full assignment execution identity',
      });
    }
  });

export const eventEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(2),
    eventId: eventIdSchema,
    sequence: sequenceSchema,
    occurredAt: timestampSchema,
    sourceNodeId: nodeIdSchema,
    workerInstanceId: workerInstanceIdSchema,
    teamId: teamIdSchema.optional(),
    assignmentId: assignmentIdSchema.optional(),
    attemptId: attemptIdSchema.optional(),
    leaseEpoch: leaseEpochSchema.optional(),
    type: envelopeTypeSchema,
    payload: z.unknown(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasAttemptIdentity = value.attemptId !== undefined || value.leaseEpoch !== undefined;
    if (
      hasAttemptIdentity &&
      (value.assignmentId === undefined ||
        value.attemptId === undefined ||
        value.leaseEpoch === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'attemptId and leaseEpoch require the full assignment execution identity',
      });
    }
  });

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
