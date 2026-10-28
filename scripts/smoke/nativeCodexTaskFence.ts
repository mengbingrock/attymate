/** Verify an old native thread cannot inherit a later assignment's live MCP credentials. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { startAgentTeamsRelay } from '../../packages/agent-teams-relay/src/relayServer';
import type { WorkerCodexAppServerSession } from '../../packages/agent-teams-worker/src/codexAppServerClient';
import type { StartedAgentTeamsWorker } from '../../packages/agent-teams-worker/src/workerDaemon';
import type { WorkerRuntimeBinding } from '../../packages/agent-teams-worker/src/workerRuntimeStore';
import { callRuntimeTool, waitFor } from './nativeCodexFixture';
import type { startResponsesFixture } from './nativeResponsesFixture';

export const verifyNativeTaskFence = async (options: {
  relay: Awaited<ReturnType<typeof startAgentTeamsRelay>>;
  worker: StartedAgentTeamsWorker;
  binding: WorkerRuntimeBinding;
  peer: WorkerCodexAppServerSession;
  teamId: string;
  membershipId: string;
  nodeId: string;
  managerToken: string;
  responses: Awaited<ReturnType<typeof startResponsesFixture>>;
  control: (type: string, payload: unknown) => Promise<void>;
}) => {
  const {
    relay,
    worker,
    binding,
    peer,
    teamId,
    membershipId,
    nodeId,
    managerToken,
    responses,
    control,
  } = options;
  const threadId = binding.threadId!;
  await control('turn.start', {
    threadId,
    appServerGeneration: binding.appServerGeneration,
    message: 'NATIVE_TASK_HOLD',
  });
  await waitFor(
    async () =>
      responses.heldCount > 0 &&
      worker
        .listRuntimeBindings()
        .some((b) => b.attemptId === binding.attemptId && b.state === 'active'),
    'Native follow-up turn did not enter active state'
  );
  await peer.request('thread/resume', { threadId });
  assert.ok(
    (await callRuntimeTool(peer, threadId, 'runtime_context')).includes(binding.assignmentId)
  );
  const route = worker
    .listTeamMemberships()
    .find((team) => team.teamId === teamId)!
    .members.find((member) => member.membershipId === membershipId)!;
  // Queue the successor before fencing so heartbeat reactivation cannot win the serial queue.
  const nextRequestOffset = responses.requests.length;
  const offered = await relay.app.inject({
    method: 'POST',
    url: `/v2/teams/${teamId}/members`,
    headers: { authorization: 'Bearer ' + managerToken },
    payload: {
      targetNodeId: nodeId,
      membershipId,
      workspaceId: route.workspaceId,
      role: 'member',
      title: 'NATIVE_TASK_HOLD',
      description: 'Disposable successor task for native credential isolation.',
    },
  });
  assert.equal(offered.statusCode, 201, offered.body);
  const nextAssignmentId = offered.json().assignmentId as string;
  await control('turn.interrupt', { reason: 'native_smoke_cancel' });
  await waitFor(
    async () =>
      worker.listAssignments().find((a) => a.assignmentId === binding.assignmentId)?.state ===
      'fenced',
    'Native task lease was not fenced'
  );
  const assertOldScopeDenied = async () => {
    for (const [tool, arguments_] of [
      ['runtime_context', {}],
      ['result_submit', { outcome: 'completed', summary: 'Must reject old task thread' }],
    ] as const) {
      const denied = await peer.request('mcpServer/tool/call', {
        threadId,
        server: 'agent-teams-runtime',
        tool,
        arguments: arguments_,
      });
      assert.ok(
        JSON.stringify(denied).includes('"isError":true'),
        'Old native task thread invoked ' + tool
      );
    }
  };
  await assertOldScopeDenied();
  await waitFor(
    async () =>
      worker
        .listRuntimeBindings()
        .some((b) => b.assignmentId === nextAssignmentId && b.state === 'active') &&
      responses.requests
        .slice(nextRequestOffset)
        .some(({ body }) =>
          JSON.stringify(body.input?.filter((item) => item.role === 'user').at(-1))?.includes(
            'NATIVE_TASK_HOLD'
          )
        ),
    'Successor native task did not enter a held active turn',
    45000
  );
  const next = worker.listRuntimeBindings().find((b) => b.assignmentId === nextAssignmentId)!;
  assert.ok(next.threadId && next.attemptId !== binding.attemptId);
  await peer.request('thread/resume', { threadId: next.threadId });
  const nextContext = await callRuntimeTool(peer, next.threadId, 'runtime_context');
  assert.ok(nextContext.includes(nextAssignmentId), 'Successor native MCP context is unavailable');
  assert.ok(
    !nextContext.includes(binding.assignmentId),
    'Successor inherited old assignment context'
  );
  await assertOldScopeDenied();
  assert.ok(
    !worker
      .listOutboxEvents()
      .some(
        (event) =>
          event.envelope.type === 'assignment.result_submitted' &&
          event.envelope.assignmentId === nextAssignmentId
      ),
    'Old task submitted a result for its successor'
  );
  const assignment = worker.listAssignments().find((a) => a.assignmentId === nextAssignmentId)!;
  const created = await relay.app.inject({
    method: 'POST',
    url: '/v2/runtime-sessions',
    headers: { authorization: 'Bearer ' + managerToken },
    payload: {
      teamId,
      nodeId,
      assignmentId: nextAssignmentId,
      attemptId: assignment.attemptId,
      leaseEpoch: assignment.leaseEpoch,
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const runtime = created.json() as { sessionId: string; sessionToken: string };
  const cancelled = await relay.app.inject({
    method: 'POST',
    url: `/v2/runtime-sessions/${runtime.sessionId}/controls`,
    headers: { authorization: 'Bearer ' + runtime.sessionToken },
    payload: {
      controlId: randomUUID(),
      type: 'turn.interrupt',
      payload: { reason: 'native_smoke_successor_cleanup' },
    },
  });
  assert.equal(cancelled.statusCode, 202, cancelled.body);
  await waitFor(
    async () =>
      worker.listAssignments().find((a) => a.assignmentId === nextAssignmentId)?.state === 'fenced',
    'Successor native task cleanup failed'
  );
};
