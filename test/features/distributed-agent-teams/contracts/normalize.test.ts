import { normalizeCreateRemoteAssignmentRequest } from '@features/distributed-agent-teams/contracts';
import { describe, expect, it } from 'vitest';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';

describe('normalizeCreateRemoteAssignmentRequest', () => {
  it('trims user text and canonicalizes identifiers', () => {
    expect(
      normalizeCreateRemoteAssignmentRequest({
        targetNodeId: ` ${NODE_ID.toUpperCase()} `,
        teamId: ` ${TEAM_ID.toUpperCase()} `,
        title: '  Review the relay adapter  ',
        description: '  Check the IPC boundary.  ',
      })
    ).toEqual({
      targetNodeId: NODE_ID,
      teamId: TEAM_ID,
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
  ])('rejects malformed boundary input %#', (input) => {
    expect(() => normalizeCreateRemoteAssignmentRequest(input)).toThrow();
  });
});
