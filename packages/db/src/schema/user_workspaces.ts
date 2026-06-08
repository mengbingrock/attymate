import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * A user-granted local workspace folder.
 *
 * Set when the user picks a folder in AttyMate (Electron shell) via the
 * `window.attymate.pickFolder()` IPC bridge. The agent runtime on the server
 * uses these paths to scope `local_read_file` requests sent back to the user's
 * AttyMate over the bridge WebSocket.
 *
 * Multiple rows per user are allowed; uniqueness is on (user_id, workspace_path)
 * so the same folder can't be granted twice. The agent-side read/write routes
 * currently dispatch against the user's "default" workspace (the oldest one);
 * a future workspaceId param on those routes will let agents target a specific
 * folder.
 *
 * `activeAt` marks which folder the user's local-execution-runner agents run in:
 * the row with the most-recent non-null `activeAt` is "the active workspace".
 * Using a timestamp (rather than a boolean) sidesteps multi-row uniqueness — a
 * new "set active" just stamps now() and the latest wins. Null = never marked
 * active; resolution falls back to the oldest grant.
 */
export const userWorkspaces = pgTable(
  "user_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    workspacePath: text("workspace_path").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    activeAt: timestamp("active_at", { withTimezone: true }),
  },
  (table) => ({
    userPathUq: uniqueIndex("user_workspaces_user_path_uq").on(table.userId, table.workspacePath),
  }),
);
