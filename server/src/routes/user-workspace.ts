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
 * AttyMate local-workspace routes.
 *
 * A user can grant AttyMate access to N local folders (migration 0086). The
 * path itself is unvalidatable from the server side (it lives on the user's
 * machine); we sanity-check the syntax here and let the AttyMate bridge
 * enforce existence + readability when it actually serves a read/write.
 *
 * Read/write routes (`/local-files/read|write`) operate on the user's
 * "default" workspace (oldest grant) for now — adding a workspaceId param to
 * those calls is the natural next step once an agent UI needs to address a
 * specific folder.
 */

const workspacePathSchema = z
  .string()
  .trim()
  .min(1, "workspacePath required")
  .max(1024, "workspacePath too long")
  .refine((value) => value.startsWith("/"), "workspacePath must be absolute (start with /)")
  .refine((value) => !value.split("/").includes(".."), "workspacePath must not contain .. segments");

const addWorkspaceSchema = z.object({
  workspacePath: workspacePathSchema,
});

const relativeWorkspacePathSchema = z
  .string()
  .trim()
  .min(1, "path required")
  .max(1024, "path too long")
  // Reject any absolute path; the agent should always express paths relative
  // to the user's workspace root. Absolute paths from agents are a smell.
  .refine((value) => !value.startsWith("/"), "path must be relative to the workspace root")
  .refine((value) => !value.split("/").includes(".."), "path must not contain .. segments");

const readLocalFileSchema = z.object({
  path: relativeWorkspacePathSchema,
});

// ~8MB cap on the base64 string ≈ ~6MB raw. The bridge re-checks decoded size
// against MAX_WRITE_BYTES (5MB) and is the authoritative limit; this just
// prevents oversized request bodies from getting through validation.
const MAX_WRITE_BASE64_CHARS = 8 * 1024 * 1024;

const writeLocalFileSchema = z.object({
  path: relativeWorkspacePathSchema,
  // Empty contents allowed — agents legitimately create empty placeholder files.
  contents: z.string().max(MAX_WRITE_BASE64_CHARS, "contents too large (base64-encoded)"),
  encoding: z.literal("base64").optional().default("base64"),
});

interface BridgeReadResponse {
  contents: string;
  encoding: string;
  size: number;
  mtime: string;
}

interface BridgeWriteResponse {
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

  // ── Workspace folder list (plural) ─────────────────────────────────────────

  router.get("/users/me/workspaces", async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    const rows = await svc.listByUser(userId);
    res.json(rows);
  });

  router.post("/users/me/workspaces", validate(addWorkspaceSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    const row = await svc.add(userId, req.body.workspacePath);
    res.status(201).json(row);
  });

  router.delete("/users/me/workspaces/:id", async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    const removed = await svc.removeById(userId, req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    res.status(204).end();
  });

  // ── Local file ops (read/write the user's default workspace) ───────────────
  //
  // The relative path is resolved against the user's default workspace (oldest
  // grant). Adding a workspaceId/folderId param to switch among multiple grants
  // is the next iteration; for now agents see one folder.

  router.post("/users/me/local-files/read", validate(readLocalFileSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;

    const workspace = await svc.getDefault(userId);
    if (!workspace) {
      throw unprocessable("No workspace granted. Add a folder under WORKSPACE in the sidebar first.");
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
      throw unprocessable(err instanceof Error ? err.message : String(err));
    }

    res.json(payload);
  });

  router.post("/users/me/local-files/write", validate(writeLocalFileSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;

    const workspace = await svc.getDefault(userId);
    if (!workspace) {
      throw unprocessable("No workspace granted. Add a folder under WORKSPACE in the sidebar first.");
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

    let payload: BridgeWriteResponse;
    try {
      payload = (await dispatchToUserBridge(userId, "write", {
        path: resolvedAbs,
        workspaceRoot: workspace.workspacePath,
        contents: req.body.contents,
        encoding: req.body.encoding,
      })) as BridgeWriteResponse;
    } catch (err) {
      throw unprocessable(err instanceof Error ? err.message : String(err));
    }

    res.json({ path: rel, ...payload });
  });

  return router;
}
