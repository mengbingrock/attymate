import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { finalAgentReply, runtimeReplyKey } from '../../core/domain/runtimeReplies';

import type { TeamsBinding, TeamsResponse, TeamsRuntimePort } from '../../contracts';
import type {
  DistributedDebugSnapshotDto,
  DistributedRuntimeSessionDto,
  GetDistributedRuntimeSessionRequest,
} from '@features/distributed-agent-teams/contracts';
import type { DistributedAgentTeamsFeatureFacade } from '@features/distributed-agent-teams/main';

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const failedTurnReply = (error: unknown): string => {
  const message = typeof error === 'string' ? error : record(error).message;
  return typeof message === 'string' && /429|too many requests|rate.?limit/i.test(message)
    ? 'The model is temporarily limiting requests (429). The agent turn failed and automatic retries are stopped. The operator needs to recover the agent after the limit clears.'
    : 'The last agent turn failed and automatic retries are stopped. The operator needs to recover the agent before it can take more work.';
};

const latestFailure = (
  snapshot: DistributedDebugSnapshotDto,
  binding: TeamsBinding,
  scope?: GetDistributedRuntimeSessionRequest
): string | undefined => {
  const latest = snapshot.events
    .filter(
      (event) =>
        event.teamId === binding.teamId &&
        event.sourceNodeId === binding.nodeId &&
        (scope === undefined ||
          (event.assignmentId === scope.assignmentId && event.attemptId === scope.attemptId)) &&
        event.type === 'assignment.state_changed'
    )
    .sort((a, b) => a.cursor - b.cursor)
    .at(-1);
  const payload = record(latest?.payload);
  return payload.state === 'failed' ? failedTurnReply(payload.reason) : undefined;
};

export class RelayTeamsRuntime implements TeamsRuntimePort {
  constructor(private readonly framework: DistributedAgentTeamsFeatureFacade) {}

  private async pollRuntime(
    binding: TeamsBinding,
    scope: GetDistributedRuntimeSessionRequest
  ): Promise<
    { page: DistributedRuntimeSessionDto; failure?: never } | { failure: string; page?: never }
  > {
    try {
      return { page: await this.framework.getRuntimeSession(scope) };
    } catch (error) {
      // Failure releases the execution lease before its final runtime notification
      // can be read. Confirm it from durable, exactly scoped assignment events.
      const failure = latestFailure(await this.framework.getDebugSnapshot(), binding, scope);
      if (failure !== undefined) return { failure };
      throw error;
    }
  }

  async status(binding: TeamsBinding): Promise<string> {
    const topology = await this.framework.getTopology();
    const worker = topology.workers.find((candidate) => candidate.nodeId === binding.nodeId);
    if (worker?.status !== 'connected')
      return 'Your worker is offline or unavailable. No work has been started.';
    return (
      latestFailure(await this.framework.getDebugSnapshot(), binding) ??
      'Your worker is connected to the relay.'
    );
  }

  async exchange(binding: TeamsBinding, text: string): Promise<string> {
    return (await this.exchangeResponse(binding, text)).text;
  }

  async exchangeResponse(binding: TeamsBinding, text: string): Promise<TeamsResponse> {
    const snapshot = await this.framework.getDebugSnapshot();
    const membership = snapshot.membershipRoutes.find(
      (member) =>
        member.teamId === binding.teamId &&
        member.nodeId === binding.nodeId &&
        member.status === 'active'
    );
    if (membership === undefined) throw new Error('Pilot membership is not provisioned');
    const lease = snapshot.leases.find(
      (candidate) =>
        candidate.teamId === binding.teamId &&
        candidate.nodeId === binding.nodeId &&
        candidate.status === 'active' &&
        Date.parse(candidate.expiresAt) > Date.now()
    );
    if (lease === undefined)
      return {
        text:
          latestFailure(snapshot, binding) ??
          'Your agent has no active session. Your message was not sent. Ask the operator to recover the agent.',
      };
    const scope = {
      teamId: binding.teamId,
      nodeId: binding.nodeId,
      assignmentId: lease.assignmentId,
      attemptId: lease.attemptId,
      leaseEpoch: lease.leaseEpoch,
    };
    await this.framework.sendRuntimeControl({
      session: scope,
      control: { controlId: randomUUID(), type: 'runtime.snapshot', payload: {} },
    });
    let cursor = 0;
    let runtime: Record<string, unknown> | undefined;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && runtime === undefined) {
      const result = await this.pollRuntime(binding, { ...scope, afterCursor: cursor });
      if (result.failure !== undefined) return { text: result.failure };
      const page = result.page;
      if (page.truncated) throw new Error('Runtime event coverage is incomplete');
      cursor = page.nextCursor;
      for (const item of page.events) {
        if (item.event.kind === 'runtime.snapshot')
          runtime = record(record(item.event.payload).binding);
      }
      if (runtime === undefined) await delay(200);
    }
    if (runtime?.state === 'failed') return { text: failedTurnReply(runtime.error) };
    if (typeof runtime?.threadId !== 'string' || typeof runtime.appServerGeneration !== 'number')
      throw new Error('The runtime is not ready');
    const active = runtime.state === 'active';
    if (!active && runtime.state !== 'completed')
      throw new Error('The runtime needs operator recovery');
    if (active && typeof runtime.turnId !== 'string') throw new Error('The active turn is unknown');
    const message = `${text}\n\nTeams delivery instructions: Your final answer is automatically delivered to the owner in this private Teams chat. Include the requested answer, findings and actual results in that final answer. An internal result submission or an acknowledgment alone does not answer the owner. Do not send a separate Teams message through another tool for this reply. Use English.`;
    const submittedControlId = randomUUID();
    await this.framework.sendRuntimeControl({
      session: scope,
      control: active
        ? {
            controlId: submittedControlId,
            type: 'turn.steer',
            payload: {
              threadId: runtime.threadId,
              expectedTurnId: runtime.turnId as string,
              appServerGeneration: runtime.appServerGeneration,
              message,
            },
          }
        : {
            controlId: submittedControlId,
            type: 'turn.start',
            payload: {
              threadId: runtime.threadId,
              appServerGeneration: runtime.appServerGeneration,
              message,
            },
          },
    });
    let turnId = active ? (runtime.turnId as string) : undefined;
    const messages = new Map<string, string>();
    const phases = new Map<string, string>();
    let dispatchConfirmed = false;
    let statusControlId: string | undefined;
    let statusDeadline = deadline;
    let currentStatus: Record<string, unknown> | undefined;
    let statusConfirmed = false;
    for (;;) {
      if (Date.now() >= deadline && statusControlId === undefined) {
        // A long turn can outlive the synchronous reply window. Confirm its
        // exact live status without starting, steering or approving work again.
        statusControlId = randomUUID();
        statusDeadline = Date.now() + 4000;
        await this.framework.sendRuntimeControl({
          session: scope,
          control: { controlId: statusControlId, type: 'runtime.snapshot', payload: {} },
        });
      }
      if (statusControlId !== undefined && Date.now() >= statusDeadline) break;
      const result = await this.pollRuntime(binding, { ...scope, afterCursor: cursor });
      if (result.failure !== undefined) return { text: result.failure };
      const page = result.page;
      if (page.truncated) throw new Error('Runtime event coverage is incomplete');
      cursor = page.nextCursor;
      for (const item of page.events) {
        const event = item.event;
        const payload = record(event.payload);
        if (event.kind === 'control.result' && payload.controlId === submittedControlId) {
          if (payload.ok !== true) throw new Error('The Worker rejected the request');
          dispatchConfirmed = true;
        }
        if (statusControlId !== undefined) {
          if (event.kind === 'runtime.snapshot') currentStatus = record(payload.binding);
          if (event.kind === 'control.result' && payload.controlId === statusControlId)
            statusConfirmed = payload.ok === true;
        }
        if (event.kind === 'app-server.request')
          return {
            text: 'Your agent needs your approval. Check the approval card in this Teams chat; the action has not been approved yet.',
          };
        if (event.kind !== 'app-server.notification') continue;
        const notification = record(event.payload);
        const params = record(notification.params);
        const turn = record(params.turn);
        if (notification.method === 'turn/started' && typeof turn.id === 'string') turnId = turn.id;
        const eventTurnId = params.turnId ?? turn.id;
        if (turnId === undefined || eventTurnId !== turnId) continue;
        if (notification.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
          const id = String(params.itemId);
          messages.set(id, (messages.get(id) ?? '') + params.delta);
        }
        if (notification.method === 'item/completed') {
          const completed = record(params.item);
          if (completed.type === 'agentMessage') {
            const id = String(completed.id);
            if (typeof completed.text === 'string') messages.set(id, completed.text);
            if (typeof completed.phase === 'string') phases.set(id, completed.phase);
          }
        }
        if (notification.method === 'turn/completed') {
          if (turn.status === 'failed') return { text: failedTurnReply(turn.error) };
          if (turn.status !== 'completed') throw new Error('The agent turn did not complete');
          return {
            text:
              finalAgentReply(messages, phases) ||
              'The agent completed its turn without a text reply. Check the desktop session.',
            deliveryKey: runtimeReplyKey(scope, turnId),
          };
        }
      }
      if (statusConfirmed) {
        if (
          dispatchConfirmed &&
          typeof turnId === 'string' &&
          currentStatus?.threadId === runtime.threadId &&
          currentStatus.turnId === turnId &&
          currentStatus.appServerGeneration === runtime.appServerGeneration &&
          currentStatus.state === 'active'
        )
          return {
            text: 'Your agent is still working. Its final reply will be posted here automatically. Your request has not been submitted again.',
          };
        break;
      }
      await delay(300);
    }
    throw new Error('Reply status is unknown after timeout');
  }
}
