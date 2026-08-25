import {
  relayRuntimeControlMessageSchema,
  runtimeControlSchema,
  runtimeSessionCreateRequestSchema,
  workerRuntimeEventMessageSchema,
} from '@claude-teams/agent-teams-protocol';
import { describe, expect, it } from 'vitest';

const scope = {
  teamId: '00000000-0000-4000-8000-000000000001',
  nodeId: '00000000-0000-4000-8000-000000000002',
  assignmentId: '00000000-0000-4000-8000-000000000003',
  attemptId: '00000000-0000-4000-8000-000000000004',
  leaseId: '00000000-0000-4000-8000-000000000005',
  leaseEpoch: 2,
};

describe('distributed runtime session protocol', () => {
  it('accepts scoped controls and events while rejecting unbounded or incomplete input', () => {
    expect(
      runtimeSessionCreateRequestSchema.parse({
        teamId: scope.teamId,
        nodeId: scope.nodeId,
        assignmentId: scope.assignmentId,
        attemptId: scope.attemptId,
        leaseEpoch: scope.leaseEpoch,
      })
    ).toMatchObject({ assignmentId: scope.assignmentId });

    const control = runtimeControlSchema.parse({
      controlId: '00000000-0000-4000-8000-000000000006',
      type: 'turn.steer',
      payload: {
        threadId: 'thr_1',
        expectedTurnId: 'turn_1',
        appServerGeneration: 3,
        message: 'Continue with the requested verification.',
      },
    });
    expect(
      relayRuntimeControlMessageSchema.parse({
        type: 'relay.runtime_control',
        protocolVersion: 2,
        sessionId: '00000000-0000-4000-8000-000000000007',
        scope,
        control,
      })
    ).toMatchObject({ control: { type: 'turn.steer' } });

    expect(
      runtimeControlSchema.parse({
        controlId: '00000000-0000-4000-8000-000000000009',
        type: 'turn.start',
        payload: {
          threadId: 'thr_1',
          appServerGeneration: 3,
          message: 'Start the next turn in the leased thread.',
        },
      })
    ).toMatchObject({ type: 'turn.start' });

    expect(
      workerRuntimeEventMessageSchema.parse({
        type: 'worker.runtime_event',
        protocolVersion: 2,
        eventId: '00000000-0000-4000-8000-000000000008',
        sequence: 1,
        scope,
        occurredAt: '2026-08-24T08:00:00.000Z',
        event: {
          kind: 'app-server.notification',
          payload: { method: 'item/agentMessage/delta', params: { delta: 'hello' } },
        },
      })
    ).toMatchObject({ event: { kind: 'app-server.notification' } });

    expect(() =>
      runtimeControlSchema.parse({
        controlId: '00000000-0000-4000-8000-000000000006',
        type: 'turn.steer',
        payload: { message: 'missing exact turn identity' },
      })
    ).toThrow();
    expect(() =>
      runtimeControlSchema.parse({
        controlId: '00000000-0000-4000-8000-000000000006',
        type: 'filesystem.read',
        payload: { path: '../outside.txt' },
      })
    ).toThrow();
    expect(() =>
      runtimeControlSchema.parse({
        controlId: '00000000-0000-4000-8000-000000000006',
        type: 'filesystem.write',
        payload: { path: 'file.txt', content: 'x'.repeat(1_048_577) },
      })
    ).toThrow();
  });
});
