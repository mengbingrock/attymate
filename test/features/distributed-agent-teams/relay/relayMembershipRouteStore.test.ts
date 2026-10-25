// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RelayMembershipRouteStore,
  RelayTeamLeaderlessError,
  RelayTeamSettingsRevisionConflictError,
} from '@claude-teams/agent-teams-relay';
import { describe, expect, it } from 'vitest';

const ids = {
  teamId: '00000000-0000-4000-8000-000000000001',
  leadMembershipId: '00000000-0000-4000-8000-000000000002',
  leadNodeId: '00000000-0000-4000-8000-000000000003',
  leadWorkspaceId: '00000000-0000-4000-8000-000000000004',
  memberMembershipId: '00000000-0000-4000-8000-000000000005',
  memberNodeId: '00000000-0000-4000-8000-000000000006',
  memberWorkspaceId: '00000000-0000-4000-8000-000000000007',
  thirdMembershipId: '00000000-0000-4000-8000-000000000008',
  thirdNodeId: '00000000-0000-4000-8000-000000000009',
  thirdWorkspaceId: '00000000-0000-4000-8000-000000000010',
} as const;

const registerThree = (store: RelayMembershipRouteStore) => [
  store.register({
    membershipId: ids.leadMembershipId,
    teamId: ids.teamId,
    nodeId: ids.leadNodeId,
    workspaceId: ids.leadWorkspaceId,
  }),
  store.register({
    membershipId: ids.memberMembershipId,
    teamId: ids.teamId,
    nodeId: ids.memberNodeId,
    workspaceId: ids.memberWorkspaceId,
  }),
  store.register({
    membershipId: ids.thirdMembershipId,
    teamId: ids.teamId,
    nodeId: ids.thirdNodeId,
    workspaceId: ids.thirdWorkspaceId,
  }),
];

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

  describe('leaderless teams', () => {
    it('defaults to led coordination until a team is configured', async () => {
      const store = new RelayMembershipRouteStore(
        await mkdtemp(join(tmpdir(), 'agent-teams-settings-default-'))
      );
      try {
        expect(store.teamSettings(ids.teamId)).toEqual({
          teamId: ids.teamId,
          coordination: 'led',
          revision: 0,
        });
        expect(store.isLeaderless(ids.teamId)).toBe(false);
        expect(store.listTeamSettings()).toEqual([]);
      } finally {
        store.close();
      }
    });

    it('joins everyone as a member, refuses a lead, and stays leaderless across a restart', async () => {
      const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-leaderless-'));
      const store = new RelayMembershipRouteStore(dataDir);
      try {
        const declared = store.setTeamCoordination({
          teamId: ids.teamId,
          coordination: 'leaderless',
          expectedRevision: 0,
        });
        expect(declared).toMatchObject({
          changed: true,
          settings: { coordination: 'leaderless', revision: 1 },
        });
        expect(declared.demoted).toBeUndefined();

        const routes = registerThree(store);
        expect(routes.map((route) => route.role)).toEqual(['member', 'member', 'member']);
        expect(store.activeLead(ids.teamId)).toBeUndefined();
        expect(() =>
          store.register({
            membershipId: '00000000-0000-4000-8000-000000000011',
            teamId: ids.teamId,
            nodeId: '00000000-0000-4000-8000-000000000012',
            workspaceId: '00000000-0000-4000-8000-000000000013',
            role: 'lead',
          })
        ).toThrow(RelayTeamLeaderlessError);

        // A member can leave without naming a successor because nobody leads.
        expect(
          store.leave({ teamId: ids.teamId, membershipId: ids.leadMembershipId })
        ).toMatchObject({ status: 'left', role: 'member' });
      } finally {
        store.close();
      }

      // Reopening the store runs the startup lead migration, which must skip leaderless teams.
      const reopened = new RelayMembershipRouteStore(dataDir);
      try {
        expect(reopened.activeLead(ids.teamId)).toBeUndefined();
        expect(reopened.listActiveForTeam(ids.teamId).map((route) => route.role)).toEqual([
          'member',
          'member',
        ]);
        expect(reopened.listTeamSettings()).toEqual([
          expect.objectContaining({ teamId: ids.teamId, coordination: 'leaderless' }),
        ]);
      } finally {
        reopened.close();
      }
    });

    it('demotes the lead when a team becomes leaderless and promotes the oldest member when it is led again', async () => {
      const store = new RelayMembershipRouteStore(
        await mkdtemp(join(tmpdir(), 'agent-teams-leaderless-switch-'))
      );
      try {
        const [lead] = registerThree(store);
        expect(lead).toMatchObject({ role: 'lead', revision: 1 });

        const toLeaderless = store.setTeamCoordination({
          teamId: ids.teamId,
          coordination: 'leaderless',
        });
        expect(toLeaderless.demoted).toMatchObject({
          membershipId: ids.leadMembershipId,
          role: 'member',
          revision: 2,
        });
        expect(store.activeLead(ids.teamId)).toBeUndefined();

        expect(
          store.setTeamCoordination({ teamId: ids.teamId, coordination: 'leaderless' })
        ).toMatchObject({ changed: false, settings: { revision: 1 } });
        expect(() =>
          store.setTeamCoordination({
            teamId: ids.teamId,
            coordination: 'led',
            expectedRevision: 0,
          })
        ).toThrow(RelayTeamSettingsRevisionConflictError);

        const toLed = store.setTeamCoordination({
          teamId: ids.teamId,
          coordination: 'led',
          expectedRevision: 1,
        });
        expect(toLed).toMatchObject({
          changed: true,
          settings: { coordination: 'led', revision: 2 },
          promoted: { membershipId: ids.leadMembershipId, role: 'lead', revision: 3 },
        });
        expect(store.activeLead(ids.teamId)?.membershipId).toBe(ids.leadMembershipId);
      } finally {
        store.close();
      }
    });
  });
});
