import { randomUUID } from 'node:crypto';

import {
  canRuntimeRoleInvokeTool,
  type PublicMcpToolName,
  type TeamMembershipRole,
} from '@claude-teams/agent-teams-protocol';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';

import { requestWorkerControl } from './workerControlServer';

export const RUNTIME_BRIDGE_TOOL_NAMES = [
  'runtime_context',
  'progress_report',
  'message_send',
  'team_leave',
  'result_submit',
] as const satisfies readonly PublicMcpToolName[];

export const LEAD_RUNTIME_BRIDGE_TOOL_NAMES = [
  'team_membership_list',
  'team_member_join',
  'team_member_leave',
] as const satisfies readonly PublicMcpToolName[];

export const runtimeBridgeToolNames = (
  role: TeamMembershipRole
): readonly PublicMcpToolName[] =>
  role === 'lead'
    ? [...RUNTIME_BRIDGE_TOOL_NAMES, ...LEAD_RUNTIME_BRIDGE_TOOL_NAMES]
    : RUNTIME_BRIDGE_TOOL_NAMES;

const jsonContent = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

const emptyParameters = z.object({}).strict();
const progressParameters = z
  .object({
    summary: z.string().trim().min(1).max(4_000),
    percent: z.number().min(0).max(100).optional(),
    details: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict();
const messageParameters = z
  .object({
    recipientMembershipId: z.uuid(),
    message: z.string().trim().min(1).max(20_000),
  })
  .strict();
const resultParameters = z
  .object({
    outcome: z.enum(['completed', 'blocked']),
    summary: z.string().trim().min(1).max(20_000),
    artifacts: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(),
    tests: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(),
  })
  .strict();
const joinMemberParameters = z
  .object({
    targetNodeId: z.uuid(),
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict();
const leaveMemberParameters = z
  .object({
    targetMembershipId: z.uuid(),
    successorMembershipId: z.uuid().optional(),
    reason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
const leaveTeamParameters = leaveMemberParameters.omit({ targetMembershipId: true });

export const parseRuntimeMcpToolArguments = (
  toolName: string,
  input: unknown
): Readonly<Record<string, unknown>> => {
  switch (toolName) {
    case 'runtime_context':
      return emptyParameters.parse(input);
    case 'progress_report':
      return progressParameters.parse(input);
    case 'message_send':
      return messageParameters.parse(input);
    case 'result_submit':
      return resultParameters.parse(input);
    case 'team_membership_list':
      return emptyParameters.parse(input);
    case 'team_member_join':
      return joinMemberParameters.parse(input);
    case 'team_member_leave':
      return leaveMemberParameters.parse(input);
    case 'team_leave':
      return leaveTeamParameters.parse(input);
    default:
      throw new TypeError(`Runtime MCP tool ${toolName} is not implemented by this Worker`);
  }
};

export interface RuntimeMcpToolDefinition {
  readonly name:
    | (typeof RUNTIME_BRIDGE_TOOL_NAMES)[number]
    | (typeof LEAD_RUNTIME_BRIDGE_TOOL_NAMES)[number];
  readonly description: string;
  readonly parameters: z.ZodType;
  readonly execute: (input: unknown) => Promise<ReturnType<typeof jsonContent>>;
}

export const createRuntimeMcpToolDefinitions = (
  socketPath: string,
  token: string,
  teamRole: TeamMembershipRole = 'member'
): readonly RuntimeMcpToolDefinition[] => {
  const call = async (toolName: string, input: unknown) =>
    await requestWorkerControl<unknown>(socketPath, `/v2/runtime-tools/${toolName}`, {
      method: 'POST',
      bearerToken: token,
      body: { idempotencyKey: randomUUID(), arguments: input },
    });
  const definitions: readonly RuntimeMcpToolDefinition[] = [
    {
      name: 'runtime_context',
      description: 'Show the Worker-bound team, assignment, lease, workspace, and turn identity',
      parameters: emptyParameters,
      execute: async (input) =>
        jsonContent(await call('runtime_context', emptyParameters.parse(input))),
    },
    {
      name: 'progress_report',
      description: 'Durably report progress for the currently leased assignment',
      parameters: progressParameters,
      execute: async (input) =>
        jsonContent(await call('progress_report', progressParameters.parse(input))),
    },
    {
      name: 'message_send',
      description: 'Send a durable assignment-scoped message to another team membership',
      parameters: messageParameters,
      execute: async (input) =>
        jsonContent(await call('message_send', messageParameters.parse(input))),
    },
    {
      name: 'team_leave',
      description:
        'Leave the current team and fence this runtime; an active lead must name a successor',
      parameters: leaveTeamParameters,
      execute: async (input) =>
        jsonContent(await call('team_leave', leaveTeamParameters.parse(input))),
    },
    {
      name: 'result_submit',
      description: 'Submit a candidate result for Worker-side verification and publication',
      parameters: resultParameters,
      execute: async (input) =>
        jsonContent(await call('result_submit', resultParameters.parse(input))),
    },
    ...(teamRole === 'lead'
      ? [
          {
            name: 'team_membership_list' as const,
            description: 'List the current active team roster and membership identifiers',
            parameters: emptyParameters,
            execute: async (input: unknown) =>
              jsonContent(await call('team_membership_list', emptyParameters.parse(input))),
          },
          {
            name: 'team_member_join' as const,
            description: 'Invite a connected Worker node to join this team and start its runtime',
            parameters: joinMemberParameters,
            execute: async (input: unknown) =>
              jsonContent(await call('team_member_join', joinMemberParameters.parse(input))),
          },
          {
            name: 'team_member_leave' as const,
            description:
              'Remove a team membership, fencing its active execution lease; a departing lead must name a successor',
            parameters: leaveMemberParameters,
            execute: async (input: unknown) =>
              jsonContent(await call('team_member_leave', leaveMemberParameters.parse(input))),
          },
        ]
      : []),
  ];
  for (const definition of definitions) {
    if (!canRuntimeRoleInvokeTool(teamRole, definition.name)) {
      throw new Error(`Tool ${definition.name} is not allowed for a ${teamRole} runtime`);
    }
  }
  return definitions;
};

export const createAgentTeamsRuntimeMcpServer = (
  socketPath: string,
  token: string,
  teamRole: TeamMembershipRole = 'member'
): FastMCP => {
  const server = new FastMCP({ name: 'agent-teams-runtime', version: '2.0.0' });
  for (const definition of createRuntimeMcpToolDefinitions(socketPath, token, teamRole)) {
    server.addTool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      execute: (input) => definition.execute(input),
    });
  }
  return server;
};
