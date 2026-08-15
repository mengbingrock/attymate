import { randomUUID } from 'node:crypto';

import { canProfileInvokeTool, type PublicMcpToolName } from '@claude-teams/agent-teams-protocol';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';

import { requestWorkerControl } from './workerControlServer';

export const RUNTIME_BRIDGE_TOOL_NAMES = [
  'runtime_context',
  'progress_report',
  'message_send',
  'result_submit',
] as const satisfies readonly PublicMcpToolName[];

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
    default:
      throw new TypeError(`Runtime MCP tool ${toolName} is not implemented by this Worker`);
  }
};

export interface RuntimeMcpToolDefinition {
  readonly name: (typeof RUNTIME_BRIDGE_TOOL_NAMES)[number];
  readonly description: string;
  readonly parameters: z.ZodType;
  readonly execute: (input: unknown) => Promise<ReturnType<typeof jsonContent>>;
}

export const createRuntimeMcpToolDefinitions = (
  socketPath: string,
  token: string
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
      name: 'result_submit',
      description: 'Submit a candidate result for Worker-side verification and publication',
      parameters: resultParameters,
      execute: async (input) =>
        jsonContent(await call('result_submit', resultParameters.parse(input))),
    },
  ];
  for (const definition of definitions) {
    if (!canProfileInvokeTool('agent-teams-runtime', definition.name)) {
      throw new Error(`Tool ${definition.name} is not allowed in agent-teams-runtime`);
    }
  }
  return definitions;
};

export const createAgentTeamsRuntimeMcpServer = (socketPath: string, token: string): FastMCP => {
  const server = new FastMCP({ name: 'agent-teams-runtime', version: '2.0.0' });
  for (const definition of createRuntimeMcpToolDefinitions(socketPath, token)) {
    server.addTool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      execute: (input) => definition.execute(input),
    });
  }
  return server;
};
