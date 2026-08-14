import { z } from 'zod';

import {
  assignmentIdSchema,
  attemptIdSchema,
  controlSessionIdSchema,
  membershipIdSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  teamIdSchema,
  turnIdSchema,
  workerInstanceIdSchema,
  workspaceIdSchema,
} from './ids';

export const coordinationModeSchema = z.enum(['local_filesystem_v1', 'lan_relay_v2']);

const sharedSessionFields = {
  protocolVersion: z.literal(2),
  coordinationMode: z.literal('lan_relay_v2'),
  organizationId: organizationIdSchema,
  personId: personIdSchema,
  nodeId: nodeIdSchema,
  workerInstanceId: workerInstanceIdSchema,
};

export const ownerControlSessionContextSchema = z
  .object({
    ...sharedSessionFields,
    profile: z.literal('agent-teams-control'),
    controlSessionId: controlSessionIdSchema,
  })
  .strict();

export const managerSessionContextSchema = z
  .object({
    ...sharedSessionFields,
    profile: z.literal('agent-teams-manager'),
    controlSessionId: controlSessionIdSchema,
  })
  .strict();

export const runtimeSessionContextSchema = z
  .object({
    ...sharedSessionFields,
    profile: z.literal('agent-teams-runtime'),
    teamId: teamIdSchema,
    membershipId: membershipIdSchema,
    assignmentId: assignmentIdSchema,
    attemptId: attemptIdSchema,
    workspaceId: workspaceIdSchema,
    leaseEpoch: z.number().int().nonnegative(),
    turnId: turnIdSchema,
  })
  .strict();

export const mcpSessionContextSchema = z.discriminatedUnion('profile', [
  ownerControlSessionContextSchema,
  managerSessionContextSchema,
  runtimeSessionContextSchema,
]);

export const agentPlacementSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('embedded'),
      hostNodeId: nodeIdSchema,
      slotId: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      kind: z.literal('personal'),
      personId: personIdSchema,
      nodeId: nodeIdSchema,
    })
    .strict(),
]);

export type CoordinationMode = z.infer<typeof coordinationModeSchema>;
export type OwnerControlSessionContext = z.infer<typeof ownerControlSessionContextSchema>;
export type ManagerSessionContext = z.infer<typeof managerSessionContextSchema>;
export type RuntimeSessionContext = z.infer<typeof runtimeSessionContextSchema>;
export type McpSessionContext = z.infer<typeof mcpSessionContextSchema>;
export type McpCapabilityProfile = McpSessionContext['profile'];
export type AgentPlacement = z.infer<typeof agentPlacementSchema>;
