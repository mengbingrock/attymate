// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commandEnvelopeSchema,
  membershipIdSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  teamIdSchema,
  workerInstanceIdSchema,
  workspaceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import {
  startAgentTeamsWorker,
  type StartedAgentTeamsWorker,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

describe('distributed team auto-discovery', () => {
  it('forms a three-member team from two Worker advertisements and respects a lead removal', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-auto-discovery-'));
    const organizationId = organizationIdSchema.parse(
      '10000000-0000-4000-8000-000000000001'
    );
    const teamId = teamIdSchema.parse('10000000-0000-4000-8000-000000000002');
    const leadNodeId = nodeIdSchema.parse('10000000-0000-4000-8000-000000000003');
    const firstMemberNodeId = nodeIdSchema.parse('10000000-0000-4000-8000-000000000004');
    const secondMemberNodeId = nodeIdSchema.parse('10000000-0000-4000-8000-000000000005');
    const leadMembershipId = membershipIdSchema.parse(
      '10000000-0000-4000-8000-000000000006'
    );
    const leadWorkspaceId = workspaceIdSchema.parse(
      '10000000-0000-4000-8000-000000000007'
    );
    const leadAssignmentId = '10000000-0000-4000-8000-000000000008';
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 2_000,
    });
    const firstMemberOptions = {
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'first-member'),
      organizationId,
      personId: personIdSchema.parse('10000000-0000-4000-8000-000000000009'),
      nodeId: firstMemberNodeId,
      workerInstanceId: workerInstanceIdSchema.parse(
        '10000000-0000-4000-8000-000000000010'
      ),
      workerGeneration: 1,
      label: 'First advertised member',
      autoJoinTeamId: teamId,
      reconnectDelayMs: 25,
      leaseSweepIntervalMs: 10,
    } as const;
    const secondMemberOptions = {
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'second-member'),
      organizationId,
      personId: personIdSchema.parse('10000000-0000-4000-8000-000000000011'),
      nodeId: secondMemberNodeId,
      workerInstanceId: workerInstanceIdSchema.parse(
        '10000000-0000-4000-8000-000000000012'
      ),
      workerGeneration: 1,
      label: 'Second advertised member',
      autoJoinTeamId: teamId,
      reconnectDelayMs: 25,
      leaseSweepIntervalMs: 10,
    } as const;
    const lead = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'lead'),
      organizationId,
      personId: personIdSchema.parse('10000000-0000-4000-8000-000000000013'),
      nodeId: leadNodeId,
      workerInstanceId: workerInstanceIdSchema.parse(
        '10000000-0000-4000-8000-000000000014'
      ),
      workerGeneration: 1,
      label: 'Lead PC',
      reconnectDelayMs: 25,
      leaseSweepIntervalMs: 10,
    });
    const firstMember = await startAgentTeamsWorker(firstMemberOptions);
    let secondMember: StartedAgentTeamsWorker = await startAgentTeamsWorker(secondMemberOptions);

    try {
      await Promise.all([lead.ready, firstMember.ready, secondMember.ready]);
      await vi.waitFor(() => expect(relay.listWorkers()).toHaveLength(3));
      expect(relay.listMembershipRoutes()).toEqual([]);

      relay.enqueueCommand(
        commandEnvelopeSchema.parse({
          protocolVersion: 2,
          commandId: '10000000-0000-4000-8000-000000000015',
          sequence: 1,
          teamId,
          targetNodeId: leadNodeId,
          assignmentId: leadAssignmentId,
          type: 'assignment.offer',
          payload: {
            assignmentId: leadAssignmentId,
            membershipId: leadMembershipId,
            workspaceId: leadWorkspaceId,
            teamRole: 'lead',
            title: 'Lead the advertised team',
          },
        })
      );

      await vi.waitFor(() => {
        const routes = relay.listMembershipRoutes();
        expect(routes).toHaveLength(3);
        expect(routes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ nodeId: leadNodeId, role: 'lead', status: 'active' }),
            expect.objectContaining({
              nodeId: firstMemberNodeId,
              role: 'member',
              status: 'active',
            }),
            expect.objectContaining({
              nodeId: secondMemberNodeId,
              role: 'member',
              status: 'active',
            }),
          ])
        );
      });
      await vi.waitFor(() => {
        expect(firstMember.listAssignments()).toEqual([
          expect.objectContaining({ teamId, teamRole: 'member', state: 'leased' }),
        ]);
        expect(secondMember.listAssignments()).toEqual([
          expect.objectContaining({ teamId, teamRole: 'member', state: 'leased' }),
        ]);
        expect(firstMember.listTeamMemberships()[0]?.members).toHaveLength(3);
        expect(secondMember.listTeamMemberships()[0]?.members).toHaveLength(3);
      });
      expect(relay.listWorkers()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeId: firstMemberNodeId, autoJoinTeamId: teamId }),
          expect.objectContaining({ nodeId: secondMemberNodeId, autoJoinTeamId: teamId }),
        ])
      );

      const originalSecondMembership = relay
        .listMembershipRoutes()
        .find((membership) => membership.nodeId === secondMemberNodeId)!;
      await secondMember.stop();
      secondMember = await startAgentTeamsWorker(secondMemberOptions);
      await secondMember.ready;
      await vi.waitFor(() => {
        const activeRoutes = relay
          .listMembershipRoutes()
          .filter((membership) => membership.status === 'active');
        expect(activeRoutes).toHaveLength(3);
        expect(
          activeRoutes.find((membership) => membership.nodeId === secondMemberNodeId)?.membershipId
        ).toBe(originalSecondMembership.membershipId);
      });

      const removed = await relay.app.inject({
        method: 'DELETE',
        url: `/v2/teams/${teamId}/members/${originalSecondMembership.membershipId}`,
        payload: { expectedRevision: originalSecondMembership.revision },
      });
      expect(removed.statusCode).toBe(200);
      await vi.waitFor(() =>
        expect(
          relay
            .listMembershipRoutes()
            .filter((membership) => membership.status === 'active')
            .map((membership) => membership.nodeId)
        ).toEqual([leadNodeId, firstMemberNodeId])
      );

      await secondMember.stop();
      secondMember = await startAgentTeamsWorker(secondMemberOptions);
      await secondMember.ready;
      await vi.waitFor(() => expect(secondMember.getStatus().lastHeartbeatSequence).toBeGreaterThan(2));
      expect(
        relay
          .listMembershipRoutes()
          .filter((membership) => membership.status === 'active')
          .map((membership) => membership.nodeId)
      ).toEqual([leadNodeId, firstMemberNodeId]);
      expect(
        relay
          .listMembershipRoutes()
          .find((membership) => membership.membershipId === originalSecondMembership.membershipId)
      ).toMatchObject({ status: 'left' });
    } finally {
      await Promise.allSettled([lead.stop(), firstMember.stop(), secondMember.stop()]);
      await relay.close();
    }
  });
});
