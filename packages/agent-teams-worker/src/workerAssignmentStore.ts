import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assertAssignmentTransition,
  assignmentExecutionStateSchema,
  assignmentIdSchema,
  assignmentOfferPayloadSchema,
  commandIdSchema,
  nodeIdSchema,
  teamIdSchema,
  type AssignmentExecutionState,
  type AssignmentId,
  type CommandId,
  type NodeId,
  type TeamId,
} from '@claude-teams/agent-teams-protocol';

import type { WorkerInboxCommand } from './workerInboxStore';

export interface WorkerAssignment {
  readonly assignmentId: AssignmentId;
  readonly offerCommandId: CommandId;
  readonly teamId?: TeamId;
  readonly targetNodeId: NodeId;
  readonly title: string;
  readonly description?: string;
  readonly state: AssignmentExecutionState;
  readonly revision: number;
  readonly offeredAt: string;
  readonly updatedAt: string;
  readonly deferredUntil?: string;
  readonly decisionReason?: string;
}

export interface WorkerAssignmentActivity {
  readonly id: number;
  readonly assignmentId: AssignmentId;
  readonly revision: number;
  readonly fromState: AssignmentExecutionState | null;
  readonly toState: AssignmentExecutionState;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface AssignmentMutationInput {
  readonly assignmentId: string;
  readonly expectedRevision?: number;
  readonly reason?: string;
}

export interface AssignmentDeferInput extends AssignmentMutationInput {
  readonly deferredUntil?: string;
}

interface AssignmentRow {
  assignment_id: string;
  offer_command_id: string;
  team_id: string | null;
  target_node_id: string;
  title: string;
  description: string | null;
  state: string;
  revision: number;
  offered_at: string;
  updated_at: string;
  deferred_until: string | null;
  decision_reason: string | null;
}

interface ActivityRow {
  id: number;
  assignment_id: string;
  revision: number;
  from_state: string | null;
  to_state: string;
  reason: string;
  occurred_at: string;
}

const mapAssignment = (row: AssignmentRow): WorkerAssignment => ({
  assignmentId: assignmentIdSchema.parse(row.assignment_id),
  offerCommandId: commandIdSchema.parse(row.offer_command_id),
  ...(row.team_id === null ? {} : { teamId: teamIdSchema.parse(row.team_id) }),
  targetNodeId: nodeIdSchema.parse(row.target_node_id),
  title: row.title,
  ...(row.description === null ? {} : { description: row.description }),
  state: assignmentExecutionStateSchema.parse(row.state),
  revision: row.revision,
  offeredAt: row.offered_at,
  updatedAt: row.updated_at,
  ...(row.deferred_until === null ? {} : { deferredUntil: row.deferred_until }),
  ...(row.decision_reason === null ? {} : { decisionReason: row.decision_reason }),
});

const mapActivity = (row: ActivityRow): WorkerAssignmentActivity => ({
  id: row.id,
  assignmentId: assignmentIdSchema.parse(row.assignment_id),
  revision: row.revision,
  fromState: row.from_state === null ? null : assignmentExecutionStateSchema.parse(row.from_state),
  toState: assignmentExecutionStateSchema.parse(row.to_state),
  reason: row.reason,
  occurredAt: row.occurred_at,
});

const validateExpectedRevision = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError('expectedRevision must be a non-negative integer');
  }
  return value;
};

const validateOptionalText = (
  value: string | undefined,
  field: string,
  maxLength: number
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new TypeError(`${field} must contain 1-${maxLength} characters`);
  }
  return trimmed;
};

const validateDeferredUntil = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError('deferredUntil must be a timestamp');
  return parsed.toISOString();
};

export class WorkerAssignmentNotFoundError extends Error {
  readonly code = 'WORKER_ASSIGNMENT_NOT_FOUND';

  constructor(readonly assignmentId: AssignmentId) {
    super(`Assignment ${assignmentId} was not found`);
    this.name = 'WorkerAssignmentNotFoundError';
  }
}

export class WorkerAssignmentRevisionConflictError extends Error {
  readonly code = 'WORKER_ASSIGNMENT_REVISION_CONFLICT';

  constructor(
    readonly assignmentId: AssignmentId,
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      `Assignment ${assignmentId} revision ${actualRevision} does not match expected revision ${expectedRevision}`
    );
    this.name = 'WorkerAssignmentRevisionConflictError';
  }
}

export class WorkerAssignmentOfferConflictError extends Error {
  readonly code = 'WORKER_ASSIGNMENT_OFFER_CONFLICT';

  constructor(readonly assignmentId: AssignmentId) {
    super(`Assignment ${assignmentId} was offered with conflicting immutable fields`);
    this.name = 'WorkerAssignmentOfferConflictError';
  }
}

export class WorkerAssignmentStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        assignment_id TEXT PRIMARY KEY,
        offer_command_id TEXT NOT NULL UNIQUE,
        team_id TEXT,
        target_node_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        state TEXT NOT NULL,
        revision INTEGER NOT NULL,
        offered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deferred_until TEXT,
        decision_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS assignment_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assignment_activity_assignment_idx
        ON assignment_activity (assignment_id, id);
    `);
  }

  projectOffer(command: WorkerInboxCommand): WorkerAssignment | undefined {
    if (command.envelope.type !== 'assignment.offer') return undefined;
    const payload = assignmentOfferPayloadSchema.parse(command.envelope.payload);
    if (
      command.envelope.assignmentId !== undefined &&
      command.envelope.assignmentId !== payload.assignmentId
    ) {
      throw new WorkerAssignmentOfferConflictError(payload.assignmentId);
    }
    const existing = this.get(payload.assignmentId);
    if (existing !== undefined) {
      const sameOffer =
        existing.offerCommandId === command.commandId &&
        existing.targetNodeId === command.envelope.targetNodeId &&
        existing.teamId === command.envelope.teamId &&
        existing.title === payload.title &&
        existing.description === payload.description;
      if (!sameOffer) throw new WorkerAssignmentOfferConflictError(payload.assignmentId);
      return existing;
    }

    const offeredAt = command.receivedAt;
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database
        .prepare(
          `INSERT INTO assignments
            (assignment_id, offer_command_id, team_id, target_node_id, title, description,
             state, revision, offered_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'proposed', 0, ?, ?)`
        )
        .run(
          payload.assignmentId,
          command.commandId,
          command.envelope.teamId ?? null,
          command.envelope.targetNodeId,
          payload.title,
          payload.description ?? null,
          offeredAt,
          offeredAt
        );
      this.insertActivity(payload.assignmentId, 0, null, 'proposed', 'offer_received', offeredAt);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    return this.require(payload.assignmentId);
  }

  list(): readonly WorkerAssignment[] {
    const rows = this.database
      .prepare('SELECT * FROM assignments ORDER BY offered_at ASC, assignment_id ASC')
      .all() as unknown as AssignmentRow[];
    return rows.map(mapAssignment);
  }

  get(inputAssignmentId: string): WorkerAssignment | undefined {
    const assignmentId = assignmentIdSchema.parse(inputAssignmentId);
    const row = this.database
      .prepare('SELECT * FROM assignments WHERE assignment_id = ?')
      .get(assignmentId) as AssignmentRow | undefined;
    return row === undefined ? undefined : mapAssignment(row);
  }

  listActivity(inputAssignmentId?: string): readonly WorkerAssignmentActivity[] {
    const rows =
      inputAssignmentId === undefined
        ? (this.database
            .prepare('SELECT * FROM assignment_activity ORDER BY id ASC')
            .all() as unknown as ActivityRow[])
        : (this.database
            .prepare('SELECT * FROM assignment_activity WHERE assignment_id = ? ORDER BY id ASC')
            .all(assignmentIdSchema.parse(inputAssignmentId)) as unknown as ActivityRow[]);
    return rows.map(mapActivity);
  }

  accept(input: AssignmentMutationInput): WorkerAssignment {
    const assignmentId = assignmentIdSchema.parse(input.assignmentId);
    const reason = validateOptionalText(input.reason, 'reason', 2_000) ?? 'owner_accepted';
    return this.mutate(assignmentId, input.expectedRevision, (current, occurredAt) => {
      assertAssignmentTransition(current.state, 'accepted');
      const accepted = this.transition(current, 'accepted', reason, occurredAt);
      assertAssignmentTransition(accepted.state, 'queued');
      return this.transition(accepted, 'queued', 'serial_queue_entered', occurredAt);
    });
  }

  reject(input: AssignmentMutationInput): WorkerAssignment {
    const assignmentId = assignmentIdSchema.parse(input.assignmentId);
    const reason = validateOptionalText(input.reason, 'reason', 2_000) ?? 'owner_rejected';
    return this.mutate(assignmentId, input.expectedRevision, (current, occurredAt) => {
      assertAssignmentTransition(current.state, 'rejected');
      return this.transition(current, 'rejected', reason, occurredAt);
    });
  }

  defer(input: AssignmentDeferInput): WorkerAssignment {
    const assignmentId = assignmentIdSchema.parse(input.assignmentId);
    const reason = validateOptionalText(input.reason, 'reason', 2_000) ?? 'owner_deferred';
    const deferredUntil = validateDeferredUntil(input.deferredUntil);
    return this.mutate(assignmentId, input.expectedRevision, (current, occurredAt) => {
      assertAssignmentTransition(current.state, 'deferred');
      return this.transition(current, 'deferred', reason, occurredAt, deferredUntil);
    });
  }

  close(): void {
    this.database.close();
  }

  private require(assignmentId: AssignmentId): WorkerAssignment {
    const assignment = this.get(assignmentId);
    if (assignment === undefined) throw new WorkerAssignmentNotFoundError(assignmentId);
    return assignment;
  }

  private mutate(
    assignmentId: AssignmentId,
    expectedRevision: number | undefined,
    mutation: (current: WorkerAssignment, occurredAt: string) => WorkerAssignment
  ): WorkerAssignment {
    const normalizedExpectedRevision = validateExpectedRevision(expectedRevision);
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const current = this.require(assignmentId);
      if (
        normalizedExpectedRevision !== undefined &&
        current.revision !== normalizedExpectedRevision
      ) {
        throw new WorkerAssignmentRevisionConflictError(
          assignmentId,
          normalizedExpectedRevision,
          current.revision
        );
      }
      const updated = mutation(current, new Date().toISOString());
      this.database.exec('COMMIT;');
      return updated;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  private transition(
    current: WorkerAssignment,
    toState: AssignmentExecutionState,
    reason: string,
    occurredAt: string,
    deferredUntil?: string
  ): WorkerAssignment {
    const revision = current.revision + 1;
    this.database
      .prepare(
        `UPDATE assignments
         SET state = ?, revision = ?, updated_at = ?, deferred_until = ?, decision_reason = ?
         WHERE assignment_id = ? AND revision = ?`
      )
      .run(
        toState,
        revision,
        occurredAt,
        deferredUntil ?? null,
        reason,
        current.assignmentId,
        current.revision
      );
    this.insertActivity(current.assignmentId, revision, current.state, toState, reason, occurredAt);
    return this.require(current.assignmentId);
  }

  private insertActivity(
    assignmentId: AssignmentId,
    revision: number,
    fromState: AssignmentExecutionState | null,
    toState: AssignmentExecutionState,
    reason: string,
    occurredAt: string
  ): void {
    this.database
      .prepare(
        `INSERT INTO assignment_activity
          (assignment_id, revision, from_state, to_state, reason, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(assignmentId, revision, fromState, toState, reason, occurredAt);
  }
}
