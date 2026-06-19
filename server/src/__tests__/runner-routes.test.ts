import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadSharedCodexAuthRaw = vi.hoisted(() => vi.fn());
const mockUserIsCompanyMember = vi.hoisted(() => vi.fn());

vi.mock("@paperclipai/adapter-codex-local/server", () => ({
  readSharedCodexAuthRaw: mockReadSharedCodexAuthRaw,
}));

vi.mock("../realtime/runner-ws.js", () => ({
  userIsCompanyMember: mockUserIsCompanyMember,
}));

async function createApp(
  actor: Record<string, unknown> = {
    type: "board",
    userId: "user-1",
    companyIds: ["company-1"],
    source: "session",
    isInstanceAdmin: false,
  },
) {
  vi.resetModules();
  const [{ errorHandler }, { runnerRoutes }] = await Promise.all([
    import("../middleware/index.js") as Promise<typeof import("../middleware/index.js")>,
    import("../routes/runner.js") as Promise<typeof import("../routes/runner.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", runnerRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("GET /api/runner/codex-auth", () => {
  beforeEach(() => {
    mockReadSharedCodexAuthRaw.mockReset();
    mockUserIsCompanyMember.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the codex auth.json verbatim for a company member", async () => {
    mockUserIsCompanyMember.mockResolvedValue(true);
    const raw = JSON.stringify({ tokens: { access_token: "server-acc" } });
    mockReadSharedCodexAuthRaw.mockResolvedValue(raw);

    const app = await createApp();
    const res = await request(app).get("/api/runner/codex-auth?companyId=company-1");

    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mockUserIsCompanyMember).toHaveBeenCalledWith({}, "user-1", "company-1");
  });

  it("returns 404 when the control plane has no codex auth", async () => {
    mockUserIsCompanyMember.mockResolvedValue(true);
    mockReadSharedCodexAuthRaw.mockResolvedValue(null);

    const app = await createApp();
    const res = await request(app).get("/api/runner/codex-auth?companyId=company-1");

    expect(res.status).toBe(404);
  });

  it("returns 403 when the user is not a member of the company", async () => {
    mockUserIsCompanyMember.mockResolvedValue(false);

    const app = await createApp();
    const res = await request(app).get("/api/runner/codex-auth?companyId=other-co");

    expect(res.status).toBe(403);
    expect(mockReadSharedCodexAuthRaw).not.toHaveBeenCalled();
  });

  it("returns 400 when companyId is missing", async () => {
    const app = await createApp();
    const res = await request(app).get("/api/runner/codex-auth");
    expect(res.status).toBe(400);
    expect(mockUserIsCompanyMember).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-board actor", async () => {
    const app = await createApp({ type: "none" });
    const res = await request(app).get("/api/runner/codex-auth?companyId=company-1");
    expect(res.status).toBe(403);
  });
});
