import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * A user-granted local workspace folder.
 *
 * Set when the user picks a folder in AttyMate (Electron shell) via the
 * `window.attymate.pickFolder()` IPC bridge. The agent runtime on the server
 * uses this path to scope `local_read_file` requests sent back to the user's
 * AttyMate over the bridge WebSocket.
 *
 * Exactly one row per user; the workspacePath replaces any prior value on
 * upsert. Deletion revokes all in-flight and future reads.
 */
export const userWorkspaces = pgTable(
  "user_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    workspacePath: text("workspace_path").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userUq: uniqueIndex("user_workspaces_user_uq").on(table.userId),
  }),
);
