import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

const replyEnvelope = z
  .object({
    type: z.literal('agent-teams.message-reply'),
    version: z.literal(1),
    inReplyToMessageId: z.uuid(),
    text: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const encodeTeamReply = (text: string, inReplyToMessageId?: string): string => {
  if (!inReplyToMessageId) return text;
  const encoded = JSON.stringify(
    replyEnvelope.parse({
      type: 'agent-teams.message-reply',
      version: 1,
      inReplyToMessageId,
      text,
    })
  );
  if (encoded.length > 20_000) throw new Error('Reply exceeds the team message size limit');
  return encoded;
};

/** Ordinary messages and unknown envelope versions remain literal text. */
export const decodeTeamReply = (text: string): { text: string; inReplyToMessageId?: string } => {
  try {
    const reply = replyEnvelope.safeParse(JSON.parse(text));
    if (reply.success)
      return { text: reply.data.text, inReplyToMessageId: reply.data.inReplyToMessageId };
  } catch {
    /* Plain message text. */
  }
  return { text };
};

export interface MessageReplyReceipt {
  repliedAt?: string;
  replyMessageId?: string;
}

/** A local projection of a durable outgoing reply, independent of reading and processing. */
export class MessageReplyStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS message_replies (
      messageId TEXT PRIMARY KEY, repliedAt TEXT NOT NULL, replyMessageId TEXT NOT NULL
    )`);
  }
  get(messageId: string): MessageReplyReceipt {
    const row = this.db
      .prepare('SELECT repliedAt, replyMessageId FROM message_replies WHERE messageId=?')
      .get(messageId);
    return row ? ({ ...row } as MessageReplyReceipt) : {};
  }
  record(messageId: string, replyMessageId: string, repliedAt = new Date().toISOString()): void {
    this.db
      .prepare('INSERT OR IGNORE INTO message_replies VALUES (?, ?, ?)')
      .run(messageId, repliedAt, replyMessageId);
  }
}
