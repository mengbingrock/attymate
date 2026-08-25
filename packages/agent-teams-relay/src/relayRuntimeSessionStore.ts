import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  runtimeSessionScopeSchema,
  workerRuntimeEventMessageSchema,
  type RuntimeControl,
  type RuntimeSessionCapability,
  type RuntimeSessionEventRecord,
  type RuntimeSessionScope,
  type WorkerRuntimeEventMessage,
} from '@claude-teams/agent-teams-protocol';

const DEFAULT_CAPABILITIES: readonly RuntimeSessionCapability[] = [
  'events.read',
  'turn.steer',
  'turn.interrupt',
  'approval.resolve',
  'changes.read',
  'review.start',
  'filesystem.read',
  'filesystem.write',
];
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_TTL_MS = 10 * 60_000;

interface MutableRuntimeSession {
  readonly sessionId: string;
  readonly tokenHash: Buffer;
  readonly scope: RuntimeSessionScope;
  readonly capabilities: readonly RuntimeSessionCapability[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly events: RuntimeSessionEventRecord[];
  nextCursor: number;
  droppedEvents: number;
  revokedAt?: string;
}

export interface CreatedRelayRuntimeSession {
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly scope: RuntimeSessionScope;
  readonly capabilities: readonly RuntimeSessionCapability[];
  readonly expiresAt: string;
}

export interface RelayRuntimeEventReplay {
  readonly events: readonly RuntimeSessionEventRecord[];
  readonly truncated: boolean;
  readonly nextCursor: number;
}

export class RelayRuntimeSessionAuthorizationError extends Error {
  readonly code = 'RUNTIME_SESSION_DENIED';

  constructor() {
    super('Runtime session is invalid, expired, or revoked');
    this.name = 'RelayRuntimeSessionAuthorizationError';
  }
}

const hashToken = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();

const scopeMatches = (left: RuntimeSessionScope, right: RuntimeSessionScope): boolean =>
  left.teamId === right.teamId &&
  left.nodeId === right.nodeId &&
  left.assignmentId === right.assignmentId &&
  left.attemptId === right.attemptId &&
  left.leaseId === right.leaseId &&
  left.leaseEpoch === right.leaseEpoch;

const capabilityForControl = (control: RuntimeControl): RuntimeSessionCapability => {
  if (control.type === 'runtime.snapshot') return 'events.read';
  if (control.type === 'turn.steer') return 'turn.steer';
  if (control.type === 'turn.interrupt') return 'turn.interrupt';
  if (control.type === 'approval.resolve') return 'approval.resolve';
  if (control.type === 'review.start') return 'review.start';
  if (control.type === 'filesystem.write') return 'filesystem.write';
  return 'filesystem.read';
};

export class RelayRuntimeSessionStore {
  private readonly sessions = new Map<string, MutableRuntimeSession>();
  private readonly now: () => number;
  private readonly maxEventsPerSession: number;

  constructor(
    options: { readonly now?: () => number; readonly maxEventsPerSession?: number } = {}
  ) {
    this.now = options.now ?? Date.now;
    this.maxEventsPerSession = options.maxEventsPerSession ?? DEFAULT_MAX_EVENTS;
    if (!Number.isInteger(this.maxEventsPerSession) || this.maxEventsPerSession <= 0) {
      throw new TypeError('maxEventsPerSession must be a positive integer');
    }
  }

  create(
    scopeInput: RuntimeSessionScope,
    leaseExpiresAt: string,
    capabilities: readonly RuntimeSessionCapability[] = DEFAULT_CAPABILITIES
  ): CreatedRelayRuntimeSession {
    const scope = runtimeSessionScopeSchema.parse(scopeInput);
    const leaseExpiry = Date.parse(leaseExpiresAt);
    const now = this.now();
    if (!Number.isFinite(leaseExpiry) || leaseExpiry <= now) {
      throw new RelayRuntimeSessionAuthorizationError();
    }
    const sessionToken = randomBytes(32).toString('base64url');
    const sessionId = randomUUID();
    const expiresAt = new Date(Math.min(leaseExpiry, now + DEFAULT_TTL_MS)).toISOString();
    this.sessions.set(sessionId, {
      sessionId,
      tokenHash: hashToken(sessionToken),
      scope,
      capabilities: [...new Set(capabilities)],
      createdAt: new Date(now).toISOString(),
      expiresAt,
      events: [],
      nextCursor: 1,
      droppedEvents: 0,
    });
    return { sessionId, sessionToken, scope, capabilities: [...new Set(capabilities)], expiresAt };
  }

  authorizeControl(sessionId: string, token: string, control: RuntimeControl): RuntimeSessionScope {
    const session = this.authorize(sessionId, token);
    if (!session.capabilities.includes(capabilityForControl(control))) {
      throw new RelayRuntimeSessionAuthorizationError();
    }
    return session.scope;
  }

  authorizeRead(sessionId: string, token: string): RuntimeSessionScope {
    const session = this.authorize(sessionId, token);
    if (!session.capabilities.includes('events.read')) {
      throw new RelayRuntimeSessionAuthorizationError();
    }
    return session.scope;
  }

  listEvents(sessionId: string, token: string, afterCursor: number): RelayRuntimeEventReplay {
    if (!Number.isInteger(afterCursor) || afterCursor < 0) {
      throw new TypeError('afterCursor must be a non-negative integer');
    }
    const session = this.authorize(sessionId, token);
    const firstCursor = session.events[0]?.cursor ?? session.nextCursor;
    return {
      events: session.events.filter((event) => event.cursor > afterCursor),
      truncated: session.droppedEvents > 0 && afterCursor < firstCursor - 1,
      nextCursor: session.nextCursor - 1,
    };
  }

  acceptEvent(input: WorkerRuntimeEventMessage): number {
    const message = workerRuntimeEventMessageSchema.parse(input);
    let accepted = 0;
    for (const session of this.sessions.values()) {
      if (session.revokedAt !== undefined || Date.parse(session.expiresAt) <= this.now()) continue;
      if (message.sessionId !== undefined && message.sessionId !== session.sessionId) continue;
      if (!scopeMatches(session.scope, message.scope)) continue;
      session.events.push({
        cursor: session.nextCursor,
        eventId: message.eventId,
        sequence: message.sequence,
        scope: message.scope,
        ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
        occurredAt: message.occurredAt,
        receivedAt: new Date(this.now()).toISOString(),
        event: message.event,
      });
      session.nextCursor += 1;
      if (session.events.length > this.maxEventsPerSession) {
        session.events.splice(0, session.events.length - this.maxEventsPerSession);
        session.droppedEvents += 1;
      }
      accepted += 1;
    }
    return accepted;
  }

  revokeScope(scopeInput: RuntimeSessionScope): void {
    const scope = runtimeSessionScopeSchema.parse(scopeInput);
    const revokedAt = new Date(this.now()).toISOString();
    for (const session of this.sessions.values()) {
      if (scopeMatches(session.scope, scope)) session.revokedAt = revokedAt;
    }
  }

  revokeNode(nodeId: string): void {
    const revokedAt = new Date(this.now()).toISOString();
    for (const session of this.sessions.values()) {
      if (session.scope.nodeId === nodeId) session.revokedAt = revokedAt;
    }
  }

  debugSession(sessionId: string): Readonly<Record<string, unknown>> | undefined {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return undefined;
    return {
      sessionId: session.sessionId,
      scope: session.scope,
      capabilities: session.capabilities,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      eventCount: session.events.length,
      droppedEvents: session.droppedEvents,
    };
  }

  private authorize(sessionId: string, token: string): MutableRuntimeSession {
    const session = this.sessions.get(sessionId);
    const suppliedHash = hashToken(token);
    if (
      session === undefined ||
      session.revokedAt !== undefined ||
      Date.parse(session.expiresAt) <= this.now() ||
      suppliedHash.length !== session.tokenHash.length ||
      !timingSafeEqual(suppliedHash, session.tokenHash)
    ) {
      throw new RelayRuntimeSessionAuthorizationError();
    }
    return session;
  }
}
