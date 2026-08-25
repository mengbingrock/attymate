import type {
  ExecutionLeaseIdentity,
  RuntimeSessionContext,
} from '@claude-teams/agent-teams-protocol';

import type {
  CodexAppServerNotification,
  CodexAppServerRequest,
  CodexAppServerSessionClosed,
  WorkerCodexAppServerSession,
  WorkerCodexAppServerSessionFactory,
} from './codexAppServerClient';
import type { WorkerAssignment } from './workerAssignmentStore';
import {
  assertRestrictedRuntimeMcpInventory,
  buildRestrictedRuntimeMcpConfig,
  readConfiguredPluginNames,
  readConfiguredMcpServerNames,
  type CodexRuntimeMcpLaunchSpec,
} from './codexRuntimeMcpProfile';
import { WorkerRuntimeStore, type WorkerRuntimeBinding } from './workerRuntimeStore';
import {
  WorkerRuntimeSessionStore,
  type CreatedRuntimeMcpSession,
} from './workerRuntimeSessionStore';

export interface WorkerCodexRuntimeOptions {
  readonly dataDir: string;
  readonly cwd: string;
  readonly sessionFactory: WorkerCodexAppServerSessionFactory;
  readonly model?: string;
  readonly runtimeIdentity?: {
    readonly organizationId: string;
    readonly personId: string;
    readonly nodeId: string;
    readonly workerInstanceId: string;
  };
  readonly runtimeMcp?: CodexRuntimeMcpLaunchSpec;
  readonly onStarted?: (binding: WorkerRuntimeBinding) => void;
  readonly onRecovered?: (binding: WorkerRuntimeBinding) => void;
  readonly onCompleted?: (binding: WorkerRuntimeBinding) => void;
  readonly onFailed?: (binding: WorkerRuntimeBinding, error: Error) => void;
  readonly onRuntimeEvent?: (
    binding: WorkerRuntimeBinding,
    notification: CodexAppServerNotification
  ) => void;
  readonly onRuntimeRequest?: (
    binding: WorkerRuntimeBinding,
    request: CodexAppServerRequest
  ) => void;
  readonly canRecover?: (binding: WorkerRuntimeBinding) => boolean;
  readonly onReconciliationRequired?: (binding: WorkerRuntimeBinding, error: Error) => void;
}

interface ThreadStartResponse {
  readonly thread?: { readonly id?: unknown };
}

interface TurnStartResponse {
  readonly turn?: { readonly id?: unknown; readonly status?: unknown };
}

interface TurnSteerResponse {
  readonly turnId?: unknown;
}

export interface WorkerRuntimeSteerInput extends ExecutionLeaseIdentity {
  readonly threadId: string;
  readonly expectedTurnId: string;
  readonly appServerGeneration: number;
  readonly message: string;
}

export interface WorkerRuntimeStartTurnInput extends ExecutionLeaseIdentity {
  readonly threadId: string;
  readonly appServerGeneration: number;
  readonly leaseExpiresAt: string;
  readonly message: string;
}

interface PersistedTurn {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly error?: unknown;
}

interface PersistedThread {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly turns?: unknown;
}

interface ThreadReadResponse {
  readonly thread?: PersistedThread;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const requireRuntimeId = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Codex app-server ${name} response is missing an id`);
  }
  return value;
};

const assignmentIdentity = (assignment: WorkerAssignment): ExecutionLeaseIdentity => {
  if (
    assignment.attemptId === undefined ||
    assignment.leaseId === undefined ||
    assignment.leaseEpoch === undefined
  ) {
    throw new Error(`Assignment ${assignment.assignmentId} is missing execution lease identity`);
  }
  return {
    assignmentId: assignment.assignmentId,
    attemptId: assignment.attemptId,
    leaseId: assignment.leaseId,
    leaseEpoch: assignment.leaseEpoch,
  };
};

const matchesIdentity = (
  binding: WorkerRuntimeBinding,
  identity: ExecutionLeaseIdentity
): boolean =>
  binding.assignmentId === identity.assignmentId &&
  binding.attemptId === identity.attemptId &&
  binding.leaseId === identity.leaseId &&
  binding.leaseEpoch === identity.leaseEpoch;

export class WorkerCodexRuntimeSupervisor {
  private readonly store: WorkerRuntimeStore;
  private readonly runtimeSessions: WorkerRuntimeSessionStore;
  private session: WorkerCodexAppServerSession | undefined;
  private appServerGeneration: number | undefined;
  private launchPromise: Promise<WorkerRuntimeBinding> | undefined;
  private unsubscribe: (() => void) | undefined;
  private unsubscribeRequest: (() => void) | undefined;
  private unsubscribeClose: (() => void) | undefined;
  private readonly pendingRequests = new Map<number | string, CodexAppServerRequest>();
  private closing = false;

  constructor(private readonly options: WorkerCodexRuntimeOptions) {
    this.store = new WorkerRuntimeStore(options.dataDir);
    this.runtimeSessions = new WorkerRuntimeSessionStore(options.dataDir);
    if ((options.runtimeIdentity === undefined) !== (options.runtimeMcp === undefined)) {
      throw new Error('runtimeIdentity and runtimeMcp must be configured together');
    }
  }

  async start(assignment: WorkerAssignment): Promise<WorkerRuntimeBinding> {
    const identity = assignmentIdentity(assignment);
    const active = this.store.active();
    if (active !== undefined) {
      if (!matchesIdentity(active, identity)) {
        throw new Error(`Codex runtime slot is occupied by assignment ${active.assignmentId}`);
      }
      if (this.launchPromise !== undefined) return this.launchPromise;
      if (this.session === undefined || active.reconciliationState !== undefined) {
        this.launchPromise = this.recover(active).finally(() => {
          this.launchPromise = undefined;
        });
        return this.launchPromise;
      }
      return active;
    }
    const persisted = this.store.get(identity.attemptId);
    if (persisted !== undefined) return persisted;
    if (this.launchPromise !== undefined) return this.launchPromise;
    this.launchPromise = this.launch(assignment, identity).finally(() => {
      this.launchPromise = undefined;
    });
    return this.launchPromise;
  }

  async interrupt(identity: ExecutionLeaseIdentity, reason: string): Promise<void> {
    const active = this.store.active();
    if (active === undefined || !matchesIdentity(active, identity)) return;
    this.runtimeSessions.revokeAttempt(active.attemptId);
    if (
      this.session !== undefined &&
      active.threadId !== undefined &&
      active.turnId !== undefined
    ) {
      await this.session
        .request('turn/interrupt', { threadId: active.threadId, turnId: active.turnId })
        .catch(() => undefined);
    }
    this.store.settle(active.attemptId, 'interrupted', 'interrupted', reason);
  }

  authorizeRuntimeSession(token: string): RuntimeSessionContext {
    return this.runtimeSessions.authorize(token);
  }

  renewRuntimeSession(attemptId: string, expiresAt: string): void {
    this.runtimeSessions.renewAttempt(attemptId, expiresAt);
  }

  listBindings(): readonly WorkerRuntimeBinding[] {
    return this.store.list();
  }

  async steer(input: WorkerRuntimeSteerInput): Promise<void> {
    const active = this.store.active();
    if (
      active === undefined ||
      !matchesIdentity(active, input) ||
      active.state !== 'active' ||
      active.reconciliationState !== undefined ||
      active.threadId !== input.threadId ||
      active.turnId !== input.expectedTurnId ||
      active.appServerGeneration !== input.appServerGeneration ||
      this.session === undefined
    ) {
      throw new Error('Codex runtime steer precondition does not match the active turn');
    }
    const response = await this.session.request<TurnSteerResponse>('turn/steer', {
      threadId: input.threadId,
      input: [{ type: 'text', text: input.message }],
      expectedTurnId: input.expectedTurnId,
    });
    const steeredTurnId = requireRuntimeId(response.turnId, 'turn/steer');
    if (steeredTurnId !== input.expectedTurnId) {
      throw new Error(
        `Codex app-server steered unexpected turn ${steeredTurnId}; expected ${input.expectedTurnId}`
      );
    }
  }

  async startTurn(input: WorkerRuntimeStartTurnInput): Promise<WorkerRuntimeBinding> {
    const completed = this.store.get(input.attemptId);
    if (
      completed === undefined ||
      !matchesIdentity(completed, input) ||
      completed.state !== 'completed' ||
      completed.reconciliationState !== undefined ||
      completed.threadId !== input.threadId ||
      completed.appServerGeneration !== input.appServerGeneration
    ) {
      throw new Error('Codex runtime start precondition does not match the completed turn');
    }
    const session = await this.ensureSession();
    const runtimeMcpSession = await this.rotateRuntimeMcpSession(
      session,
      completed,
      input.leaseExpiresAt
    );
    await session.request('thread/resume', {
      threadId: completed.threadId,
      cwd: this.options.cwd,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      ...(runtimeMcpSession === undefined ? {} : { config: runtimeMcpSession.config }),
      ...(this.options.model === undefined ? {} : { model: this.options.model }),
    });
    if (runtimeMcpSession !== undefined) {
      await this.assertRuntimeMcpInventory(session, completed.threadId);
    }
    const turnResponse = await session.request<TurnStartResponse>('turn/start', {
      threadId: completed.threadId,
      input: [{ type: 'text', text: input.message }],
      cwd: this.options.cwd,
      approvalPolicy: 'on-request',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [this.options.cwd],
        networkAccess: false,
      },
      ...(this.options.model === undefined ? {} : { model: this.options.model }),
    });
    const turnId = requireRuntimeId(turnResponse.turn?.id, 'turn/start');
    const binding = this.store.continueTurn(
      completed.attemptId,
      turnId,
      this.appServerGeneration!
    );
    if (runtimeMcpSession !== undefined) {
      this.runtimeSessions.bindTurn(runtimeMcpSession.token, turnId);
    }
    this.pendingRequests.clear();
    this.options.onStarted?.(binding);
    return binding;
  }

  resolveApproval(
    identity: ExecutionLeaseIdentity,
    approvalRequestId: number | string,
    decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel'
  ): void {
    const active = this.store.active();
    if (
      active === undefined ||
      !matchesIdentity(active, identity) ||
      active.state !== 'active' ||
      active.reconciliationState !== undefined ||
      this.session === undefined
    ) {
      throw new Error('Codex approval precondition does not match the active turn');
    }
    this.session.respondToRequest(approvalRequestId, { decision });
    this.pendingRequests.delete(approvalRequestId);
  }

  listPendingRequests(): readonly CodexAppServerRequest[] {
    return [...this.pendingRequests.values()];
  }

  async startReview(identity: ExecutionLeaseIdentity, threadId: string): Promise<unknown> {
    const active = this.store.active();
    if (
      active === undefined ||
      !matchesIdentity(active, identity) ||
      active.state !== 'active' ||
      active.reconciliationState !== undefined ||
      active.threadId !== threadId ||
      this.session === undefined
    ) {
      throw new Error('Codex review precondition does not match the active thread');
    }
    return await this.session.request('review/start', {
      threadId,
      target: { type: 'uncommittedChanges' },
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    const active = this.store.active();
    if (active !== undefined) {
      await this.interrupt(
        {
          assignmentId: active.assignmentId,
          attemptId: active.attemptId,
          leaseId: active.leaseId,
          leaseEpoch: active.leaseEpoch,
        },
        'worker_shutdown'
      );
    }
    this.unsubscribe?.();
    this.unsubscribeRequest?.();
    this.unsubscribeClose?.();
    await this.session?.close();
    this.runtimeSessions.close();
    this.pendingRequests.clear();
    this.store.close();
  }

  private async launch(
    assignment: WorkerAssignment,
    identity: ExecutionLeaseIdentity
  ): Promise<WorkerRuntimeBinding> {
    try {
      const session = await this.ensureSession();
      this.store.begin({
        ...identity,
        appServerGeneration: this.appServerGeneration!,
      });
      const runtimeMcpSession = await this.createRuntimeMcpSession(session, assignment);
      const threadResponse = await session.request<ThreadStartResponse>('thread/start', {
        cwd: this.options.cwd,
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        serviceName: 'agent_teams_worker',
        ...(runtimeMcpSession === undefined ? {} : { config: runtimeMcpSession.config }),
        ...(this.options.model === undefined ? {} : { model: this.options.model }),
      });
      const threadId = requireRuntimeId(threadResponse.thread?.id, 'thread/start');
      this.store.bindThread(identity.attemptId, threadId);
      if (runtimeMcpSession !== undefined) {
        await this.assertRuntimeMcpInventory(session, threadId);
      }
      const prompt = [
        `Complete the leased Agent Teams assignment: ${assignment.title}`,
        assignment.description,
        'Work only inside the supplied workspace. Do not commit, push, or publish; the Worker owns verification and publication.',
      ]
        .filter((line): line is string => line !== undefined)
        .join('\n\n');
      const turnResponse = await session.request<TurnStartResponse>('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
        cwd: this.options.cwd,
        approvalPolicy: 'on-request',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [this.options.cwd],
          networkAccess: false,
        },
        ...(this.options.model === undefined ? {} : { model: this.options.model }),
      });
      const turnId = requireRuntimeId(turnResponse.turn?.id, 'turn/start');
      const binding = this.store.bindTurn(identity.attemptId, turnId);
      if (runtimeMcpSession !== undefined) {
        this.runtimeSessions.bindTurn(runtimeMcpSession.token, turnId);
      }
      this.options.onStarted?.(binding);
      return binding;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const binding = this.store.get(identity.attemptId);
      if (binding !== undefined && ['starting', 'active'].includes(binding.state)) {
        const failed = this.store.settle(
          identity.attemptId,
          'failed',
          'failed',
          normalized.message
        );
        this.options.onFailed?.(failed, normalized);
        this.runtimeSessions.revokeAttempt(identity.attemptId);
      }
      throw normalized;
    }
  }

  private async ensureSession(): Promise<WorkerCodexAppServerSession> {
    if (this.session !== undefined) return this.session;
    this.appServerGeneration = this.store.nextAppServerGeneration();
    const session = await this.options.sessionFactory.open();
    this.unsubscribe = session.onNotification((notification) => {
      this.handleNotification(notification);
    });
    this.unsubscribeRequest = session.onRequest((request) => {
      this.pendingRequests.set(request.id, request);
      const binding = this.store.active();
      if (binding !== undefined) this.options.onRuntimeRequest?.(binding, request);
    });
    this.unsubscribeClose = session.onClose((event) => {
      this.handleSessionClose(session, event);
    });
    this.session = session;
    return session;
  }

  private handleSessionClose(
    closedSession: WorkerCodexAppServerSession,
    event: CodexAppServerSessionClosed
  ): void {
    if (this.session !== closedSession) return;
    this.unsubscribe?.();
    this.unsubscribeRequest?.();
    this.unsubscribeClose?.();
    this.unsubscribe = undefined;
    this.unsubscribeRequest = undefined;
    this.unsubscribeClose = undefined;
    this.session = undefined;
    if (this.closing) return;
    if (this.launchPromise !== undefined) {
      const inFlight = this.launchPromise;
      void inFlight
        .finally(() => this.scheduleRecovery(event.error))
        .catch(() => undefined);
      return;
    }
    this.scheduleRecovery(event.error);
  }

  private scheduleRecovery(closeError: Error): void {
    if (this.closing || this.launchPromise !== undefined) return;
    const active = this.store.active();
    if (
      active === undefined ||
      this.options.canRecover?.(active) === false
    ) {
      return;
    }
    this.launchPromise = this.recover(active, closeError).finally(() => {
      this.launchPromise = undefined;
    });
    void this.launchPromise.catch(() => undefined);
  }

  private async recover(
    binding: WorkerRuntimeBinding,
    closeError?: Error
  ): Promise<WorkerRuntimeBinding> {
    if (this.options.canRecover?.(binding) === false) return binding;
    try {
      const session = await this.ensureSession();
      const recovering = this.store.markRecovering(
        binding.attemptId,
        this.appServerGeneration!
      );
      if (recovering.threadId === undefined || recovering.turnId === undefined) {
        return this.requireReconciliation(
          recovering,
          new Error(
            closeError === undefined
              ? 'Codex runtime stopped before its thread and turn identity were durably bound'
              : `Codex app-server crashed before runtime identity was durably bound: ${closeError.message}`
          )
        );
      }

      const readResponse = await session.request<ThreadReadResponse>('thread/read', {
        threadId: recovering.threadId,
        includeTurns: true,
      });
      const readTurn = this.findPersistedTurn(readResponse.thread, recovering.turnId);
      const terminal = this.projectTerminalTurn(recovering, readTurn);
      if (terminal !== undefined) return terminal;
      if (readTurn?.status !== 'inProgress') {
        return this.requireReconciliation(
          recovering,
          new Error(`Persisted Codex turn ${recovering.turnId} could not be reconciled`)
        );
      }

      const runtimeMcpSession = await this.rotateRuntimeMcpSession(session, recovering);
      if (runtimeMcpSession !== undefined) {
        this.runtimeSessions.bindTurn(runtimeMcpSession.token, recovering.turnId);
      }

      const resumeResponse = await session.request<ThreadReadResponse>('thread/resume', {
        threadId: recovering.threadId,
        cwd: this.options.cwd,
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        ...(runtimeMcpSession === undefined ? {} : { config: runtimeMcpSession.config }),
        ...(this.options.model === undefined ? {} : { model: this.options.model }),
      });
      if (runtimeMcpSession !== undefined) {
        await this.assertRuntimeMcpInventory(session, recovering.threadId);
      }
      const resumedTurn = this.findPersistedTurn(resumeResponse.thread, recovering.turnId);
      const resumedTerminal = this.projectTerminalTurn(recovering, resumedTurn);
      if (resumedTerminal !== undefined) return resumedTerminal;
      const threadStatus = asRecord(resumeResponse.thread?.status)?.type;
      if (resumedTurn?.status === 'inProgress' && threadStatus === 'active') {
        const recovered = this.store.clearReconciliation(recovering.attemptId);
        this.options.onRecovered?.(recovered);
        return recovered;
      }
      return this.requireReconciliation(
        recovering,
        new Error(
          `Codex thread ${recovering.threadId} did not rejoin active turn ${recovering.turnId}`
        )
      );
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const current = this.store.get(binding.attemptId);
      if (current === undefined || !['starting', 'active'].includes(current.state)) {
        throw normalized;
      }
      return this.requireReconciliation(current, normalized);
    }
  }

  private findPersistedTurn(
    thread: PersistedThread | undefined,
    turnId: string
  ): PersistedTurn | undefined {
    if (!Array.isArray(thread?.turns)) return undefined;
    return thread.turns
      .map((turn) => asRecord(turn))
      .find((turn) => turn?.id === turnId) as PersistedTurn | undefined;
  }

  private projectTerminalTurn(
    binding: WorkerRuntimeBinding,
    turn: PersistedTurn | undefined
  ): WorkerRuntimeBinding | undefined {
    if (turn?.status === 'completed') {
      const completed = this.store.settle(binding.attemptId, 'completed', 'completed');
      this.runtimeSessions.revokeAttempt(binding.attemptId);
      this.options.onCompleted?.(completed);
      return completed;
    }
    if (turn?.status === 'interrupted') {
      const interrupted = this.store.settle(binding.attemptId, 'interrupted', 'interrupted');
      this.runtimeSessions.revokeAttempt(binding.attemptId);
      this.options.onFailed?.(
        interrupted,
        new Error(`Codex turn ${binding.turnId ?? 'unknown'} was interrupted before recovery`)
      );
      return interrupted;
    }
    if (turn?.status !== 'failed') return undefined;
    const turnError = asRecord(turn.error);
    const failure = new Error(
      typeof turnError?.message === 'string'
        ? turnError.message
        : `Codex turn ${binding.turnId ?? 'unknown'} failed before recovery`
    );
    const failed = this.store.settle(binding.attemptId, 'failed', 'failed', failure.message);
    this.runtimeSessions.revokeAttempt(binding.attemptId);
    this.options.onFailed?.(failed, failure);
    return failed;
  }

  private requireReconciliation(
    binding: WorkerRuntimeBinding,
    error: Error
  ): WorkerRuntimeBinding {
    const failed = this.store.markNeedsReconciliation(binding.attemptId, error.message);
    this.runtimeSessions.revokeAttempt(binding.attemptId);
    this.options.onReconciliationRequired?.(failed, error);
    return failed;
  }

  private handleNotification(notification: CodexAppServerNotification): void {
    const binding = this.store.active();
    if (binding !== undefined) this.options.onRuntimeEvent?.(binding, notification);
    if (notification.method !== 'turn/completed') return;
    const params = asRecord(notification.params);
    const turn = asRecord(params?.turn);
    const turnId = typeof turn?.id === 'string' ? turn.id : undefined;
    const status = typeof turn?.status === 'string' ? turn.status : undefined;
    const active = binding;
    if (active === undefined || active.turnId !== turnId || status === undefined) return;
    if (status === 'completed') {
      const completed = this.store.settle(active.attemptId, 'completed', status);
      this.runtimeSessions.revokeAttempt(active.attemptId);
      this.options.onCompleted?.(completed);
      return;
    }
    if (status === 'interrupted') {
      this.store.settle(active.attemptId, 'interrupted', status);
      this.runtimeSessions.revokeAttempt(active.attemptId);
      return;
    }
    const error = asRecord(turn?.error);
    const failure = new Error(
      typeof error?.message === 'string' ? error.message : `Codex turn ended with ${status}`
    );
    const failed = this.store.settle(active.attemptId, 'failed', status, failure.message);
    this.runtimeSessions.revokeAttempt(active.attemptId);
    this.options.onFailed?.(failed, failure);
  }

  private async createRuntimeMcpSession(
    session: WorkerCodexAppServerSession,
    assignment: WorkerAssignment
  ): Promise<
    | (CreatedRuntimeMcpSession & { readonly config: Readonly<Record<string, unknown>> })
    | undefined
  > {
    if (this.options.runtimeMcp === undefined || this.options.runtimeIdentity === undefined) {
      return undefined;
    }
    if (
      assignment.teamId === undefined ||
      assignment.membershipId === undefined ||
      assignment.workspaceId === undefined ||
      assignment.attemptId === undefined ||
      assignment.leaseId === undefined ||
      assignment.leaseEpoch === undefined ||
      assignment.leaseExpiresAt === undefined
    ) {
      throw new Error(
        `Assignment ${assignment.assignmentId} is missing team, membership, workspace, or lease scope for runtime MCP`
      );
    }
    const created = this.runtimeSessions.create({
      ...this.options.runtimeIdentity,
      teamId: assignment.teamId,
      membershipId: assignment.membershipId,
      assignmentId: assignment.assignmentId,
      attemptId: assignment.attemptId,
      workspaceId: assignment.workspaceId,
      leaseEpoch: assignment.leaseEpoch,
      leaseId: assignment.leaseId,
      expiresAt: assignment.leaseExpiresAt,
    });
    return {
      ...created,
      config: await this.buildRuntimeMcpConfig(session, created.token),
    };
  }

  private async rotateRuntimeMcpSession(
    session: WorkerCodexAppServerSession,
    binding: WorkerRuntimeBinding,
    expiresAt?: string
  ): Promise<
    | (CreatedRuntimeMcpSession & { readonly config: Readonly<Record<string, unknown>> })
    | undefined
  > {
    if (this.options.runtimeMcp === undefined) return undefined;
    const created = this.runtimeSessions.rotateAttempt(binding.attemptId, expiresAt);
    return {
      ...created,
      config: await this.buildRuntimeMcpConfig(session, created.token),
    };
  }

  private async buildRuntimeMcpConfig(
    session: WorkerCodexAppServerSession,
    token: string
  ): Promise<Readonly<Record<string, unknown>>> {
    const runtimeMcp = this.options.runtimeMcp;
    if (runtimeMcp === undefined) throw new Error('Runtime MCP is not configured');
    const response = await session.request<unknown>('config/read', {
      cwd: this.options.cwd,
      includeLayers: false,
    });
    return buildRestrictedRuntimeMcpConfig(
      runtimeMcp,
      token,
      readConfiguredMcpServerNames(response),
      readConfiguredPluginNames(response)
    );
  }

  private async assertRuntimeMcpInventory(
    session: WorkerCodexAppServerSession,
    threadId: string
  ): Promise<void> {
    const response = await session.request<unknown>('mcpServerStatus/list', {
      threadId,
      limit: 100,
      detail: 'toolsAndAuthOnly',
    });
    assertRestrictedRuntimeMcpInventory(response);
  }
}
