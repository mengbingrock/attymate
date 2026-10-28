import type { DatabaseSync } from 'node:sqlite';

import type { WorkerCodexAppServerSession } from './codexAppServerClient';

export interface MessageSubmission {
  messageId: string;
  threadId: string;
  input: string;
  state: 'uncertain' | 'accepted';
  error: string | null;
  acceptedAt: string | null;
}

/** A claim is durable before RPC submission: a lost response must never authorize replay. */
export class MessageSubmissionStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS message_submissions (
      messageId TEXT PRIMARY KEY, threadId TEXT NOT NULL, input TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('uncertain', 'accepted')), error TEXT
    )`);
    const columns = db.prepare('PRAGMA table_info(message_submissions)').all();
    if (!columns.some((column) => column.name === 'acceptedAt'))
      db.exec('ALTER TABLE message_submissions ADD COLUMN acceptedAt TEXT');
  }
  get(messageId: string): MessageSubmission | undefined {
    return this.db.prepare('SELECT * FROM message_submissions WHERE messageId=?').get(messageId) as
      | MessageSubmission
      | undefined;
  }
  begin(messageId: string, threadId: string, input: string): boolean {
    return (
      this.db
        .prepare(
          `INSERT OR IGNORE INTO message_submissions
      (messageId, threadId, input, state) VALUES (?, ?, ?, 'uncertain')`
        )
        .run(messageId, threadId, input).changes > 0
    );
  }
  accept(messageId: string): void {
    this.db
      .prepare(
        "UPDATE message_submissions SET state='accepted', error=NULL, acceptedAt=COALESCE(acceptedAt, ?) WHERE messageId=?"
      )
      .run(new Date().toISOString(), messageId);
  }
  uncertain(messageId: string, error: unknown): void {
    this.db
      .prepare("UPDATE message_submissions SET error=? WHERE messageId=? AND state='uncertain'")
      .run(
        error instanceof Error ? error.message.slice(0, 2000) : 'Submission outcome unknown',
        messageId
      );
  }
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Positive evidence only. An absent rollout item does not prove that a submission was rejected. */
export const reconcileMessageSubmission = async (
  session: WorkerCodexAppServerSession,
  submission: MessageSubmission
): Promise<boolean> => {
  try {
    const result = record(
      await session.request('thread/read', {
        threadId: submission.threadId,
        includeTurns: true,
      })
    );
    const thread = record(result.thread);
    if (thread.id !== submission.threadId || !Array.isArray(thread.turns)) return false;
    return thread.turns.some((value) => {
      const turn = record(value);
      return (
        typeof turn.id === 'string' &&
        Array.isArray(turn.items) &&
        turn.items.some((value) => {
          const item = record(value);
          if (item.type !== 'userMessage' || !Array.isArray(item.content)) return false;
          return (
            item.content.length === 1 &&
            record(item.content[0]).type === 'text' &&
            record(item.content[0]).text === submission.input
          );
        })
      );
    });
  } catch {
    return false;
  }
};
