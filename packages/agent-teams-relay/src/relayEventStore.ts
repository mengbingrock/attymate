import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  eventEnvelopeSchema,
  eventIdSchema,
  nodeIdSchema,
  type EventEnvelope,
  type EventId,
  type NodeId,
} from '@claude-teams/agent-teams-protocol';

export interface RelayEventRecord {
  readonly cursor: number;
  readonly eventId: EventId;
  readonly sourceNodeId: NodeId;
  readonly envelope: EventEnvelope;
  readonly receivedAt: string;
}

interface RelayEventRow {
  cursor: number;
  event_id: string;
  source_node_id: string;
  envelope_json: string;
  received_at: string;
}

const mapRow = (row: RelayEventRow): RelayEventRecord => ({
  cursor: row.cursor,
  eventId: eventIdSchema.parse(row.event_id),
  sourceNodeId: nodeIdSchema.parse(row.source_node_id),
  envelope: eventEnvelopeSchema.parse(JSON.parse(row.envelope_json)),
  receivedAt: row.received_at,
});

export class RelayEventConflictError extends Error {
  readonly code = 'RELAY_EVENT_ID_CONFLICT';

  constructor(readonly eventId: EventId) {
    super(`Event ID ${eventId} already exists with different content`);
    this.name = 'RelayEventConflictError';
  }
}

export class RelayEventStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'relay.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS relay_events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        source_node_id TEXT NOT NULL,
        worker_instance_id TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS relay_events_assignment_cursor
        ON relay_events(json_extract(envelope_json, '$.assignmentId'), cursor);
    `);
  }

  accept(input: unknown): RelayEventRecord {
    const envelope = eventEnvelopeSchema.parse(input);
    const existing = this.get(envelope.eventId);
    if (existing !== undefined) {
      if (JSON.stringify(existing.envelope) !== JSON.stringify(envelope)) {
        throw new RelayEventConflictError(envelope.eventId);
      }
      return existing;
    }
    const receivedAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO relay_events
          (event_id, source_node_id, worker_instance_id, envelope_json, received_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        envelope.eventId,
        envelope.sourceNodeId,
        envelope.workerInstanceId,
        JSON.stringify(envelope),
        receivedAt
      );
    const stored = this.get(envelope.eventId);
    if (stored === undefined) throw new Error('Relay event insert did not produce a row');
    return stored;
  }

  get(eventId: EventId): RelayEventRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM relay_events WHERE event_id = ?')
      .get(eventId) as RelayEventRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  listAll(): readonly RelayEventRecord[] {
    const rows = this.database
      .prepare('SELECT * FROM relay_events ORDER BY cursor ASC')
      .all() as unknown as RelayEventRow[];
    return rows.map(mapRow);
  }

  lastSequenceForNode(nodeId: NodeId): number {
    const row = this.database
      .prepare(
        `SELECT COALESCE(MAX(json_extract(envelope_json, '$.sequence')), 0) AS sequence
         FROM relay_events
         WHERE source_node_id = ?`
      )
      .get(nodeIdSchema.parse(nodeId)) as {
      sequence: number;
    };
    return row.sequence;
  }

  close(): void {
    this.database.close();
  }
}
