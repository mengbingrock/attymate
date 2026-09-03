import {
  authorizeWorkerToolInvocation,
  filterMcpToolsForSession,
  RuntimeAuthorityArgumentError,
} from '@claude-teams/agent-teams-worker';

const runtimeContext = {
  protocolVersion: 2,
  coordinationMode: 'lan_relay_v2',
  profile: 'agent-teams-runtime',
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
  leaseEpoch: 11,
} as const;

describe('headless Worker MCP session gateway', () => {
  it('removes control and manager tools from runtime discovery', () => {
    const definitions = [
      { name: 'progress_report', description: 'Report progress' },
      { name: 'approval_respond', description: 'Answer approval' },
      { name: 'team_launch', description: 'Launch a team' },
    ];

    expect(filterMcpToolsForSession(runtimeContext, definitions)).toEqual([
      definitions[0],
    ]);
  });

  it('injects execution identity from the Worker session', () => {
    const invocation = authorizeWorkerToolInvocation(runtimeContext, 'progress_report', {
      summary: 'Tests are running',
    });

    expect(invocation.runtimeBinding).toMatchObject({
      assignmentId: runtimeContext.assignmentId,
      attemptId: runtimeContext.attemptId,
      leaseEpoch: 11,
      teamId: runtimeContext.teamId,
    });
  });

  it('rejects model-supplied runtime authority fields', () => {
    expect(() =>
      authorizeWorkerToolInvocation(runtimeContext, 'progress_report', {
        summary: 'spoofed',
        leaseEpoch: 12,
      })
    ).toThrow(RuntimeAuthorityArgumentError);
  });

  it('only exposes and authorizes team management tools for the lead runtime', () => {
    const definitions = [
      { name: 'progress_report' },
      { name: 'team_membership_list' },
      { name: 'team_member_join' },
      { name: 'team_member_leave' },
    ];

    expect(filterMcpToolsForSession({ ...runtimeContext, teamRole: 'member' }, definitions)).toEqual([
      definitions[0],
    ]);
    expect(() =>
      authorizeWorkerToolInvocation(
        { ...runtimeContext, teamRole: 'member' },
        'team_member_join',
        { targetNodeId: '00000000-0000-4000-8000-000000000011' }
      )
    ).toThrow('cannot invoke team_member_join');

    expect(filterMcpToolsForSession({ ...runtimeContext, teamRole: 'lead' }, definitions)).toEqual(
      definitions
    );
    expect(
      authorizeWorkerToolInvocation(
        { ...runtimeContext, teamRole: 'lead' },
        'team_member_join',
        { targetNodeId: '00000000-0000-4000-8000-000000000011' }
      ).toolName
    ).toBe('team_member_join');
  });
});
