import {
  assertRestrictedRuntimeMcpInventory,
  buildRestrictedRuntimeMcpConfig,
  readConfiguredMcpServerNames,
  readConfiguredPluginNames,
  RUNTIME_BRIDGE_TOOL_NAMES,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

describe('Codex runtime MCP profile', () => {
  it('disables every discovered server and injects only the tokenized runtime bridge', () => {
    const configured = readConfiguredMcpServerNames({
      config: {
        mcp_servers: {
          github: { enabled: true },
          'agent-teams-control': { enabled: true },
        },
      },
    });
    const plugins = readConfiguredPluginNames({
      config: {
        plugins: {
          'browser@openai-bundled': { enabled: true },
          'documents@openai-primary-runtime': { enabled: true },
        },
      },
    });
    const config = buildRestrictedRuntimeMcpConfig(
      { command: '/usr/bin/node', args: ['/worker/runtimeMcpCli.js', '--socket', '/tmp/w.sock'] },
      'secret-token',
      configured,
      plugins
    );

    expect(config).toEqual({
      plugins: {
        'browser@openai-bundled': { enabled: false },
        'documents@openai-primary-runtime': { enabled: false },
      },
      mcp_servers: {
        'agent-teams-control': { enabled: false },
        github: { enabled: false },
        'agent-teams-runtime': expect.objectContaining({
          command: '/usr/bin/node',
          required: true,
          enabled_tools: RUNTIME_BRIDGE_TOOL_NAMES,
          default_tools_approval_mode: 'approve',
          env: {
            AGENT_TEAMS_RUNTIME_SESSION_TOKEN: 'secret-token',
            AGENT_TEAMS_RUNTIME_TEAM_ROLE: 'member',
          },
        }),
      },
    });
  });

  it('does not invent an incomplete owner-control server when none is configured', () => {
    const config = buildRestrictedRuntimeMcpConfig(
      { command: '/usr/bin/node', args: ['/worker/runtimeMcpCli.js', '--socket', '/tmp/w.sock'] },
      'secret-token',
      []
    );

    expect(config).toEqual({
      plugins: {},
      mcp_servers: {
        'agent-teams-runtime': expect.objectContaining({
          command: '/usr/bin/node',
          required: true,
        }),
      },
    });
  });

  it('rejects any extra server or tool in the thread inventory', () => {
    const runtime = {
      name: 'agent-teams-runtime',
      tools: Object.fromEntries(RUNTIME_BRIDGE_TOOL_NAMES.map((name) => [name, {}])),
    };
    expect(() =>
      assertRestrictedRuntimeMcpInventory({ data: [runtime], nextCursor: null })
    ).not.toThrow();
    expect(() =>
      assertRestrictedRuntimeMcpInventory({
        data: [
          runtime,
          { name: 'github', tools: {}, resources: [], resourceTemplates: [] },
        ],
        nextCursor: null,
      })
    ).not.toThrow();
    expect(() =>
      assertRestrictedRuntimeMcpInventory({
        data: [
          runtime,
          {
            name: 'github',
            tools: { issue_write: {} },
            resources: [],
            resourceTemplates: [],
          },
        ],
        nextCursor: null,
      })
    ).toThrow('leaked capabilities');
    expect(() =>
      assertRestrictedRuntimeMcpInventory({
        data: [{ ...runtime, tools: { ...runtime.tools, approval_respond: {} } }],
        nextCursor: null,
      })
    ).toThrow('leaked tools');
  });
});
