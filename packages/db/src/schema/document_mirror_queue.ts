import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Pending "mirror this issue document to the user's local workspace folder" work.
 *
 * When an issue document is written (see `documentService.upsertIssueDocument`),
 * we also want the file to land inside the folder the user picked in AttyMate
 * (`user_workspaces.workspacePath`). That folder lives on the user's machine and
 * is only reachable over the AttyMate desktop bridge WebSocket — which may not be
 * connected at write time. So each intended write is recorded here and flushed
 * when the user's bridge (re)connects (see `local-bridge-ws.ts`).
 *
 * `targetUserId` is the user whose folder receives the file (resolved from the
 * issue's company owners). One row per (targetUserId, issueId, key): re-editing a
 * document coalesces onto the same row rather than queuing duplicates. The body is
 * NOT stored here — the flusher re-reads the latest document body at send time, so
 * a queued write always ships current content.
 *
 * `status` is `pending` until delivered (row is then deleted) or `failed` after
 * `attempts` exhausts the retry budget (e.g. an owner who never runs the desktop).
 */
export const documentMirrorQueue = pgTable(
  "document_mirror_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    documentId: uuid("document_id").notNull(),
    key: text("key").notNull(),
    targetUserId: text("target_user_id").notNull(),
    relativePath: text("relative_path").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetIssueKeyUq: uniqueIndex("document_mirror_queue_target_issue_key_uq").on(
      table.targetUserId,
      table.issueId,
      table.key,
    ),
    targetStatusIdx: index("document_mirror_queue_target_status_idx").on(table.targetUserId, table.status),
  }),
);
