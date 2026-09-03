import {
  assertSessionCanInvokeTool,
  listRuntimeToolsForRole,
  listToolsForProfile,
  mcpSessionContextSchema,
  type McpSessionContext,
  type RuntimeSessionContext,
} from '@claude-teams/agent-teams-protocol';
import { z } from 'zod';

const toolArgumentsSchema = z.record(z.string(), z.unknown());

const runtimeAuthorityFields = new Set([
  'actor',
  'assignmentId',
  'attemptId',
  'claudeDir',
  'controlUrl',
  'cwd',
  'from',
  'leaseEpoch',
  'memberName',
  'membershipId',
  'nodeId',
  'organizationId',
  'personId',
  'pid',
  'runtimeSessionId',
  'teamId',
  'turnId',
  'workerInstanceId',
  'workspaceId',
]);

export interface McpToolDefinition {
  readonly name: string;
}

export interface RuntimeExecutionBinding {
  readonly organizationId: RuntimeSessionContext['organizationId'];
  readonly personId: RuntimeSessionContext['personId'];
  readonly nodeId: RuntimeSessionContext['nodeId'];
  readonly workerInstanceId: RuntimeSessionContext['workerInstanceId'];
  readonly teamId: RuntimeSessionContext['teamId'];
  readonly membershipId: RuntimeSessionContext['membershipId'];
  readonly assignmentId: RuntimeSessionContext['assignmentId'];
  readonly attemptId: RuntimeSessionContext['attemptId'];
  readonly workspaceId: RuntimeSessionContext['workspaceId'];
  readonly leaseEpoch: number;
  readonly turnId: RuntimeSessionContext['turnId'];
}

export type AuthorizedWorkerToolInvocation = {
  readonly context: McpSessionContext;
  readonly toolName: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly runtimeBinding?: RuntimeExecutionBinding;
};

export class RuntimeAuthorityArgumentError extends Error {
  readonly code = 'RUNTIME_AUTHORITY_ARGUMENT_REJECTED';

  constructor(readonly field: string) {
    super(`Runtime MCP arguments cannot override Worker-owned field ${field}`);
    this.name = 'RuntimeAuthorityArgumentError';
  }
}

const runtimeBindingFromContext = (context: RuntimeSessionContext): RuntimeExecutionBinding => ({
  organizationId: context.organizationId,
  personId: context.personId,
  nodeId: context.nodeId,
  workerInstanceId: context.workerInstanceId,
  teamId: context.teamId,
  membershipId: context.membershipId,
  assignmentId: context.assignmentId,
  attemptId: context.attemptId,
  workspaceId: context.workspaceId,
  leaseEpoch: context.leaseEpoch,
  turnId: context.turnId,
});

export const filterMcpToolsForSession = <T extends McpToolDefinition>(
  inputContext: unknown,
  definitions: readonly T[]
): readonly T[] => {
  const context = mcpSessionContextSchema.parse(inputContext);
  const allowedNames = new Set(
    context.profile === 'agent-teams-runtime'
      ? listRuntimeToolsForRole(context.teamRole ?? 'member')
      : listToolsForProfile(context.profile)
  );
  return Object.freeze(definitions.filter((definition) => allowedNames.has(definition.name)));
};

export const authorizeWorkerToolInvocation = (
  inputContext: unknown,
  toolName: string,
  inputArguments: unknown
): AuthorizedWorkerToolInvocation => {
  const context = mcpSessionContextSchema.parse(inputContext);
  const toolArguments = toolArgumentsSchema.parse(inputArguments);
  assertSessionCanInvokeTool(context, toolName);

  if (context.profile !== 'agent-teams-runtime') {
    return { context, toolName, arguments: toolArguments };
  }

  for (const field of Object.keys(toolArguments)) {
    if (runtimeAuthorityFields.has(field)) {
      throw new RuntimeAuthorityArgumentError(field);
    }
  }

  return {
    context,
    toolName,
    arguments: toolArguments,
    runtimeBinding: runtimeBindingFromContext(context),
  };
};
