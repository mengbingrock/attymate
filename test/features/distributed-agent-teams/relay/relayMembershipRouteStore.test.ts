// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RelayMembershipRouteStore } from '@claude-teams/agent-teams-relay';
import { describe, expect, it } from 'vitest';

const ids = {
  teamId: '00000000-0000-4000-8000-000000000001',
  leadMembershipId: '00000000-0000-4000-8000-000000000002',
  leadNodeId: '00000000-0000-4000-8000-000000000003',
  leadWorkspaceId: '00000000-0000-4000-8000-000000000004',
  memberMembershipId: '00000000-0000-4000-8000-000000000005',
  memberNodeId: '00000000-0000-4000-8000-000000000006',
  memberWorkspaceId: '00000000-0000-4000-8000-000000000007',
} as const;

describe('RelayMembershipRouteStore', () => {
  it('maintains one lead while members join, leave, and transfer leadership', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-memberships-'));
    const store = new RelayMembershipRouteStore(dataDir);
    try {
      const lead = store.register({
        membershipId: ids.leadMembershipId,
        teamId: ids.teamId,
        nodeId: ids.leadNodeId,
        workspaceId: ids.leadWorkspaceId,
        label: 'Lead PC',
      });
      const member = store.register({
        membershipId: ids.memberMembershipId,
        teamId: ids.teamId,
        nodeId: ids.memberNodeId,
        workspaceId: ids.memberWorkspaceId,
        label: 'Teammate PC',
      });

      expect(lead).toMatchObject({ role: 'lead', status: 'active', revision: 1 });
      expect(member).toMatchObject({ role: 'member', status: 'active', revision: 1 });
      expect(store.listActiveForTeam(ids.teamId)).toHaveLength(2);
      expect(() =>
        store.leave({ teamId: ids.teamId, membershipId: ids.leadMembershipId })
      ).toThrow('requires a successorMembershipId');

      const departedLead = store.leave({
        teamId: ids.teamId,
        membershipId: ids.leadMembershipId,
        expectedRevision: 1,
        successorMembershipId: ids.memberMembershipId,
      });

      expect(departedLead).toMatchObject({ status: 'left', role: 'lead', revision: 2 });
      expect(store.activeLead(ids.teamId)).toMatchObject({
        membershipId: ids.memberMembershipId,
        role: 'lead',
        revision: 2,
      });
      expect(store.listActiveForTeam(ids.teamId)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('rejects a second active membership for one team and Worker node', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-membership-node-'));
    const store = new RelayMembershipRouteStore(dataDir);
    try {
      store.register({
        membershipId: ids.leadMembershipId,
        teamId: ids.teamId,
        nodeId: ids.leadNodeId,
        workspaceId: ids.leadWorkspaceId,
      });
      expect(() =>
        store.register({
          membershipId: ids.memberMembershipId,
          teamId: ids.teamId,
          nodeId: ids.leadNodeId,
          workspaceId: ids.memberWorkspaceId,
        })
      ).toThrow('already an active member');
    } finally {
      store.close();
    }
  });
});
