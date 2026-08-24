import { canProfileInvokeTool, type PublicMcpToolName } from '@claude-teams/agent-teams-protocol';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';

import { requestWorkerControl, type WorkerAgentContextProjection } from './workerControlServer';
import type { WorkerAssignment, WorkerAssignmentActivity } from './workerAssignmentStore';
import type { AgentTeamsWorkerStatus } from './workerDaemon';
import type { WorkerInboxCommand } from './workerInboxStore';
import type { WorkerTeamMessage } from './workerMessageStore';

export const OWNER_CONTROL_BRIDGE_TOOL_NAMES = [
  'agent_context',
  'worker_status',
  'agenda_get',
  'assignment_list',
  'assignment_get',
  'assignment_accept',
  'assignment_reject',
  'assignment_defer',
  'assignment_activity_get',
  'message_list',
  'message_mark_read',
] as const satisfies readonly PublicMcpToolName[];

const jsonContent = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

export interface OwnerControlToolDefinition {
  readonly name: (typeof OWNER_CONTROL_BRIDGE_TOOL_NAMES)[number];
  readonly description: string;
  readonly parameters: z.ZodType;
  readonly execute: (input: unknown) => Promise<ReturnType<typeof jsonContent>>;
}

const emptyParameters = z.object({}).strict();
const assignmentReferenceParameters = z
  .object({ assignmentId: z.uuid(), expectedRevision: z.number().int().nonnegative().optional() })
  .strict();
const assignmentDecisionParameters = assignmentReferenceParameters.extend({
  reason: z.string().trim().min(1).max(2_000).optional(),
});
const assignmentDeferParameters = assignmentDecisionParameters.extend({
  deferredUntil: z.iso.datetime({ offset: true }).optional(),
});
const messageReferenceParameters = z.object({ messageId: z.uuid() }).strict();

export const createOwnerControlToolDefinitions = (
  socketPath: string
): readonly OwnerControlToolDefinition[] => {
  const activity = async () =>
    await requestWorkerControl<{
      assignments: readonly WorkerAssignment[];
      events: readonly WorkerAssignmentActivity[];
      commands: readonly WorkerInboxCommand[];
    }>(socketPath, '/v2/assignment-activity');

  const assignments = async () =>
    await requestWorkerControl<{ assignments: readonly WorkerAssignment[] }>(
      socketPath,
      '/v2/assignments'
    );

  const mutateAssignment = async (
    action: 'accept' | 'reject' | 'defer',
    input: unknown,
    schema: typeof assignmentDecisionParameters | typeof assignmentDeferParameters
  ) => {
    const parsed = schema.parse(input);
    return await requestWorkerControl<{ assignment: WorkerAssignment }>(
      socketPath,
      `/v2/assignments/${encodeURIComponent(parsed.assignmentId)}/${action}`,
      {
        method: 'POST',
        body: {
          ...(parsed.expectedRevision === undefined
            ? {}
            : { expectedRevision: parsed.expectedRevision }),
          ...('reason' in parsed && parsed.reason !== undefined ? { reason: parsed.reason } : {}),
          ...('deferredUntil' in parsed && parsed.deferredUntil !== undefined
            ? { deferredUntil: parsed.deferredUntil }
            : {}),
        },
      }
    );
  };

  const definitions: readonly OwnerControlToolDefinition[] = [
    {
      name: 'agent_context',
      description: 'Show the local personal-agent identity and Worker connection context',
      parameters: emptyParameters,
      execute: async () =>
        jsonContent(
          await requestWorkerControl<WorkerAgentContextProjection>(socketPath, '/v2/agent-context')
        ),
    },
    {
      name: 'worker_status',
      description: 'Show the local headless Worker health and Relay connection status',
      parameters: emptyParameters,
      execute: async () =>
        jsonContent(
          await requestWorkerControl<AgentTeamsWorkerStatus>(socketPath, '/v2/worker-status')
        ),
    },
    {
      name: 'agenda_get',
      description: 'List the personal Worker durable assignment queue',
      parameters: emptyParameters,
      execute: async () => jsonContent(await assignments()),
    },
    {
      name: 'assignment_list',
      description: 'List assignments offered to this personal Worker',
      parameters: emptyParameters,
      execute: async () => jsonContent(await assignments()),
    },
    {
      name: 'assignment_get',
      description: 'Get one assignment and its current owner-controlled state',
      parameters: assignmentReferenceParameters,
      execute: async (input) => {
        const parsed = assignmentReferenceParameters.parse(input);
        return jsonContent(
          await requestWorkerControl<{ assignment: WorkerAssignment }>(
            socketPath,
            `/v2/assignments/${encodeURIComponent(parsed.assignmentId)}`
          )
        );
      },
    },
    {
      name: 'assignment_accept',
      description: 'Accept an offered assignment and place it in the serial local queue',
      parameters: assignmentDecisionParameters,
      execute: async (input) =>
        jsonContent(await mutateAssignment('accept', input, assignmentDecisionParameters)),
    },
    {
      name: 'assignment_reject',
      description: 'Reject an offered assignment on this device',
      parameters: assignmentDecisionParameters,
      execute: async (input) =>
        jsonContent(await mutateAssignment('reject', input, assignmentDecisionParameters)),
    },
    {
      name: 'assignment_defer',
      description: 'Defer an offered assignment until the owner is ready to decide',
      parameters: assignmentDeferParameters,
      execute: async (input) =>
        jsonContent(await mutateAssignment('defer', input, assignmentDeferParameters)),
    },
    {
      name: 'assignment_activity_get',
      description: 'Show durable assignment transitions and received commands',
      parameters: emptyParameters,
      execute: async () => jsonContent(await activity()),
    },
    {
      name: 'message_list',
      description: 'List durable peer messages delivered to this personal Worker',
      parameters: emptyParameters,
      execute: async () =>
        jsonContent(
          await requestWorkerControl<{ messages: readonly WorkerTeamMessage[] }>(
            socketPath,
            '/v2/messages'
          )
        ),
    },
    {
      name: 'message_mark_read',
      description: 'Mark one durable peer message as read without steering it into Codex',
      parameters: messageReferenceParameters,
      execute: async (input) => {
        const parsed = messageReferenceParameters.parse(input);
        return jsonContent(
          await requestWorkerControl<{ message: WorkerTeamMessage }>(
            socketPath,
            `/v2/messages/${encodeURIComponent(parsed.messageId)}/read`,
            { method: 'POST' }
          )
        );
      },
    },
  ];

  for (const definition of definitions) {
    if (!canProfileInvokeTool('agent-teams-control', definition.name)) {
      throw new Error(`Tool ${definition.name} is not allowed in agent-teams-control`);
    }
  }
  return definitions;
};

export const createAgentTeamsControlMcpServer = (socketPath: string): FastMCP => {
  const server = new FastMCP({ name: 'agent-teams-control', version: '2.0.0' });
  for (const definition of createOwnerControlToolDefinitions(socketPath)) {
    server.addTool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      execute: (input) => definition.execute(input),
    });
  }
  return server;
};
