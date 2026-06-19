import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { readSharedCodexAuthRaw } from "@paperclipai/adapter-codex-local/server";
import { assertBoard } from "./authz.js";
import { userIsCompanyMember } from "../realtime/runner-ws.js";

/**
 * HTTP routes the local execution runner-client calls over the control plane
 * (alongside the WS run channel). These are paired-runner endpoints: the desktop
 * runner authenticates with the user's session cookie, so they go through the
 * normal board-user middleware and additionally require company membership.
 */
export function runnerRoutes(db: Db) {
  const router = Router();

  function readCompanyId(req: Request): string {
    const raw = req.query.companyId;
    return typeof raw === "string" ? raw.trim() : "";
  }

  // GET /runner/codex-auth?companyId=...
  //
  // Returns the control plane's codex `auth.json` verbatim so a paired runner
  // can run codex as the same account as the server. The client only calls this
  // when it has no local codex auth, and writes it with mode 0600.
  //
  // Sensitive: this distributes OpenAI credentials to the user's machine. It is
  // gated to a member of the company the runner serves (same trust boundary as
  // the runner WS cookie pairing) and is never logged. 404 when the server has
  // no codex auth to share.
  router.get("/runner/codex-auth", async (req, res) => {
    assertBoard(req);
    const userId = req.actor.userId;
    if (!userId) {
      res.status(403).json({ error: "Board user context required" });
      return;
    }
    const companyId = readCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId is required" });
      return;
    }
    if (!(await userIsCompanyMember(db, userId, companyId))) {
      res.status(403).json({ error: "Not a member of this company" });
      return;
    }

    const raw = await readSharedCodexAuthRaw(process.env);
    if (!raw) {
      res.status(404).json({ error: "No codex auth available on the control plane" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.type("application/json").send(raw);
  });

  return router;
}
