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

const envelopeTypeSchema = z.string().trim().min(1).max(128).regex(/^[a-z][a-z0-9_.-]*$/);
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
    const executionFields = [value.assignmentId, value.attemptId, value.leaseEpoch];
    const populated = executionFields.filter((field) => field !== undefined).length;
    if (populated !== 0 && populated !== executionFields.length) {
      context.addIssue({
        code: 'custom',
        message: 'assignmentId, attemptId, and leaseEpoch must be supplied together',
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
    const executionFields = [value.assignmentId, value.attemptId, value.leaseEpoch];
    const populated = executionFields.filter((field) => field !== undefined).length;
    if (populated !== 0 && populated !== executionFields.length) {
      context.addIssue({
        code: 'custom',
        message: 'assignmentId, attemptId, and leaseEpoch must be supplied together',
      });
    }
  });

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
