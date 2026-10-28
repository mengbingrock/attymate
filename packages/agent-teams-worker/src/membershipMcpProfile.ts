import {
  buildRestrictedRuntimeMcpConfig,
  readConfiguredAppNames,
  readConfiguredAppToolNames,
  readConfiguredMcpServerNames,
  readConfiguredPluginNames,
  type CodexRuntimeMcpLaunchSpec,
} from './codexRuntimeMcpProfile';

import type { WorkerCodexAppServerSession } from './codexAppServerClient';

export const DESKTOP_TEAM_TOOLS = [
  'runtime_context',
  'team_membership_list',
  'message_send',
  'support_request',
  'review_request',
  'message_list',
  'message_get',
  'message_ack',
] as const;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Membership has communication authority only, irrespective of owner connection selections. */
export const membershipMcpConfig = async (
  session: WorkerCodexAppServerSession,
  spec: CodexRuntimeMcpLaunchSpec,
  token: string
): Promise<Record<string, unknown>> => {
  const ownerConfig = await session.request('config/read', { includeLayers: false });
  const config = buildRestrictedRuntimeMcpConfig(
    { ...spec, connections: { mcpServers: {}, plugins: {}, apps: {} } },
    token,
    readConfiguredMcpServerNames(ownerConfig),
    readConfiguredPluginNames(ownerConfig),
    'member',
    readConfiguredAppNames(ownerConfig),
    readConfiguredAppToolNames(ownerConfig)
  );
  return {
    ...config,
    mcp_servers: {
      ...record(config.mcp_servers),
      'agent-teams-runtime': {
        command: spec.command,
        args: [...spec.args, '--desktop-chat'],
        env: { AGENT_TEAMS_RUNTIME_SESSION_TOKEN: token },
        enabled: true,
        required: true,
        startup_timeout_sec: 15,
        default_tools_approval_mode: 'approve',
        enabled_tools: [...DESKTOP_TEAM_TOOLS],
      },
    },
  };
};

export const assertMembershipMcpInventory = async (
  session: WorkerCodexAppServerSession,
  threadId: string
): Promise<void> => {
  const response = record(
    await session.request('mcpServerStatus/list', {
      threadId,
      limit: 100,
      detail: 'full',
    })
  );
  if (!Array.isArray(response.data) || response.nextCursor != null)
    throw new Error('Cannot establish membership MCP inventory');
  let runtimeCount = 0;
  for (const value of response.data) {
    const server = record(value);
    const tools = record(server.tools);
    const resources = server.resources;
    const templates = server.resourceTemplates;
    if (
      typeof server.name !== 'string' ||
      server.tools === null ||
      typeof server.tools !== 'object' ||
      Array.isArray(server.tools) ||
      (resources !== undefined && (!Array.isArray(resources) || resources.length > 0)) ||
      (templates !== undefined && (!Array.isArray(templates) || templates.length > 0))
    )
      throw new Error('Membership MCP inventory contains unsafe capabilities');
    if (server.name !== 'agent-teams-runtime') {
      if (Object.keys(tools).length > 0)
        throw new Error(`Membership MCP inventory leaked server: ${server.name}`);
      continue;
    }
    runtimeCount++;
    const actual = Object.keys(tools).sort();
    const expected = [...DESKTOP_TEAM_TOOLS].sort();
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index]))
      throw new Error('Membership MCP inventory leaked task or owner tools');
  }
  if (runtimeCount !== 1) throw new Error('Membership MCP inventory is missing its runtime bridge');
};
