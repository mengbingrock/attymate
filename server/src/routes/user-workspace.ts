import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { userWorkspaceService } from "../services/user-workspaces.js";
import { assertBoard } from "./authz.js";

/**
 * AttyMate local workspace routes.
 *
 * Lets each authenticated user record the absolute path of the local folder
 * they've granted AttyMate access to. The path is stored verbatim — server has
 * no way to validate it exists (the path is on the user's machine, not here).
 * Path-syntax sanity is enforced here; existence/readability is enforced by
 * AttyMate's main process when the bridge actually serves a read.
 */

const workspacePathSchema = z
  .string()
  .trim()
  .min(1, "workspacePath required")
  .max(1024, "workspacePath too long")
  .refine((value) => value.startsWith("/"), "workspacePath must be absolute (start with /)")
  .refine((value) => !value.split("/").includes(".."), "workspacePath must not contain .. segments");

const upsertWorkspaceSchema = z.object({
  workspacePath: workspacePathSchema,
});

function requireBoardUserId(req: Request, res: Response): string | null {
  assertBoard(req);
  if (!req.actor.userId) {
    res.status(403).json({ error: "Board user context required" });
    return null;
  }
  return req.actor.userId;
}

export function userWorkspaceRoutes(db: Db) {
  const router = Router();
  const svc = userWorkspaceService(db);

  router.get("/users/me/workspace", async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    const row = await svc.get(userId);
    if (!row) {
      res.status(204).end();
      return;
    }
    res.json(row);
  });

  router.put("/users/me/workspace", validate(upsertWorkspaceSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    const row = await svc.upsert(userId, req.body.workspacePath);
    res.json(row);
  });

  router.delete("/users/me/workspace", async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    await svc.remove(userId);
    res.status(204).end();
  });

  return router;
}
