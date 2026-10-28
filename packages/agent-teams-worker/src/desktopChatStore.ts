import { randomBytes, createHash } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DesktopTeamMessage } from '@claude-teams/agent-teams-protocol';
import { MessageSubmissionStore } from './messageSubmissionStore';
import { decodeTeamReply, MessageReplyStore } from './teamMessageReplies';

export interface DesktopChatBinding {
  id: string;
  teamId: string;
  membershipId: string;
  threadId: string | null;
  token: string;
}

interface DesktopInboxRow {
  payload: string;
  readAt: string | null;
  processedAt: string | null;
}

const inboxMessage = ({ payload, readAt, processedAt }: DesktopInboxRow) => {
  const message = JSON.parse(payload) as DesktopTeamMessage;
  return {
    ...message,
    ...decodeTeamReply(message.text),
    messageId: message.id,
    ...(readAt === null ? {} : { readAt }),
    ...(processedAt === null ? {} : { processedAt }),
  };
};

export class DesktopChatStore {
  readonly db: DatabaseSync;
  readonly pairingHash: string;
  readonly submissions: MessageSubmissionStore;
  readonly replies: MessageReplyStore;
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
    this.submissions = new MessageSubmissionStore(this.db);
    this.replies = new MessageReplyStore(this.db);
    const columns = this.db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
    for (const column of ['readAt', 'processedAt', 'acceptedAt']) {
      if (!columns.some(({ name }) => name === column))
        this.db.exec(`ALTER TABLE messages ADD COLUMN ${column} TEXT`);
    }
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
    const existing = this.db
      .prepare('SELECT payload, direction FROM messages WHERE id=?')
      .get(message.id) as { payload: string; direction: string } | undefined;
    if (
      existing &&
      (existing.payload !== JSON.stringify(message) || existing.direction !== direction)
    ) {
      throw new Error('Message ID was replayed with different content');
    }
    this.db
      .prepare(
        'INSERT OR IGNORE INTO messages (id, teamId, payload, direction, acceptedAt) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        message.id,
        message.teamId,
        JSON.stringify(message),
        direction,
        new Date().toISOString()
      );
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
  listForMembership(teamId: string, membershipId: string, unprocessedOnly = false, limit = 50) {
    const rows = this.db
      .prepare(
        `SELECT payload, readAt, processedAt FROM messages
      WHERE direction='in' AND teamId=? AND json_extract(payload, '$.recipientMembershipId')=?
        AND (?=0 OR processedAt IS NULL) ORDER BY rowid LIMIT ?`
      )
      .all(teamId, membershipId, unprocessedOnly ? 1 : 0, limit) as {
      payload: string;
      readAt: string | null;
      processedAt: string | null;
    }[];
    return rows.map((row) => this.inbox(row));
  }
  readForMembership(id: string, teamId: string, membershipId: string) {
    const row = this.db
      .prepare(
        `UPDATE messages SET readAt=COALESCE(readAt, ?)
      WHERE id=? AND direction='in' AND teamId=? AND json_extract(payload, '$.recipientMembershipId')=?
      RETURNING payload, readAt, processedAt`
      )
      .get(new Date().toISOString(), id, teamId, membershipId) as DesktopInboxRow | undefined;
    if (!row) throw new Error('Message was not found in this membership inbox');
    return this.inbox(row);
  }
  acknowledgeProcessed(id: string, teamId: string, membershipId: string) {
    const now = new Date().toISOString();
    const row = this.db
      .prepare(
        `UPDATE messages SET delivered=1, readAt=COALESCE(readAt, ?), processedAt=COALESCE(processedAt, ?)
      WHERE id=? AND direction='in' AND teamId=? AND json_extract(payload, '$.recipientMembershipId')=?
      RETURNING payload, readAt, processedAt`
      )
      .get(now, now, id, teamId, membershipId) as DesktopInboxRow | undefined;
    if (!row) throw new Error('Message was not found in this membership inbox');
    return this.inbox(row);
  }
  private inbox(row: DesktopInboxRow) {
    const message = inboxMessage(row);
    const submission = this.submissions.get(message.id);
    const accepted = this.db.prepare('SELECT acceptedAt FROM messages WHERE id=?').get(message.id);
    return {
      ...message,
      ...this.replies.get(message.id),
      ...(accepted?.acceptedAt ? { acceptedAt: accepted.acceptedAt as string } : {}),
      deliveryState:
        submission?.state === 'accepted' ? 'delivered' : (submission?.state ?? 'pending'),
      ...(submission?.acceptedAt ? { deliveredAt: submission.acceptedAt } : {}),
    };
  }
  assertReplyTarget(id: string, teamId: string, membershipId: string, recipient: string): void {
    const row = this.db
      .prepare(
        `SELECT payload FROM messages WHERE id=? AND teamId=?
      AND direction='in' AND json_extract(payload, '$.recipientMembershipId')=?
      AND json_extract(payload, '$.senderMembershipId')=?`
      )
      .get(id, teamId, membershipId, recipient);
    if (!row)
      throw new Error(
        'Reply target was not found in this membership inbox or has a different sender'
      );
  }
  queueReply(message: DesktopTeamMessage, inReplyToMessageId: string): DesktopTeamMessage {
    const previous = this.replies.get(inReplyToMessageId).replyMessageId;
    const existing = previous
      ? this.messages(undefined, false, 'out').find((m) => m.id === previous)
      : undefined;
    if (
      existing &&
      existing.text === message.text &&
      existing.recipientMembershipId === message.recipientMembershipId
    )
      return existing;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.putMessage(message, 'out');
      this.replies.record(inReplyToMessageId, message.id);
      this.db.exec('COMMIT');
      return message;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  requeueUnprocessedNotifications(): void {
    this.db
      .prepare(
        `UPDATE messages SET delivered=0 WHERE direction='in' AND processedAt IS NULL
        AND id NOT IN (SELECT messageId FROM message_submissions WHERE state='accepted')`
      )
      .run();
  }
  acknowledge(id: string): void {
    this.db.prepare('UPDATE messages SET delivered=1 WHERE id=?').run(id);
  }
  close(): void {
    this.db.close();
  }
}
