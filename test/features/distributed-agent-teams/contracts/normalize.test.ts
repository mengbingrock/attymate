import { normalizeCreateRemoteAssignmentRequest } from '@features/distributed-agent-teams/contracts';
import { describe, expect, it } from 'vitest';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';

describe('normalizeCreateRemoteAssignmentRequest', () => {
  it('trims user text and canonicalizes identifiers', () => {
    expect(
      normalizeCreateRemoteAssignmentRequest({
        targetNodeId: ` ${NODE_ID.toUpperCase()} `,
        teamId: ` ${TEAM_ID.toUpperCase()} `,
        membershipId: ` ${MEMBERSHIP_ID.toUpperCase()} `,
        workspaceId: ` ${WORKSPACE_ID.toUpperCase()} `,
        title: '  Review the relay adapter  ',
        description: '  Check the IPC boundary.  ',
      })
    ).toEqual({
      targetNodeId: NODE_ID,
      teamId: TEAM_ID,
      membershipId: MEMBERSHIP_ID,
      workspaceId: WORKSPACE_ID,
      title: 'Review the relay adapter',
      description: 'Check the IPC boundary.',
    });
  });

  it.each([
    null,
    [],
    { targetNodeId: 'not-a-uuid', title: 'Task' },
    { targetNodeId: NODE_ID, title: '   ' },
    { targetNodeId: NODE_ID, title: 'x'.repeat(241) },
    { targetNodeId: NODE_ID, title: 'Task', description: 42 },
    { targetNodeId: NODE_ID, title: 'Task', membershipId: MEMBERSHIP_ID },
    {
      targetNodeId: NODE_ID,
      title: 'Task',
      membershipId: MEMBERSHIP_ID,
      workspaceId: WORKSPACE_ID,
    },
  ])('rejects malformed boundary input %#', (input) => {
    expect(() => normalizeCreateRemoteAssignmentRequest(input)).toThrow();
  });
});
