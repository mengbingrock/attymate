// Runner spec portability — make a control-plane-resolved run config safe to
// execute on a REMOTE runner machine.
//
// The control plane resolves skill directories and instruction files into
// CONTAINER-ABSOLUTE paths (e.g. /app/skills/<name>,
// /paperclip/instances/.../AGENTS.md) and puts them in the adapter config. Those
// paths don't exist on a user's machine, so a runner_gateway run that ships the
// config verbatim fails with ENOENT when the local adapter tries to read them.
//
// `packRunnerConfig` (server side) replaces those path-bearing fields with the
// embedded file CONTENTS. `materializeRunnerConfig` (runner side) writes the
// contents into a local staging dir and rewrites the paths to point there, so
// the unchanged adapter code reads real local files.
//
// Path-bearing config fields handled:
//   - paperclipRuntimeSkills[].source   (a skill directory tree)
//   - instructionsRootPath + instructionsFilePath (+ instructionsEntryFile)
// Everything else (model, env secret VALUES, promptTemplate text, …) passes
// through untouched. config.cwd is set by the runner itself, so it's ignored.

import { promises as fs } from "node:fs";
import path from "node:path";

const SKILLS_KEY = "paperclipRuntimeSkills";
const SKILL_FILES_KEY = "files";
const INSTR_ROOT_KEY = "instructionsRootPath";
const INSTR_FILE_KEY = "instructionsFilePath";
const INSTR_ENTRY_KEY = "instructionsEntryFile";
const INSTR_FILES_KEY = "instructionsBundleFiles";

/** Per-file size cap — a pathological skill shouldn't balloon a WS frame. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface EmbeddedFile {
  /** POSIX-style path relative to the bundle root. */
  path: string;
  /** Permission bits (lower 9), preserved so executable skill scripts stay executable. */
  mode: number;
  /** File contents, base64-encoded. */
  contentBase64: string;
}

type Logger = (message: string) => void;

const defaultLog: Logger = (m) => {
  // eslint-disable-next-line no-console
  console.warn(`[runner-materialize] ${m}`);
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Recursively read a directory into embedded files (skips symlinks + oversized files). */
async function walkDir(root: string, log: Logger): Promise<EmbeddedFile[]> {
  const out: EmbeddedFile[] = [];
  async function visit(abs: string, rel: string): Promise<void> {
    const stat = await fs.lstat(abs);
    if (stat.isSymbolicLink()) return; // don't follow symlinks across the boundary
    if (stat.isDirectory()) {
      const entries = await fs.readdir(abs, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        await visit(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
      }
      return;
    }
    if (stat.isFile()) {
      if (stat.size > MAX_FILE_BYTES) {
        log(`skipping oversized file ${rel} (${stat.size} bytes)`);
        return;
      }
      const buf = await fs.readFile(abs);
      out.push({ path: rel, mode: stat.mode & 0o777, contentBase64: buf.toString("base64") });
    }
    // ignore sockets/fifos/etc.
  }
  await visit(root, "");
  return out;
}

/** Write embedded files under destDir (recreated fresh), restoring mode bits. */
async function writeEmbeddedFiles(files: EmbeddedFile[], destDir: string): Promise<void> {
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });
  for (const f of files) {
    if (!isRecord(f) || typeof f.path !== "string" || typeof f.contentBase64 !== "string") continue;
    // Defend against path traversal — keep only safe relative segments.
    const rel = f.path
      .split("/")
      .filter((s) => s && s !== "." && s !== "..")
      .join(path.sep);
    if (!rel) continue;
    const abs = path.join(destDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(f.contentBase64, "base64"));
    const mode = typeof f.mode === "number" ? f.mode & 0o777 : 0o644;
    await fs.chmod(abs, mode).catch(() => {});
  }
}

/**
 * Server side: embed skill-directory + instruction-file CONTENTS into the config
 * and strip the container-absolute paths. Skills whose source dir can't be read
 * are dropped (with a log) rather than shipped as a dead path.
 */
export async function packRunnerConfig(
  config: Record<string, unknown>,
  opts: { log?: Logger } = {},
): Promise<Record<string, unknown>> {
  const log = opts.log ?? defaultLog;
  const next: Record<string, unknown> = { ...config };

  // Skills.
  const skills = config[SKILLS_KEY];
  if (Array.isArray(skills)) {
    const packed: unknown[] = [];
    for (const raw of skills) {
      if (!isRecord(raw)) {
        packed.push(raw);
        continue;
      }
      const source = typeof raw.source === "string" ? raw.source : null;
      if (!source) {
        packed.push(raw);
        continue;
      }
      try {
        const files = await walkDir(source, log);
        const { source: _omit, ...rest } = raw;
        packed.push({ ...rest, [SKILL_FILES_KEY]: files });
      } catch (err) {
        const id = String(raw.key ?? raw.runtimeName ?? "?");
        log(`skipping skill "${id}": ${err instanceof Error ? err.message : String(err)}`);
        // Omit the skill entirely so the runner never sees an unreadable path.
      }
    }
    next[SKILLS_KEY] = packed;
  }

  // Instructions — prefer the whole root dir (preserves relative references);
  // fall back to a lone absolute instructionsFilePath (legacy bundles).
  const instrRoot = typeof config[INSTR_ROOT_KEY] === "string" ? (config[INSTR_ROOT_KEY] as string) : null;
  const instrFile = typeof config[INSTR_FILE_KEY] === "string" ? (config[INSTR_FILE_KEY] as string) : null;
  if (instrRoot) {
    try {
      next[INSTR_FILES_KEY] = await walkDir(instrRoot, log);
      if (typeof next[INSTR_ENTRY_KEY] !== "string" && instrFile) {
        next[INSTR_ENTRY_KEY] = path.basename(instrFile);
      }
    } catch (err) {
      log(`skipping instructions bundle: ${err instanceof Error ? err.message : String(err)}`);
    }
    delete next[INSTR_ROOT_KEY];
    delete next[INSTR_FILE_KEY];
  } else if (instrFile && path.isAbsolute(instrFile)) {
    try {
      const stat = await fs.lstat(instrFile);
      if (stat.isFile() && stat.size <= MAX_FILE_BYTES) {
        const base = path.basename(instrFile);
        const buf = await fs.readFile(instrFile);
        next[INSTR_FILES_KEY] = [
          { path: base, mode: stat.mode & 0o777, contentBase64: buf.toString("base64") },
        ];
        next[INSTR_ENTRY_KEY] = base;
        delete next[INSTR_FILE_KEY];
      }
    } catch (err) {
      log(`skipping instructions file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return next;
}

/**
 * Runner side: write embedded contents under `destRoot` and rewrite the config
 * paths to the local copies. Inverse of {@link packRunnerConfig}.
 */
export async function materializeRunnerConfig(
  config: Record<string, unknown>,
  destRoot: string,
): Promise<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...config };

  // Skills.
  const skills = config[SKILLS_KEY];
  if (Array.isArray(skills)) {
    const out: unknown[] = [];
    for (const raw of skills) {
      if (!isRecord(raw)) {
        out.push(raw);
        continue;
      }
      const files = raw[SKILL_FILES_KEY];
      if (Array.isArray(files)) {
        const runtimeName =
          (typeof raw.runtimeName === "string" && raw.runtimeName) ||
          (typeof raw.key === "string" && raw.key) ||
          "skill";
        const skillDir = path.join(destRoot, "skills", runtimeName);
        await writeEmbeddedFiles(files as EmbeddedFile[], skillDir);
        const { [SKILL_FILES_KEY]: _omit, ...rest } = raw;
        out.push({ ...rest, source: skillDir });
      } else {
        out.push(raw);
      }
    }
    next[SKILLS_KEY] = out;
  }

  // Instructions.
  const instrFiles = config[INSTR_FILES_KEY];
  if (Array.isArray(instrFiles)) {
    const instrDir = path.join(destRoot, "instructions");
    await writeEmbeddedFiles(instrFiles as EmbeddedFile[], instrDir);
    const entry =
      typeof config[INSTR_ENTRY_KEY] === "string" ? (config[INSTR_ENTRY_KEY] as string) : "AGENTS.md";
    next[INSTR_ROOT_KEY] = instrDir;
    next[INSTR_FILE_KEY] = path.join(instrDir, entry);
    delete next[INSTR_FILES_KEY];
  }

  return next;
}
