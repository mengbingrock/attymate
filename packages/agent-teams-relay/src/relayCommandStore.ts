import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  commandEnvelopeSchema,
  commandIdSchema,
  nodeIdSchema,
  type CommandEnvelope,
  type CommandId,
  type NodeId,
} from '@claude-teams/agent-teams-protocol';

export type RelayCommandStatus = 'pending' | 'delivered' | 'acknowledged' | 'rejected';

export interface RelayCommandRecord {
  readonly cursor: number;
  readonly commandId: CommandId;
  readonly targetNodeId: NodeId;
  readonly envelope: CommandEnvelope;
  readonly status: RelayCommandStatus;
  readonly createdAt: string;
  readonly deliveredAt?: string;
  readonly acknowledgedAt?: string;
  readonly rejectionError?: string;
}

interface RelayCommandRow {
  cursor: number;
  command_id: string;
  target_node_id: string;
  envelope_json: string;
  status: RelayCommandStatus;
  created_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
  rejection_error: string | null;
}

const mapRow = (row: RelayCommandRow): RelayCommandRecord => ({
  cursor: row.cursor,
  commandId: commandIdSchema.parse(row.command_id),
  targetNodeId: nodeIdSchema.parse(row.target_node_id),
  envelope: commandEnvelopeSchema.parse(JSON.parse(row.envelope_json)),
  status: row.status,
  createdAt: row.created_at,
  ...(row.delivered_at === null ? {} : { deliveredAt: row.delivered_at }),
  ...(row.acknowledged_at === null ? {} : { acknowledgedAt: row.acknowledged_at }),
  ...(row.rejection_error === null ? {} : { rejectionError: row.rejection_error }),
});

export class RelayCommandConflictError extends Error {
  readonly code = 'RELAY_COMMAND_ID_CONFLICT';

  constructor(readonly commandId: CommandId) {
    super(`Command ID ${commandId} already exists with different content`);
    this.name = 'RelayCommandConflictError';
  }
}

export class RelayCommandStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'relay.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS relay_commands (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id TEXT NOT NULL UNIQUE,
        target_node_id TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'acknowledged', 'rejected')),
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        acknowledged_at TEXT,
        rejection_error TEXT
      );
      CREATE INDEX IF NOT EXISTS relay_commands_target_cursor
        ON relay_commands(target_node_id, cursor);
    `);
  }

  enqueue(input: unknown): RelayCommandRecord {
    const envelope = commandEnvelopeSchema.parse(input);
    const existing = this.get(envelope.commandId);
    if (existing !== undefined) {
      if (JSON.stringify(existing.envelope) !== JSON.stringify(envelope)) {
        throw new RelayCommandConflictError(envelope.commandId);
      }
      return existing;
    }
    const createdAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO relay_commands
          (command_id, target_node_id, envelope_json, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)`
      )
      .run(
        envelope.commandId,
        envelope.targetNodeId,
        JSON.stringify(envelope),
        createdAt
      );
    const stored = this.get(envelope.commandId);
    if (stored === undefined) throw new Error('Relay command insert did not produce a row');
    return stored;
  }

  get(commandId: CommandId): RelayCommandRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM relay_commands WHERE command_id = ?')
      .get(commandId) as RelayCommandRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  listForNodeAfter(nodeId: NodeId, cursor: number): readonly RelayCommandRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM relay_commands
         WHERE target_node_id = ? AND cursor > ? AND status NOT IN ('acknowledged', 'rejected')
         ORDER BY cursor ASC`
      )
      .all(nodeId, cursor) as unknown as RelayCommandRow[];
    return rows.map(mapRow);
  }

  listAll(): readonly RelayCommandRecord[] {
    const rows = this.database
      .prepare('SELECT * FROM relay_commands ORDER BY cursor ASC')
      .all() as unknown as RelayCommandRow[];
    return rows.map(mapRow);
  }

  markDelivered(commandId: CommandId): void {
    this.database
      .prepare(
        `UPDATE relay_commands
         SET status = CASE WHEN status = 'pending' THEN 'delivered' ELSE status END,
             delivered_at = COALESCE(delivered_at, ?)
         WHERE command_id = ? AND status NOT IN ('acknowledged', 'rejected')`
      )
      .run(new Date().toISOString(), commandId);
  }

  acknowledge(
    commandId: CommandId,
    nodeId: NodeId,
    status: 'received' | 'rejected',
    error?: string
  ): void {
    const nextStatus: RelayCommandStatus = status === 'received' ? 'acknowledged' : 'rejected';
    this.database
      .prepare(
        `UPDATE relay_commands
         SET status = ?, acknowledged_at = ?, rejection_error = ?
         WHERE command_id = ? AND target_node_id = ?`
      )
      .run(nextStatus, new Date().toISOString(), error ?? null, commandId, nodeId);
  }

  acknowledgeThrough(nodeId: NodeId, cursor: number): void {
    this.database
      .prepare(
        `UPDATE relay_commands
         SET status = 'acknowledged', acknowledged_at = COALESCE(acknowledged_at, ?)
         WHERE target_node_id = ? AND cursor <= ? AND status IN ('pending', 'delivered')`
      )
      .run(new Date().toISOString(), nodeId, cursor);
  }

  close(): void {
    this.database.close();
  }
}
