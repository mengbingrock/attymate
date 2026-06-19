import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureCodexAuthProvisioned } from "./codex-auth.js";
import type { RunnerClientConfig } from "./config.js";

function cookieConfig(overrides: Partial<RunnerClientConfig> = {}): RunnerClientConfig {
  return {
    serverUrl: "wss://paperclip.example.test",
    companyId: "company-1",
    auth: { mode: "cookie", cookie: "session=abc" },
    runnerId: "runner-1",
    workspacesRoot: "/tmp/ws",
    ...overrides,
  };
}

const SERVER_AUTH = JSON.stringify({ tokens: { access_token: "from-server" } });
const LOCAL_AUTH = JSON.stringify({ tokens: { access_token: "local-login" } });

const authPath = (home: string) => path.join(home, "auth.json");
const backupPath = (home: string) => path.join(home, "auth.json.paperclip-local-backup");

function stubFetch(status: number, body = SERVER_AUTH) {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function read(file: string): Promise<string | null> {
  return fs.readFile(file, "utf8").catch(() => null);
}

describe("ensureCodexAuthProvisioned", () => {
  let home: string;
  const logs: string[] = [];
  const log = (chunk: string) => void logs.push(chunk);

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-runner-codexauth-"));
    process.env.CODEX_HOME = home;
    logs.length = 0;
  });

  afterEach(async () => {
    delete process.env.CODEX_HOME;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await fs.rm(home, { recursive: true, force: true }).catch(() => {});
  });

  describe("useServerCodexAuth: true", () => {
    it("pulls the server auth and backs up an existing local login", async () => {
      await fs.writeFile(authPath(home), LOCAL_AUTH);
      const fetchMock = stubFetch(200);

      await ensureCodexAuthProvisioned(cookieConfig(), "codex_local", { useServerCodexAuth: true }, log);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await read(authPath(home))).toBe(SERVER_AUTH);
      expect(await read(backupPath(home))).toBe(LOCAL_AUTH);
      expect(logs.join("")).toContain("backed up");
    });

    it("pulls the server auth with no backup when there is no local login", async () => {
      const fetchMock = stubFetch(200);

      await ensureCodexAuthProvisioned(cookieConfig(), "codex_local", { useServerCodexAuth: true }, log);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await read(authPath(home))).toBe(SERVER_AUTH);
      expect(await read(backupPath(home))).toBeNull();
    });

    it("leaves local auth untouched when the server has none (404)", async () => {
      await fs.writeFile(authPath(home), LOCAL_AUTH);
      stubFetch(404, "{}");

      await ensureCodexAuthProvisioned(cookieConfig(), "codex_local", { useServerCodexAuth: true }, log);

      expect(await read(authPath(home))).toBe(LOCAL_AUTH);
      expect(await read(backupPath(home))).toBeNull();
    });
  });

  describe("useServerCodexAuth: false (default)", () => {
    it("restores the backed-up local login after a previous server switch (select back)", async () => {
      // First switch to server (backs up local)...
      await fs.writeFile(authPath(home), LOCAL_AUTH);
      stubFetch(200);
      await ensureCodexAuthProvisioned(cookieConfig(), "codex_local", { useServerCodexAuth: true }, log);
      expect(await read(authPath(home))).toBe(SERVER_AUTH);

      // ...then turn it off — local must come back, fetch must not be called.
      const fetchMock = stubFetch(200);
      await ensureCodexAuthProvisioned(cookieConfig(), "codex_local", { useServerCodexAuth: false }, log);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await read(authPath(home))).toBe(LOCAL_AUTH);
      expect(await read(backupPath(home))).toBeNull();
      expect(logs.join("")).toContain("restored your local codex auth");
    });

    it("leaves an existing local login alone and does not call the server", async () => {
      await fs.writeFile(authPath(home), LOCAL_AUTH);
      const fetchMock = stubFetch(200);

      await ensureCodexAuthProvisioned(cookieConfig(), "codex_local", { useServerCodexAuth: false }, log);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await read(authPath(home))).toBe(LOCAL_AUTH);
    });

    it("provisions from the server when a fresh machine has no login (convenience)", async () => {
      const fetchMock = stubFetch(200);

      await ensureCodexAuthProvisioned(cookieConfig(), "codex_local", {}, log);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await read(authPath(home))).toBe(SERVER_AUTH);
    });
  });

  describe("guards", () => {
    it("skips non-codex adapters", async () => {
      const fetchMock = stubFetch(200);
      await ensureCodexAuthProvisioned(cookieConfig(), "claude_local", { useServerCodexAuth: true }, log);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips token-only (headless) runners", async () => {
      const fetchMock = stubFetch(200);
      await ensureCodexAuthProvisioned(
        cookieConfig({ auth: { mode: "token", token: "t" } }),
        "codex_local",
        { useServerCodexAuth: true },
        log,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never throws when the fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
      await expect(
        ensureCodexAuthProvisioned(cookieConfig(), "codex_local", { useServerCodexAuth: true }, log),
      ).resolves.toBeUndefined();
      expect(logs.join("")).toContain("provisioning error");
    });
  });
});
