// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  teamIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import { startAgentTeamsWorker } from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

describe('leaderless distributed team', () => {
  it('auto-joins advertised Workers as members without a lead and switches coordination both ways', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-leaderless-'));
    const organizationId = organizationIdSchema.parse('20000000-0000-4000-8000-000000000001');
    const teamId = teamIdSchema.parse('20000000-0000-4000-8000-000000000002');
    const firstNodeId = nodeIdSchema.parse('20000000-0000-4000-8000-000000000003');
    const secondNodeId = nodeIdSchema.parse('20000000-0000-4000-8000-000000000004');
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 2_000,
    });
    const workerOptions = (nodeId: string, suffix: string, label: string) =>
      ({
        relayUrl: relay.wsUrl,
        dataDir: join(dataRoot, label),
        organizationId,
        personId: personIdSchema.parse(`20000000-0000-4000-8000-0000000001${suffix}`),
        nodeId: nodeIdSchema.parse(nodeId),
        workerInstanceId: workerInstanceIdSchema.parse(
          `20000000-0000-4000-8000-0000000002${suffix}`
        ),
        workerGeneration: 1,
        label,
        autoJoinTeamId: teamId,
        reconnectDelayMs: 25,
        leaseSweepIntervalMs: 10,
      }) as const;
    const first = await startAgentTeamsWorker(workerOptions(firstNodeId, '01', 'first-peer'));
    const second = await startAgentTeamsWorker(workerOptions(secondNodeId, '02', 'second-peer'));

    try {
      await Promise.all([first.ready, second.ready]);
      await vi.waitFor(() => expect(relay.listWorkers()).toHaveLength(2));
      // A led team with no lead never auto-joins anyone.
      expect(relay.listMembershipRoutes()).toEqual([]);

      const declared = await relay.app.inject({
        method: 'PUT',
        url: `/v2/teams/${teamId}/settings`,
        payload: { coordination: 'leaderless', expectedRevision: 0 },
      });
      expect(declared.statusCode).toBe(200);
      expect(declared.json()).toMatchObject({
        changed: true,
        settings: { teamId, coordination: 'leaderless', revision: 1 },
      });

      await vi.waitFor(() => {
        const routes = relay.listMembershipRoutes();
        expect(routes).toHaveLength(2);
        expect(routes.every((route) => route.role === 'member' && route.status === 'active')).toBe(
          true
        );
      });
      await vi.waitFor(() => {
        for (const worker of [first, second]) {
          expect(worker.listAssignments()).toEqual([
            expect.objectContaining({ teamId, teamRole: 'member', state: 'leased' }),
          ]);
          expect(worker.listTeamMemberships()[0]?.members).toHaveLength(2);
        }
      });
      const offers = relay
        .listCommands()
        .filter((command) => command.envelope.type === 'assignment.offer');
      expect(
        offers.map((offer) => (offer.envelope.payload as { description?: string }).description)
      ).toEqual([
        expect.stringContaining('This team has no lead'),
        expect.stringContaining('This team has no lead'),
      ]);

      const settings = await relay.app.inject({
        method: 'GET',
        url: `/v2/teams/${teamId}/settings`,
      });
      expect(settings.json()).toMatchObject({ settings: { coordination: 'leaderless' } });
      const listed = await relay.app.inject({ method: 'GET', url: '/v2/team-settings' });
      expect(listed.json()).toEqual({ teams: [expect.objectContaining({ teamId })] });

      const leadJoin = await relay.app.inject({
        method: 'POST',
        url: `/v2/teams/${teamId}/members`,
        payload: { targetNodeId: firstNodeId, role: 'lead' },
      });
      expect(leadJoin.statusCode).toBe(409);
      expect(leadJoin.json()).toMatchObject({ code: 'RELAY_TEAM_LEADERLESS' });

      const staleSwitch = await relay.app.inject({
        method: 'PUT',
        url: `/v2/teams/${teamId}/settings`,
        payload: { coordination: 'led', expectedRevision: 0 },
      });
      expect(staleSwitch.statusCode).toBe(409);

      // Back to led: the oldest member is promoted and re-offered a lead assignment.
      const toLed = await relay.app.inject({
        method: 'PUT',
        url: `/v2/teams/${teamId}/settings`,
        payload: { coordination: 'led', expectedRevision: 1 },
      });
      expect(toLed.statusCode).toBe(200);
      const promotedMembershipId = toLed.json().promotedMembershipId as string;
      const promoted = relay
        .listMembershipRoutes()
        .find((route) => route.membershipId === promotedMembershipId)!;
      expect(promoted).toMatchObject({ role: 'lead', status: 'active' });
      const promotedWorker = promoted.nodeId === firstNodeId ? first : second;
      await vi.waitFor(() =>
        expect(promotedWorker.listAssignments()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ teamId, teamRole: 'lead', state: 'leased' }),
          ])
        )
      );

      // Leaderless again: the lead is demoted and re-offered a member assignment.
      const toLeaderless = await relay.app.inject({
        method: 'PUT',
        url: `/v2/teams/${teamId}/settings`,
        payload: { coordination: 'leaderless' },
      });
      expect(toLeaderless.json()).toMatchObject({ demotedMembershipId: promotedMembershipId });
      expect(
        relay
          .listMembershipRoutes()
          .filter((route) => route.role === 'lead' && route.status === 'active')
      ).toEqual([]);
      await vi.waitFor(() => {
        const leased = promotedWorker
          .listAssignments()
          .filter((assignment) => assignment.state === 'leased');
        expect(leased).toEqual([expect.objectContaining({ teamId, teamRole: 'member' })]);
      });
    } finally {
      await Promise.allSettled([first.stop(), second.stop()]);
      await relay.close();
    }
  });
});
