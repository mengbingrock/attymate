import {
  commandEnvelopeSchema,
  eventEnvelopeSchema,
  nodeIdSchema,
  type AssignmentId,
  type AttemptId,
  type CommandEnvelope,
  type EventEnvelope,
  type NodeId,
  type WorkerInstanceId,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { z } from 'zod';

export const relayWorkerSessionBindingSchema = z
  .object({
    nodeId: nodeIdSchema,
    workerInstanceId: workerInstanceIdSchema,
  })
  .strict();

export interface ActiveAttemptFence {
  readonly assignmentId: AssignmentId;
  readonly attemptId: AttemptId;
  readonly leaseEpoch: number;
}

export type RelayWorkerSessionBinding = z.infer<typeof relayWorkerSessionBindingSchema>;

export class RelayIngressError extends Error {
  readonly code = 'RELAY_INGRESS_REJECTED';

  constructor(
    readonly reason:
      | 'wrong_target_node'
      | 'wrong_source_node'
      | 'wrong_worker_instance'
      | 'missing_attempt_fence'
      | 'stale_attempt',
    message: string
  ) {
    super(message);
    this.name = 'RelayIngressError';
  }
}

export const acceptCommandForWorkerSession = (
  input: unknown,
  inputBinding: unknown
): CommandEnvelope => {
  const command = commandEnvelopeSchema.parse(input);
  const binding = relayWorkerSessionBindingSchema.parse(inputBinding);

  if (command.targetNodeId !== binding.nodeId) {
    throw new RelayIngressError(
      'wrong_target_node',
      `Command targets node ${command.targetNodeId}, not connected node ${binding.nodeId}`
    );
  }

  return command;
};

export const acceptEventFromWorkerSession = (
  input: unknown,
  inputBinding: unknown
): EventEnvelope => {
  const event = eventEnvelopeSchema.parse(input);
  const binding = relayWorkerSessionBindingSchema.parse(inputBinding);

  if (event.sourceNodeId !== binding.nodeId) {
    throw new RelayIngressError(
      'wrong_source_node',
      `Event source node ${event.sourceNodeId} does not match connected node ${binding.nodeId}`
    );
  }
  if (event.workerInstanceId !== binding.workerInstanceId) {
    throw new RelayIngressError(
      'wrong_worker_instance',
      'Event worker instance does not match the connected Worker session'
    );
  }

  return event;
};

type FencedEnvelope = Pick<
  CommandEnvelope | EventEnvelope,
  'assignmentId' | 'attemptId' | 'leaseEpoch'
>;

export const assertEnvelopeHasCurrentAttempt = (
  envelope: FencedEnvelope,
  activeFence: ActiveAttemptFence
): void => {
  if (
    envelope.assignmentId === undefined ||
    envelope.attemptId === undefined ||
    envelope.leaseEpoch === undefined
  ) {
    throw new RelayIngressError(
      'missing_attempt_fence',
      'Attempt-scoped traffic requires assignmentId, attemptId, and leaseEpoch'
    );
  }

  if (
    envelope.assignmentId !== activeFence.assignmentId ||
    envelope.attemptId !== activeFence.attemptId ||
    envelope.leaseEpoch !== activeFence.leaseEpoch
  ) {
    throw new RelayIngressError('stale_attempt', 'Attempt identity or fencing epoch is stale');
  }
};

export const relaySessionKey = (binding: {
  readonly nodeId: NodeId;
  readonly workerInstanceId: WorkerInstanceId;
}): string => `${binding.nodeId}:${binding.workerInstanceId}`;
