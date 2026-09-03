import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  buildDistributedTeamDetail,
  buildDistributedTeamSummaries,
  DistributedAgentTeamsView,
  DistributedTeamDetailView,
  DistributedTeamsSection,
} from '@features/distributed-agent-teams/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DistributedAssignmentEventsDto,
  DistributedDebugSnapshotDto,
  DistributedTopologyDto,
} from '@features/distributed-agent-teams/contracts';

const topology: DistributedTopologyDto = {
  relayUrl: 'http://127.0.0.1:43170',
  insecureLanMode: true,
  fetchedAt: '2026-08-24T19:00:00.000Z',
  degraded: false,
  workers: [
    {
      organizationId: 'org-attymate',
      personId: 'person-atlas',
      nodeId: 'node-atlas-coordinator',
      workerInstanceId: 'worker-atlas-instance',
      workerGeneration: 1,
      label: 'Atlas Coordinator',
      connectedAt: '2026-08-24T18:59:00.000Z',
      lastHeartbeatAt: '2026-08-24T19:00:00.000Z',
      lastHeartbeatSequence: 4,
      status: 'connected',
    },
    {
      organizationId: 'org-attymate',
      personId: 'person-beacon',
      nodeId: 'node-beacon-reviewer',
      workerInstanceId: 'worker-beacon-instance',
      workerGeneration: 1,
      label: 'Beacon Reviewer',
      connectedAt: '2026-08-24T18:59:00.000Z',
      lastHeartbeatAt: '2026-08-24T19:00:00.000Z',
      lastHeartbeatSequence: 4,
      status: 'connected',
      autoJoinTeamId: 'team-remote-ui-smoke',
    },
  ],
};

const assignmentEvents: DistributedAssignmentEventsDto = {
  fetchedAt: '2026-08-24T19:00:00.000Z',
  degraded: false,
  events: [
    {
      cursor: 1,
      eventId: 'event-1',
      assignmentId: 'assignment-atlas',
      sourceNodeId: 'node-atlas-coordinator',
      workerInstanceId: 'worker-atlas-instance',
      teamId: 'team-remote-ui-smoke',
      occurredAt: '2026-08-24T19:00:00.000Z',
      receivedAt: '2026-08-24T19:00:00.000Z',
      revision: 1,
      fromState: null,
      state: 'proposed',
      reason: 'Awaiting worker acceptance',
    },
    {
      cursor: 2,
      eventId: 'event-2',
      assignmentId: 'assignment-beacon',
      sourceNodeId: 'node-beacon-reviewer',
      workerInstanceId: 'worker-beacon-instance',
      teamId: 'team-remote-ui-smoke',
      occurredAt: '2026-08-24T19:00:01.000Z',
      receivedAt: '2026-08-24T19:00:01.000Z',
      revision: 1,
      fromState: null,
      state: 'proposed',
      reason: 'Awaiting reviewer acceptance',
    },
  ],
};

const debugSnapshot: DistributedDebugSnapshotDto = {
  relayUrl: topology.relayUrl,
  fetchedAt: '2026-08-24T19:00:02.000Z',
  degraded: false,
  commands: [
    {
      cursor: 1,
      commandId: 'command-atlas',
      targetNodeId: 'node-atlas-coordinator',
      sequence: 1,
      teamId: 'team-remote-ui-smoke',
      assignmentId: 'assignment-atlas',
      type: 'assignment.offer',
      payload: { title: 'Review manager integration', description: 'Run focused checks.' },
      status: 'acknowledged',
      createdAt: '2026-08-24T19:00:00.000Z',
      acknowledgedAt: '2026-08-24T19:00:01.000Z',
    },
  ],
  events: [
    {
      cursor: 2,
      eventId: 'message-1',
      sourceNodeId: 'node-atlas-coordinator',
      workerInstanceId: 'worker-atlas-instance',
      sequence: 2,
      teamId: 'team-remote-ui-smoke',
      type: 'team.message',
      payload: {
        senderMembershipId: 'membership-atlas',
        recipientMembershipId: 'membership-beacon',
        message: 'Review is ready.',
      },
      occurredAt: '2026-08-24T19:00:02.000Z',
      receivedAt: '2026-08-24T19:00:02.000Z',
    },
  ],
  leases: [],
  membershipRoutes: [
    {
      membershipId: 'membership-atlas',
      teamId: 'team-remote-ui-smoke',
      nodeId: 'node-atlas-coordinator',
      workspaceId: 'workspace-atlas',
      label: 'Atlas Coordinator',
      role: 'lead',
      status: 'active',
      revision: 1,
      createdAt: '2026-08-24T18:59:00.000Z',
      updatedAt: '2026-08-24T18:59:00.000Z',
    },
    {
      membershipId: 'membership-beacon',
      teamId: 'team-remote-ui-smoke',
      nodeId: 'node-beacon-reviewer',
      workspaceId: 'workspace-beacon',
      label: 'Beacon Reviewer',
      role: 'member',
      status: 'active',
      revision: 1,
      createdAt: '2026-08-24T18:59:00.000Z',
      updatedAt: '2026-08-24T18:59:00.000Z',
    },
  ],
};

describe('DistributedAgentTeamsView', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  afterEach(() => {
    window.sessionStorage.clear();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('renders the relay, worker roster, team, and assignment state', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <DistributedAgentTeamsView
          topology={topology}
          assignmentEvents={assignmentEvents}
          loading={false}
          refreshing={false}
          error={null}
          onRefresh={vi.fn()}
        />
      );
    });

    expect(host.textContent).toContain('Distributed Agent Team');
    expect(host.textContent).toContain('http://127.0.0.1:43170');
    expect(host.textContent).toContain('2 connected / 2');
    expect(host.textContent).toContain('Atlas Coordinator');
    expect(host.textContent).toContain('Beacon Reviewer');
    expect(host.textContent).toContain('Advertising auto-join for team-rem…smoke');
    expect(host.textContent).toContain('team-rem…smoke');
    expect(host.textContent).toContain('proposed');
    expect(host.textContent).toContain('Awaiting worker acceptance');
  });

  it('builds and renders a distributed team beside traditional team cards', async () => {
    const summaries = buildDistributedTeamSummaries(topology, assignmentEvents);
    expect(summaries).toMatchObject([
      {
        teamId: 'team-remote-ui-smoke',
        displayName: 'Distributed Team',
        connectedWorkerCount: 2,
        assignmentCount: 2,
        activeAssignmentCount: 0,
      },
    ]);

    const onOpenTeam = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<DistributedTeamsSection teams={summaries} onOpenTeam={onOpenTeam} />);
    });

    expect(host.textContent).toContain('Distributed teams');
    expect(host.textContent).toContain('Atlas Coordinator');
    expect(host.textContent).toContain('Beacon Reviewer');
    expect(host.textContent).toContain('2/2 workers');
    expect(host.textContent).toContain('0/2 active assignments');

    await act(async () => {
      host.querySelector('button')?.click();
    });
    expect(onOpenTeam).toHaveBeenCalledWith('team-remote-ui-smoke');
  });

  it('shows a roster-only team before any assignment activity exists', () => {
    const summaries = buildDistributedTeamSummaries(
      { ...topology, membershipRoutes: debugSnapshot.membershipRoutes },
      { ...assignmentEvents, events: [] }
    );

    expect(summaries).toMatchObject([
      {
        teamId: 'team-remote-ui-smoke',
        workers: [
          { label: 'Atlas Coordinator', status: 'connected' },
          { label: 'Beacon Reviewer', status: 'connected' },
        ],
        assignmentCount: 0,
      },
    ]);
  });

  it('removes departed members from the roster and makes their Worker available again', () => {
    const departedSnapshot: DistributedDebugSnapshotDto = {
      ...debugSnapshot,
      membershipRoutes: debugSnapshot.membershipRoutes.map((route) =>
        route.membershipId === 'membership-beacon'
          ? {
              ...route,
              status: 'left',
              revision: 2,
              updatedAt: '2026-08-24T19:01:00.000Z',
              leftAt: '2026-08-24T19:01:00.000Z',
            }
          : route
      ),
    };
    const model = buildDistributedTeamDetail(
      'team-remote-ui-smoke',
      topology,
      assignmentEvents,
      departedSnapshot
    );

    expect(model.members.map(({ route }) => route.membershipId)).toEqual(['membership-atlas']);
    expect(model.availableWorkers).toEqual([
      expect.objectContaining({ nodeId: 'node-beacon-reviewer' }),
    ]);
  });

  it('adapts relay state into a local-style team detail and semantic Console view', async () => {
    const model = buildDistributedTeamDetail(
      'team-remote-ui-smoke',
      topology,
      assignmentEvents,
      debugSnapshot
    );
    expect(model.workers).toHaveLength(2);
    expect(model.assignments).toEqual([
      expect.objectContaining({
        title: 'Review manager integration',
        workerLabel: 'Atlas Coordinator',
        state: 'proposed',
      }),
    ]);
    expect(model.messages).toEqual([
      expect.objectContaining({
        senderLabel: 'Atlas Coordinator',
        recipientLabel: 'Beacon Reviewer',
        message: 'Review is ready.',
      }),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onStartTeam = vi.fn();
    const onReconnectLead = vi.fn();
    await act(async () => {
      root.render(
        <DistributedTeamDetailView
          model={model}
          relayUrl={topology.relayUrl}
          loading={false}
          refreshing={false}
          error={null}
          mutationError={null}
          reconnectLeadMessage={null}
          creatingAssignment={false}
          startingTeam={false}
          reconnectingLead={false}
          membershipMutation={null}
          insecureLanMode={false}
          selectedRuntimeNodeId={null}
          runtimeSession={null}
          runtimeLoading={false}
          runtimeSending={false}
          runtimeError={null}
          onRefresh={vi.fn()}
          onSelectRuntimeNode={vi.fn()}
          onRuntimeControl={vi.fn(async (control) => ({
            controlId: control.controlId,
            accepted: true as const,
          }))}
          onCreateAssignment={vi.fn(async () => undefined)}
          onStartTeam={onStartTeam}
          onReconnectLead={onReconnectLead}
          onJoinTeamMember={vi.fn(async () => undefined)}
          onLeaveTeamMember={vi.fn(async () => undefined)}
        />
      );
    });

    expect(host.textContent).toContain('Remote protocol v2');
    expect(host.textContent).toContain('Atlas Coordinator');
    expect(host.textContent).toContain('Auto-joined');
    expect(host.textContent).toContain('Assignments');
    const startButton = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Start team')
    );
    expect(startButton?.disabled).toBe(false);
    await act(async () => startButton?.click());
    expect(onStartTeam).toHaveBeenCalledOnce();
    const reconnectButton = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Reconnect lead')
    );
    await act(async () => reconnectButton?.click());
    expect(onReconnectLead).toHaveBeenCalledOnce();
    const debugButton = host.querySelector<HTMLButtonElement>('article button');
    await act(async () => {
      debugButton?.click();
    });
    expect(host.textContent).toContain('Worker runtime is not active yet');
    expect(host.textContent).not.toContain('Raw Relay protocol traffic');
    expect(host.textContent).not.toContain('assignment.offer');
  });

  it('keeps the selected tab while a refreshed roster is rendered', async () => {
    const initialModel = buildDistributedTeamDetail(
      'team-remote-ui-smoke',
      topology,
      assignmentEvents,
      debugSnapshot
    );
    const refreshedModel = buildDistributedTeamDetail(
      'team-remote-ui-smoke',
      {
        ...topology,
        workers: [
          ...topology.workers,
          {
            ...topology.workers[1]!,
            nodeId: 'node-cascade-worker',
            workerInstanceId: 'worker-cascade-instance',
            label: 'Cascade Worker',
          },
        ],
      },
      assignmentEvents,
      {
        ...debugSnapshot,
        membershipRoutes: [
          ...debugSnapshot.membershipRoutes,
          {
            ...debugSnapshot.membershipRoutes[1]!,
            membershipId: 'membership-cascade',
            nodeId: 'node-cascade-worker',
            workspaceId: 'workspace-cascade',
            label: 'Cascade Worker',
          },
        ],
      }
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const props = {
      relayUrl: topology.relayUrl,
      loading: false,
      refreshing: false,
      error: null,
      mutationError: null,
      reconnectLeadMessage: null,
      creatingAssignment: false,
      startingTeam: false,
      reconnectingLead: false,
      membershipMutation: null,
      insecureLanMode: false,
      selectedRuntimeNodeId: null,
      runtimeSession: null,
      runtimeLoading: false,
      runtimeSending: false,
      runtimeError: null,
      onRefresh: vi.fn(),
      onSelectRuntimeNode: vi.fn(),
      onRuntimeControl: vi.fn(async (control: { controlId: string }) => ({
        controlId: control.controlId,
        accepted: true as const,
      })),
      onCreateAssignment: vi.fn(async () => undefined),
      onStartTeam: vi.fn(),
      onReconnectLead: vi.fn(),
      onJoinTeamMember: vi.fn(async () => undefined),
      onLeaveTeamMember: vi.fn(async () => undefined),
    };

    await act(async () => root.render(<DistributedTeamDetailView model={initialModel} {...props} />));
    const messagesTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent?.trim() === 'Messages'
    )!;
    await act(async () => {
      messagesTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await Promise.resolve();
    });
    expect(messagesTab.dataset.state).toBe('active');

    await act(async () => root.render(<DistributedTeamDetailView model={refreshedModel} {...props} />));
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (button) => button.textContent?.trim() === 'Messages'
      )?.dataset.state
    ).toBe('active');

    const overviewTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent?.trim() === 'Overview'
    )!;
    await act(async () => {
      overviewTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Cascade Worker');
  });

  it('restores the selected tab after the team detail remounts', async () => {
    const model = buildDistributedTeamDetail(
      'team-remote-ui-smoke',
      topology,
      assignmentEvents,
      debugSnapshot
    );
    const props = {
      model,
      relayUrl: topology.relayUrl,
      loading: false,
      refreshing: false,
      error: null,
      mutationError: null,
      reconnectLeadMessage: null,
      creatingAssignment: false,
      startingTeam: false,
      reconnectingLead: false,
      membershipMutation: null,
      insecureLanMode: false,
      selectedRuntimeNodeId: null,
      runtimeSession: null,
      runtimeLoading: false,
      runtimeSending: false,
      runtimeError: null,
      onRefresh: vi.fn(),
      onSelectRuntimeNode: vi.fn(),
      onRuntimeControl: vi.fn(async (control: { controlId: string }) => ({
        controlId: control.controlId,
        accepted: true as const,
      })),
      onCreateAssignment: vi.fn(async () => undefined),
      onStartTeam: vi.fn(),
      onReconnectLead: vi.fn(),
      onJoinTeamMember: vi.fn(async () => undefined),
      onLeaveTeamMember: vi.fn(async () => undefined),
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root = createRoot(host);

    await act(async () => root.render(<DistributedTeamDetailView {...props} />));
    const consoleTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent?.trim() === 'Console'
    )!;
    await act(async () => {
      consoleTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await Promise.resolve();
    });
    expect(consoleTab.dataset.state).toBe('active');

    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<DistributedTeamDetailView {...props} />));

    expect(
      [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (button) => button.textContent?.trim() === 'Console'
      )?.dataset.state
    ).toBe('active');
  });
});
