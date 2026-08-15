import {
  assertAssignmentTransition,
  commandEnvelopeSchema,
  eventEnvelopeSchema,
  InvalidAssignmentTransitionError,
  isTerminalAssignmentState,
} from '@claude-teams/agent-teams-protocol';

const ids = {
  commandId: '00000000-0000-4000-8000-000000000001',
  eventId: '00000000-0000-4000-8000-000000000002',
  nodeId: '00000000-0000-4000-8000-000000000003',
  workerInstanceId: '00000000-0000-4000-8000-000000000004',
  assignmentId: '00000000-0000-4000-8000-000000000005',
  attemptId: '00000000-0000-4000-8000-000000000006',
};

describe('distributed protocol envelopes', () => {
  it('accepts a fenced assignment command only with its full execution identity', () => {
    const command = commandEnvelopeSchema.parse({
      protocolVersion: 2,
      commandId: ids.commandId,
      sequence: 42,
      targetNodeId: ids.nodeId,
      assignmentId: ids.assignmentId,
      attemptId: ids.attemptId,
      leaseEpoch: 7,
      expiresAt: '2026-08-14T20:00:00.000Z',
      type: 'assignment.cancel',
      payload: { reason: 'team stopped' },
    });

    expect(command.leaseEpoch).toBe(7);
  });

  it('allows pre-execution assignment identity but rejects partial attempt identity', () => {
    const command = commandEnvelopeSchema.safeParse({
      protocolVersion: 2,
      commandId: ids.commandId,
      sequence: 42,
      targetNodeId: ids.nodeId,
      assignmentId: ids.assignmentId,
      type: 'assignment.offer',
      payload: {},
    });
    const event = eventEnvelopeSchema.safeParse({
      protocolVersion: 2,
      eventId: ids.eventId,
      sequence: 43,
      occurredAt: '2026-08-14T19:00:00.000Z',
      sourceNodeId: ids.nodeId,
      workerInstanceId: ids.workerInstanceId,
      assignmentId: ids.assignmentId,
      attemptId: ids.attemptId,
      type: 'assignment.progress',
      payload: {},
    });

    expect(command.success).toBe(true);
    expect(event.success).toBe(false);
  });
});

describe('assignment lifecycle', () => {
  it('supports the leased execution and review path', () => {
    const path = [
      'proposed',
      'accepted',
      'queued',
      'leased',
      'preparing_workspace',
      'running',
      'verifying',
      'committing',
      'awaiting_push',
      'reporting',
      'ready_review',
      'completed',
    ] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(() => assertAssignmentTransition(path[index], path[index + 1])).not.toThrow();
    }
    expect(isTerminalAssignmentState('completed')).toBe(true);
  });

  it('rejects publishing after an attempt is fenced', () => {
    expect(() => assertAssignmentTransition('fenced', 'reporting')).toThrow(
      InvalidAssignmentTransitionError
    );
  });
});
