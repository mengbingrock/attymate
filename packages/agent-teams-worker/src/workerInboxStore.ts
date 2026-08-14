import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  commandEnvelopeSchema,
  commandIdSchema,
  type CommandEnvelope,
  type CommandId,
} from '@claude-teams/agent-teams-protocol';

export interface WorkerInboxCommand {
  readonly cursor: number;
  readonly commandId: CommandId;
  readonly envelope: CommandEnvelope;
  readonly receivedAt: string;
}

interface WorkerInboxRow {
  cursor: number;
  command_id: string;
  envelope_json: string;
  received_at: string;
}

const mapRow = (row: WorkerInboxRow): WorkerInboxCommand => ({
  cursor: row.cursor,
  commandId: commandIdSchema.parse(row.command_id),
  envelope: commandEnvelopeSchema.parse(JSON.parse(row.envelope_json)),
  receivedAt: row.received_at,
});

export class WorkerInboxConflictError extends Error {
  readonly code = 'WORKER_INBOX_CONFLICT';

  constructor(readonly commandId: CommandId) {
    super(`Command ${commandId} was replayed with a different cursor or content`);
    this.name = 'WorkerInboxConflictError';
  }
}

export class WorkerInboxStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS inbox_commands (
        cursor INTEGER PRIMARY KEY,
        command_id TEXT NOT NULL UNIQUE,
        envelope_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
    `);
  }

  accept(cursor: number, inputEnvelope: unknown): WorkerInboxCommand {
    const envelope = commandEnvelopeSchema.parse(inputEnvelope);
    const existing = this.get(envelope.commandId);
    if (existing !== undefined) {
      if (
        existing.cursor !== cursor ||
        JSON.stringify(existing.envelope) !== JSON.stringify(envelope)
      ) {
        throw new WorkerInboxConflictError(envelope.commandId);
      }
      return existing;
    }
    const receivedAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO inbox_commands
          (cursor, command_id, envelope_json, received_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(cursor, envelope.commandId, JSON.stringify(envelope), receivedAt);
    const stored = this.get(envelope.commandId);
    if (stored === undefined) throw new Error('Worker inbox insert did not produce a row');
    return stored;
  }

  get(commandId: CommandId): WorkerInboxCommand | undefined {
    const row = this.database
      .prepare('SELECT * FROM inbox_commands WHERE command_id = ?')
      .get(commandId) as WorkerInboxRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  list(): readonly WorkerInboxCommand[] {
    const rows = this.database
      .prepare('SELECT * FROM inbox_commands ORDER BY cursor ASC')
      .all() as unknown as WorkerInboxRow[];
    return rows.map(mapRow);
  }

  lastInboundCursor(): number {
    const row = this.database
      .prepare('SELECT COALESCE(MAX(cursor), 0) AS cursor FROM inbox_commands')
      .get() as { cursor: number };
    return row.cursor;
  }

  close(): void {
    this.database.close();
  }
}
