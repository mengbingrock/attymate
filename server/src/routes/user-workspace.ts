import path from "node:path";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { unprocessable } from "../errors.js";
import { dispatchToUserBridge, isUserBridgeConnected } from "../realtime/local-bridge-ws.js";
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

const readLocalFileSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1, "path required")
    .max(1024, "path too long")
    // Reject any absolute path; the agent should always express paths relative
    // to the user's workspace root. Absolute paths from agents are a smell.
    .refine((value) => !value.startsWith("/"), "path must be relative to the workspace root")
    .refine((value) => !value.split("/").includes(".."), "path must not contain .. segments"),
});

interface BridgeReadResponse {
  contents: string;
  encoding: string;
  size: number;
  mtime: string;
}

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

  // Read a file from the user's granted workspace via the AttyMate bridge.
  //
  // The request path is RELATIVE to the workspace root the user granted via
  // PUT /users/me/workspace. We join the two, prevent traversal, and dispatch
  // the absolute path to the user's connected AttyMate. AttyMate re-validates
  // (defense in depth) and returns base64 bytes.
  router.post("/users/me/local-files/read", validate(readLocalFileSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;

    const workspace = await svc.get(userId);
    if (!workspace) {
      throw unprocessable("No workspace granted. PUT /users/me/workspace first.");
    }
    if (!isUserBridgeConnected(userId)) {
      throw unprocessable("AttyMate is not connected. Open the desktop app and sign in.");
    }

    const relativePath = req.body.path as string;
    const resolvedAbs = path.resolve(workspace.workspacePath, relativePath);
    const rel = path.relative(workspace.workspacePath, resolvedAbs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw unprocessable("path escapes the granted workspace root");
    }

    let payload: BridgeReadResponse;
    try {
      payload = (await dispatchToUserBridge(userId, "read", {
        path: resolvedAbs,
        workspaceRoot: workspace.workspacePath,
      })) as BridgeReadResponse;
    } catch (err) {
      // Bridge errors (not connected, timed out, client-side read failure) are
      // surfaced as 422 — the caller (eventually an agent tool) should report
      // them to the user, not retry blindly.
      throw unprocessable(err instanceof Error ? err.message : String(err));
    }

    res.json(payload);
  });

  return router;
}
