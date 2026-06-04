import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { userWorkspaces } from "@paperclipai/db";

export type UserWorkspaceRow = {
  workspacePath: string;
  grantedAt: Date;
  updatedAt: Date;
};

/**
 * Manages the absolute path each user has granted AttyMate access to.
 * Each user has at most one workspace row (enforced by user_workspaces_user_uq).
 *
 * Used by the agent runtime to scope local_read_file requests sent through the
 * AttyMate ↔ server bridge (see F3/F4 of the local-fs plan). Service-layer
 * code does only DB I/O — path validation lives in the route layer (incoming
 * paths from clients) and in the bridge dispatch layer (request paths from
 * agents being checked against the user's granted root).
 */
export function userWorkspaceService(db: Db) {
  return {
    async get(userId: string): Promise<UserWorkspaceRow | null> {
      const [row] = await db
        .select({
          workspacePath: userWorkspaces.workspacePath,
          grantedAt: userWorkspaces.grantedAt,
          updatedAt: userWorkspaces.updatedAt,
        })
        .from(userWorkspaces)
        .where(eq(userWorkspaces.userId, userId))
        .limit(1);
      return row ?? null;
    },

    async upsert(userId: string, workspacePath: string): Promise<UserWorkspaceRow> {
      const [row] = await db
        .insert(userWorkspaces)
        .values({ userId, workspacePath })
        .onConflictDoUpdate({
          target: userWorkspaces.userId,
          set: { workspacePath, updatedAt: new Date() },
        })
        .returning({
          workspacePath: userWorkspaces.workspacePath,
          grantedAt: userWorkspaces.grantedAt,
          updatedAt: userWorkspaces.updatedAt,
        });
      return row;
    },

    async remove(userId: string): Promise<boolean> {
      const result = await db
        .delete(userWorkspaces)
        .where(eq(userWorkspaces.userId, userId))
        .returning({ id: userWorkspaces.id });
      return result.length > 0;
    },
  };
}
