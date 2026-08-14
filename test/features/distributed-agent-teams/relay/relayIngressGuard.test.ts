import {
  assignmentIdSchema,
  attemptIdSchema,
} from '@claude-teams/agent-teams-protocol';
import {
  acceptCommandForWorkerSession,
  acceptEventFromWorkerSession,
  assertEnvelopeHasCurrentAttempt,
  RelayIngressError,
} from '@claude-teams/agent-teams-relay';

const ids = {
  commandId: '00000000-0000-4000-8000-000000000001',
  eventId: '00000000-0000-4000-8000-000000000002',
  nodeId: '00000000-0000-4000-8000-000000000003',
  otherNodeId: '00000000-0000-4000-8000-000000000004',
  workerInstanceId: '00000000-0000-4000-8000-000000000005',
  otherWorkerInstanceId: '00000000-0000-4000-8000-000000000006',
  assignmentId: assignmentIdSchema.parse('00000000-0000-4000-8000-000000000007'),
  attemptId: attemptIdSchema.parse('00000000-0000-4000-8000-000000000008'),
} as const;

const binding = { nodeId: ids.nodeId, workerInstanceId: ids.workerInstanceId };

describe('Relay ingress guard', () => {
  it('rejects commands delivered to the wrong connected node', () => {
    expect(() =>
      acceptCommandForWorkerSession(
        {
          protocolVersion: 2,
          commandId: ids.commandId,
          sequence: 1,
          targetNodeId: ids.otherNodeId,
          type: 'assignment.offer',
          payload: {},
        },
        binding
      )
    ).toThrow(RelayIngressError);
  });

  it('rejects events whose source identity differs from the connection binding', () => {
    expect(() =>
      acceptEventFromWorkerSession(
        {
          protocolVersion: 2,
          eventId: ids.eventId,
          sequence: 1,
          occurredAt: '2026-08-14T20:00:00.000Z',
          sourceNodeId: ids.nodeId,
          workerInstanceId: ids.otherWorkerInstanceId,
          type: 'worker.heartbeat',
          payload: {},
        },
        binding
      )
    ).toThrow(RelayIngressError);
  });

  it('rejects stale fencing epochs before result acceptance', () => {
    expect(() =>
      assertEnvelopeHasCurrentAttempt(
        {
          assignmentId: ids.assignmentId,
          attemptId: ids.attemptId,
          leaseEpoch: 10,
        },
        {
          assignmentId: ids.assignmentId,
          attemptId: ids.attemptId,
          leaseEpoch: 11,
        }
      )
    ).toThrow(RelayIngressError);
  });
});
