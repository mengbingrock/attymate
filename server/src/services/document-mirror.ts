// Mirrors issue documents to the user's locally-granted workspace folder.
//
// Every issue-document write (see `documentService.upsertIssueDocument`) is also
// recorded here as a pending file write and shipped to the folder the user picked
// in AttyMate (`user_workspaces.workspacePath`). That folder lives on the user's
// machine and is only reachable over the desktop bridge WebSocket, which may be
// offline at write time — so writes are queued in `document_mirror_queue` and
// flushed when the bridge (re)connects (`local-bridge-ws.ts`).
//
// The DB document is the source of truth; mirroring is best-effort and must never
// block or fail a document write.

import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyMemberships, documentMirrorQueue, documents, issueDocuments, issues } from "@paperclipai/db";
import { isSystemIssueDocumentKey } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { dispatchToUserBridge, isUserBridgeConnected } from "../realtime/local-bridge-ws.js";
import { userWorkspaceService } from "./user-workspaces.js";

// Stop retrying a row after this many failed delivery attempts (e.g. an owner who
// never runs the desktop app) so the queue doesn't grow unbounded.
const MAX_MIRROR_ATTEMPTS = 5;

// Collapse a value into a single safe path segment: only [A-Za-z0-9._-], no
// leading/trailing dots or dashes (blocks hidden files and `..`), length-capped.
// Falls back to `fallback` if nothing safe remains.
function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "")
    .slice(0, 128);
  return cleaned.length > 0 ? cleaned : fallback;
}

function extForFormat(format: string): string {
  return format === "markdown" ? "md" : "txt";
}

/**
 * Build the per-issue relative path a document mirrors to, e.g. `ENG-12/plan.md`.
 * Pure — unit-testable without a DB. `issueId` (a uuid) is the fallback folder name
 * when the issue has no identifier or it sanitizes to empty.
 */
export function buildMirrorRelativePath(input: {
  issueIdentifier: string | null;
  issueId: string;
  key: string;
  format: string;
}): string {
  const dir = sanitizeSegment(input.issueIdentifier ?? input.issueId, input.issueId);
  const file = sanitizeSegment(input.key, "document");
  return `${dir}/${file}.${extForFormat(input.format)}`;
}

export function documentMirrorService(db: Db) {
  const workspaces = userWorkspaceService(db);

  // The users whose granted folder should receive a company's issue documents:
  // the company's active human owners (typically one — the desktop operator).
  async function resolveTargetUserIds(companyId: string): Promise<string[]> {
    const rows = await db
      .select({ principalId: companyMemberships.principalId })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
          eq(companyMemberships.membershipRole, "owner"),
        ),
      );
    return [...new Set(rows.map((r) => r.principalId))];
  }

  async function readDocumentBody(issueId: string, key: string): Promise<string | null> {
    const row = await db
      .select({ body: documents.latestBody })
      .from(issueDocuments)
      .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
      .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, key)))
      .then((rows) => rows[0] ?? null);
    return row ? row.body : null;
  }

  // Record an intended mirror write and, for any target whose bridge is connected
  // right now, kick a flush. Never throws into the caller's document write.
  async function enqueueForDocument(input: {
    companyId: string;
    issueId: string;
    documentId: string;
    key: string;
    format: string;
  }): Promise<void> {
    // Scope: issue documents only — skip the auto continuation-summary (and any
    // future system-managed doc keys).
    if (isSystemIssueDocumentKey(input.key)) return;

    const targetUserIds = await resolveTargetUserIds(input.companyId);
    if (targetUserIds.length === 0) return;

    const issue = await db
      .select({ identifier: issues.identifier })
      .from(issues)
      .where(eq(issues.id, input.issueId))
      .then((rows) => rows[0] ?? null);

    const relativePath = buildMirrorRelativePath({
      issueIdentifier: issue?.identifier ?? null,
      issueId: input.issueId,
      key: input.key,
      format: input.format,
    });

    const now = new Date();
    for (const targetUserId of targetUserIds) {
      // Coalesce re-edits onto one row per (targetUserId, issueId, key) and reset
      // it to pending so the flusher re-reads and ships the latest body.
      await db
        .insert(documentMirrorQueue)
        .values({
          companyId: input.companyId,
          issueId: input.issueId,
          documentId: input.documentId,
          key: input.key,
          targetUserId,
          relativePath,
          status: "pending",
        })
        .onConflictDoUpdate({
          target: [documentMirrorQueue.targetUserId, documentMirrorQueue.issueId, documentMirrorQueue.key],
          set: {
            documentId: input.documentId,
            relativePath,
            status: "pending",
            attempts: 0,
            lastError: null,
            updatedAt: now,
          },
        });
    }

    for (const targetUserId of targetUserIds) {
      if (isUserBridgeConnected(targetUserId)) {
        void flushForUser(targetUserId).catch((err) =>
          logger.warn({ err, targetUserId }, "document mirror: immediate flush failed"),
        );
      }
    }
  }

  // Deliver all pending rows for a user to their default workspace folder over the
  // bridge. Called on bridge (re)connect and best-effort right after enqueue.
  async function flushForUser(userId: string): Promise<void> {
    if (!isUserBridgeConnected(userId)) return;

    const rows = await db
      .select()
      .from(documentMirrorQueue)
      .where(and(eq(documentMirrorQueue.targetUserId, userId), eq(documentMirrorQueue.status, "pending")));

    // Workspaces are company-scoped, so each queue row mirrors into its own
    // company's default workspace. Cache per company across the batch.
    const workspaceByCompany = new Map<string, Awaited<ReturnType<typeof workspaces.getDefault>>>();
    async function workspaceForCompany(companyId: string) {
      if (!workspaceByCompany.has(companyId)) {
        workspaceByCompany.set(companyId, await workspaces.getDefault(companyId));
      }
      return workspaceByCompany.get(companyId) ?? null;
    }

    for (const row of rows) {
      try {
        const workspace = await workspaceForCompany(row.companyId);
        if (!workspace) continue; // company has no workspace yet — leave pending

        const body = await readDocumentBody(row.issueId, row.key);
        if (body === null) {
          // Source document was deleted — drop the queue row.
          await db.delete(documentMirrorQueue).where(eq(documentMirrorQueue.id, row.id));
          continue;
        }

        const resolvedAbs = path.resolve(workspace.workspacePath, row.relativePath);
        const rel = path.relative(workspace.workspacePath, resolvedAbs);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          // Defense-in-depth: paths are sanitized at enqueue, so this is unexpected.
          // Mark failed (don't retry) rather than risk an escaping write.
          await db
            .update(documentMirrorQueue)
            .set({ status: "failed", lastError: "relative path escapes workspace", updatedAt: new Date() })
            .where(eq(documentMirrorQueue.id, row.id));
          continue;
        }

        await dispatchToUserBridge(userId, "write", {
          path: resolvedAbs,
          workspaceRoot: workspace.workspacePath,
          contents: Buffer.from(body, "utf-8").toString("base64"),
          encoding: "base64",
          createParents: true,
        });

        await db.delete(documentMirrorQueue).where(eq(documentMirrorQueue.id, row.id));
      } catch (err) {
        const attempts = row.attempts + 1;
        const failed = attempts >= MAX_MIRROR_ATTEMPTS;
        await db
          .update(documentMirrorQueue)
          .set({
            attempts,
            status: failed ? "failed" : "pending",
            lastError: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(documentMirrorQueue.id, row.id));
        logger.warn(
          { err, userId, issueId: row.issueId, key: row.key, attempts, failed },
          "document mirror: bridge write failed",
        );
      }
    }
  }

  return { resolveTargetUserIds, enqueueForDocument, flushForUser };
}
