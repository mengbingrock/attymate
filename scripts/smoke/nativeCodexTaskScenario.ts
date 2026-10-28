/** Real leased assignment turns, native MCP reporting, and authenticated runtime fencing. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { startAgentTeamsRelay } from '../../packages/agent-teams-relay/src/relayServer';
import type { WorkerCodexAppServerSession } from '../../packages/agent-teams-worker/src/codexAppServerClient';
import {
  startAgentTeamsWorker,
  type AgentTeamsWorkerOptions,
  type StartedAgentTeamsWorker,
} from '../../packages/agent-teams-worker/src/workerDaemon';
import { waitFor, type startNativeServer } from './nativeCodexFixture';
import type { startResponsesFixture } from './nativeResponsesFixture';
import { verifyNativeTaskFence } from './nativeCodexTaskFence';

export const runNativeTaskScenario = async (options: {
  relay: Awaited<ReturnType<typeof startAgentTeamsRelay>>;
  workers: StartedAgentTeamsWorker[];
  engines: Awaited<ReturnType<typeof startNativeServer>>[];
  members: {
    kind: string;
    membershipId: string;
    threadId: string;
    peer: WorkerCodexAppServerSession;
    options: AgentTeamsWorkerOptions;
  }[];
  teamId: string;
  managerToken: string;
  leadKind: 'stock' | 'fork';
  deliveryMode: 'inline' | 'mcp-inbox';
  responses: Awaited<ReturnType<typeof startResponsesFixture>>;
  evidence: Record<string, unknown>[];
  emit: (stage: string, detail: Record<string, unknown>) => void;
}) => {
  const {
    relay,
    workers,
    members,
    teamId,
    managerToken,
    leadKind,
    deliveryMode,
    responses,
    evidence,
    emit,
  } = options;
  const memberIndex = members.findIndex((member) => member.kind !== leadKind);
  const member = members[memberIndex]!;
  const leadIndex = members.findIndex((candidate) => candidate.kind === leadKind);
  for (const [index, candidate] of members.entries()) {
    await workers[index]!.stop();
    const engine = options.engines.find((runtime) => runtime.kind === candidate.kind)!;
    const mcp = candidate.options.desktopChat!.runtimeMcp;
    workers[index] = await startAgentTeamsWorker({
      ...candidate.options,
      workerGeneration: candidate.options.workerGeneration + 2,
      codexRuntime: {
        cwd: engine.project,
        sessionFactory: engine.factory,
        runtimeMcp: { ...mcp, tokenFile: candidate.options.dataDir + '/runtime-session.token' },
      },
    });
    await workers[index]!.ready;
  }
  const worker = workers[memberIndex]!;
  const leadWorker = workers[leadIndex]!;
  await waitFor(
    async () => leadWorker.listRuntimeBindings().some((b) => b.state === 'completed'),
    'Lead native assignment did not finish its initial turn',
    45000
  );
  await waitFor(
    async () =>
      worker
        .listAssignments()
        .some(
          (a) =>
            a.membershipId === member.membershipId && ['running', 'verifying'].includes(a.state)
        ),
    'Relay-assigned native task did not start'
  );
  const assignment = worker
    .listAssignments()
    .find(
      (a) => a.membershipId === member.membershipId && ['running', 'verifying'].includes(a.state)
    )!;
  const assignmentId = assignment.assignmentId;
  for (const type of ['assignment.offer', 'assignment.accept']) {
    assert.ok(
      worker
        .listInboxCommands()
        .some(
          (command) =>
            command.envelope.assignmentId === assignmentId && command.envelope.type === type
        ),
      'Missing Relay task lifecycle command ' + type
    );
  }
  await waitFor(
    async () =>
      worker
        .listRuntimeBindings()
        .some((b) => b.assignmentId === assignmentId && b.state === 'completed'),
    'Initial leased native turn did not finish',
    45000
  );
  const binding = worker.listRuntimeBindings().find((b) => b.assignmentId === assignmentId)!;
  assert.ok(binding.threadId && binding.turnId);
  const scope = {
    teamId,
    nodeId: member.options.nodeId,
    assignmentId,
    attemptId: assignment.attemptId!,
    leaseEpoch: assignment.leaseEpoch!,
  };
  const invalid = await relay.app.inject({
    method: 'POST',
    url: '/v2/runtime-sessions',
    headers: { authorization: 'Bearer ' + managerToken },
    payload: { ...scope, leaseEpoch: scope.leaseEpoch + 1 },
  });
  assert.equal(invalid.statusCode, 409, invalid.body);
  const created = await relay.app.inject({
    method: 'POST',
    url: '/v2/runtime-sessions',
    headers: { authorization: 'Bearer ' + managerToken },
    payload: scope,
  });
  assert.equal(created.statusCode, 201, created.body);
  const runtime = created.json() as { sessionId: string; sessionToken: string };
  const control = async (type: string, payload: unknown) => {
    const result = await relay.app.inject({
      method: 'POST',
      url: `/v2/runtime-sessions/${runtime.sessionId}/controls`,
      headers: { authorization: 'Bearer ' + runtime.sessionToken },
      payload: { controlId: randomUUID(), type, payload },
    });
    assert.equal(result.statusCode, 202, result.body);
  };
  try {
    const reportingOffset = responses.requests.length;
    await control('turn.start', {
      threadId: binding.threadId,
      appServerGeneration: binding.appServerGeneration,
      message: 'NATIVE_TASK_FLOW',
    });
    await waitFor(
      async () =>
        worker
          .listRuntimeBindings()
          .some(
            (b) =>
              b.attemptId === binding.attemptId &&
              b.turnId !== binding.turnId &&
              b.state === 'completed'
          ),
      'Native MCP task reporting turn did not finish',
      45000
    );
    assert.equal(
      worker.listAssignments().find((a) => a.assignmentId === assignmentId)?.state,
      'verifying'
    );
    for (const type of ['assignment.progress', 'assignment.result_submitted']) {
      assert.ok(
        worker
          .listOutboxEvents()
          .some(
            (event) => event.envelope.type === type && event.envelope.assignmentId === assignmentId
          ),
        'Missing native MCP event ' + type
      );
    }
    await waitFor(
      async () =>
        deliveryMode === 'mcp-inbox'
          ? leadWorker
              .listMessages()
              .some(
                (message) =>
                  message.processedAt && message.payload.message.includes('NATIVE_TASK_REVIEW')
              )
          : responses.requests
              .slice(reportingOffset)
              .some(({ body }) =>
                JSON.stringify(body.input?.filter((item) => item.role === 'user').at(-1))?.includes(
                  'NATIVE_TASK_REVIEW'
                )
              ),
      'Lead native model did not receive the task review request',
      45000
    );
    await verifyNativeTaskFence({
      relay,
      worker,
      binding,
      peer: member.peer,
      teamId,
      membershipId: member.membershipId,
      nodeId: member.options.nodeId,
      managerToken,
      responses,
      control,
    });
    const revoked = await relay.app.inject({
      method: 'GET',
      url: `/v2/runtime-sessions/${runtime.sessionId}/events?after=0`,
      headers: { authorization: 'Bearer ' + runtime.sessionToken },
    });
    assert.equal(revoked.statusCode, 401, revoked.body);
    const result = {
      leadKind,
      deliveryMode,
      assignedRuntime: member.kind,
      assignmentId,
      assignmentOfferedAndAccepted: true,
      nativeTaskTurnCompleted: true,
      progressThroughNativeMcp: true,
      reviewReachedLead: true,
      reviewLeadModelObserved: true,
      resultCandidatePersisted: true,
      wrongLeaseRejected: true,
      nativeFollowupInterrupted: true,
      taskFenced: true,
      fencedResultRejected: true,
      successorTaskContextVerified: true,
      oldThreadDeniedSuccessorScope: true,
      runtimeSessionRevoked: true,
    };
    evidence.push(result);
    emit('task-flow-complete', result);
  } finally {
    responses.releaseHeld();
  }
};
