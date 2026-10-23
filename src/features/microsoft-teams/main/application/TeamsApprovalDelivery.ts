import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  approvalCard,
  approvalRecord as record,
  taskApprovalGrant,
} from '../../core/domain/approvalCards';

import type {
  TeamsApprovalJournal,
  TeamsApprovalRecord,
  TeamsBinding,
  TeamsConversation,
  TeamsDeliveryJournal,
} from '../../contracts';
import type { DistributedAgentTeamsFeatureFacade } from '@features/distributed-agent-teams/main';

interface Watch {
  scope: TeamsApprovalRecord['scope'];
  cursor: number;
  sessionId: string;
  generation?: number;
}

/** Owner-only UI for the existing lease-scoped approval.resolve control. */
export class TeamsApprovalDelivery {
  private readonly watches = new Map<string, Watch>();
  private ticking = false;
  private refreshing = false;

  constructor(
    private readonly framework: DistributedAgentTeamsFeatureFacade,
    private readonly bindings: readonly TeamsBinding[],
    private readonly conversations: TeamsDeliveryJournal,
    private readonly journal: TeamsApprovalJournal,
    private readonly send: (
      target: TeamsConversation,
      card: Record<string, unknown>
    ) => Promise<string>,
    private readonly reportError: (error: unknown) => void
  ) {
    const owners = new Set<string>();
    for (const b of bindings)
      for (const n of this.nodes(b)) {
        const key = `${b.tenantId}:${b.teamId}:${n.nodeId}`;
        if (owners.has(key)) throw new Error('A device must have exactly one approval owner');
        owners.add(key);
      }
  }

  private nodes(binding: TeamsBinding): { nodeId: string; label: string }[] {
    return [
      { nodeId: binding.nodeId, label: 'Your primary computer' },
      ...(binding.ownedNodes ?? []).filter((n) => n.nodeId !== binding.nodeId),
    ];
  }

  private settle(id: string, controlId: string, ok: boolean): void {
    const approval = this.journal.get(id);
    if (
      approval?.dispatch?.controlId !== controlId ||
      !['resolving', 'unknown'].includes(approval.state)
    )
      return;
    this.journal.transition(id, approval.state, ok ? 'resolved' : 'expired');
  }

  /** Read-only receipt recovery. The original approval control is never resubmitted. */
  private async reconcile(): Promise<void> {
    for (const old of this.journal.tracked()) {
      if (
        !old.dispatch ||
        old.dispatch.coverageLost ||
        !['resolving', 'unknown'].includes(old.state)
      )
        continue;
      try {
        const page = await this.framework.getRuntimeSession({
          ...old.scope,
          afterCursor: old.dispatch.cursor,
        });
        if (page.sessionId !== old.dispatch.sessionId || page.truncated) {
          this.journal.transition(old.id, old.state, 'unknown', {
            ...old.dispatch,
            coverageLost: true,
            receiptPending: true,
          });
          continue;
        }
        for (const event of page.events) {
          const payload = record(event.event.payload);
          if (event.event.kind === 'control.result' && payload.controlId === old.dispatch.controlId)
            this.settle(old.id, old.dispatch.controlId, payload.ok === true);
        }
        const current = this.journal.get(old.id);
        if (current?.dispatch && ['resolving', 'unknown'].includes(current.state))
          this.journal.transition(
            current.id,
            current.state,
            Date.now() - Date.parse(current.dispatch.submittedAt) > 30_000
              ? 'unknown'
              : current.state,
            {
              ...current.dispatch,
              cursor: page.nextCursor,
              ...(Date.now() - Date.parse(current.dispatch.submittedAt) > 30_000
                ? { receiptPending: true }
                : {}),
            }
          );
      } catch (error) {
        this.reportError(error);
        const current = this.journal.get(old.id);
        if (current?.dispatch && Date.now() - Date.parse(current.dispatch.submittedAt) > 30_000)
          this.journal.transition(current.id, current.state, 'unknown', {
            ...current.dispatch,
            receiptPending: true,
          });
      }
    }
    for (const approval of this.journal.tracked()) {
      const dispatch = approval.dispatch;
      if (
        !dispatch?.receiptPending ||
        !['resolved', 'expired', 'unknown'].includes(approval.state) ||
        dispatch.notifiedState === approval.state ||
        !this.owns(approval, approval.target)
      )
        continue;
      const text =
        approval.state === 'resolved'
          ? `${approval.nodeLabel}: your ${dispatch.decision === 'accept' ? 'approval' : 'decline'} was confirmed delivered.${dispatch.grantKey ? ` ${taskApprovalGrant(approval)?.description ?? 'Approved for this task only.'}` : ''}`
          : approval.state === 'expired'
            ? `${approval.nodeLabel}: the agent rejected an expired or changed approval. No new permission was granted.`
            : `${approval.nodeLabel}: approval delivery is not yet confirmed. Nothing was submitted again.${dispatch.coverageLost ? ' Send "approval status" to check the current request.' : ' Receipt checks will continue in the background.'}`;
      this.conversations.enqueue(
        `approval:${approval.id}:${dispatch.controlId}:${approval.state}`,
        approval.target,
        text
      );
      this.journal.transition(approval.id, approval.state, approval.state, {
        ...dispatch,
        notifiedState: approval.state as 'resolved' | 'expired' | 'unknown',
      });
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.reconcile();
      const snapshot = await this.framework.getDebugSnapshot();
      for (const binding of this.bindings) {
        const target = this.conversations.conversation(binding);
        if (!target) continue;
        for (const node of this.nodes(binding)) {
          try {
            const lease = snapshot.leases.find(
              (l) =>
                l.nodeId === node.nodeId &&
                l.teamId === binding.teamId &&
                l.status === 'active' &&
                Date.parse(l.expiresAt) > Date.now()
            );
            if (!lease) {
              this.watches.delete(node.nodeId);
              continue;
            }
            const scope = {
              teamId: binding.teamId,
              nodeId: node.nodeId,
              assignmentId: lease.assignmentId,
              attemptId: lease.attemptId,
              leaseEpoch: lease.leaseEpoch,
            };
            let watch = this.watches.get(node.nodeId);
            if (!watch || JSON.stringify(watch.scope) !== JSON.stringify(scope)) {
              const page = await this.framework.getRuntimeSession(scope);
              watch = { scope, cursor: page.nextCursor, sessionId: page.sessionId };
              this.watches.set(node.nodeId, watch);
              await this.framework.sendRuntimeControl({
                session: scope,
                control: { controlId: randomUUID(), type: 'runtime.snapshot', payload: {} },
              });
            }
            const page = await this.framework.getRuntimeSession({
              ...scope,
              afterCursor: watch.cursor,
            });
            if (page.sessionId !== watch.sessionId || page.truncated) {
              this.watches.delete(node.nodeId);
              throw new Error('Approval coverage changed; reloading pending requests');
            }
            for (const item of page.events) {
              const payload = record(item.event.payload);
              if (item.event.kind === 'runtime.snapshot') {
                const b = record(payload.binding);
                if (typeof b.appServerGeneration === 'number')
                  watch.generation = b.appServerGeneration;
              }
              if (
                item.event.kind !== 'app-server.request' ||
                typeof payload.method !== 'string' ||
                !['string', 'number'].includes(typeof payload.id)
              )
                continue;
              const params = record(payload.params);
              if (
                typeof params.threadId !== 'string' ||
                typeof params.turnId !== 'string' ||
                watch.generation === undefined
              )
                continue;
              const fingerprint = createHash('sha256')
                .update(
                  JSON.stringify([scope, watch.generation, payload.id, payload.method, params])
                )
                .digest('hex');
              this.journal.add({
                id: randomUUID(),
                key: fingerprint,
                target,
                nodeLabel:
                  snapshot.membershipRoutes.find(
                    (m) =>
                      m.nodeId === node.nodeId &&
                      m.teamId === binding.teamId &&
                      m.status === 'active'
                  )?.label ?? node.label,
                scope,
                threadId: params.threadId,
                turnId: params.turnId,
                appServerGeneration: watch.generation,
                request: { id: payload.id as number | string, method: payload.method, params },
                state: 'pending',
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
              });
            }
            watch.cursor = page.nextCursor;
          } catch (error) {
            this.reportError(error);
          }
        }
      }
      for (const approval of this.journal.pending()) {
        if (Date.parse(approval.expiresAt) < Date.now()) {
          this.journal.transition(approval.id, 'pending', 'expired');
          continue;
        }
        if (!this.owns(approval, approval.target)) continue;
        const grant = taskApprovalGrant(approval);
        if (grant && this.journal.hasTaskGrant(grant.key)) {
          await this.submit(approval, 'accept', {}, {}, false, 'task');
          continue;
        }
        if (!this.journal.transition(approval.id, 'pending', 'sending')) continue;
        try {
          await this.send(approval.target, approvalCard(approval));
          this.journal.transition(approval.id, 'sending', 'shown');
        } catch (error) {
          this.journal.transition(approval.id, 'sending', 'unknown');
          this.reportError(error);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private owns(approval: TeamsApprovalRecord, caller: TeamsConversation): boolean {
    return (
      caller.tenantId === approval.target.tenantId &&
      caller.aadObjectId === approval.target.aadObjectId &&
      caller.conversationId === approval.target.conversationId &&
      this.bindings.some(
        (b) =>
          b.tenantId === caller.tenantId &&
          b.aadObjectId === caller.aadObjectId &&
          b.teamId === approval.scope.teamId &&
          this.nodes(b).some((n) => n.nodeId === approval.scope.nodeId)
      )
    );
  }

  /** Explicit owner status check: redisplay only after a fresh Worker snapshot proves it is pending. */
  async refreshUnknown(caller: TeamsConversation): Promise<string> {
    if (this.refreshing)
      return 'An approval status check is already in progress. No permission was granted.';
    this.refreshing = true;
    try {
      return await this.refreshPending(caller);
    } finally {
      this.refreshing = false;
    }
  }

  private async refreshPending(caller: TeamsConversation): Promise<string> {
    await this.reconcile();
    let refreshed = 0;
    const snapshot = await this.framework.getDebugSnapshot();
    for (const old of this.journal.unconfirmed().filter((a) => this.owns(a, caller))) {
      if (
        old.dispatch &&
        !old.dispatch.coverageLost &&
        ['resolving', 'unknown'].includes(old.state)
      )
        continue;
      const active = snapshot.leases.some(
        (l) =>
          l.teamId === old.scope.teamId &&
          l.nodeId === old.scope.nodeId &&
          l.assignmentId === old.scope.assignmentId &&
          l.attemptId === old.scope.attemptId &&
          l.leaseEpoch === old.scope.leaseEpoch &&
          l.status === 'active' &&
          Date.parse(l.expiresAt) > Date.now()
      );
      if (!active) {
        this.journal.transition(old.id, old.state, 'expired');
        continue;
      }
      try {
        let page = await this.framework.getRuntimeSession(old.scope);
        let cursor = page.nextCursor;
        const controlId = randomUUID();
        await this.framework.sendRuntimeControl({
          session: old.scope,
          control: { controlId, type: 'runtime.snapshot', payload: {} },
        });
        let binding: Record<string, unknown> = {};
        let pending: Record<string, unknown> | undefined;
        let confirmed = false;
        const deadline = Date.now() + 4000;
        while (!confirmed && Date.now() < deadline) {
          page = await this.framework.getRuntimeSession({ ...old.scope, afterCursor: cursor });
          cursor = page.nextCursor;
          for (const event of page.events) {
            const p = record(event.event.payload);
            if (event.event.kind === 'runtime.snapshot') binding = record(p.binding);
            if (
              event.event.kind === 'app-server.request' &&
              p.id === old.request.id &&
              p.method === old.request.method
            )
              pending = p;
            if (event.event.kind === 'control.result' && p.controlId === controlId && p.ok === true)
              confirmed = true;
          }
          if (!confirmed) await delay(100);
        }
        if (!confirmed) continue;
        if (
          pending &&
          binding.appServerGeneration === old.appServerGeneration &&
          binding.threadId === old.threadId &&
          binding.turnId === old.turnId
        ) {
          if (!this.journal.transition(old.id, old.state, 'expired')) continue;
          this.journal.add({
            ...old,
            id: randomUUID(),
            key: `${old.key}:confirmed:${controlId}`,
            state: 'pending',
            request: { ...old.request, params: record(pending.params) },
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          });
          refreshed++;
        } else this.journal.transition(old.id, old.state, 'expired');
      } catch (error) {
        // A stale or unavailable stream must not prevent checking another owned device.
        this.reportError(error);
      }
    }
    await this.tick();
    if (
      !refreshed &&
      this.journal
        .tracked()
        .some(
          (a) =>
            this.owns(a, caller) &&
            a.dispatch &&
            !a.dispatch.coverageLost &&
            ['resolving', 'unknown'].includes(a.state)
        )
    )
      return 'Your choice was already received. Receipt checks continue in the background. No approval was submitted again.';
    return refreshed
      ? 'The Worker confirmed a pending request. Review the new approval card. No permission was granted by this status check.'
      : 'No unconfirmed approval was confirmed pending. No permission was granted or resubmitted.';
  }

  async resolve(
    caller: TeamsConversation,
    id: string,
    decision: 'accept' | 'decline',
    inputs: Record<string, unknown> = {}
  ): Promise<string> {
    const approval = this.journal.get(id);
    if (!approval || !this.owns(approval, caller))
      throw new Error('This approval belongs to another device owner or conversation');
    if (approval.state === 'resolved')
      return 'This request was already answered. Your choice was delivered to your agent. Nothing was submitted again.';
    if (approval.state === 'expired')
      return 'This card expired or was replaced. Use the newest approval card in this chat. No permission was granted by this click.';
    if (approval.state !== 'shown')
      return approval.dispatch && !approval.dispatch.coverageLost
        ? 'This choice was already received. Receipt checks continue in the background. Nothing was submitted again.'
        : 'This choice has not been confirmed yet. Send "approval status" to check it. Nothing was submitted again.';
    const answers: Record<string, string[]> = {};
    const form: Record<string, string | number | boolean> = {};
    if (approval.request.method === 'mcpServer/elicitation/request')
      Object.entries(record(record(approval.request.params.requestedSchema).properties)).forEach(
        ([key, raw], index) => {
          const field = record(raw);
          const input = inputs[`form_${index}`];
          if (typeof input !== 'string' && typeof input !== 'number' && typeof input !== 'boolean')
            return;
          if (Array.isArray(field.enum)) {
            const chosen = field.enum.find((v) => String(v) === String(input));
            if (['string', 'number', 'boolean'].includes(typeof chosen))
              form[key] = chosen as string | number | boolean;
          } else if (field.type === 'boolean' && ['true', 'false'].includes(String(input)))
            form[key] = String(input) === 'true';
          else if (
            (field.type === 'number' || field.type === 'integer') &&
            String(input).trim() &&
            Number.isFinite(Number(input))
          )
            form[key] = Number(input);
          else if (field.type === 'string') form[key] = String(input).slice(0, 2000);
        }
      );
    if (
      approval.request.method === 'tool/requestUserInput' &&
      Array.isArray(approval.request.params.questions)
    )
      approval.request.params.questions.forEach((value, index) => {
        const q = record(value);
        if (typeof q.id === 'string' && typeof inputs[`answer_${index}`] === 'string')
          answers[q.id] = [String(inputs[`answer_${index}`]).slice(0, 2000)];
      });
    return this.submit(approval, decision, answers, form, inputs.forTask === true, 'owner');
  }

  private async submit(
    approval: TeamsApprovalRecord,
    decision: 'accept' | 'decline',
    answers: Record<string, string[]>,
    form: Record<string, string | number | boolean>,
    forTask: boolean,
    source: 'owner' | 'task'
  ): Promise<string> {
    const id = approval.id;
    const snapshot = await this.framework.getDebugSnapshot();
    if (
      !snapshot.leases.some(
        (l) =>
          l.nodeId === approval.scope.nodeId &&
          l.teamId === approval.scope.teamId &&
          l.assignmentId === approval.scope.assignmentId &&
          l.attemptId === approval.scope.attemptId &&
          l.leaseEpoch === approval.scope.leaseEpoch &&
          l.status === 'active' &&
          Date.parse(l.expiresAt) > Date.now()
      ) ||
      Date.parse(approval.expiresAt) < Date.now()
    ) {
      this.journal.transition(id, approval.state, 'expired');
      return 'This approval expired. No permission was granted.';
    }
    let page = await this.framework.getRuntimeSession(approval.scope);
    const cursor = page.nextCursor;
    const controlId = randomUUID();
    const grantKey =
      decision === 'accept' && forTask && source === 'owner'
        ? taskApprovalGrant(approval)?.key
        : undefined;
    const dispatch: NonNullable<TeamsApprovalRecord['dispatch']> = {
      controlId,
      decision,
      sessionId: page.sessionId,
      cursor,
      submittedAt: new Date().toISOString(),
      source,
      ...(grantKey ? { grantKey } : {}),
    };
    if (!this.journal.transition(id, approval.state, 'resolving', dispatch))
      return 'This approval was already received. Nothing was submitted again.';
    try {
      await this.framework.sendRuntimeControl({
        session: approval.scope,
        control: {
          controlId,
          type: 'approval.resolve',
          payload: {
            approvalRequestId: approval.request.id,
            decision,
            expectedThreadId: approval.threadId,
            expectedTurnId: approval.turnId,
            appServerGeneration: approval.appServerGeneration,
            ...(Object.keys(answers).length ? { answers } : {}),
            ...(Object.keys(form).length ? { form } : {}),
          },
        },
      });
      // One immediate read only. Remote delivery is reconciled by tick(), not
      // by holding the Teams invoke open while a remote Worker responds.
      page = await this.framework.getRuntimeSession({ ...approval.scope, afterCursor: cursor });
      if (page.sessionId !== dispatch.sessionId || page.truncated)
        throw new Error('Approval receipt coverage changed');
      for (const e of page.events) {
        const p = record(e.event.payload);
        if (e.event.kind === 'control.result' && p.controlId === controlId) {
          this.settle(id, controlId, p.ok === true);
        }
      }
      const current = this.journal.get(id);
      if (current?.state === 'resolved')
        return decision === 'accept'
          ? `Your choice was delivered to your agent. It can continue.${grantKey ? ' Approved for this task only.' : ''}`
          : 'Declined. Your agent received your decision.';
      if (current?.state === 'expired')
        return 'The agent rejected an expired or changed request. No new permission was granted.';
    } catch (error) {
      this.journal.transition(id, 'resolving', 'unknown');
      this.reportError(error);
    }
    const current = this.journal.get(id);
    if (current?.state === 'resolved')
      return 'Your choice was delivered to your agent. It can continue.';
    if (current?.state === 'expired')
      return 'The agent rejected an expired or changed request. No new permission was granted.';
    if (current?.dispatch && source === 'owner')
      this.journal.transition(id, current.state, current.state, {
        ...current.dispatch,
        receiptPending: true,
      });
    return 'Your choice was received. Waiting for your agent to confirm delivery; we will update you here. Nothing will be submitted again.';
  }
}
