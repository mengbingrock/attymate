import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { materializeRunnerConfig, packRunnerConfig } from "./runner-materialize.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "runner-mat-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("packRunnerConfig + materializeRunnerConfig", () => {
  it("round-trips a skill dir (nested + executable) and an instructions bundle", async () => {
    // Server-side source: a skill directory with a nested dir + an executable script.
    const skillSrc = path.join(tmp, "server", "skills", "diagnose");
    await fs.mkdir(path.join(skillSrc, "nested"), { recursive: true });
    await fs.writeFile(path.join(skillSrc, "SKILL.md"), "# Diagnose\nhello");
    await fs.writeFile(path.join(skillSrc, "nested", "data.txt"), "deep");
    const scriptPath = path.join(skillSrc, "run.sh");
    await fs.writeFile(scriptPath, "#!/bin/sh\necho hi");
    await fs.chmod(scriptPath, 0o755);

    // Server-side instructions root with an entry file.
    const instrRoot = path.join(tmp, "server", "instructions");
    await fs.mkdir(instrRoot, { recursive: true });
    await fs.writeFile(path.join(instrRoot, "AGENTS.md"), "# Agent\ndo things");
    await fs.writeFile(path.join(instrRoot, "ref.md"), "referenced");

    const serverConfig: Record<string, unknown> = {
      model: "claude-x",
      env: { ANTHROPIC_API_KEY: "secret-value" },
      paperclipRuntimeSkills: [
        { key: "diagnose", runtimeName: "diagnose", source: skillSrc, required: true },
      ],
      instructionsBundleMode: "managed",
      instructionsRootPath: instrRoot,
      instructionsEntryFile: "AGENTS.md",
      instructionsFilePath: path.join(instrRoot, "AGENTS.md"),
    };

    // Pack: contents embedded, absolute paths stripped.
    const packed = await packRunnerConfig(serverConfig);
    const packedSkill = (packed.paperclipRuntimeSkills as any[])[0];
    expect(packedSkill.source).toBeUndefined();
    expect(Array.isArray(packedSkill.files)).toBe(true);
    expect(packed.instructionsRootPath).toBeUndefined();
    expect(packed.instructionsFilePath).toBeUndefined();
    expect(Array.isArray((packed as any).instructionsBundleFiles)).toBe(true);
    // Untouched fields pass through.
    expect(packed.model).toBe("claude-x");
    expect((packed.env as any).ANTHROPIC_API_KEY).toBe("secret-value");

    // Materialize on the "runner" into a fresh dir.
    const dest = path.join(tmp, "runner-stage");
    const local = await materializeRunnerConfig(packed, dest);

    const localSkill = (local.paperclipRuntimeSkills as any[])[0];
    expect(localSkill.source).toBe(path.join(dest, "skills", "diagnose"));
    expect(localSkill.files).toBeUndefined();
    expect(localSkill.required).toBe(true);

    // Contents round-trip.
    expect(await fs.readFile(path.join(localSkill.source, "SKILL.md"), "utf8")).toBe("# Diagnose\nhello");
    expect(await fs.readFile(path.join(localSkill.source, "nested", "data.txt"), "utf8")).toBe("deep");
    // Executable bit preserved.
    const st = await fs.stat(path.join(localSkill.source, "run.sh"));
    expect(st.mode & 0o111).not.toBe(0);

    // Instructions rewritten to local + readable.
    expect(local.instructionsRootPath).toBe(path.join(dest, "instructions"));
    expect(local.instructionsFilePath).toBe(path.join(dest, "instructions", "AGENTS.md"));
    expect(await fs.readFile(local.instructionsFilePath as string, "utf8")).toBe("# Agent\ndo things");
    expect(await fs.readFile(path.join(dest, "instructions", "ref.md"), "utf8")).toBe("referenced");
  });

  it("drops a skill whose source dir is missing, leaving others intact", async () => {
    const okSrc = path.join(tmp, "ok");
    await fs.mkdir(okSrc, { recursive: true });
    await fs.writeFile(path.join(okSrc, "SKILL.md"), "ok");

    const packed = await packRunnerConfig(
      {
        paperclipRuntimeSkills: [
          { key: "missing", runtimeName: "missing", source: path.join(tmp, "does-not-exist") },
          { key: "ok", runtimeName: "ok", source: okSrc },
        ],
      },
      { log: () => {} },
    );
    const ids = (packed.paperclipRuntimeSkills as any[]).map((s) => s.key);
    expect(ids).toEqual(["ok"]);
  });

  it("is a no-op when there are no path-bearing fields", async () => {
    const cfg = { model: "x", timeoutSec: 30 };
    const packed = await packRunnerConfig(cfg);
    expect(packed).toEqual(cfg);
    const local = await materializeRunnerConfig(packed, path.join(tmp, "d"));
    expect(local).toEqual(cfg);
  });
});
