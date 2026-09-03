// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commandEnvelopeSchema } from '@claude-teams/agent-teams-protocol';
import {
  type WorkerInboxCommand,
  WorkerTeamMembershipStore,
} from '@claude-teams/agent-teams-worker';

const teamId = '00000000-0000-4000-8000-000000000001';
const nodeId = '00000000-0000-4000-8000-000000000002';
const membershipId = '00000000-0000-4000-8000-000000000003';
const workspaceId = '00000000-0000-4000-8000-000000000004';

const snapshotCommand = (
  cursor: number,
  generatedAt: string,
  label: string
): WorkerInboxCommand => ({
  cursor,
  commandId: commandEnvelopeSchema.parse({
    protocolVersion: 2,
    commandId: `00000000-0000-4000-8000-${String(cursor).padStart(12, '0')}`,
    sequence: cursor,
    teamId,
    targetNodeId: nodeId,
    type: 'team.membership.snapshot',
    payload: {
      teamId,
      members: [
        {
          membershipId,
          teamId,
          nodeId,
          workspaceId,
          label,
          role: 'lead',
          status: 'active',
          revision: cursor,
          joinedAt: '2026-09-03T00:00:00.000Z',
          updatedAt: generatedAt,
        },
      ],
      generatedAt,
    },
  }).commandId,
  envelope: commandEnvelopeSchema.parse({
    protocolVersion: 2,
    commandId: `00000000-0000-4000-8000-${String(cursor).padStart(12, '0')}`,
    sequence: cursor,
    teamId,
    targetNodeId: nodeId,
    type: 'team.membership.snapshot',
    payload: {
      teamId,
      members: [
        {
          membershipId,
          teamId,
          nodeId,
          workspaceId,
          label,
          role: 'lead',
          status: 'active',
          revision: cursor,
          joinedAt: '2026-09-03T00:00:00.000Z',
          updatedAt: generatedAt,
        },
      ],
      generatedAt,
    },
  }),
  receivedAt: new Date(Date.parse(generatedAt) + 1_000).toISOString(),
});

describe('WorkerTeamMembershipStore', () => {
  it('persists the newest roster and ignores an older replay', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-roster-store-'));
    const store = new WorkerTeamMembershipStore(dataDir);

    try {
      store.accept(snapshotCommand(2, '2026-09-03T00:02:00.000Z', 'Current lead'));
      store.accept(snapshotCommand(1, '2026-09-03T00:01:00.000Z', 'Stale lead'));

      expect(store.get(teamId)).toMatchObject({
        generatedAt: '2026-09-03T00:02:00.000Z',
        members: [{ label: 'Current lead', role: 'lead', status: 'active' }],
      });
      expect(store.list()).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
