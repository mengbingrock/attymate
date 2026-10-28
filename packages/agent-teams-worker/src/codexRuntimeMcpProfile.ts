import { attemptIdSchema } from '@claude-teams/agent-teams-protocol';

import { runtimeBridgeToolNames } from './runtimeMcpServer';
import { isOwnerControlServerName } from './codexMcpServerNames';
import {
  runtimeConnectionFeatures,
  type CodexRuntimeConnectionPolicy,
} from './codexRuntimeConnections';

import type { TeamMembershipRole } from '@claude-teams/agent-teams-protocol';

export const RUNTIME_MCP_SERVER_NAME = 'agent-teams-runtime';
export const OWNER_CONTROL_MCP_SERVER_NAME = 'agent-teams-control';

export interface CodexRuntimeMcpLaunchSpec {
  readonly connections?: CodexRuntimeConnectionPolicy;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Worker-owned token-file base (mode 0600). The supervisor adds the attempt ID before
   * exposing it to a bridge, so a long-lived bridge can rotate only its own attempt's token.
   */
  readonly tokenFile?: string;
}

/** Stable across rotations of one attempt, distinct for every other attempt. */
export const runtimeMcpTokenFileForAttempt = (base: string, attemptId: string): string =>
  `${base}.${attemptIdSchema.parse(attemptId)}`;

export const readConfiguredMcpServerNames = (response: unknown): readonly string[] => {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return [];
  const config = (response as Record<string, unknown>).config;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return [];
  const servers = (config as Record<string, unknown>).mcp_servers;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return [];
  return Object.keys(servers).sort((a, b) => a.localeCompare(b));
};

export const readConfiguredPluginNames = (response: unknown): readonly string[] => {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return [];
  const config = (response as Record<string, unknown>).config;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return [];
  const plugins = (config as Record<string, unknown>).plugins;
  if (typeof plugins !== 'object' || plugins === null || Array.isArray(plugins)) return [];
  return Object.keys(plugins).sort((a, b) => a.localeCompare(b));
};

export const readConfiguredAppNames = (response: unknown): readonly string[] => {
  if (typeof response !== 'object' || response === null) return [];
  const config = (response as Record<string, unknown>).config as
    | Record<string, unknown>
    | undefined;
  const apps = config?.apps;
  return typeof apps === 'object' && apps !== null && !Array.isArray(apps)
    ? Object.keys(apps)
        .filter((name) => name !== '_default')
        .sort((a, b) => a.localeCompare(b))
    : [];
};

export const readConfiguredAppToolNames = (
  response: unknown
): Readonly<Record<string, readonly string[]>> =>
  Object.fromEntries(
    Object.entries(record(record(record(response).config).apps)).map(([name, app]) => [
      name,
      Object.keys(record(record(app).tools)),
    ])
  );

export const buildRestrictedRuntimeMcpConfig = (
  spec: CodexRuntimeMcpLaunchSpec,
  token: string,
  configuredServerNames: readonly string[],
  configuredPluginNames: readonly string[] = [],
  teamRole: TeamMembershipRole = 'member',
  configuredAppNames: readonly string[] = [],
  configuredAppToolNames: Readonly<Record<string, readonly string[]>> = {},
  additionalServerNames: readonly string[] = []
): Readonly<Record<string, unknown>> => {
  const connections = spec.connections;
  const selectedControl = [
    ...Object.keys(connections?.mcpServers ?? {}),
    ...Object.values(connections?.plugins ?? {}).flatMap((plugin) =>
      Object.values(plugin.mcpServers).map((server) => server.inventoryName)
    ),
  ].find(isOwnerControlServerName);
  if (selectedControl) throw new Error(`Reserved MCP server ${selectedControl}`);
  for (const name of Object.keys(connections?.mcpServers ?? {})) {
    if (
      !configuredServerNames.includes(name) &&
      connections?.mcpServers[name]?.launch === undefined
    )
      throw new Error(`Selected MCP server is not configured: ${name}`);
  }
  const selectedPluginServers = Object.values(connections?.plugins ?? {}).flatMap((p) =>
    Object.values(p.mcpServers).map((s) => s.inventoryName)
  );
  const disabled = Object.fromEntries(
    [...new Set([...configuredServerNames, ...additionalServerNames])]
      .filter((name) => name !== RUNTIME_MCP_SERVER_NAME && !selectedPluginServers.includes(name))
      .map((name) => [
        name,
        {
          enabled: false,
          ...(configuredServerNames.includes(name) ? {} : { command: spec.command }),
        },
      ])
  );
  return {
    // Connections are opt-in per Worker. Unselected owner connections stay disabled.
    features: runtimeConnectionFeatures(connections),
    plugins: Object.fromEntries(
      [...new Set([...configuredPluginNames, ...Object.keys(connections?.plugins ?? {})])].map(
        (name) => {
          const selected = connections?.plugins[name];
          return [
            name,
            selected === undefined
              ? { enabled: false }
              : {
                  enabled: true,
                  mcp_servers: Object.fromEntries(
                    Object.entries(selected.mcpServers).map(([serverName, policy]) => [
                      serverName,
                      {
                        enabled: true,
                        enabled_tools: policy.enabledTools,
                        default_tools_approval_mode: 'prompt',
                      },
                    ])
                  ),
                },
          ];
        }
      )
    ),
    ...(connections === undefined
      ? {}
      : {
          apps: {
            _default: {
              enabled: false,
              destructive_enabled: false,
              default_tools_approval_mode: 'prompt',
            },
            ...Object.fromEntries(
              [...new Set([...configuredAppNames, ...Object.keys(connections.apps)])].map(
                (name) => {
                  const selected = new Map(Object.entries(connections.apps)).get(name);
                  return [
                    name,
                    selected === undefined
                      ? { enabled: false }
                      : {
                          enabled: true,
                          default_tools_enabled: false,
                          destructive_enabled: !selected.readOnly,
                          default_tools_approval_mode: 'prompt',
                          tools: Object.fromEntries(
                            [
                              ...new Set([
                                ...(configuredAppToolNames[name] ?? []),
                                ...selected.enabledTools,
                              ]),
                            ].map((tool) => [
                              tool,
                              selected.enabledTools.includes(tool)
                                ? { enabled: true, approval_mode: 'approve' }
                                : { enabled: false, approval_mode: 'prompt' },
                            ])
                          ),
                        },
                  ];
                }
              )
            ),
          },
        }),
    mcp_servers: {
      ...disabled,
      ...Object.fromEntries(
        Object.entries(connections?.mcpServers ?? {}).map(([name, policy]) => [
          name,
          {
            enabled: true,
            ...(policy.launch === undefined
              ? {}
              : {
                  command: policy.launch.command,
                  args: policy.launch.args,
                  ...(policy.launch.cwd === undefined ? {} : { cwd: policy.launch.cwd }),
                }),
            ...(policy.enabledTools === undefined ? {} : { enabled_tools: policy.enabledTools }),
            ...(policy.env === undefined ? {} : { env: policy.env }),
            default_tools_approval_mode: policy.approvalMode,
          },
        ])
      ),
      [RUNTIME_MCP_SERVER_NAME]: {
        command: spec.command,
        args: [...spec.args],
        ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
        env: {
          ...spec.env,
          AGENT_TEAMS_RUNTIME_SESSION_TOKEN: token,
          ...(spec.tokenFile === undefined
            ? {}
            : { AGENT_TEAMS_RUNTIME_SESSION_TOKEN_FILE: spec.tokenFile }),
          AGENT_TEAMS_RUNTIME_TEAM_ROLE: teamRole,
        },
        enabled: true,
        required: true,
        startup_timeout_sec: 10,
        tool_timeout_sec: 30,
        default_tools_approval_mode: 'approve',
        enabled_tools: [...runtimeBridgeToolNames(teamRole)],
      },
    },
  };
};

export const assertRestrictedRuntimeMcpInventory = (
  response: unknown,
  teamRole: TeamMembershipRole = 'member',
  connections?: CodexRuntimeConnectionPolicy
): void => {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    throw new Error('Codex runtime MCP inventory response is invalid');
  }
  const data = (response as Record<string, unknown>).data;
  if ((response as Record<string, unknown>).nextCursor != null) {
    throw new Error('Codex runtime MCP inventory exceeded the single-page safety limit');
  }
  if (!Array.isArray(data)) throw new Error('Codex runtime MCP inventory is missing data');
  const servers = data.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('Codex runtime MCP inventory contains an invalid server');
    }
    return entry as Record<string, unknown>;
  });
  const runtimeServers = servers.filter(({ name }) => name === RUNTIME_MCP_SERVER_NAME);
  if (runtimeServers.length !== 1) {
    throw new Error(`Codex runtime MCP inventory is missing ${RUNTIME_MCP_SERVER_NAME}`);
  }
  const leakedServers = servers.filter((server) => {
    if (server.name === RUNTIME_MCP_SERVER_NAME) return false;
    if (typeof server.name === 'string' && isOwnerControlServerName(server.name)) {
      return (
        typeof server.tools !== 'object' ||
        server.tools === null ||
        Array.isArray(server.tools) ||
        Object.keys(server.tools).length > 0 ||
        (server.resources !== undefined &&
          (!Array.isArray(server.resources) || server.resources.length > 0)) ||
        (server.resourceTemplates !== undefined &&
          (!Array.isArray(server.resourceTemplates) || server.resourceTemplates.length > 0))
      );
    }
    let allowedTools = connections?.mcpServers[String(server.name)]?.enabledTools;
    const selectedMcp = Object.hasOwn(connections?.mcpServers ?? {}, String(server.name));
    for (const plugin of Object.values(connections?.plugins ?? {})) {
      const selected = Object.values(plugin.mcpServers).find(
        (policy) => policy.inventoryName === server.name
      );
      if (selected !== undefined) allowedTools = selected.enabledTools;
    }
    if (
      (server.name === 'codex_apps' || server.name === '_codex_apps') &&
      Object.keys(connections?.apps ?? {}).length > 0
    ) {
      // This endpoint returns the raw hosted catalog, including disabled apps and tools.
      // Codex applies apps.<id> settings to model-visible/callable tools separately.
      assertSelectedAppTools(server.tools, connections!);
      return false;
    }
    if (selectedMcp || allowedTools !== undefined) {
      if (typeof server.tools !== 'object' || server.tools === null || Array.isArray(server.tools))
        return true;
      if (
        connections?.mcpServers[String(server.name)]?.readOnly === true &&
        Object.values(server.tools).some((tool) => !isReadTool(tool))
      )
        return true;
      return (
        allowedTools !== undefined &&
        Object.keys(server.tools).some((name) => !allowedTools.includes(name))
      );
    }
    return (
      typeof server.tools !== 'object' ||
      server.tools === null ||
      Array.isArray(server.tools) ||
      Object.keys(server.tools).length > 0
    );
  });
  if (leakedServers.length > 0) {
    throw new Error(
      `Codex runtime MCP inventory leaked capabilities: ${leakedServers
        .map(({ name }) => String(name))
        .sort((a, b) => a.localeCompare(b))
        .join(', ')}`
    );
  }
  const tools = runtimeServers[0]?.tools;
  if (typeof tools !== 'object' || tools === null || Array.isArray(tools)) {
    throw new Error('Codex runtime MCP inventory is missing tools');
  }
  const actualTools = Object.keys(tools).sort((a, b) => a.localeCompare(b));
  const expectedTools = [...runtimeBridgeToolNames(teamRole)].sort((a, b) => a.localeCompare(b));
  if (
    actualTools.length !== expectedTools.length ||
    actualTools.some((tool, index) => tool !== expectedTools[index])
  ) {
    throw new Error(`Codex runtime MCP inventory leaked tools: ${actualTools.join(', ')}`);
  }
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isReadTool = (tool: unknown): boolean => {
  const annotations = record(record(tool).annotations);
  return annotations.readOnlyHint === true && annotations.destructiveHint !== true;
};

const assertSelectedAppTools = (
  value: unknown,
  connections: CodexRuntimeConnectionPolicy
): void => {
  const tools = Object.entries(record(value));
  for (const [appId, policy] of Object.entries(connections.apps)) {
    for (const name of policy.enabledTools) {
      const selected = tools.find(([inventoryName, tool]) => {
        const meta = record(record(tool)._meta);
        return (
          meta.connector_id === appId &&
          (inventoryName === name || inventoryName.endsWith(`.${name}`))
        );
      });
      if (selected === undefined)
        throw new Error(`Selected app tool is unavailable: ${appId}/${name}`);
      if (policy.readOnly && !isReadTool(selected[1]))
        throw new Error(`Selected app tool is not read-only: ${appId}/${name}`);
      if (policy.expectedEmail !== undefined) {
        assertAppAccount(selected[1], appId, policy.expectedEmail);
      }
    }
  }
};

const assertAppAccount = (tool: unknown, appId: string, expectedEmail: string): void => {
  const profile = record(record(record(tool)._meta).link_owner_profile);
  if (
    typeof profile.email !== 'string' ||
    profile.email.toLowerCase() !== expectedEmail.toLowerCase()
  )
    throw new Error(`Selected app account does not match: ${appId}`);
};

export const assertRuntimeAppInventory = (
  value: unknown,
  connections: CodexRuntimeConnectionPolicy
): void => {
  const apps = record(value).apps;
  if (!Array.isArray(apps)) throw new Error('Codex runtime app inventory is invalid');
  const selected = Object.keys(connections.apps);
  for (const app of apps.map(record)) {
    if ((app.enabled === true || app.callable === true) && !selected.includes(String(app.id)))
      throw new Error(`Codex runtime enabled an unselected app: ${String(app.id)}`);
  }
  for (const id of selected) {
    if (
      !apps
        .map(record)
        .some((app) => app.id === id && app.enabled === true && app.callable === true)
    )
      throw new Error(`Selected app is not callable: ${id}`);
  }
};
