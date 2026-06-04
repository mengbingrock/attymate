import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { userWorkspaces } from "@paperclipai/db";

export type UserWorkspaceRow = {
  id: string;
  workspacePath: string;
  grantedAt: Date;
  updatedAt: Date;
};

const SELECT_COLS = {
  id: userWorkspaces.id,
  workspacePath: userWorkspaces.workspacePath,
  grantedAt: userWorkspaces.grantedAt,
  updatedAt: userWorkspaces.updatedAt,
} as const;

/**
 * Manages the absolute paths each user has granted AttyMate access to.
 *
 * As of migration 0086 each user can have multiple workspace rows; uniqueness
 * is on (user_id, workspace_path) so the same folder can't be granted twice.
 *
 * The agent-side read/write routes still operate on a single "default" folder
 * via `getDefault()` — the user's oldest grant — until those routes learn to
 * take a workspaceId parameter. Service-layer code does only DB I/O; all path
 * validation lives in the route layer (client input) and the bridge dispatch
 * layer (agent requests, re-checked against the granted root).
 */
export function userWorkspaceService(db: Db) {
  return {
    async listByUser(userId: string): Promise<UserWorkspaceRow[]> {
      return db
        .select(SELECT_COLS)
        .from(userWorkspaces)
        .where(eq(userWorkspaces.userId, userId))
        .orderBy(asc(userWorkspaces.grantedAt));
    },

    // The "default" workspace used by read/write routes when no workspaceId is
    // supplied. Oldest grant = stable choice that doesn't shift if the user
    // adds new folders. Returns null if the user hasn't granted any folder yet.
    async getDefault(userId: string): Promise<UserWorkspaceRow | null> {
      const [row] = await db
        .select(SELECT_COLS)
        .from(userWorkspaces)
        .where(eq(userWorkspaces.userId, userId))
        .orderBy(asc(userWorkspaces.grantedAt))
        .limit(1);
      return row ?? null;
    },

    async add(userId: string, workspacePath: string): Promise<UserWorkspaceRow> {
      // Idempotent: re-adding the same path returns the existing row instead of
      // 409-ing. UI-friendly — clicking "add" twice on the same folder is a
      // no-op rather than an error.
      const [row] = await db
        .insert(userWorkspaces)
        .values({ userId, workspacePath })
        .onConflictDoUpdate({
          target: [userWorkspaces.userId, userWorkspaces.workspacePath],
          set: { updatedAt: new Date() },
        })
        .returning(SELECT_COLS);
      return row;
    },

    async removeById(userId: string, id: string): Promise<boolean> {
      const result = await db
        .delete(userWorkspaces)
        .where(and(eq(userWorkspaces.id, id), eq(userWorkspaces.userId, userId)))
        .returning({ id: userWorkspaces.id });
      return result.length > 0;
    },
  };
}
