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
  type CodexAppServerNotification,
  type CodexAppServerSessionClosed,
  LEAD_RUNTIME_BRIDGE_TOOL_NAMES,
  requestWorkerControl,
  RUNTIME_BRIDGE_TOOL_NAMES,
  startAgentTeamsWorker,
  type WorkerCodexAppServerSession,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

class LeadCodexSession implements WorkerCodexAppServerSession {
  readonly requests: Array<{ method: string; params: unknown }> = [];

  request = async <T>(method: string, params?: unknown): Promise<T> => {
    this.requests.push({ method, params });
    if (method === 'config/read') return { config: { mcp_servers: {} } } as T;
    if (method === 'thread/start') {
      return { thread: { id: '00000000-0000-7000-8000-000000000021' } } as T;
    }
    if (method === 'mcpServerStatus/list') {
      const names = [...RUNTIME_BRIDGE_TOOL_NAMES, ...LEAD_RUNTIME_BRIDGE_TOOL_NAMES];
      return {
        data: [
          {
            name: 'agent-teams-runtime',
            tools: Object.fromEntries(names.map((name) => [name, {}])),
          },
        ],
        nextCursor: null,
      } as T;
    }
    if (method === 'turn/start') {
      return {
        turn: { id: '00000000-0000-7000-8000-000000000022', status: 'inProgress' },
      } as T;
    }
    return {} as T;
  };

  notify = (): void => undefined;
  onNotification = (_listener: (notification: CodexAppServerNotification) => void) => () =>
    undefined;
  onRequest = () => () => undefined;
  respondToRequest = (): void => undefined;
  onClose = (_listener: (event: CodexAppServerSessionClosed) => void) => () => undefined;
  close = async (): Promise<void> => undefined;
}

describe('dynamic distributed team membership', () => {
  it('lets an authenticated lead runtime join and remove a connected teammate', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-dynamic-membership-'));
    const organizationId = organizationIdSchema.parse(
      '00000000-0000-4000-8000-000000000001'
    );
    const teamId = teamIdSchema.parse('00000000-0000-4000-8000-000000000002');
    const leadNodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000003');
    const candidateNodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000004');
    const leadMembershipId = membershipIdSchema.parse(
      '00000000-0000-4000-8000-000000000005'
    );
    const leadWorkspaceId = workspaceIdSchema.parse(
      '00000000-0000-4000-8000-000000000006'
    );
    const leadAssignmentId = '00000000-0000-4000-8000-000000000007';
    const controlSocketPath = join(dataRoot, 'lead', 'control.sock');
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 2_000,
    });
    const codex = new LeadCodexSession();
    const lead = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'lead'),
      organizationId,
      personId: personIdSchema.parse('00000000-0000-4000-8000-000000000008'),
      nodeId: leadNodeId,
      workerInstanceId: workerInstanceIdSchema.parse(
        '00000000-0000-4000-8000-000000000009'
      ),
      workerGeneration: 1,
      label: 'Lead PC',
      controlSocketPath,
      leaseSweepIntervalMs: 10,
      codexRuntime: {
        cwd: join(dataRoot, 'lead-workspace'),
        sessionFactory: { open: async () => codex },
        runtimeMcp: {
          command: process.execPath,
          args: ['/fixture/runtimeMcpCli.js', '--socket', controlSocketPath],
        },
      },
    });
    const candidateOptions = {
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'candidate'),
      organizationId,
      personId: personIdSchema.parse('00000000-0000-4000-8000-000000000010'),
      nodeId: candidateNodeId,
      workerInstanceId: workerInstanceIdSchema.parse(
        '00000000-0000-4000-8000-000000000011'
      ),
      workerGeneration: 1,
      label: 'Teammate PC',
      leaseSweepIntervalMs: 10,
    } as const;
    let candidate = await startAgentTeamsWorker(candidateOptions);

    try {
      await Promise.all([lead.ready, candidate.ready]);
      relay.enqueueCommand(
        commandEnvelopeSchema.parse({
          protocolVersion: 2,
          commandId: '00000000-0000-4000-8000-000000000012',
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
            title: 'Manage the dynamic team',
          },
        })
      );
      await vi.waitFor(() => expect(lead.listAssignments()).toHaveLength(1));
      lead.acceptAssignment({ assignmentId: leadAssignmentId, expectedRevision: 0 });
      await vi.waitFor(() =>
        expect(lead.listAssignments()[0]).toMatchObject({ state: 'running', teamRole: 'lead' })
      );

      const threadStart = codex.requests.find(({ method }) => method === 'thread/start')
        ?.params as Record<string, unknown>;
      const servers = (threadStart.config as Record<string, unknown>).mcp_servers as Record<
        string,
        Record<string, unknown>
      >;
      const runtimeServer = servers['agent-teams-runtime']!;
      expect(runtimeServer.enabled_tools).toEqual([
        ...RUNTIME_BRIDGE_TOOL_NAMES,
        ...LEAD_RUNTIME_BRIDGE_TOOL_NAMES,
      ]);
      const token = (runtimeServer.env as Record<string, string>)
        .AGENT_TEAMS_RUNTIME_SESSION_TOKEN;

      const joinResult = await requestWorkerControl<{
        event: { envelope: { type: string } };
      }>(controlSocketPath, '/v2/runtime-tools/team_member_join', {
        method: 'POST',
        bearerToken: token,
        body: {
          idempotencyKey: 'join-teammate',
          arguments: { targetNodeId: candidateNodeId, title: 'Report to the lead' },
        },
      });
      expect(joinResult.event.envelope.type).toBe('team.member.join_requested');
      await vi.waitFor(() =>
        expect({
          workerState: lead.getStatus().state,
          joinEvent: lead
            .listOutboxEvents()
            .find(({ envelope }) => envelope.type === 'team.member.join_requested'),
          relayAccepted: relay
            .listEvents()
            .some(({ envelope }) => envelope.type === 'team.member.join_requested'),
        }).toMatchObject({
          workerState: 'connected',
          joinEvent: { acknowledgedAt: expect.any(String) },
          relayAccepted: true,
        })
      );
      await vi.waitFor(() => {
        expect(relay.listMembershipRoutes()).toEqual([
          expect.objectContaining({ membershipId: leadMembershipId, role: 'lead', status: 'active' }),
          expect.objectContaining({ nodeId: candidateNodeId, role: 'member', status: 'active' }),
        ]);
        expect(candidate.listAssignments()).toEqual([
          expect.objectContaining({ title: 'Report to the lead', state: 'leased' }),
        ]);
      });
      const teammateMembership = relay
        .listMembershipRoutes()
        .find((membership) => membership.nodeId === candidateNodeId)!;
      await vi.waitFor(() => {
        expect(lead.listTeamMemberships()[0]?.members).toEqual([
          expect.objectContaining({ label: 'Lead PC', role: 'lead' }),
          expect.objectContaining({ label: 'Teammate PC', role: 'member' }),
        ]);
      });

      const listed = await requestWorkerControl<{
        team: { members: Array<{ membershipId: string }> };
      }>(controlSocketPath, '/v2/runtime-tools/team_membership_list', {
        method: 'POST',
        bearerToken: token,
        body: { idempotencyKey: 'list-team', arguments: {} },
      });
      expect(listed.team.members.map(({ membershipId }) => membershipId)).toContain(
        teammateMembership.membershipId
      );

      await requestWorkerControl(controlSocketPath, '/v2/runtime-tools/team_member_leave', {
        method: 'POST',
        bearerToken: token,
        body: {
          idempotencyKey: 'remove-teammate',
          arguments: {
            targetMembershipId: teammateMembership.membershipId,
            reason: 'capacity_changed',
          },
        },
      });
      await vi.waitFor(() => {
        expect(
          relay
            .listMembershipRoutes()
            .find((membership) => membership.membershipId === teammateMembership.membershipId)
        ).toMatchObject({ status: 'left', revision: 2 });
        expect(candidate.listAssignments()[0]).toMatchObject({ state: 'fenced' });
        expect(lead.listTeamMemberships()[0]?.members).toHaveLength(1);
      });

      await requestWorkerControl(controlSocketPath, '/v2/runtime-tools/team_member_join', {
        method: 'POST',
        bearerToken: token,
        body: {
          idempotencyKey: 'rejoin-teammate',
          arguments: { targetNodeId: candidateNodeId, title: 'Prepare to lead the team' },
        },
      });
      await vi.waitFor(() => {
        expect(candidate.listAssignments()).toEqual([
          expect.objectContaining({ state: 'fenced', teamRole: 'member' }),
          expect.objectContaining({ state: 'leased', teamRole: 'member' }),
        ]);
      });
      const successorMembership = relay
        .listMembershipRoutes()
        .find(
          (route) => route.nodeId === candidateNodeId && route.status === 'active'
        )!;

      await candidate.stop();
      candidate = await startAgentTeamsWorker({ ...candidateOptions, workerGeneration: 2 });
      await candidate.ready;
      await vi.waitFor(
        () => {
          expect(candidate.listAssignments()).toEqual([
            expect.objectContaining({ state: 'fenced', teamRole: 'member' }),
            expect.objectContaining({ state: 'fenced', teamRole: 'member' }),
            expect.objectContaining({ state: 'leased', teamRole: 'member' }),
          ]);
        },
        { timeout: 3_000 }
      );

      await requestWorkerControl(controlSocketPath, '/v2/runtime-tools/team_leave', {
        method: 'POST',
        bearerToken: token,
        body: {
          idempotencyKey: 'lead-handoff',
          arguments: {
            successorMembershipId: successorMembership.membershipId,
            reason: 'handoff_test',
          },
        },
      });
      await vi.waitFor(
        () => {
          expect(relay.listMembershipRoutes()).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                membershipId: leadMembershipId,
                status: 'left',
              }),
              expect.objectContaining({
                membershipId: successorMembership.membershipId,
                role: 'lead',
                status: 'active',
              }),
            ])
          );
          expect(lead.listAssignments()[0]).toMatchObject({ state: 'fenced' });
          expect(candidate.listAssignments()).toEqual([
            expect.objectContaining({ state: 'fenced', teamRole: 'member' }),
            expect.objectContaining({ state: 'fenced', teamRole: 'member' }),
            expect.objectContaining({ state: 'fenced', teamRole: 'member' }),
            expect.objectContaining({ state: 'leased', teamRole: 'lead' }),
          ]);
          expect(candidate.listTeamMemberships()[0]?.members).toEqual([
            expect.objectContaining({
              membershipId: successorMembership.membershipId,
              role: 'lead',
            }),
          ]);
        },
        { timeout: 3_000 }
      );
    } finally {
      await candidate.stop();
      await lead.stop();
      await relay.close();
    }
  });
});
