import { finalAgentReply, runtimeReplyKey } from '../../core/domain/runtimeReplies';

import type { TeamsBinding, TeamsConversation, TeamsDeliveryJournal } from '../../contracts';
import type { GetDistributedRuntimeSessionRequest } from '@features/distributed-agent-teams/contracts';
import type { DistributedAgentTeamsFeatureFacade } from '@features/distributed-agent-teams/main';

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

interface RuntimeWatch {
  scope: GetDistributedRuntimeSessionRequest;
  cursor: number;
  sessionId: string;
  turns: Map<string, { messages: Map<string, string>; phases: Map<string, string> }>;
}

/** Observes the existing private runtime stream; never starts or retries agent work. */
export class TeamsResultDelivery {
  private readonly watches = new Map<string, RuntimeWatch>();
  private ticking = false;

  constructor(
    private readonly framework: DistributedAgentTeamsFeatureFacade,
    private readonly bindings: readonly TeamsBinding[],
    private readonly journal: TeamsDeliveryJournal,
    private readonly send: (target: TeamsConversation, text: string) => Promise<string>,
    private readonly reportError: (error: unknown) => void
  ) {}

  async activate(binding: TeamsBinding): Promise<void> {
    const snapshot = await this.framework.getDebugSnapshot();
    const member = snapshot.membershipRoutes.find(
      (candidate) =>
        candidate.teamId === binding.teamId &&
        candidate.nodeId === binding.nodeId &&
        candidate.status === 'active'
    );
    const lease = snapshot.leases.find(
      (candidate) =>
        candidate.teamId === binding.teamId &&
        candidate.nodeId === binding.nodeId &&
        candidate.status === 'active' &&
        Date.parse(candidate.expiresAt) > Date.now()
    );
    if (!member || !lease) {
      this.watches.delete(binding.nodeId);
      return;
    }
    const scope = {
      teamId: binding.teamId,
      nodeId: binding.nodeId,
      assignmentId: lease.assignmentId,
      attemptId: lease.attemptId,
      leaseEpoch: lease.leaseEpoch,
    };
    const previous = this.watches.get(binding.nodeId);
    if (previous && runtimeReplyKey(previous.scope, '') === runtimeReplyKey(scope, '')) return;
    // Establish coverage before dispatching a Teams request. Existing history is not replayed.
    const page = await this.framework.getRuntimeSession(scope);
    this.watches.set(binding.nodeId, {
      scope,
      cursor: page.nextCursor,
      sessionId: page.sessionId,
      turns: new Map(),
    });
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const binding of this.bindings) {
        const target = this.journal.conversation(binding);
        if (!target) continue;
        try {
          await this.activate(binding);
          const watch = this.watches.get(binding.nodeId);
          if (!watch) continue;
          const page = await this.framework.getRuntimeSession({
            ...watch.scope,
            afterCursor: watch.cursor,
          });
          if (page.sessionId !== watch.sessionId || page.truncated) {
            // A replacement subscription cannot prove coverage of the missing interval.
            watch.turns.clear();
            watch.sessionId = page.sessionId;
            watch.cursor = page.nextCursor;
            throw new Error(
              'Teams result stream coverage changed; inspect runtime diagnostics for missed results'
            );
          }
          for (const item of page.events) {
            if (item.event.kind !== 'app-server.notification') continue;
            const notification = record(item.event.payload);
            const params = record(notification.params);
            const turn = record(params.turn);
            const turnId = params.turnId ?? turn.id;
            if (typeof turnId !== 'string') continue;
            const output = watch.turns.get(turnId) ?? {
              messages: new Map<string, string>(),
              phases: new Map<string, string>(),
            };
            watch.turns.set(turnId, output);
            if (notification.method === 'item/completed') {
              const completed = record(params.item);
              if (completed.type === 'agentMessage' && typeof completed.text === 'string') {
                const id = String(completed.id);
                output.messages.set(id, completed.text);
                if (typeof completed.phase === 'string') output.phases.set(id, completed.phase);
              }
            }
            if (notification.method === 'turn/completed') {
              const text = finalAgentReply(output.messages, output.phases);
              if (turn.status === 'completed' && text)
                this.journal.enqueue(runtimeReplyKey(watch.scope, turnId), target, text);
              watch.turns.delete(turnId);
            }
          }
          watch.cursor = page.nextCursor;
        } catch (error) {
          this.reportError(error);
        }
      }
      for (const delivery of this.journal.pending()) {
        if (
          !this.bindings.some(
            (binding) =>
              binding.tenantId === delivery.target.tenantId &&
              binding.aadObjectId === delivery.target.aadObjectId &&
              binding.nodeId === delivery.target.nodeId &&
              binding.teamId === delivery.target.teamId
          )
        )
          continue;
        if (!this.journal.claim(delivery.key)) continue;
        try {
          this.journal.settle(delivery.key, await this.send(delivery.target, delivery.text));
        } catch (error) {
          // Teams may have accepted a timed-out HTTP request. Do not blindly duplicate it.
          this.journal.settle(delivery.key);
          this.reportError(error);
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
