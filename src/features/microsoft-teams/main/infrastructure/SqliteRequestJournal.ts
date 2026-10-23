import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  PendingTeamsDelivery,
  TeamsBinding,
  TeamsConversation,
  TeamsDeliveryJournal,
  TeamsRequestJournal,
} from '../../contracts';

const identity = (binding: TeamsBinding): string =>
  JSON.stringify([binding.tenantId, binding.aadObjectId, binding.teamId, binding.nodeId]);

export class SqliteRequestJournal implements TeamsRequestJournal, TeamsDeliveryJournal {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.database.exec(
      'PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS teams_requests (key TEXT PRIMARY KEY, reply TEXT, received_at TEXT NOT NULL)'
    );
    const columns = this.database.prepare('PRAGMA table_info(teams_requests)').all();
    if (!columns.some((column) => column.name === 'delivery_key'))
      this.database.exec('ALTER TABLE teams_requests ADD COLUMN delivery_key TEXT');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS teams_conversations (identity TEXT PRIMARY KEY, target TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS teams_deliveries (
        key TEXT PRIMARY KEY, target TEXT NOT NULL, text TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, activity_id TEXT
      );
      UPDATE teams_deliveries SET state='unknown' WHERE state='sending';
    `);
  }

  begin(key: string): { fresh: boolean; reply?: string; deliveryKey?: string } {
    const inserted = this.database
      .prepare('INSERT OR IGNORE INTO teams_requests(key, received_at) VALUES (?, ?)')
      .run(key, new Date().toISOString());
    if (inserted.changes === 1) return { fresh: true };
    const row = this.database
      .prepare('SELECT reply, delivery_key FROM teams_requests WHERE key=?')
      .get(key);
    return {
      fresh: false,
      ...(typeof row?.reply === 'string' ? { reply: row.reply } : {}),
      ...(typeof row?.delivery_key === 'string' ? { deliveryKey: row.delivery_key } : {}),
    };
  }

  finish(key: string, reply: string, deliveryKey?: string): void {
    this.database
      .prepare('UPDATE teams_requests SET reply=?, delivery_key=? WHERE key=?')
      .run(reply, deliveryKey ?? `request:${key}`, key);
  }

  rememberConversation(target: TeamsConversation): void {
    this.database
      .prepare(
        'INSERT INTO teams_conversations VALUES (?, ?) ON CONFLICT(identity) DO UPDATE SET target=excluded.target'
      )
      .run(identity(target), JSON.stringify(target));
  }

  conversation(binding: TeamsBinding): TeamsConversation | undefined {
    const row = this.database
      .prepare('SELECT target FROM teams_conversations WHERE identity=?')
      .get(identity(binding));
    return typeof row?.target === 'string'
      ? (JSON.parse(row.target) as TeamsConversation)
      : undefined;
  }

  enqueue(key: string, target: TeamsConversation, text: string): void {
    this.database
      .prepare(
        'INSERT OR IGNORE INTO teams_deliveries(key, target, text, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(
        JSON.stringify([identity(target), key]),
        JSON.stringify(target),
        text,
        new Date().toISOString()
      );
  }

  pending(): PendingTeamsDelivery[] {
    return this.database
      .prepare(
        "SELECT key, target, text FROM teams_deliveries WHERE state='pending' ORDER BY rowid"
      )
      .all()
      .map((row) => ({
        key: String(row.key),
        target: JSON.parse(String(row.target)) as TeamsConversation,
        text: String(row.text),
      }));
  }

  claim(key: string): boolean {
    return (
      this.database
        .prepare("UPDATE teams_deliveries SET state='sending' WHERE key=? AND state='pending'")
        .run(key).changes === 1
    );
  }

  settle(key: string, activityId?: string): void {
    this.database
      .prepare("UPDATE teams_deliveries SET state=?, activity_id=? WHERE key=? AND state='sending'")
      .run(activityId === undefined ? 'unknown' : 'sent', activityId ?? null, key);
  }

  close(): void {
    this.database.close();
  }
}
