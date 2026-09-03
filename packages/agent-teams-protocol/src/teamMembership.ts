import { z } from 'zod';

import {
  membershipIdSchema,
  nodeIdSchema,
  teamIdSchema,
  turnIdSchema,
  workspaceIdSchema,
} from './ids';

export const teamMembershipRoleSchema = z.enum(['lead', 'member']);
export const teamMembershipStatusSchema = z.enum(['active', 'left']);

export const teamMembershipRecordSchema = z
  .object({
    membershipId: membershipIdSchema,
    teamId: teamIdSchema,
    nodeId: nodeIdSchema,
    workspaceId: workspaceIdSchema,
    label: z.string().trim().min(1).max(128),
    role: teamMembershipRoleSchema,
    status: teamMembershipStatusSchema,
    revision: z.number().int().positive(),
    joinedAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    leftAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const teamMembershipSnapshotPayloadSchema = z
  .object({
    teamId: teamIdSchema,
    members: z.array(teamMembershipRecordSchema).max(256),
    generatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const joinTeamMemberRequestSchema = z
  .object({
    targetNodeId: nodeIdSchema,
    membershipId: membershipIdSchema.optional(),
    workspaceId: workspaceIdSchema.optional(),
    role: teamMembershipRoleSchema.optional(),
    title: z.string().trim().min(1).max(240).optional(),
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

export const leaveTeamMemberRequestSchema = z
  .object({
    membershipId: membershipIdSchema,
    expectedRevision: z.number().int().positive().optional(),
    successorMembershipId: membershipIdSchema.optional(),
    reason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const teamMemberJoinRequestedPayloadSchema = z
  .object({
    actorMembershipId: membershipIdSchema,
    targetNodeId: nodeIdSchema,
    turnId: turnIdSchema,
    role: z.literal('member').optional(),
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict();

export const teamMemberLeaveRequestedPayloadSchema = z
  .object({
    actorMembershipId: membershipIdSchema,
    membershipId: membershipIdSchema,
    turnId: turnIdSchema,
    successorMembershipId: membershipIdSchema.optional(),
    reason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export type TeamMembershipRole = z.infer<typeof teamMembershipRoleSchema>;
export type TeamMembershipStatus = z.infer<typeof teamMembershipStatusSchema>;
export type TeamMembershipRecord = z.infer<typeof teamMembershipRecordSchema>;
export type TeamMembershipSnapshotPayload = z.infer<
  typeof teamMembershipSnapshotPayloadSchema
>;
export type JoinTeamMemberRequest = z.infer<typeof joinTeamMemberRequestSchema>;
export type LeaveTeamMemberRequest = z.infer<typeof leaveTeamMemberRequestSchema>;
export type TeamMemberJoinRequestedPayload = z.infer<
  typeof teamMemberJoinRequestedPayloadSchema
>;
export type TeamMemberLeaveRequestedPayload = z.infer<
  typeof teamMemberLeaveRequestedPayloadSchema
>;
