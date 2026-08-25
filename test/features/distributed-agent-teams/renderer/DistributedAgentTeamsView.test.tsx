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
      createdAt: '2026-08-24T18:59:00.000Z',
      updatedAt: '2026-08-24T18:59:00.000Z',
    },
    {
      membershipId: 'membership-beacon',
      teamId: 'team-remote-ui-smoke',
      nodeId: 'node-beacon-reviewer',
      workspaceId: 'workspace-beacon',
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
    await act(async () => {
      root.render(
        <DistributedTeamDetailView
          model={model}
          relayUrl={topology.relayUrl}
          loading={false}
          refreshing={false}
          error={null}
          mutationError={null}
          creatingAssignment={false}
          startingTeam={false}
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
        />
      );
    });

    expect(host.textContent).toContain('Remote protocol v2');
    expect(host.textContent).toContain('Atlas Coordinator');
    expect(host.textContent).toContain('Assignments');
    const startButton = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Start team')
    );
    expect(startButton?.disabled).toBe(false);
    await act(async () => startButton?.click());
    expect(onStartTeam).toHaveBeenCalledOnce();
    const debugButton = host.querySelector<HTMLButtonElement>('article button');
    await act(async () => {
      debugButton?.click();
    });
    expect(host.textContent).toContain('Worker runtime is not active yet');
    expect(host.textContent).not.toContain('Raw Relay protocol traffic');
    expect(host.textContent).not.toContain('assignment.offer');
  });
});
