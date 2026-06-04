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
    userPathUq: uniqueIndex("user_workspaces_user_path_uq").on(table.userId, table.workspacePath),
  }),
);
