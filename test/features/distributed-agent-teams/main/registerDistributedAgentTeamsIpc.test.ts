import {
  DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT,
  DISTRIBUTED_AGENT_TEAMS_GET_ASSIGNMENT_EVENTS,
  DISTRIBUTED_AGENT_TEAMS_GET_DEBUG_SNAPSHOT,
  DISTRIBUTED_AGENT_TEAMS_GET_RUNTIME_SESSION,
  DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY,
  DISTRIBUTED_AGENT_TEAMS_JOIN_TEAM_MEMBER,
  DISTRIBUTED_AGENT_TEAMS_LEAVE_TEAM_MEMBER,
  DISTRIBUTED_AGENT_TEAMS_RECONNECT_LEAD,
  DISTRIBUTED_AGENT_TEAMS_SEND_RUNTIME_CONTROL,
  DISTRIBUTED_AGENT_TEAMS_START_TEAM,
} from '@features/distributed-agent-teams/contracts';
import {
  registerDistributedAgentTeamsIpc,
  removeDistributedAgentTeamsIpc,
} from '@features/distributed-agent-teams/main';
import { describe, expect, it, vi } from 'vitest';

import type { DistributedAgentTeamsFeatureFacade } from '@features/distributed-agent-teams/main';
import type { IpcMain } from 'electron';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const ASSIGNMENT_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const MEMBERSHIP_ID = '55555555-5555-4555-8555-555555555555';

type IpcHandler = (event: unknown, input?: unknown) => unknown;

const createHarness = () => {
  const handlers = new Map<string, IpcHandler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  };
  const feature: DistributedAgentTeamsFeatureFacade = {
    getTopology: vi.fn(async () => ({
      relayUrl: 'http://127.0.0.1:43170',
      insecureLanMode: true as const,
      workers: [],
      fetchedAt: '2026-08-14T10:00:00.000Z',
      degraded: false,
    })),
    getAssignmentEvents: vi.fn(async () => ({
      events: [],
      fetchedAt: '2026-08-14T10:00:00.000Z',
      degraded: false,
    })),
    getDebugSnapshot: vi.fn(async () => ({
      relayUrl: 'http://127.0.0.1:43170',
      commands: [],
      events: [],
      leases: [],
      membershipRoutes: [],
      fetchedAt: '2026-08-14T10:00:00.000Z',
      degraded: false,
    })),
    getRuntimeSession: vi.fn(async (request) => ({
      sessionId: '22222222-2222-4222-8222-222222222220',
      scope: { ...request, leaseId: '22222222-2222-4222-8222-222222222221' },
      capabilities: ['events.read' as const],
      expiresAt: '2026-08-14T10:05:00.000Z',
      events: [],
      truncated: false,
      nextCursor: 0,
    })),
    sendRuntimeControl: vi.fn(async (request) => ({
      controlId: request.control.controlId,
      accepted: true as const,
    })),
    createRemoteAssignment: vi.fn(async (request) => ({
      commandId: '22222222-2222-4222-8222-222222222222',
      targetNodeId: request.targetNodeId,
      cursor: 1,
      status: 'pending' as const,
      createdAt: '2026-08-14T10:00:00.000Z',
    })),
    startTeam: vi.fn(async (request) => ({
      teamId: request.teamId,
      status: 'starting' as const,
      assignmentCommandIds: [],
      requestedAt: '2026-08-14T10:00:00.000Z',
    })),
    reconnectLead: vi.fn(async (request) => ({
      teamId: request.teamId,
      nodeId: NODE_ID,
      status: 'started' as const,
      requestedAt: '2026-08-14T10:00:00.000Z',
    })),
    joinTeamMember: vi.fn(async (request) => ({
      membership: {
        membershipId: MEMBERSHIP_ID,
        teamId: request.teamId,
        nodeId: request.targetNodeId,
        workspaceId: '66666666-6666-4666-8666-666666666666',
        label: 'Remote member',
        role: request.role ?? ('member' as const),
        status: 'active' as const,
        revision: 1,
        createdAt: '2026-08-14T10:00:00.000Z',
        updatedAt: '2026-08-14T10:00:00.000Z',
      },
      assignmentId: ASSIGNMENT_ID,
      commandIds: [],
    })),
    leaveTeamMember: vi.fn(async (request) => ({
      membership: {
        membershipId: request.membershipId,
        teamId: request.teamId,
        nodeId: NODE_ID,
        workspaceId: '66666666-6666-4666-8666-666666666666',
        label: 'Remote member',
        role: 'member' as const,
        status: 'left' as const,
        revision: request.expectedRevision ?? 2,
        createdAt: '2026-08-14T10:00:00.000Z',
        updatedAt: '2026-08-14T10:01:00.000Z',
      },
      releasedAssignmentIds: [],
    })),
  };
  return { feature, handlers, ipcMain: ipcMain as unknown as IpcMain };
};

describe('distributed Agent Teams IPC', () => {
  it('registers topology and assignment handlers with boundary normalization', async () => {
    const { feature, handlers, ipcMain } = createHarness();
    registerDistributedAgentTeamsIpc(ipcMain, feature);

    await expect(handlers.get(DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY)?.({})).resolves.toMatchObject({
      degraded: false,
    });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_GET_ASSIGNMENT_EVENTS)?.({})
    ).resolves.toMatchObject({ events: [], degraded: false });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_GET_DEBUG_SNAPSHOT)?.({})
    ).resolves.toMatchObject({ commands: [], events: [], degraded: false });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_GET_RUNTIME_SESSION)?.(
        {},
        {
          teamId: TEAM_ID.toUpperCase(),
          nodeId: NODE_ID.toUpperCase(),
          assignmentId: ASSIGNMENT_ID.toUpperCase(),
          attemptId: ATTEMPT_ID.toUpperCase(),
          leaseEpoch: 1,
          afterCursor: 4,
        }
      )
    ).resolves.toMatchObject({ nextCursor: 0 });
    expect(feature.getRuntimeSession).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      nodeId: NODE_ID,
      assignmentId: ASSIGNMENT_ID,
      attemptId: ATTEMPT_ID,
      leaseEpoch: 1,
      afterCursor: 4,
    });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_SEND_RUNTIME_CONTROL)?.(
        {},
        {
          session: {
            teamId: TEAM_ID,
            nodeId: NODE_ID,
            assignmentId: ASSIGNMENT_ID,
            attemptId: ATTEMPT_ID,
            leaseEpoch: 1,
          },
          control: {
            controlId: '55555555-5555-4555-8555-555555555555',
            type: 'turn.interrupt',
            payload: { reason: 'user_requested' },
          },
        }
      )
    ).resolves.toMatchObject({ accepted: true });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT)?.(
        {},
        { targetNodeId: NODE_ID.toUpperCase(), title: '  Remote review  ' }
      )
    ).resolves.toMatchObject({ targetNodeId: NODE_ID });
    expect(feature.createRemoteAssignment).toHaveBeenCalledWith({
      targetNodeId: NODE_ID,
      title: 'Remote review',
    });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_START_TEAM)?.({}, { teamId: TEAM_ID.toUpperCase() })
    ).resolves.toMatchObject({ teamId: TEAM_ID });
    expect(feature.startTeam).toHaveBeenCalledWith({ teamId: TEAM_ID });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_RECONNECT_LEAD)?.(
        {},
        { teamId: TEAM_ID.toUpperCase() }
      )
    ).resolves.toMatchObject({ teamId: TEAM_ID, status: 'started' });
    expect(feature.reconnectLead).toHaveBeenCalledWith({ teamId: TEAM_ID });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_JOIN_TEAM_MEMBER)?.(
        {},
        { teamId: TEAM_ID.toUpperCase(), targetNodeId: NODE_ID.toUpperCase() }
      )
    ).resolves.toMatchObject({ assignmentId: ASSIGNMENT_ID });
    expect(feature.joinTeamMember).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      targetNodeId: NODE_ID,
    });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_LEAVE_TEAM_MEMBER)?.(
        {},
        { teamId: TEAM_ID, membershipId: MEMBERSHIP_ID, expectedRevision: 1 }
      )
    ).resolves.toMatchObject({ membership: { status: 'left' } });
    expect(feature.leaveTeamMember).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      membershipId: MEMBERSHIP_ID,
      expectedRevision: 1,
    });
  });

  it('rejects malformed renderer input before invoking the feature', () => {
    const { feature, handlers, ipcMain } = createHarness();
    registerDistributedAgentTeamsIpc(ipcMain, feature);

    expect(() =>
      handlers.get(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT)?.(
        {},
        { targetNodeId: '../x', title: '' }
      )
    ).toThrow();
    expect(feature.createRemoteAssignment).not.toHaveBeenCalled();
  });

  it('removes only its ten handlers', () => {
    const { feature, handlers, ipcMain } = createHarness();
    registerDistributedAgentTeamsIpc(ipcMain, feature);
    handlers.set('unrelated', vi.fn());

    removeDistributedAgentTeamsIpc(ipcMain);

    expect([...handlers.keys()]).toEqual(['unrelated']);
  });
});
