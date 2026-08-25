import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assignmentIdSchema,
  attemptIdSchema,
  leaseIdSchema,
  type AssignmentId,
  type AttemptId,
  type LeaseId,
} from '@claude-teams/agent-teams-protocol';

export type WorkerRuntimeState = 'starting' | 'active' | 'completed' | 'interrupted' | 'failed';
export type WorkerRuntimeReconciliationState = 'recovering' | 'needs_reconciliation';

export interface WorkerRuntimeBinding {
  readonly assignmentId: AssignmentId;
  readonly attemptId: AttemptId;
  readonly leaseId: LeaseId;
  readonly leaseEpoch: number;
  readonly appServerGeneration: number;
  readonly state: WorkerRuntimeState;
  readonly reconciliationState?: WorkerRuntimeReconciliationState;
  readonly threadId?: string;
  readonly turnId?: string;
  readonly turnStatus?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RuntimeRow {
  assignment_id: string;
  attempt_id: string;
  lease_id: string;
  lease_epoch: number;
  app_server_generation: number;
  state: WorkerRuntimeState;
  reconciliation_state: WorkerRuntimeReconciliationState | null;
  thread_id: string | null;
  turn_id: string | null;
  turn_status: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const mapRow = (row: RuntimeRow): WorkerRuntimeBinding => ({
  assignmentId: assignmentIdSchema.parse(row.assignment_id),
  attemptId: attemptIdSchema.parse(row.attempt_id),
  leaseId: leaseIdSchema.parse(row.lease_id),
  leaseEpoch: row.lease_epoch,
  appServerGeneration: row.app_server_generation,
  state: row.state,
  ...(row.reconciliation_state === null
    ? {}
    : { reconciliationState: row.reconciliation_state }),
  ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
  ...(row.turn_id === null ? {} : { turnId: row.turn_id }),
  ...(row.turn_status === null ? {} : { turnStatus: row.turn_status }),
  ...(row.error === null ? {} : { error: row.error }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const validateRuntimeId = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new TypeError(`${name} must contain 1-256 characters`);
  }
  return normalized;
};

export class WorkerRuntimeStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runtime_bindings (
        assignment_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL PRIMARY KEY,
        lease_id TEXT NOT NULL,
        lease_epoch INTEGER NOT NULL,
        app_server_generation INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('starting', 'active', 'completed', 'interrupted', 'failed')),
        reconciliation_state TEXT CHECK (reconciliation_state IN ('recovering', 'needs_reconciliation')),
        thread_id TEXT,
        turn_id TEXT,
        turn_status TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS runtime_bindings_one_active
        ON runtime_bindings((1)) WHERE state IN ('starting', 'active');
      CREATE TABLE IF NOT EXISTS runtime_metadata (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
    `);
    this.ensureRuntimeBindingColumn(
      'reconciliation_state',
      "TEXT CHECK (reconciliation_state IN ('recovering', 'needs_reconciliation'))"
    );
  }

  nextAppServerGeneration(): number {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const current = this.database
        .prepare("SELECT value FROM runtime_metadata WHERE key = 'app_server_generation'")
        .get() as { value: number } | undefined;
      const generation = (current?.value ?? 0) + 1;
      this.database
        .prepare(
          `INSERT INTO runtime_metadata (key, value) VALUES ('app_server_generation', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run(generation);
      this.database.exec('COMMIT;');
      return generation;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  begin(input: {
    readonly assignmentId: string;
    readonly attemptId: string;
    readonly leaseId: string;
    readonly leaseEpoch: number;
    readonly appServerGeneration: number;
  }): WorkerRuntimeBinding {
    const assignmentId = assignmentIdSchema.parse(input.assignmentId);
    const attemptId = attemptIdSchema.parse(input.attemptId);
    const leaseId = leaseIdSchema.parse(input.leaseId);
    if (!Number.isInteger(input.leaseEpoch) || input.leaseEpoch <= 0) {
      throw new TypeError('leaseEpoch must be a positive integer');
    }
    if (!Number.isInteger(input.appServerGeneration) || input.appServerGeneration <= 0) {
      throw new TypeError('appServerGeneration must be a positive integer');
    }
    const existing = this.get(attemptId);
    if (existing !== undefined) {
      if (
        existing.assignmentId !== assignmentId ||
        existing.leaseId !== leaseId ||
        existing.leaseEpoch !== input.leaseEpoch
      ) {
        throw new Error(`Runtime attempt ${attemptId} has conflicting lease identity`);
      }
      return existing;
    }
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO runtime_bindings
          (assignment_id, attempt_id, lease_id, lease_epoch, app_server_generation,
           state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'starting', ?, ?)`
      )
      .run(assignmentId, attemptId, leaseId, input.leaseEpoch, input.appServerGeneration, now, now);
    return this.require(attemptId);
  }

  bindThread(attemptIdInput: string, threadIdInput: string): WorkerRuntimeBinding {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    const threadId = validateRuntimeId(threadIdInput, 'threadId');
    this.database
      .prepare(
        `UPDATE runtime_bindings SET thread_id = ?, updated_at = ?
         WHERE attempt_id = ? AND state = 'starting'`
      )
      .run(threadId, new Date().toISOString(), attemptId);
    return this.require(attemptId);
  }

  bindTurn(attemptIdInput: string, turnIdInput: string): WorkerRuntimeBinding {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    const turnId = validateRuntimeId(turnIdInput, 'turnId');
    this.database
      .prepare(
        `UPDATE runtime_bindings
         SET turn_id = ?, state = 'active', turn_status = 'inProgress', updated_at = ?
         WHERE attempt_id = ? AND state = 'starting' AND thread_id IS NOT NULL`
      )
      .run(turnId, new Date().toISOString(), attemptId);
    return this.require(attemptId);
  }

  continueTurn(
    attemptIdInput: string,
    turnIdInput: string,
    appServerGeneration: number
  ): WorkerRuntimeBinding {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    const turnId = validateRuntimeId(turnIdInput, 'turnId');
    if (!Number.isInteger(appServerGeneration) || appServerGeneration <= 0) {
      throw new TypeError('appServerGeneration must be a positive integer');
    }
    const result = this.database
      .prepare(
        `UPDATE runtime_bindings
         SET turn_id = ?, app_server_generation = ?, state = 'active',
             turn_status = 'inProgress', error = NULL, updated_at = ?
         WHERE attempt_id = ? AND state = 'completed' AND thread_id IS NOT NULL`
      )
      .run(
        turnId,
        appServerGeneration,
        new Date().toISOString(),
        attemptId
      );
    if (result.changes !== 1) {
      throw new Error(`Runtime attempt ${attemptId} is not ready for a continuation turn`);
    }
    return this.require(attemptId);
  }

  markRecovering(
    attemptIdInput: string,
    appServerGeneration: number
  ): WorkerRuntimeBinding {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    if (!Number.isInteger(appServerGeneration) || appServerGeneration <= 0) {
      throw new TypeError('appServerGeneration must be a positive integer');
    }
    this.database
      .prepare(
        `UPDATE runtime_bindings
         SET app_server_generation = ?, reconciliation_state = 'recovering', error = NULL,
             updated_at = ?
         WHERE attempt_id = ? AND state IN ('starting', 'active')`
      )
      .run(appServerGeneration, new Date().toISOString(), attemptId);
    return this.require(attemptId);
  }

  clearReconciliation(attemptIdInput: string): WorkerRuntimeBinding {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    this.database
      .prepare(
        `UPDATE runtime_bindings SET reconciliation_state = NULL, error = NULL, updated_at = ?
         WHERE attempt_id = ? AND state IN ('starting', 'active')`
      )
      .run(new Date().toISOString(), attemptId);
    return this.require(attemptId);
  }

  markNeedsReconciliation(attemptIdInput: string, error: string): WorkerRuntimeBinding {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    this.database
      .prepare(
        `UPDATE runtime_bindings
         SET state = 'failed', reconciliation_state = 'needs_reconciliation',
             turn_status = 'needsReconciliation', error = ?, updated_at = ?
         WHERE attempt_id = ? AND state IN ('starting', 'active')`
      )
      .run(error.slice(0, 2_000), new Date().toISOString(), attemptId);
    return this.require(attemptId);
  }

  settle(
    attemptIdInput: string,
    state: Exclude<WorkerRuntimeState, 'starting' | 'active'>,
    turnStatus: string,
    error?: string
  ): WorkerRuntimeBinding {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    const status = validateRuntimeId(turnStatus, 'turnStatus');
    this.database
      .prepare(
        `UPDATE runtime_bindings
         SET state = ?, reconciliation_state = NULL, turn_status = ?, error = ?, updated_at = ?
         WHERE attempt_id = ? AND state IN ('starting', 'active')`
      )
      .run(state, status, error?.slice(0, 2_000) ?? null, new Date().toISOString(), attemptId);
    return this.require(attemptId);
  }

  active(): WorkerRuntimeBinding | undefined {
    const row = this.database
      .prepare("SELECT * FROM runtime_bindings WHERE state IN ('starting', 'active')")
      .get() as RuntimeRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  get(attemptIdInput: string): WorkerRuntimeBinding | undefined {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    const row = this.database
      .prepare('SELECT * FROM runtime_bindings WHERE attempt_id = ?')
      .get(attemptId) as RuntimeRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  list(): readonly WorkerRuntimeBinding[] {
    const rows = this.database
      .prepare('SELECT * FROM runtime_bindings ORDER BY created_at ASC')
      .all() as unknown as RuntimeRow[];
    return rows.map(mapRow);
  }

  close(): void {
    this.database.close();
  }

  private ensureRuntimeBindingColumn(name: string, definition: string): void {
    const columns = this.database.prepare('PRAGMA table_info(runtime_bindings)').all() as Array<{
      name: string;
    }>;
    if (columns.some((column) => column.name === name)) return;
    this.database.exec(`ALTER TABLE runtime_bindings ADD COLUMN ${name} ${definition}`);
  }

  private require(attemptId: AttemptId): WorkerRuntimeBinding {
    const binding = this.get(attemptId);
    if (binding === undefined) throw new Error(`Runtime attempt ${attemptId} was not found`);
    return binding;
  }
}
