import { randomBytes, createHash } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DesktopTeamMessage } from '@claude-teams/agent-teams-protocol';

export interface DesktopChatBinding {
  id: string;
  teamId: string;
  membershipId: string;
  threadId: string | null;
  token: string;
}

export class DesktopChatStore {
  readonly db: DatabaseSync;
  readonly pairingHash: string;
  constructor(dataDir: string) {
    const path = join(dataDir, 'desktop-pairing-code');
    let code: string;
    try {
      code = readFileSync(path, 'utf8').trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      code = randomBytes(32).toString('base64url');
      writeFileSync(path, code + '\n', { mode: 0o600, flag: 'wx' });
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Invalid desktop pairing code');
    this.pairingHash = createHash('sha256').update(code).digest('hex');
    const databasePath = join(dataDir, 'desktop-chats.sqlite');
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS bindings (id TEXT PRIMARY KEY, teamId TEXT NOT NULL,
        membershipId TEXT NOT NULL, threadId TEXT UNIQUE, token TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, teamId TEXT NOT NULL,
        payload TEXT NOT NULL, direction TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
    `);
  }
  get defaultTeam(): string | null {
    return (
      (
        this.db.prepare("SELECT value FROM settings WHERE key='defaultTeam'").get() as
          | { value: string }
          | undefined
      )?.value ?? null
    );
  }
  set defaultTeam(value: string | null) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES ('defaultTeam', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      )
      .run(value);
  }
  list(): DesktopChatBinding[] {
    return this.db.prepare('SELECT * FROM bindings').all() as unknown as DesktopChatBinding[];
  }
  get(id: string): DesktopChatBinding | undefined {
    return this.db.prepare('SELECT * FROM bindings WHERE id=?').get(id) as unknown as
      | DesktopChatBinding
      | undefined;
  }
  byThread(threadId: string): DesktopChatBinding | undefined {
    return this.db.prepare('SELECT * FROM bindings WHERE threadId=?').get(threadId) as unknown as
      | DesktopChatBinding
      | undefined;
  }
  byToken(token: string): DesktopChatBinding | undefined {
    return this.db.prepare('SELECT * FROM bindings WHERE token=?').get(token) as unknown as
      | DesktopChatBinding
      | undefined;
  }
  create(id: string, teamId: string, membershipId: string): DesktopChatBinding {
    this.db
      .prepare('INSERT OR IGNORE INTO bindings VALUES (?, ?, ?, NULL, ?)')
      .run(id, teamId, membershipId, randomBytes(32).toString('base64url'));
    const binding = this.get(id)!;
    if (binding.teamId !== teamId || binding.membershipId !== membershipId)
      throw new Error('Request already belongs to another team');
    return binding;
  }
  bind(id: string, threadId: string): void {
    const current = this.get(id);
    if (!current || (current.threadId !== null && current.threadId !== threadId))
      throw new Error('Chat binding conflict');
    this.db.prepare('UPDATE bindings SET threadId=? WHERE id=?').run(threadId, id);
  }
  putMessage(message: DesktopTeamMessage, direction: 'in' | 'out'): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO messages (id, teamId, payload, direction) VALUES (?, ?, ?, ?)'
      )
      .run(message.id, message.teamId, JSON.stringify(message), direction);
  }
  messages(teamId?: string, pending = false, direction = 'in'): DesktopTeamMessage[] {
    return (
      this.db
        .prepare(
          'SELECT payload FROM messages WHERE direction=? AND (? IS NULL OR teamId=?) AND (?=0 OR delivered=0) ORDER BY rowid'
        )
        .all(direction, teamId ?? null, teamId ?? null, pending ? 1 : 0) as { payload: string }[]
    ).map((row) => JSON.parse(row.payload) as DesktopTeamMessage);
  }
  acknowledge(id: string): void {
    this.db.prepare('UPDATE messages SET delivered=1 WHERE id=?').run(id);
  }
  close(): void {
    this.db.close();
  }
}
