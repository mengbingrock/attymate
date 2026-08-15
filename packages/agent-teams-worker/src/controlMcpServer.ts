import {
  canProfileInvokeTool,
  type PublicMcpToolName,
} from '@claude-teams/agent-teams-protocol';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';

import {
  requestWorkerControl,
  type WorkerAgentContextProjection,
} from './workerControlServer';
import type { AgentTeamsWorkerStatus } from './workerDaemon';
import type { WorkerInboxCommand } from './workerInboxStore';

export const OWNER_CONTROL_BRIDGE_TOOL_NAMES = [
  'agent_context',
  'worker_status',
  'agenda_get',
  'assignment_activity_get',
] as const satisfies readonly PublicMcpToolName[];

const jsonContent = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

export interface OwnerControlToolDefinition {
  readonly name: (typeof OWNER_CONTROL_BRIDGE_TOOL_NAMES)[number];
  readonly description: string;
  readonly execute: () => Promise<ReturnType<typeof jsonContent>>;
}

export const createOwnerControlToolDefinitions = (
  socketPath: string
): readonly OwnerControlToolDefinition[] => {
  const activity = async () =>
    await requestWorkerControl<{ commands: readonly WorkerInboxCommand[] }>(
      socketPath,
      '/v2/assignment-activity'
    );

  const definitions: readonly OwnerControlToolDefinition[] = [
    {
      name: 'agent_context',
      description: 'Show the local personal-agent identity and Worker connection context',
      execute: async () =>
        jsonContent(
          await requestWorkerControl<WorkerAgentContextProjection>(
            socketPath,
            '/v2/agent-context'
          )
        ),
    },
    {
      name: 'worker_status',
      description: 'Show the local headless Worker health and Relay connection status',
      execute: async () =>
        jsonContent(
          await requestWorkerControl<AgentTeamsWorkerStatus>(socketPath, '/v2/worker-status')
        ),
    },
    {
      name: 'agenda_get',
      description: 'List durable assignment commands currently known to the personal Worker',
      execute: async () => jsonContent(await activity()),
    },
    {
      name: 'assignment_activity_get',
      description: 'Show durable assignment-command activity received by the personal Worker',
      execute: async () => jsonContent(await activity()),
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
      parameters: z.object({}).strict(),
      execute: definition.execute,
    });
  }
  return server;
};
