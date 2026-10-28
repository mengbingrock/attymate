// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  assertMembershipMcpInventory,
  DESKTOP_TEAM_TOOLS,
} from '../../../../packages/agent-teams-worker/src/membershipMcpProfile';

import type { WorkerCodexAppServerSession } from '../../../../packages/agent-teams-worker/src/codexAppServerClient';

describe('membership MCP inventory', () => {
  const bridge = () => ({
    name: 'agent-teams-runtime',
    tools: Object.fromEntries(DESKTOP_TEAM_TOOLS.map((name) => [name, {}])),
  });
  const check = (response: unknown) =>
    assertMembershipMcpInventory(
      { request: async () => response } as unknown as WorkerCodexAppServerSession,
      'thread'
    );
  it('allows only membership tools with disabled inherited servers', async () => {
    await expect(
      check({
        data: [
          bridge(),
          { name: 'agent_teams_control_other', tools: {}, resources: [], resourceTemplates: [] },
        ],
      })
    ).resolves.toBeUndefined();
  });
  it.each([
    { data: [bridge(), { name: 'agent-teams-control', tools: { task_create: {} } }] },
    { data: [bridge(), { name: 'personal', tools: {}, resources: [{}] }] },
    { data: [bridge(), { name: 'personal', tools: {}, resourceTemplates: [{}] }] },
    { data: [{ name: 'agent-teams-runtime', tools: { ...bridge().tools, review_approve: {} } }] },
    { data: [bridge(), bridge()] },
    { data: [bridge()], nextCursor: 'more' },
    { data: [] },
  ])('rejects leaked, incomplete, or ambiguous inventory %j', async (response) => {
    await expect(check(response)).rejects.toThrow();
  });
});
