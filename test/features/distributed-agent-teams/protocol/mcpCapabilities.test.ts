import {
  assertSessionCanInvokeTool,
  canProfileInvokeTool,
  isInternalProtocolOperation,
  listToolsForProfile,
  McpCapabilityError,
  mcpSessionContextSchema,
} from '@claude-teams/agent-teams-protocol';

const ids = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  nodeId: '00000000-0000-4000-8000-000000000003',
  workerInstanceId: '00000000-0000-4000-8000-000000000004',
  teamId: '00000000-0000-4000-8000-000000000005',
  membershipId: '00000000-0000-4000-8000-000000000006',
  assignmentId: '00000000-0000-4000-8000-000000000007',
  attemptId: '00000000-0000-4000-8000-000000000008',
  workspaceId: '00000000-0000-4000-8000-000000000009',
  turnId: '00000000-0000-4000-8000-000000000010',
};

describe('distributed MCP capability profiles', () => {
  it('fails closed when a runtime session invokes owner or manager tools', () => {
    const runtime = mcpSessionContextSchema.parse({
      protocolVersion: 2,
      coordinationMode: 'lan_relay_v2',
      profile: 'agent-teams-runtime',
      ...ids,
      leaseEpoch: 3,
    });

    expect(() => assertSessionCanInvokeTool(runtime, 'progress_report')).not.toThrow();

    for (const forbidden of [
      'approval_respond',
      'worker_policy_update',
      'worker_restart',
      'team_launch',
      'team_placement_update',
    ]) {
      expect(() => assertSessionCanInvokeTool(runtime, forbidden)).toThrow(McpCapabilityError);
    }
  });

  it('keeps manager lifecycle tools out of teammate control sessions', () => {
    expect(canProfileInvokeTool('agent-teams-control', 'approval_respond')).toBe(true);
    expect(canProfileInvokeTool('agent-teams-control', 'message_mark_read')).toBe(true);
    expect(canProfileInvokeTool('agent-teams-control', 'team_launch')).toBe(false);
    expect(canProfileInvokeTool('agent-teams-manager', 'team_launch')).toBe(true);
  });

  it('does not expose worker-relay protocol operations as MCP tools', () => {
    expect(isInternalProtocolOperation('runtime_heartbeat')).toBe(true);

    for (const profile of [
      'agent-teams-control',
      'agent-teams-runtime',
      'agent-teams-manager',
    ] as const) {
      expect(listToolsForProfile(profile)).not.toContain('runtime_heartbeat');
      expect(listToolsForProfile(profile)).not.toContain('runtime_bootstrap_checkin');
    }
  });

  it('requires runtime identity to come from a complete session binding', () => {
    const result = mcpSessionContextSchema.safeParse({
      protocolVersion: 2,
      coordinationMode: 'lan_relay_v2',
      profile: 'agent-teams-runtime',
      ...ids,
      attemptId: undefined,
      leaseEpoch: 3,
    });

    expect(result.success).toBe(false);
  });
});
