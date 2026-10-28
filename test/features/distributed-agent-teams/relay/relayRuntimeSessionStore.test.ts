// @vitest-environment node

import { runtimeSessionScopeSchema } from '@claude-teams/agent-teams-protocol';
import { RelayRuntimeSessionStore } from '@claude-teams/agent-teams-relay';
import { describe, expect, it } from 'vitest';

const scope = runtimeSessionScopeSchema.parse({
  teamId: '00000000-0000-4000-8000-000000000001',
  nodeId: '00000000-0000-4000-8000-000000000002',
  assignmentId: '00000000-0000-4000-8000-000000000003',
  attemptId: '00000000-0000-4000-8000-000000000004',
  leaseId: '00000000-0000-4000-8000-000000000005',
  leaseEpoch: 2,
});

describe('RelayRuntimeSessionStore', () => {
  it('does not map turn.start to the filesystem.read capability', () => {
    const store = new RelayRuntimeSessionStore();
    const created = store.create(scope, new Date(Date.now() + 60_000).toISOString(), [
      'events.read',
      'filesystem.read',
    ]);
    expect(() =>
      store.authorizeControl(created.sessionId, created.sessionToken, {
        controlId: '00000000-0000-4000-8000-000000000008',
        type: 'turn.start',
        payload: { threadId: 'thread', appServerGeneration: 1, message: 'Use local tools' },
      })
    ).toThrow('invalid, expired, or revoked');
  });

  it('does not replace an existing session when an opening request is replayed', () => {
    const store = new RelayRuntimeSessionStore();
    const id = '00000000-0000-4000-8000-000000000009';
    const created = store.create(
      scope,
      new Date(Date.now() + 60_000).toISOString(),
      ['events.read'],
      id
    );
    expect(() =>
      store.create(scope, new Date(Date.now() + 60_000).toISOString(), ['events.read'], id)
    ).toThrow();
    expect(store.listEvents(id, created.sessionToken, 0).events).toEqual([]);
  });

  it('uses hashed expiring bearer capabilities and isolates event replay by lease scope', () => {
    let now = Date.parse('2026-08-24T08:00:00.000Z');
    const store = new RelayRuntimeSessionStore({ now: () => now, maxEventsPerSession: 2 });
    const created = store.create(scope, '2026-08-24T08:05:00.000Z');

    expect(store.debugSession(created.sessionId)).not.toHaveProperty('sessionToken');
    expect(() => store.listEvents(created.sessionId, 'wrong-token', 0)).toThrow(
      'Runtime session is invalid, expired, or revoked'
    );

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      store.acceptEvent({
        type: 'worker.runtime_event',
        protocolVersion: 2,
        eventId: `00000000-0000-4000-8000-00000000000${5 + sequence}`,
        sequence,
        scope,
        occurredAt: new Date(now + sequence).toISOString(),
        event: {
          kind: 'app-server.notification',
          payload: { method: 'item/agentMessage/delta', params: { delta: String(sequence) } },
        },
      });
    }
    expect(store.listEvents(created.sessionId, created.sessionToken, 0)).toMatchObject({
      truncated: true,
      events: [{ cursor: 2 }, { cursor: 3 }],
    });

    now = Date.parse('2026-08-24T08:05:00.001Z');
    expect(() => store.listEvents(created.sessionId, created.sessionToken, 0)).toThrow(
      'Runtime session is invalid, expired, or revoked'
    );
  });
});
