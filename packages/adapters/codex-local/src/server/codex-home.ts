import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { resolvePaperclipInstanceRootForAdapter } from "@paperclipai/adapter-utils/server-utils";

const TRUTHY_ENV_RE = /^(1|true|yes|on)$/i;
const COPIED_SHARED_FILES = ["config.json", "instructions.md"] as const;
const SYMLINKED_SHARED_FILES = ["auth.json"] as const;
const SAFE_SHARED_CONFIG_KEYS = [
  "model",
  "model_provider",
  "model_reasoning_effort",
  "model_reasoning_summary",
  "reasoning_effort",
] as const;

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

export function resolveSharedCodexHomeDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = nonEmpty(env.CODEX_HOME);
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ".codex");
}

function isWorktreeMode(env: NodeJS.ProcessEnv): boolean {
  return TRUTHY_ENV_RE.test(env.PAPERCLIP_IN_WORKTREE ?? "");
}

export function resolveManagedCodexHomeDir(
  env: NodeJS.ProcessEnv,
  companyId?: string,
): string {
  const instanceRoot = resolvePaperclipInstanceRootForAdapter({
    homeDir: nonEmpty(env.PAPERCLIP_HOME) ?? undefined,
    instanceId: nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? undefined,
    env,
  });
  return companyId
    ? path.resolve(instanceRoot, "companies", companyId, "codex-home")
    : path.resolve(instanceRoot, "codex-home");
}

async function ensureParentDir(target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
}

function isSymlinkPermissionError(err: unknown): boolean {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as NodeJS.ErrnoException).code ?? "")
      : "";
  if (code === "EPERM" || code === "EACCES") return true;

  const message = err instanceof Error ? err.message : String(err);
  return /administrator privilege|required privilege|operation not permitted|access is denied/i.test(message);
}

async function copySharedFile(target: string, source: string): Promise<void> {
  await ensureParentDir(target);
  await fs.copyFile(source, target);
  await fs.chmod(target, 0o600).catch(() => {});
}

async function createSymlinkOrCopyFile(target: string, source: string): Promise<void> {
  await ensureParentDir(target);
  try {
    await fs.symlink(source, target);
  } catch (err) {
    if (!isSymlinkPermissionError(err)) throw err;
    await copySharedFile(target, source);
  }
}

async function ensureSymlinkOrCopyFile(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (!existing) {
    await createSymlinkOrCopyFile(target, source);
    return;
  }

  if (!existing.isSymbolicLink()) {
    if (!existing.isFile()) {
      throw new Error(`Managed Codex home entry exists and is not a file or symlink: ${target}`);
    }
    await copySharedFile(target, source);
    return;
  }

  const linkedPath = await fs.readlink(target).catch(() => null);
  if (!linkedPath) return;

  const resolvedLinkedPath = path.resolve(path.dirname(target), linkedPath);
  if (resolvedLinkedPath === source) return;

  await fs.unlink(target);
  await createSymlinkOrCopyFile(target, source);
}

async function ensureCopiedFile(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (existing) return;
  await ensureParentDir(target);
  await fs.copyFile(source, target);
}

function extractSafeSharedConfigDefaults(configToml: string): string[] {
  const safeKeys = new Set<string>(SAFE_SHARED_CONFIG_KEYS);
  const defaults: string[] = [];
  let inTopLevel = true;

  for (const line of configToml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;

    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    if (!safeKeys.has(key)) continue;
    defaults.push(`${key} = ${value.trim()}`);
  }

  return defaults;
}

async function writeManagedCodexConfig(targetHome: string, sourceHome: string): Promise<void> {
  const sourceConfig = await fs.readFile(path.join(sourceHome, "config.toml"), "utf8").catch(() => "");
  const safeDefaults = extractSafeSharedConfigDefaults(sourceConfig);
  const managedConfig = [
    "# Paperclip-managed Codex config for headless runner execution.",
    "# Desktop integration settings are intentionally not copied here.",
    ...safeDefaults,
    "",
    "[windows]",
    'sandbox = "unelevated"',
    "",
  ].join("\n");

  await fs.writeFile(path.join(targetHome, "config.toml"), managedConfig, "utf8");
}

/**
 * Writes an `auth.json` containing only `OPENAI_API_KEY` so the codex CLI can
 * authenticate via API key. Overwrites any existing file or symlink at that
 * path. Required because the codex CLI (>= 0.122) ignores the `OPENAI_API_KEY`
 * environment variable and only reads credentials from `$CODEX_HOME/auth.json`.
 */
export async function writeApiKeyAuthJson(home: string, apiKey: string): Promise<void> {
  await fs.mkdir(home, { recursive: true });
  const target = path.join(home, "auth.json");
  await fs.rm(target, { force: true });
  await fs.writeFile(target, JSON.stringify({ OPENAI_API_KEY: apiKey }), { mode: 0o600 });
}

/**
 * Read the raw `auth.json` text from the shared Codex home (CODEX_HOME or
 * ~/.codex), validating that it parses as JSON. Returns null when the file is
 * absent or unreadable/invalid. Used to distribute the server's codex login to
 * a paired runner-client so the client's codex runs as the same account.
 *
 * Returns the bytes verbatim so a ChatGPT-OAuth login (`tokens` block) survives
 * the round-trip, not just API-key (`OPENAI_API_KEY`) credentials.
 */
export async function readSharedCodexAuthRaw(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const file = path.join(resolveSharedCodexHomeDir(env), "auth.json");
  try {
    const text = await fs.readFile(file, "utf8");
    JSON.parse(text);
    return text;
  } catch {
    return null;
  }
}

/**
 * Write raw `auth.json` text into the shared Codex home (CODEX_HOME or ~/.codex)
 * with mode 0600. The text must be valid JSON (codex reads it as JSON). The
 * paired runner-client uses this to install the auth fetched from the control
 * plane so the local codex CLI authenticates as the server's account.
 */
export async function writeSharedCodexAuthRaw(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  JSON.parse(raw); // fail fast on non-JSON rather than poisoning auth.json
  const home = resolveSharedCodexHomeDir(env);
  await fs.mkdir(home, { recursive: true });
  const target = path.join(home, "auth.json");
  await fs.rm(target, { force: true });
  await fs.writeFile(target, raw, { mode: 0o600 });
  return target;
}

// Sidecar files the runner uses to track auth provenance in the shared codex
// home. Codex itself only reads `auth.json`, so these are inert to the CLI.
const LOCAL_BACKUP_SUFFIX = ".paperclip-local-backup";
const SERVER_MARKER_SUFFIX = ".paperclip-source";

function sharedCodexAuthPaths(env: NodeJS.ProcessEnv) {
  const home = resolveSharedCodexHomeDir(env);
  const auth = path.join(home, "auth.json");
  return {
    home,
    auth,
    backup: `${auth}${LOCAL_BACKUP_SUFFIX}`,
    marker: `${auth}${SERVER_MARKER_SUFFIX}`,
  };
}

/**
 * Install the control-plane's codex auth into the shared codex home so the
 * local CLI runs as the server's account.
 *
 * Before overwriting, the user's *own* local auth.json is preserved once into a
 * backup sidecar so {@link restoreLocalCodexAuth} can put it back. We only back
 * up a genuine local login: if the current auth.json is already one we wrote
 * from the server (marker present) or a backup already exists, we don't clobber
 * the saved local. A marker is written so we can tell server-provisioned auth
 * apart from the user's own later.
 *
 * Returns whether a local auth was backed up on this call.
 */
export async function writeServerCodexAuth(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ backedUp: boolean }> {
  JSON.parse(raw); // fail fast rather than poisoning auth.json
  const { home, auth, backup, marker } = sharedCodexAuthPaths(env);
  await fs.mkdir(home, { recursive: true });

  let backedUp = false;
  const backupExists = await pathExists(backup);
  const markerExists = await pathExists(marker);
  const authExists = await pathExists(auth);
  if (!backupExists && authExists && !markerExists) {
    // Genuine user-local login — preserve it once so the user can switch back.
    await fs.copyFile(auth, backup);
    backedUp = true;
  }

  await fs.rm(auth, { force: true });
  await fs.writeFile(auth, raw, { mode: 0o600 });
  await fs.writeFile(marker, "server", { mode: 0o600 });
  return { backedUp };
}

/**
 * Restore the user's backed-up local codex auth (undoing a previous
 * {@link writeServerCodexAuth}). Moves the backup back over auth.json and clears
 * the server marker. Returns whether a backup existed and was restored — false
 * means there was no saved local login (e.g. the machine never had one).
 */
export async function restoreLocalCodexAuth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ restored: boolean }> {
  const { auth, backup, marker } = sharedCodexAuthPaths(env);
  if (!(await pathExists(backup))) {
    return { restored: false };
  }
  await fs.rm(auth, { force: true });
  await fs.rename(backup, auth);
  await fs.rm(marker, { force: true });
  return { restored: true };
}

export async function prepareManagedCodexHome(
  env: NodeJS.ProcessEnv,
  onLog: AdapterExecutionContext["onLog"],
  companyId?: string,
  options: { apiKey?: string | null } = {},
): Promise<string> {
  const targetHome = resolveManagedCodexHomeDir(env, companyId);
  const apiKey = nonEmpty(options.apiKey ?? undefined);

  const sourceHome = resolveSharedCodexHomeDir(env);
  const seedFromShared = path.resolve(sourceHome) !== path.resolve(targetHome);

  await fs.mkdir(targetHome, { recursive: true });

  // If a previous run wrote an apikey-mode auth.json and shared auth no longer
  // exists, remove the stale managed file. When shared auth exists, the seeding
  // step below refreshes any copied fallback file in place.
  if (!apiKey && seedFromShared) {
    const sourceAuthPath = path.join(sourceHome, "auth.json");
    const authPath = path.join(targetHome, "auth.json");
    const existing = await fs.lstat(authPath).catch(() => null);
    if (existing && !existing.isSymbolicLink() && !(await pathExists(sourceAuthPath))) {
      await fs.rm(authPath, { force: true });
    }
  }

  if (seedFromShared) {
    for (const name of SYMLINKED_SHARED_FILES) {
      const source = path.join(sourceHome, name);
      if (!(await pathExists(source))) continue;
      await ensureSymlinkOrCopyFile(path.join(targetHome, name), source);
    }

    for (const name of COPIED_SHARED_FILES) {
      const source = path.join(sourceHome, name);
      if (!(await pathExists(source))) continue;
      await ensureCopiedFile(path.join(targetHome, name), source);
    }

    await writeManagedCodexConfig(targetHome, sourceHome);

    await onLog(
      "stdout",
      `[paperclip] Using ${isWorktreeMode(env) ? "worktree-isolated" : "Paperclip-managed"} Codex home "${targetHome}" (seeded from "${sourceHome}").\n`,
    );
  }

  if (apiKey) {
    await writeApiKeyAuthJson(targetHome, apiKey);
    await onLog(
      "stdout",
      `[paperclip] Wrote API-key auth.json into Codex home "${targetHome}" from configured OPENAI_API_KEY.\n`,
    );
  }

  return targetHome;
}
