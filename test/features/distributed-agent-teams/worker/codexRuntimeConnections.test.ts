// @vitest-environment node
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertRestrictedRuntimeMcpInventory,
  assertRuntimeAppInventory,
  buildRestrictedRuntimeMcpConfig,
  readConfiguredAppToolNames,
  readRuntimeConnectionPolicy,
  RUNTIME_BRIDGE_TOOL_NAMES,
  runtimeConnectionPolicySchema,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

const connections = runtimeConnectionPolicySchema.parse({
  mcpServers: { clio: { enabledTools: ['auth_status'], env: { READ_ONLY: 'true' } } },
  plugins: {
    'notes@local': {
      mcpServers: { notes: { inventoryName: 'plugin_notes_notes', enabledTools: ['search'] } },
    },
  },
  apps: { outlook: { enabledTools: ['get_profile'], expectedEmail: 'pilot@example.test' } },
});
const runtime = {
  name: 'agent-teams-runtime',
  tools: Object.fromEntries(RUNTIME_BRIDGE_TOOL_NAMES.map((name) => [name, {}])),
};

describe('Worker selected connections', () => {
  it('enables selected connections and overrides inherited app and plugin grants', () => {
    const config = buildRestrictedRuntimeMcpConfig(
      { command: 'node', args: [], connections },
      'token',
      ['clio', 'github', 'agent-teams-control'],
      ['notes@local', 'browser@local'],
      'member',
      ['outlook', 'gmail'],
      readConfiguredAppToolNames({
        config: { apps: { outlook: { tools: { send_email: { enabled: true } } } } },
      })
    );
    expect(config).toMatchObject({
      features: { apps: true, plugins: true, remote_plugin: true },
      mcp_servers: {
        clio: {
          enabled: true,
          enabled_tools: ['auth_status'],
          env: { READ_ONLY: 'true' },
          default_tools_approval_mode: 'prompt',
        },
        github: { enabled: false },
        'agent-teams-control': { enabled: false },
      },
      plugins: {
        'browser@local': { enabled: false },
        'notes@local': {
          enabled: true,
          mcp_servers: { notes: { enabled: true, enabled_tools: ['search'] } },
        },
      },
      apps: {
        _default: { enabled: false },
        gmail: { enabled: false },
        outlook: {
          enabled: true,
          default_tools_enabled: false,
          destructive_enabled: false,
          tools: {
            get_profile: { enabled: true, approval_mode: 'approve' },
            send_email: { enabled: false, approval_mode: 'prompt' },
          },
        },
      },
    });
  });

  it('accepts selected tools and rejects additional servers, writes, and bridge changes', () => {
    const selected = [
      runtime,
      { name: 'clio', tools: { auth_status: {} } },
      { name: 'plugin_notes_notes', tools: { search: {} } },
      {
        name: 'codex_apps',
        tools: {
          'outlook.get_profile': {
            annotations: { readOnlyHint: true },
            _meta: { connector_id: 'outlook', link_owner_profile: { email: 'pilot@example.test' } },
          },
          'gmail.send_email': { _meta: { connector_id: 'gmail' } },
        },
      },
    ];
    expect(() =>
      assertRestrictedRuntimeMcpInventory({ data: selected }, 'member', connections)
    ).not.toThrow();
    for (const extra of [
      { name: 'clio', tools: { create_time_entry: {} } },
      { name: 'plugin_notes_notes', tools: { delete_note: {} } },
      { name: 'agent-teams-control', tools: { assignment_accept: {} } },
    ]) {
      expect(() =>
        assertRestrictedRuntimeMcpInventory({ data: [runtime, extra] }, 'member', connections)
      ).toThrow('leaked capabilities');
    }
    expect(() =>
      assertRestrictedRuntimeMcpInventory(
        { data: [{ ...runtime, tools: { ...runtime.tools, approval_respond: {} } }] },
        'member',
        connections
      )
    ).toThrow('leaked tools');
    expect(() =>
      assertRestrictedRuntimeMcpInventory(
        {
          data: [
            runtime,
            {
              name: 'codex_apps',
              tools: {
                'outlook.get_profile': {
                  annotations: { readOnlyHint: true },
                  _meta: {
                    connector_id: 'outlook',
                    link_owner_profile: { email: 'other@example.test' },
                  },
                },
              },
            },
          ],
        },
        'member',
        connections
      )
    ).toThrow('account does not match');
    expect(() =>
      assertRestrictedRuntimeMcpInventory(
        {
          data: [
            runtime,
            {
              name: 'codex_apps',
              tools: {
                'outlook.get_profile': {
                  annotations: { readOnlyHint: false },
                  _meta: { connector_id: 'outlook' },
                },
              },
            },
          ],
        },
        'member',
        connections
      )
    ).toThrow('not read-only');
  });

  it('checks effective callable apps separately from the raw hosted tool catalog', () => {
    expect(() =>
      assertRuntimeAppInventory(
        {
          apps: [
            { id: 'outlook', enabled: true, callable: true },
            { id: 'gmail', enabled: false, callable: false },
          ],
        },
        connections
      )
    ).not.toThrow();
    expect(() =>
      assertRuntimeAppInventory(
        {
          apps: [
            { id: 'outlook', enabled: true, callable: true },
            { id: 'gmail', enabled: true, callable: true },
          ],
        },
        connections
      )
    ).toThrow('unselected app');
    expect(() =>
      assertRuntimeAppInventory(
        { apps: [{ id: 'outlook', enabled: true, callable: false }] },
        connections
      )
    ).toThrow('not callable');
  });

  it('does not enable absent MCP definitions or let a policy replace the coordination servers', () => {
    expect(() =>
      buildRestrictedRuntimeMcpConfig({ command: 'node', args: [], connections }, 'token', [])
    ).toThrow('not configured');
    expect(() =>
      runtimeConnectionPolicySchema.parse({ mcpServers: { 'agent-teams-control': {} } })
    ).toThrow('Reserved');
    expect(() =>
      runtimeConnectionPolicySchema.parse({ mcpServers: { 'agent-teams-runtime': {} } })
    ).toThrow('Reserved');
    expect(() =>
      runtimeConnectionPolicySchema.parse({ apps: { outlook: { enabledTools: [] } } })
    ).toThrow();
  });

  it('requires a private configuration file and rejects accidental unknown options', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-teams-connections-'));
    const file = join(dir, 'connections.json');
    await writeFile(file, JSON.stringify(connections), { mode: 0o600 });
    await expect(readRuntimeConnectionPolicy(file)).resolves.toEqual(connections);
    if (process.platform !== 'win32') {
      await chmod(file, 0o644);
      await expect(readRuntimeConnectionPolicy(file)).rejects.toThrow('owner-only');
    }
    expect(() => runtimeConnectionPolicySchema.parse({ allowEverything: true })).toThrow();
  });
});
