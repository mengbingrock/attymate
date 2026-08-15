import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assignmentStateChangedPayloadSchema,
  eventEnvelopeSchema,
  eventIdSchema,
  type EventEnvelope,
  type EventId,
  type NodeId,
  type WorkerInstanceId,
} from '@claude-teams/agent-teams-protocol';

import type { WorkerAssignment, WorkerAssignmentActivity } from './workerAssignmentStore';

export interface WorkerOutboxEvent {
  readonly sequence: number;
  readonly eventId: EventId;
  readonly idempotencyKey: string;
  readonly envelope: EventEnvelope;
  readonly createdAt: string;
  readonly acknowledgedAt?: string;
}

interface WorkerOutboxRow {
  sequence: number;
  event_id: string;
  idempotency_key: string;
  envelope_json: string;
  created_at: string;
  acknowledged_at: string | null;
}

const mapRow = (row: WorkerOutboxRow): WorkerOutboxEvent => ({
  sequence: row.sequence,
  eventId: eventIdSchema.parse(row.event_id),
  idempotencyKey: row.idempotency_key,
  envelope: eventEnvelopeSchema.parse(JSON.parse(row.envelope_json)),
  createdAt: row.created_at,
  ...(row.acknowledged_at === null ? {} : { acknowledgedAt: row.acknowledged_at }),
});

export class WorkerOutboxAcknowledgementError extends Error {
  readonly code = 'WORKER_OUTBOX_ACK_MISMATCH';

  constructor(
    readonly eventId: EventId,
    readonly sequence: number
  ) {
    super(`Outbox event ${eventId} does not match sequence ${sequence}`);
    this.name = 'WorkerOutboxAcknowledgementError';
  }
}

export class WorkerOutboxStore {
  private readonly database: DatabaseSync;

  constructor(
    dataDir: string,
    private readonly identity: {
      readonly nodeId: NodeId;
      readonly workerInstanceId: WorkerInstanceId;
    }
  ) {
    this.database = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        envelope_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        acknowledged_at TEXT
      );
    `);
  }

  projectAssignmentActivity(
    assignment: WorkerAssignment,
    activity: WorkerAssignmentActivity
  ): WorkerOutboxEvent {
    const idempotencyKey = `assignment-activity:${activity.id}`;
    const existing = this.getByIdempotencyKey(idempotencyKey);
    if (existing !== undefined) return existing;

    const eventId = eventIdSchema.parse(randomUUID());
    const createdAt = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const insert = this.database
        .prepare(
          `INSERT INTO outbox_events
            (event_id, idempotency_key, envelope_json, created_at)
           VALUES (?, ?, '{}', ?)`
        )
        .run(eventId, idempotencyKey, createdAt);
      const sequence = Number(insert.lastInsertRowid);
      const envelope = eventEnvelopeSchema.parse({
        protocolVersion: 2,
        eventId,
        sequence,
        occurredAt: activity.occurredAt,
        sourceNodeId: this.identity.nodeId,
        workerInstanceId: this.identity.workerInstanceId,
        ...(assignment.teamId === undefined ? {} : { teamId: assignment.teamId }),
        assignmentId: assignment.assignmentId,
        type: 'assignment.state_changed',
        payload: assignmentStateChangedPayloadSchema.parse({
          revision: activity.revision,
          fromState: activity.fromState,
          state: activity.toState,
          reason: activity.reason,
          ...(activity.toState === 'deferred' && assignment.deferredUntil !== undefined
            ? { deferredUntil: assignment.deferredUntil }
            : {}),
        }),
      });
      this.database
        .prepare('UPDATE outbox_events SET envelope_json = ? WHERE sequence = ?')
        .run(JSON.stringify(envelope), sequence);
      this.database.exec('COMMIT;');
      return this.requireByIdempotencyKey(idempotencyKey);
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  listPending(): readonly WorkerOutboxEvent[] {
    const rows = this.database
      .prepare('SELECT * FROM outbox_events WHERE acknowledged_at IS NULL ORDER BY sequence ASC')
      .all() as unknown as WorkerOutboxRow[];
    return rows.map(mapRow);
  }

  listAll(): readonly WorkerOutboxEvent[] {
    const rows = this.database
      .prepare('SELECT * FROM outbox_events ORDER BY sequence ASC')
      .all() as unknown as WorkerOutboxRow[];
    return rows.map(mapRow);
  }

  lastAcknowledgedSequence(): number {
    const row = this.database
      .prepare(
        'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM outbox_events WHERE acknowledged_at IS NOT NULL'
      )
      .get() as { sequence: number };
    return row.sequence;
  }

  acknowledge(inputEventId: string, sequence: number): WorkerOutboxEvent {
    const eventId = eventIdSchema.parse(inputEventId);
    if (!Number.isInteger(sequence) || sequence <= 0) {
      throw new TypeError('Outbox acknowledgement sequence must be a positive integer');
    }
    const row = this.database
      .prepare('SELECT * FROM outbox_events WHERE event_id = ?')
      .get(eventId) as WorkerOutboxRow | undefined;
    if (row === undefined || row.sequence !== sequence) {
      throw new WorkerOutboxAcknowledgementError(eventId, sequence);
    }
    this.database
      .prepare(
        'UPDATE outbox_events SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE event_id = ?'
      )
      .run(new Date().toISOString(), eventId);
    return this.getByIdempotencyKey(row.idempotency_key)!;
  }

  close(): void {
    this.database.close();
  }

  private getByIdempotencyKey(idempotencyKey: string): WorkerOutboxEvent | undefined {
    const row = this.database
      .prepare('SELECT * FROM outbox_events WHERE idempotency_key = ?')
      .get(idempotencyKey) as WorkerOutboxRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  private requireByIdempotencyKey(idempotencyKey: string): WorkerOutboxEvent {
    const event = this.getByIdempotencyKey(idempotencyKey);
    if (event === undefined) throw new Error('Worker outbox insert did not produce a row');
    return event;
  }
}
