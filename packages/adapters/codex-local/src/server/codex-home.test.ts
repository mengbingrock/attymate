import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  prepareManagedCodexHome,
  readSharedCodexAuthRaw,
  writeSharedCodexAuthRaw,
  writeServerCodexAuth,
  restoreLocalCodexAuth,
} from "./codex-home.js";

async function tmpHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codexhome-"));
}

describe("shared codex auth raw read/write", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("round-trips raw auth.json verbatim (preserving an OAuth token block)", async () => {
    const home = await tmpHome();
    dirs.push(home);
    const env = { CODEX_HOME: home } as NodeJS.ProcessEnv;
    const raw = JSON.stringify({
      tokens: { id_token: "id", access_token: "acc", refresh_token: "ref", account_id: "acct" },
      last_refresh: "2026-01-01T00:00:00Z",
    });

    const written = await writeSharedCodexAuthRaw(raw, env);
    expect(written).toBe(path.join(home, "auth.json"));
    expect(await readSharedCodexAuthRaw(env)).toBe(raw);
  });

  it("writes auth.json with 0600 permissions", async () => {
    const home = await tmpHome();
    dirs.push(home);
    const env = { CODEX_HOME: home } as NodeJS.ProcessEnv;
    await writeSharedCodexAuthRaw(JSON.stringify({ OPENAI_API_KEY: "sk-test" }), env);
    const mode = (await fs.stat(path.join(home, "auth.json"))).mode & 0o777;
    if (process.platform === "win32") {
      expect(mode).not.toBe(0);
    } else {
      expect(mode).toBe(0o600);
    }
  });

  it("returns null when no auth.json exists", async () => {
    const home = await tmpHome();
    dirs.push(home);
    expect(await readSharedCodexAuthRaw({ CODEX_HOME: home } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("returns null for malformed auth.json", async () => {
    const home = await tmpHome();
    dirs.push(home);
    await fs.writeFile(path.join(home, "auth.json"), "not json{");
    expect(await readSharedCodexAuthRaw({ CODEX_HOME: home } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("refuses to write non-JSON (never poisons auth.json)", async () => {
    const home = await tmpHome();
    dirs.push(home);
    await expect(
      writeSharedCodexAuthRaw("not json{", { CODEX_HOME: home } as NodeJS.ProcessEnv),
    ).rejects.toThrow();
    expect(await readSharedCodexAuthRaw({ CODEX_HOME: home } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("writeServerCodexAuth / restoreLocalCodexAuth", () => {
  const local = JSON.stringify({ tokens: { access_token: "local" } });
  const server = JSON.stringify({ tokens: { access_token: "server" } });
  const dirs: string[] = [];
  let env: NodeJS.ProcessEnv;
  let home: string;
  const auth = () => path.join(home, "auth.json");
  const backup = () => path.join(home, "auth.json.paperclip-local-backup");
  const read = (f: string) => fs.readFile(f, "utf8").catch(() => null);

  afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  async function fresh() {
    home = await tmpHome();
    dirs.push(home);
    env = { CODEX_HOME: home } as NodeJS.ProcessEnv;
  }

  it("backs up a genuine local login exactly once, then refreshes without re-backing-up", async () => {
    await fresh();
    await fs.writeFile(auth(), local);

    const first = await writeServerCodexAuth(server, env);
    expect(first.backedUp).toBe(true);
    expect(await read(auth())).toBe(server);
    expect(await read(backup())).toBe(local);

    // A second server write (refresh) must not overwrite the saved local backup.
    const server2 = JSON.stringify({ tokens: { access_token: "server2" } });
    const second = await writeServerCodexAuth(server2, env);
    expect(second.backedUp).toBe(false);
    expect(await read(auth())).toBe(server2);
    expect(await read(backup())).toBe(local);
  });

  it("does not create a backup when there is no local login", async () => {
    await fresh();
    const res = await writeServerCodexAuth(server, env);
    expect(res.backedUp).toBe(false);
    expect(await read(auth())).toBe(server);
    expect(await read(backup())).toBeNull();
  });

  it("restores the backed-up local login and clears server state", async () => {
    await fresh();
    await fs.writeFile(auth(), local);
    await writeServerCodexAuth(server, env);

    const res = await restoreLocalCodexAuth(env);
    expect(res.restored).toBe(true);
    expect(await read(auth())).toBe(local);
    expect(await read(backup())).toBeNull();
    expect(await read(path.join(home, "auth.json.paperclip-source"))).toBeNull();
  });

  it("reports nothing to restore when no backup exists", async () => {
    await fresh();
    await fs.writeFile(auth(), server);
    const res = await restoreLocalCodexAuth(env);
    expect(res.restored).toBe(false);
    expect(await read(auth())).toBe(server);
  });
});

describe("prepareManagedCodexHome auth seeding", () => {
  const dirs: string[] = [];
  const companyId = "company-1";
  const onLog = async () => {};

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function freshEnv() {
    const sharedHome = await tmpHome();
    const paperclipHome = await tmpHome();
    dirs.push(sharedHome, paperclipHome);
    const env = {
      CODEX_HOME: sharedHome,
      PAPERCLIP_HOME: paperclipHome,
      PAPERCLIP_INSTANCE_ID: "default",
    } as NodeJS.ProcessEnv;
    return { env, sharedHome, paperclipHome };
  }

  it("falls back to copying auth.json when symlink privilege is unavailable", async () => {
    const { env, sharedHome } = await freshEnv();
    const raw = JSON.stringify({ tokens: { access_token: "shared" } });
    await fs.writeFile(path.join(sharedHome, "auth.json"), raw);
    vi.spyOn(fs, "symlink").mockRejectedValueOnce(
      Object.assign(new Error("A required privilege is not held by the client"), { code: "EPERM" }),
    );

    const managedHome = await prepareManagedCodexHome(env, onLog, companyId);
    const target = path.join(managedHome, "auth.json");

    expect(await fs.readFile(target, "utf8")).toBe(raw);
    const targetStat = await fs.lstat(target);
    expect(targetStat.isFile()).toBe(true);
    expect(targetStat.isSymbolicLink()).toBe(false);
  });

  it("refreshes a copied auth.json fallback when shared auth changes", async () => {
    const { env, sharedHome } = await freshEnv();
    const managedHome = await prepareManagedCodexHome(env, onLog, companyId);
    const target = path.join(managedHome, "auth.json");
    await fs.mkdir(managedHome, { recursive: true });
    await fs.writeFile(target, JSON.stringify({ OPENAI_API_KEY: "stale" }));
    const raw = JSON.stringify({ tokens: { access_token: "fresh" } });
    await fs.writeFile(path.join(sharedHome, "auth.json"), raw);

    await prepareManagedCodexHome(env, onLog, companyId);

    expect(await fs.readFile(target, "utf8")).toBe(raw);
  });

  it("does not hide non-permission symlink failures", async () => {
    const { env, sharedHome } = await freshEnv();
    await fs.writeFile(path.join(sharedHome, "auth.json"), JSON.stringify({ tokens: { access_token: "shared" } }));
    vi.spyOn(fs, "symlink").mockRejectedValueOnce(
      Object.assign(new Error("disk is unavailable"), { code: "EIO" }),
    );

    await expect(prepareManagedCodexHome(env, onLog, companyId)).rejects.toThrow("disk is unavailable");
  });

  it("keeps configured API-key auth ahead of shared auth seeding", async () => {
    const { env, sharedHome } = await freshEnv();
    await fs.writeFile(path.join(sharedHome, "auth.json"), JSON.stringify({ tokens: { access_token: "shared" } }));
    vi.spyOn(fs, "symlink").mockRejectedValueOnce(
      Object.assign(new Error("operation not permitted"), { code: "EPERM" }),
    );

    const managedHome = await prepareManagedCodexHome(env, onLog, companyId, {
      apiKey: "sk-managed",
    });

    expect(await fs.readFile(path.join(managedHome, "auth.json"), "utf8")).toBe(
      JSON.stringify({ OPENAI_API_KEY: "sk-managed" }),
    );
  });
});
