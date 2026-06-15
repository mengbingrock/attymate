import { asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { userWorkspaces } from "@paperclipai/db";

export type UserWorkspaceRow = {
  id: string;
  workspacePath: string;
  grantedAt: Date;
  updatedAt: Date;
  activeAt: Date | null;
};

const SELECT_COLS = {
  id: userWorkspaces.id,
  workspacePath: userWorkspaces.workspacePath,
  grantedAt: userWorkspaces.grantedAt,
  updatedAt: userWorkspaces.updatedAt,
  activeAt: userWorkspaces.activeAt,
} as const;

/**
 * Pick the active workspace from a user's rows. Newest non-null `activeAt` wins;
 * otherwise the oldest grant (so a single-folder user needs zero clicks). Pure
 * so it can be unit-tested without a DB; `getActive` delegates to it.
 */
export function pickActiveWorkspace<T extends { grantedAt: Date; activeAt: Date | null }>(
  rows: T[],
): T | null {
  if (rows.length === 0) return null;
  const marked = rows
    .filter((r) => r.activeAt)
    .sort((a, b) => (b.activeAt as Date).getTime() - (a.activeAt as Date).getTime());
  if (marked.length > 0) return marked[0];
  return [...rows].sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime())[0];
}

/**
 * Manages the absolute paths granted to AttyMate, scoped per COMPANY.
 *
 * Workspaces belong to a company (migration 0089): switching companies switches
 * the folder list, and uniqueness is on (company_id, workspace_path). `user_id`
 * is retained only as the "granted by" record / local-bridge dispatch target.
 *
 * The agent-side read/write routes operate on a single "default" folder via
 * `getDefault()` — the company's oldest grant. Service-layer code does only DB
 * I/O; all path validation lives in the route layer (client input) and the
 * bridge dispatch layer (agent requests, re-checked against the granted root).
 */
export function userWorkspaceService(db: Db) {
  return {
    async listByCompany(companyId: string): Promise<UserWorkspaceRow[]> {
      return db
        .select(SELECT_COLS)
        .from(userWorkspaces)
        .where(eq(userWorkspaces.companyId, companyId))
        .orderBy(asc(userWorkspaces.grantedAt));
    },

    // Look up a single workspace by id (company-agnostic; ids are unguessable
    // UUIDs and are only surfaced via a company's own list).
    async getById(id: string): Promise<UserWorkspaceRow | null> {
      const [row] = await db
        .select(SELECT_COLS)
        .from(userWorkspaces)
        .where(eq(userWorkspaces.id, id))
        .limit(1);
      return row ?? null;
    },

    // The "default" workspace used by read/write routes when no workspaceId is
    // supplied. Oldest grant for the company = stable choice that doesn't shift
    // if new folders are added. Returns null if the company has no folder yet.
    async getDefault(companyId: string): Promise<UserWorkspaceRow | null> {
      const [row] = await db
        .select(SELECT_COLS)
        .from(userWorkspaces)
        .where(eq(userWorkspaces.companyId, companyId))
        .orderBy(asc(userWorkspaces.grantedAt))
        .limit(1);
      return row ?? null;
    },

    async add(
      companyId: string,
      workspacePath: string,
      userId: string,
    ): Promise<UserWorkspaceRow> {
      // Idempotent: re-adding the same path (for the same company) returns the
      // existing row instead of 409-ing. UI-friendly — clicking "add" twice on
      // the same folder is a no-op rather than an error.
      const [row] = await db
        .insert(userWorkspaces)
        .values({ userId, companyId, workspacePath })
        .onConflictDoUpdate({
          target: [userWorkspaces.companyId, userWorkspaces.workspacePath],
          set: { updatedAt: new Date() },
        })
        .returning(SELECT_COLS);
      return row;
    },

    async removeById(id: string): Promise<boolean> {
      const result = await db
        .delete(userWorkspaces)
        .where(eq(userWorkspaces.id, id))
        .returning({ id: userWorkspaces.id });
      return result.length > 0;
    },

    // The folder the company's local-execution-runner agents run in. Newest
    // `activeAt` wins; if none was ever marked active, fall back to the oldest
    // grant so a single-folder company works with zero clicks. Returns null if
    // the company has no folder.
    async getActive(companyId: string): Promise<UserWorkspaceRow | null> {
      const rows = await db
        .select(SELECT_COLS)
        .from(userWorkspaces)
        .where(eq(userWorkspaces.companyId, companyId));
      return pickActiveWorkspace(rows);
    },

    // Mark one folder active by stamping now(). Other rows keep their (older)
    // activeAt, so the latest stamp wins in getActive. Returns the updated row,
    // or null if the id doesn't exist.
    async setActive(id: string): Promise<UserWorkspaceRow | null> {
      const [row] = await db
        .update(userWorkspaces)
        .set({ activeAt: new Date() })
        .where(eq(userWorkspaces.id, id))
        .returning(SELECT_COLS);
      return row ?? null;
    },
  };
}
