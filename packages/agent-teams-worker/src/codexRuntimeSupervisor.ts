import type { ExecutionLeaseIdentity } from '@claude-teams/agent-teams-protocol';

import type {
  CodexAppServerNotification,
  WorkerCodexAppServerSession,
  WorkerCodexAppServerSessionFactory,
} from './codexAppServerClient';
import type { WorkerAssignment } from './workerAssignmentStore';
import { WorkerRuntimeStore, type WorkerRuntimeBinding } from './workerRuntimeStore';

export interface WorkerCodexRuntimeOptions {
  readonly dataDir: string;
  readonly cwd: string;
  readonly sessionFactory: WorkerCodexAppServerSessionFactory;
  readonly model?: string;
  readonly onStarted?: (binding: WorkerRuntimeBinding) => void;
  readonly onCompleted?: (binding: WorkerRuntimeBinding) => void;
  readonly onFailed?: (binding: WorkerRuntimeBinding, error: Error) => void;
}

interface ThreadStartResponse {
  readonly thread?: { readonly id?: unknown };
}

interface TurnStartResponse {
  readonly turn?: { readonly id?: unknown; readonly status?: unknown };
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
  private session: WorkerCodexAppServerSession | undefined;
  private appServerGeneration: number | undefined;
  private launchPromise: Promise<WorkerRuntimeBinding> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly options: WorkerCodexRuntimeOptions) {
    this.store = new WorkerRuntimeStore(options.dataDir);
  }

  async start(assignment: WorkerAssignment): Promise<WorkerRuntimeBinding> {
    const identity = assignmentIdentity(assignment);
    const active = this.store.active();
    if (active !== undefined) {
      if (!matchesIdentity(active, identity)) {
        throw new Error(`Codex runtime slot is occupied by assignment ${active.assignmentId}`);
      }
      if (this.launchPromise !== undefined) return this.launchPromise;
      return active;
    }
    if (this.launchPromise !== undefined) return this.launchPromise;
    this.launchPromise = this.launch(assignment, identity).finally(() => {
      this.launchPromise = undefined;
    });
    return this.launchPromise;
  }

  async interrupt(identity: ExecutionLeaseIdentity, reason: string): Promise<void> {
    const active = this.store.active();
    if (active === undefined || !matchesIdentity(active, identity)) return;
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

  listBindings(): readonly WorkerRuntimeBinding[] {
    return this.store.list();
  }

  async close(): Promise<void> {
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
    await this.session?.close();
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
      const threadResponse = await session.request<ThreadStartResponse>('thread/start', {
        cwd: this.options.cwd,
        approvalPolicy: 'never',
        sandbox: 'workspaceWrite',
        serviceName: 'agent_teams_worker',
        ...(this.options.model === undefined ? {} : { model: this.options.model }),
      });
      const threadId = requireRuntimeId(threadResponse.thread?.id, 'thread/start');
      this.store.bindThread(identity.attemptId, threadId);
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
        approvalPolicy: 'never',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [this.options.cwd],
          networkAccess: false,
        },
        ...(this.options.model === undefined ? {} : { model: this.options.model }),
      });
      const turnId = requireRuntimeId(turnResponse.turn?.id, 'turn/start');
      const binding = this.store.bindTurn(identity.attemptId, turnId);
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
    this.session = session;
    return session;
  }

  private handleNotification(notification: CodexAppServerNotification): void {
    if (notification.method !== 'turn/completed') return;
    const params = asRecord(notification.params);
    const turn = asRecord(params?.turn);
    const turnId = typeof turn?.id === 'string' ? turn.id : undefined;
    const status = typeof turn?.status === 'string' ? turn.status : undefined;
    const active = this.store.active();
    if (active === undefined || active.turnId !== turnId || status === undefined) return;
    if (status === 'completed') {
      const completed = this.store.settle(active.attemptId, 'completed', status);
      this.options.onCompleted?.(completed);
      return;
    }
    if (status === 'interrupted') {
      this.store.settle(active.attemptId, 'interrupted', status);
      return;
    }
    const error = asRecord(turn?.error);
    const failure = new Error(
      typeof error?.message === 'string' ? error.message : `Codex turn ended with ${status}`
    );
    const failed = this.store.settle(active.attemptId, 'failed', status, failure.message);
    this.options.onFailed?.(failed, failure);
  }
}
