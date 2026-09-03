import { z } from 'zod';

import {
  assignmentIdSchema,
  leaseIdSchema,
  membershipIdSchema,
  workspaceIdSchema,
} from './ids';
import { teamMembershipRoleSchema } from './teamMembership';

export const assignmentOfferPayloadSchema = z
  .object({
    assignmentId: assignmentIdSchema,
    membershipId: membershipIdSchema.optional(),
    workspaceId: workspaceIdSchema.optional(),
    teamRole: teamMembershipRoleSchema.optional(),
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.membershipId === undefined) !== (value.workspaceId === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'membershipId and workspaceId must be supplied together',
      });
    }
  });

export type AssignmentOfferPayload = z.infer<typeof assignmentOfferPayloadSchema>;

export const assignmentAcceptPayloadSchema = z
  .object({
    assignmentId: assignmentIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type AssignmentAcceptPayload = z.infer<typeof assignmentAcceptPayloadSchema>;

export const assignmentLeaseGrantPayloadSchema = z
  .object({
    leaseId: leaseIdSchema,
    assignmentRevision: z.number().int().nonnegative(),
  })
  .strict();

export type AssignmentLeaseGrantPayload = z.infer<typeof assignmentLeaseGrantPayloadSchema>;

export const assignmentExecutionStateSchema = z.enum([
  'proposed',
  'accepted',
  'rejected',
  'deferred',
  'queued',
  'leased',
  'preparing_workspace',
  'running',
  'waiting_local_approval',
  'verifying',
  'committing',
  'awaiting_push',
  'reporting',
  'ready_review',
  'completed',
  'cancelled',
  'failed',
  'fenced',
]);

export type AssignmentExecutionState = z.infer<typeof assignmentExecutionStateSchema>;

export const assignmentStateChangedPayloadSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    fromState: assignmentExecutionStateSchema.nullable(),
    state: assignmentExecutionStateSchema,
    reason: z.string().trim().min(1).max(2_000),
    deferredUntil: z.iso.datetime({ offset: true }).optional(),
    leaseId: leaseIdSchema.optional(),
    leaseExpiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type AssignmentStateChangedPayload = z.infer<typeof assignmentStateChangedPayloadSchema>;

const terminalStates = new Set<AssignmentExecutionState>([
  'rejected',
  'completed',
  'cancelled',
  'failed',
  'fenced',
]);

const allowedTransitions: Readonly<
  Record<AssignmentExecutionState, ReadonlySet<AssignmentExecutionState>>
> = {
  proposed: new Set(['accepted', 'rejected', 'deferred', 'cancelled']),
  accepted: new Set(['queued', 'cancelled']),
  rejected: new Set(),
  deferred: new Set(['accepted', 'rejected', 'cancelled']),
  queued: new Set(['leased', 'cancelled']),
  leased: new Set(['preparing_workspace', 'cancelled', 'failed', 'fenced']),
  preparing_workspace: new Set(['running', 'cancelled', 'failed', 'fenced']),
  running: new Set(['waiting_local_approval', 'verifying', 'cancelled', 'failed', 'fenced']),
  waiting_local_approval: new Set(['running', 'cancelled', 'failed', 'fenced']),
  verifying: new Set(['running', 'committing', 'cancelled', 'failed', 'fenced']),
  committing: new Set(['awaiting_push', 'cancelled', 'failed', 'fenced']),
  awaiting_push: new Set(['reporting', 'cancelled', 'failed', 'fenced']),
  reporting: new Set(['ready_review', 'cancelled', 'failed', 'fenced']),
  ready_review: new Set(['queued', 'completed', 'cancelled', 'failed']),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
  fenced: new Set(),
};

export class InvalidAssignmentTransitionError extends Error {
  readonly code = 'INVALID_ASSIGNMENT_TRANSITION';

  constructor(
    readonly from: AssignmentExecutionState,
    readonly to: AssignmentExecutionState
  ) {
    super(`Assignment cannot transition from ${from} to ${to}`);
    this.name = 'InvalidAssignmentTransitionError';
  }
}

export const isTerminalAssignmentState = (state: AssignmentExecutionState): boolean =>
  terminalStates.has(state);

export const canTransitionAssignment = (
  from: AssignmentExecutionState,
  to: AssignmentExecutionState
): boolean => allowedTransitions[from].has(to);

export const assertAssignmentTransition = (
  from: AssignmentExecutionState,
  to: AssignmentExecutionState
): void => {
  if (!canTransitionAssignment(from, to)) {
    throw new InvalidAssignmentTransitionError(from, to);
  }
};
