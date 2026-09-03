import {
  normalizeRelayBaseUrl,
  RelayHttpAdapter,
} from '@features/distributed-agent-teams/main/infrastructure/RelayHttpAdapter';
import { describe, expect, it, vi } from 'vitest';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const ASSIGNMENT_ID = '55555555-5555-4555-8555-555555555555';
const ATTEMPT_ID = '66666666-6666-4666-8666-666666666666';
const LEASE_ID = '77777777-7777-4777-8777-777777777777';
const COMMAND_ID = '88888888-8888-4888-8888-888888888888';
const EVENT_ID = '99999999-9999-4999-8999-999999999999';
const WORKER_INSTANCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('RelayHttpAdapter', () => {
  it('maps Relay worker projections into browser-safe DTOs', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        workers: [
          {
            organizationId: '33333333-3333-4333-8333-333333333333',
            personId: '44444444-4444-4444-8444-444444444444',
            nodeId: NODE_ID,
            workerInstanceId: '55555555-5555-4555-8555-555555555555',
            workerGeneration: 3,
            label: 'Alice Worker',
            connectedAt: '2026-08-14T10:00:00.000Z',
            lastHeartbeatAt: '2026-08-14T10:00:05.000Z',
            lastHeartbeatSequence: 2,
            status: 'connected',
            autoJoinTeamId: TEAM_ID,
          },
        ],
      })
    );
    const adapter = new RelayHttpAdapter('http://127.0.0.1:43170/', fetchImpl as typeof fetch);

    await expect(adapter.listWorkers()).resolves.toEqual([
      expect.objectContaining({
        nodeId: NODE_ID,
        label: 'Alice Worker',
        status: 'connected',
        autoJoinTeamId: TEAM_ID,
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:43170/v2/workers',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('creates an assignment offer for the selected Worker', async () => {
    let postedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(
        {
          command: {
            commandId: postedBody.commandId,
            targetNodeId: postedBody.targetNodeId,
            cursor: 7,
            status: 'delivered',
            createdAt: '2026-08-14T10:00:00.000Z',
          },
        },
        { status: 201 }
      );
    });
    const adapter = new RelayHttpAdapter('http://relay.local:43170', fetchImpl as typeof fetch);

    await expect(
      adapter.createRemoteAssignment({
        targetNodeId: NODE_ID,
        teamId: TEAM_ID,
        membershipId: MEMBERSHIP_ID,
        workspaceId: WORKSPACE_ID,
        title: 'Review manager integration',
        description: 'Run focused checks.',
      })
    ).resolves.toMatchObject({ targetNodeId: NODE_ID, cursor: 7, status: 'delivered' });
    expect(postedBody).toMatchObject({
      protocolVersion: 2,
      targetNodeId: NODE_ID,
      teamId: TEAM_ID,
      type: 'assignment.offer',
      payload: {
        title: 'Review manager integration',
        description: 'Run focused checks.',
        membershipId: MEMBERSHIP_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
    expect(postedBody?.commandId).toEqual(expect.any(String));
    expect(postedBody?.assignmentId).toBe(
      (postedBody?.payload as Record<string, unknown>).assignmentId
    );
    expect((postedBody?.payload as Record<string, unknown>).assignmentId).toEqual(
      expect.any(String)
    );
  });

  it('sends a revision-checked assignment accept command', async () => {
    let postedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(
        {
          command: {
            commandId: postedBody.commandId,
            targetNodeId: postedBody.targetNodeId,
            cursor: 8,
            status: 'pending',
            createdAt: '2026-08-14T10:00:00.000Z',
          },
        },
        { status: 201 }
      );
    });
    const adapter = new RelayHttpAdapter('http://relay.local:43170', fetchImpl as typeof fetch);

    await expect(
      adapter.acceptRemoteAssignment({
        teamId: TEAM_ID,
        targetNodeId: NODE_ID,
        assignmentId: ASSIGNMENT_ID,
        expectedRevision: 2,
      })
    ).resolves.toMatchObject({ cursor: 8, status: 'pending' });
    expect(postedBody).toMatchObject({
      teamId: TEAM_ID,
      targetNodeId: NODE_ID,
      assignmentId: ASSIGNMENT_ID,
      type: 'assignment.accept',
      payload: {
        assignmentId: ASSIGNMENT_ID,
        expectedRevision: 2,
        reason: 'manager_started_team',
      },
    });
  });

  it('joins and removes team memberships through manager-authenticated routes', async () => {
    const managerToken = 'manager-token-which-is-long-enough-for-tests';
    const requests: Array<{ url: string; method: string; body: unknown; authorization: string | null }> = [];
    const route = {
      membershipId: MEMBERSHIP_ID,
      teamId: TEAM_ID,
      nodeId: NODE_ID,
      workspaceId: WORKSPACE_ID,
      label: 'Alice Worker',
      role: 'member',
      status: 'active',
      revision: 1,
      createdAt: '2026-08-14T10:00:00.000Z',
      updatedAt: '2026-08-14T10:00:00.000Z',
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      if (init?.method === 'POST') {
        return Response.json(
          { membership: route, assignmentId: ASSIGNMENT_ID, commandIds: [COMMAND_ID] },
          { status: 201 }
        );
      }
      return Response.json({
        membership: { ...route, status: 'left', revision: 2 },
        releasedAssignmentIds: [ASSIGNMENT_ID],
      });
    });
    const adapter = new RelayHttpAdapter(
      'https://relay.example.test',
      fetchImpl as typeof fetch,
      managerToken
    );

    await expect(
      adapter.joinTeamMember({ teamId: TEAM_ID, targetNodeId: NODE_ID, role: 'member' })
    ).resolves.toMatchObject({ membership: { status: 'active' }, assignmentId: ASSIGNMENT_ID });
    await expect(
      adapter.leaveTeamMember({
        teamId: TEAM_ID,
        membershipId: MEMBERSHIP_ID,
        expectedRevision: 1,
      })
    ).resolves.toMatchObject({
      membership: { status: 'left', revision: 2 },
      releasedAssignmentIds: [ASSIGNMENT_ID],
    });
    expect(requests).toEqual([
      expect.objectContaining({
        url: `https://relay.example.test/v2/teams/${TEAM_ID}/members`,
        method: 'POST',
        authorization: `Bearer ${managerToken}`,
        body: { targetNodeId: NODE_ID, role: 'member' },
      }),
      expect.objectContaining({
        url: `https://relay.example.test/v2/teams/${TEAM_ID}/members/${MEMBERSHIP_ID}`,
        method: 'DELETE',
        authorization: `Bearer ${managerToken}`,
        body: { expectedRevision: 1 },
      }),
    ]);
  });

  it('maps validated Relay assignment events into renderer DTOs', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        events: [
          {
            cursor: 3,
            eventId: '33333333-3333-4333-8333-333333333333',
            sourceNodeId: NODE_ID,
            receivedAt: '2026-08-14T10:00:02.000Z',
            envelope: {
              protocolVersion: 2,
              eventId: '33333333-3333-4333-8333-333333333333',
              sequence: 2,
              occurredAt: '2026-08-14T10:00:01.000Z',
              sourceNodeId: NODE_ID,
              workerInstanceId: '44444444-4444-4444-8444-444444444444',
              teamId: TEAM_ID,
              assignmentId: '55555555-5555-4555-8555-555555555555',
              type: 'assignment.state_changed',
              payload: {
                revision: 1,
                fromState: 'proposed',
                state: 'deferred',
                reason: 'Owner is in a meeting',
                deferredUntil: '2026-08-14T11:00:00.000Z',
              },
            },
          },
        ],
      })
    );
    const adapter = new RelayHttpAdapter('http://127.0.0.1:43170', fetchImpl as typeof fetch);

    await expect(adapter.listAssignmentEvents()).resolves.toEqual([
      expect.objectContaining({
        cursor: 3,
        state: 'deferred',
        revision: 1,
        sourceNodeId: NODE_ID,
        teamId: TEAM_ID,
      }),
    ]);
  });

  it('maps command, event, lease, and membership-route diagnostics', async () => {
    const timestamp = '2026-08-14T10:00:00.000Z';
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/v2/commands')) {
        return Response.json({
          commands: [
            {
              cursor: 4,
              envelope: {
                protocolVersion: 2,
                commandId: COMMAND_ID,
                sequence: 4,
                teamId: TEAM_ID,
                targetNodeId: NODE_ID,
                assignmentId: ASSIGNMENT_ID,
                type: 'assignment.offer',
                payload: { title: 'Remote review' },
              },
              status: 'acknowledged',
              createdAt: timestamp,
              deliveredAt: timestamp,
              acknowledgedAt: timestamp,
            },
          ],
        });
      }
      if (url.endsWith('/v2/events')) {
        return Response.json({
          events: [
            {
              cursor: 5,
              envelope: {
                protocolVersion: 2,
                eventId: EVENT_ID,
                sequence: 5,
                occurredAt: timestamp,
                sourceNodeId: NODE_ID,
                workerInstanceId: WORKER_INSTANCE_ID,
                teamId: TEAM_ID,
                assignmentId: ASSIGNMENT_ID,
                type: 'assignment.state_changed',
                payload: { revision: 1, fromState: null, state: 'proposed', reason: 'offered' },
              },
              receivedAt: timestamp,
            },
          ],
        });
      }
      if (url.endsWith('/v2/leases')) {
        return Response.json({
          leases: [
            {
              leaseId: LEASE_ID,
              assignmentId: ASSIGNMENT_ID,
              attemptId: ATTEMPT_ID,
              nodeId: NODE_ID,
              teamId: TEAM_ID,
              leaseEpoch: 1,
              assignmentRevision: 0,
              status: 'active',
              issuedAt: timestamp,
              expiresAt: '2026-08-14T10:05:00.000Z',
              updatedAt: timestamp,
            },
          ],
        });
      }
      if (url.endsWith('/v2/membership-routes')) {
        return Response.json({
          routes: [
            {
              membershipId: MEMBERSHIP_ID,
              teamId: TEAM_ID,
              nodeId: NODE_ID,
              workspaceId: WORKSPACE_ID,
              label: 'Alice Worker',
              role: 'lead',
              status: 'active',
              revision: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        });
      }
      return Response.json({}, { status: 404 });
    });
    const adapter = new RelayHttpAdapter('http://127.0.0.1:43170', fetchImpl as typeof fetch);

    const [commands, events, leases, routes] = await Promise.all([
      adapter.listCommands(),
      adapter.listEvents(),
      adapter.listLeases(),
      adapter.listMembershipRoutes(),
    ]);

    expect(commands).toEqual([
      expect.objectContaining({ commandId: COMMAND_ID, status: 'acknowledged' }),
    ]);
    expect(events).toEqual([expect.objectContaining({ eventId: EVENT_ID, teamId: TEAM_ID })]);
    expect(leases).toEqual([
      expect.objectContaining({ leaseId: LEASE_ID, assignmentRevision: 0, status: 'active' }),
    ]);
    expect(routes).toEqual([
      expect.objectContaining({
        membershipId: MEMBERSHIP_ID,
        workspaceId: WORKSPACE_ID,
        role: 'lead',
        status: 'active',
      }),
    ]);
  });

  it('keeps runtime capability tokens in main while polling events and sending controls', async () => {
    const managerToken = 'manager-token-which-is-long-enough-for-tests';
    const sessionToken = 'session-token-which-is-long-enough-for-tests';
    const calls: Array<{ url: string; authorization: string | undefined }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get('authorization') ?? undefined });
      if (url.endsWith('/v2/runtime-sessions')) {
        return Response.json(
          {
            sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            sessionToken,
            scope: {
              teamId: TEAM_ID,
              nodeId: NODE_ID,
              assignmentId: ASSIGNMENT_ID,
              attemptId: ATTEMPT_ID,
              leaseId: LEASE_ID,
              leaseEpoch: 1,
            },
            capabilities: ['events.read', 'turn.interrupt'],
            expiresAt: '2099-08-14T10:05:00.000Z',
          },
          { status: 201 }
        );
      }
      if (url.includes('/events?after=')) {
        return Response.json({ events: [], truncated: false, nextCursor: 0 });
      }
      if (url.endsWith('/controls')) {
        return Response.json({ accepted: true, controlId: COMMAND_ID }, { status: 202 });
      }
      return Response.json({}, { status: 404 });
    });
    const adapter = new RelayHttpAdapter(
      'http://127.0.0.1:43170',
      fetchImpl as typeof fetch,
      managerToken
    );
    const sessionRequest = {
      teamId: TEAM_ID,
      nodeId: NODE_ID,
      assignmentId: ASSIGNMENT_ID,
      attemptId: ATTEMPT_ID,
      leaseEpoch: 1,
    };

    await expect(adapter.getRuntimeSession(sessionRequest)).resolves.toMatchObject({
      sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      events: [],
    });
    await expect(
      adapter.sendRuntimeControl({
        session: sessionRequest,
        control: {
          controlId: COMMAND_ID,
          type: 'turn.interrupt',
          payload: { reason: 'test' },
        },
      })
    ).resolves.toEqual({ accepted: true, controlId: COMMAND_ID });

    expect(calls).toEqual([
      expect.objectContaining({ authorization: `Bearer ${managerToken}` }),
      expect.objectContaining({ authorization: `Bearer ${sessionToken}` }),
      expect.objectContaining({ authorization: `Bearer ${sessionToken}` }),
    ]);
    expect(JSON.stringify(await adapter.getRuntimeSession(sessionRequest))).not.toContain(
      sessionToken
    );
  });

  it('recreates a revoked runtime capability and retries an event poll once', async () => {
    let sessionCreates = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/v2/runtime-sessions')) {
        sessionCreates += 1;
        return Response.json(
          {
            sessionId:
              sessionCreates === 1
                ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
                : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            sessionToken: `session-token-${sessionCreates}-which-is-long-enough-for-tests`,
            scope: {
              teamId: TEAM_ID,
              nodeId: NODE_ID,
              assignmentId: ASSIGNMENT_ID,
              attemptId: ATTEMPT_ID,
              leaseId: LEASE_ID,
              leaseEpoch: 1,
            },
            capabilities: ['events.read'],
            expiresAt: '2099-08-14T10:05:00.000Z',
          },
          { status: 201 }
        );
      }
      if (url.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/events')) {
        return Response.json({ error: 'RUNTIME_SESSION_DENIED' }, { status: 401 });
      }
      if (url.includes('cccccccc-cccc-4ccc-8ccc-cccccccccccc/events')) {
        return Response.json({ events: [], truncated: false, nextCursor: 0 });
      }
      return Response.json({}, { status: 404 });
    });
    const adapter = new RelayHttpAdapter(
      'http://127.0.0.1:43170',
      fetchImpl as typeof fetch,
      'manager-token-which-is-long-enough-for-tests'
    );
    const sessionRequest = {
      teamId: TEAM_ID,
      nodeId: NODE_ID,
      assignmentId: ASSIGNMENT_ID,
      attemptId: ATTEMPT_ID,
      leaseEpoch: 1,
    };

    await expect(adapter.getRuntimeSession(sessionRequest)).resolves.toMatchObject({
      sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(sessionCreates).toBe(2);
  });

  it('recreates a revoked runtime capability and retries a control once', async () => {
    let sessionCreates = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/v2/runtime-sessions')) {
        sessionCreates += 1;
        return Response.json(
          {
            sessionId:
              sessionCreates === 1
                ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
                : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            sessionToken: `session-token-${sessionCreates}-which-is-long-enough-for-tests`,
            scope: {
              teamId: TEAM_ID,
              nodeId: NODE_ID,
              assignmentId: ASSIGNMENT_ID,
              attemptId: ATTEMPT_ID,
              leaseId: LEASE_ID,
              leaseEpoch: 1,
            },
            capabilities: ['turn.start'],
            expiresAt: '2099-08-14T10:05:00.000Z',
          },
          { status: 201 }
        );
      }
      if (url.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/controls')) {
        return Response.json({ error: 'RUNTIME_SESSION_DENIED' }, { status: 401 });
      }
      if (url.includes('cccccccc-cccc-4ccc-8ccc-cccccccccccc/controls')) {
        return Response.json({ accepted: true, controlId: COMMAND_ID }, { status: 202 });
      }
      return Response.json({}, { status: 404 });
    });
    const adapter = new RelayHttpAdapter(
      'http://127.0.0.1:43170',
      fetchImpl as typeof fetch,
      'manager-token-which-is-long-enough-for-tests'
    );

    await expect(
      adapter.sendRuntimeControl({
        session: {
          teamId: TEAM_ID,
          nodeId: NODE_ID,
          assignmentId: ASSIGNMENT_ID,
          attemptId: ATTEMPT_ID,
          leaseEpoch: 1,
        },
        control: {
          controlId: COMMAND_ID,
          type: 'turn.start',
          payload: {
            threadId: 'thr_1',
            appServerGeneration: 3,
            message: 'retry after Relay restart',
          },
        },
      })
    ).resolves.toEqual({ accepted: true, controlId: COMMAND_ID });
    expect(sessionCreates).toBe(2);
  });

  it('shares one replacement session between concurrent polling and control retries', async () => {
    let sessionCreates = 0;
    let revoked = false;
    let deniedRequests = 0;
    let releaseDeniedRequests: (() => void) | undefined;
    const deniedRequestsReady = new Promise<void>((resolve) => {
      releaseDeniedRequests = resolve;
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/v2/runtime-sessions')) {
        sessionCreates += 1;
        return Response.json(
          {
            sessionId:
              sessionCreates === 1
                ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
                : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            sessionToken: `session-token-${sessionCreates}-which-is-long-enough-for-tests`,
            scope: {
              teamId: TEAM_ID,
              nodeId: NODE_ID,
              assignmentId: ASSIGNMENT_ID,
              attemptId: ATTEMPT_ID,
              leaseId: LEASE_ID,
              leaseEpoch: 1,
            },
            capabilities: ['events.read', 'turn.start'],
            expiresAt: '2099-08-14T10:05:00.000Z',
          },
          { status: 201 }
        );
      }
      if (url.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/')) {
        if (!revoked && url.includes('/events')) {
          return Response.json({ events: [], truncated: false, nextCursor: 0 });
        }
        deniedRequests += 1;
        if (deniedRequests === 2) releaseDeniedRequests?.();
        await deniedRequestsReady;
        return Response.json({ error: 'RUNTIME_SESSION_DENIED' }, { status: 401 });
      }
      if (url.includes('cccccccc-cccc-4ccc-8ccc-cccccccccccc/events')) {
        return Response.json({ events: [], truncated: false, nextCursor: 0 });
      }
      if (url.includes('cccccccc-cccc-4ccc-8ccc-cccccccccccc/controls')) {
        return Response.json({ accepted: true, controlId: COMMAND_ID }, { status: 202 });
      }
      return Response.json({}, { status: 404 });
    });
    const adapter = new RelayHttpAdapter(
      'http://127.0.0.1:43170',
      fetchImpl as typeof fetch,
      'manager-token-which-is-long-enough-for-tests'
    );
    const sessionRequest = {
      teamId: TEAM_ID,
      nodeId: NODE_ID,
      assignmentId: ASSIGNMENT_ID,
      attemptId: ATTEMPT_ID,
      leaseEpoch: 1,
    };

    await expect(adapter.getRuntimeSession(sessionRequest)).resolves.toMatchObject({
      sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    revoked = true;
    const [polled, controlled] = await Promise.all([
      adapter.getRuntimeSession(sessionRequest),
      adapter.sendRuntimeControl({
        session: sessionRequest,
        control: {
          controlId: COMMAND_ID,
          type: 'turn.start',
          payload: {
            threadId: 'thr_1',
            appServerGeneration: 3,
            message: 'retry concurrently after Relay restart',
          },
        },
      }),
    ]);

    expect(polled.sessionId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(controlled).toEqual({ accepted: true, controlId: COMMAND_ID });
    expect(sessionCreates).toBe(2);
  });

  it.each([
    'file:///tmp/relay',
    'ws://relay.local/v2/worker-stream',
    'http://user:secret@relay.local',
    'http://relay.local?target=http://elsewhere',
  ])('rejects an unsafe Relay URL: %s', (relayUrl) => {
    expect(() => normalizeRelayBaseUrl(relayUrl)).toThrow();
  });
});
