import {
  assertRestrictedRuntimeMcpInventory,
  buildRestrictedRuntimeMcpConfig,
  readConfiguredMcpServerNames,
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
    const config = buildRestrictedRuntimeMcpConfig(
      { command: '/usr/bin/node', args: ['/worker/runtimeMcpCli.js', '--socket', '/tmp/w.sock'] },
      'secret-token',
      configured
    );

    expect(config).toEqual({
      mcp_servers: {
        'agent-teams-control': { enabled: false },
        github: { enabled: false },
        'agent-teams-runtime': expect.objectContaining({
          command: '/usr/bin/node',
          required: true,
          enabled_tools: RUNTIME_BRIDGE_TOOL_NAMES,
          env: { AGENT_TEAMS_RUNTIME_SESSION_TOKEN: 'secret-token' },
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
        data: [runtime, { name: 'github', tools: {} }],
        nextCursor: null,
      })
    ).toThrow('leaked servers');
    expect(() =>
      assertRestrictedRuntimeMcpInventory({
        data: [{ ...runtime, tools: { ...runtime.tools, approval_respond: {} } }],
        nextCursor: null,
      })
    ).toThrow('leaked tools');
  });
});
