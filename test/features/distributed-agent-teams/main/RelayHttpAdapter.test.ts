import {
  normalizeRelayBaseUrl,
  RelayHttpAdapter,
} from '@features/distributed-agent-teams/main/infrastructure/RelayHttpAdapter';
import { describe, expect, it, vi } from 'vitest';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';

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
          },
        ],
      })
    );
    const adapter = new RelayHttpAdapter('http://127.0.0.1:43170/', fetchImpl as typeof fetch);

    await expect(adapter.listWorkers()).resolves.toEqual([
      expect.objectContaining({ nodeId: NODE_ID, label: 'Alice Worker', status: 'connected' }),
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

  it.each([
    'file:///tmp/relay',
    'ws://relay.local/v2/worker-stream',
    'http://user:secret@relay.local',
    'http://relay.local?target=http://elsewhere',
  ])('rejects an unsafe Relay URL: %s', (relayUrl) => {
    expect(() => normalizeRelayBaseUrl(relayUrl)).toThrow();
  });
});
