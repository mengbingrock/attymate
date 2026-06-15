import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * A user-granted local workspace folder.
 *
 * Set when the user picks a folder in AttyMate (Electron shell) via the
 * `window.attymate.pickFolder()` IPC bridge. The agent runtime on the server
 * uses these paths to scope `local_read_file` requests sent back to the user's
 * AttyMate over the bridge WebSocket.
 *
 * Workspaces are scoped per COMPANY (not per user): switching companies switches
 * the workspace folder list, and all members of a company share it. Uniqueness
 * is on (company_id, workspace_path). `company_id` is nullable only for legacy
 * rows created before this scoping existed. `user_id` is retained as the
 * "granted by" record and the local-bridge dispatch target (whose machine the
 * folder lives on); it no longer scopes the list.
 *
 * `activeAt` marks which folder the company's local-execution-runner agents run
 * in: among the company's rows, the most-recent non-null `activeAt` is "the
 * active workspace". Using a timestamp (rather than a boolean) sidesteps
 * multi-row uniqueness — a new "set active" just stamps now() and the latest
 * wins. Null = never marked active; resolution falls back to the oldest grant.
 */
export const userWorkspaces = pgTable(
  "user_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    companyId: text("company_id"),
    workspacePath: text("workspace_path").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    activeAt: timestamp("active_at", { withTimezone: true }),
  },
  (table) => ({
    companyPathUq: uniqueIndex("user_workspaces_company_path_uq").on(
      table.companyId,
      table.workspacePath,
    ),
  }),
);
