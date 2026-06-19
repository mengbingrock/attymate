import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexDesktopAppInstalled, parseNodeReplCommand } from "./codex-desktop-app.js";

describe("parseNodeReplCommand", () => {
  it("returns null when there's no node_repl command", () => {
    expect(parseNodeReplCommand("[mcp_servers.other]\ncommand = \"/x\"\n")).toBeNull();
  });

  it("parses a POSIX path", () => {
    const cfg = '[mcp_servers.node_repl]\ncommand = "/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl"\n';
    expect(parseNodeReplCommand(cfg)).toBe(
      "/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl",
    );
  });

  it("parses a Windows path with escaped backslashes (TOML basic string)", () => {
    const cfg = '[mcp_servers.node_repl]\ncommand = "C:\\\\Users\\\\me\\\\AppData\\\\Codex\\\\node_repl.exe"\nenabled = true\n';
    expect(parseNodeReplCommand(cfg)).toBe("C:\\Users\\me\\AppData\\Codex\\node_repl.exe");
  });

  it("parses a Windows path with forward slashes", () => {
    const cfg = '[mcp_servers.node_repl]\ncommand = "C:/Users/me/AppData/Codex/node_repl.exe"\n';
    expect(parseNodeReplCommand(cfg)).toBe("C:/Users/me/AppData/Codex/node_repl.exe");
  });

  it("parses a Windows path from a TOML literal string (no escaping)", () => {
    const cfg = "[mcp_servers.node_repl]\ncommand = 'C:\\Users\\me\\AppData\\Codex\\node_repl.exe'\n";
    expect(parseNodeReplCommand(cfg)).toBe("C:\\Users\\me\\AppData\\Codex\\node_repl.exe");
  });
});

describe("codexDesktopAppInstalled", () => {
  const dirs: string[] = [];
  const origPlatform = process.platform;

  function tmpHome(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codexhome-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    // Run the config-detection branch deterministically regardless of whether
    // the test host happens to have Codex.app installed (the macOS fast path).
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    for (const dir of dirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });

  it("returns false when there is no codex config", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    expect(codexDesktopAppInstalled(tmpHome())).toBe(false);
  });

  it("returns false when the node_repl command path no longer exists (stale entry)", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    const home = tmpHome();
    const missing = path.join(home, "does-not-exist", "node_repl");
    writeFileSync(
      path.join(home, "config.toml"),
      `[mcp_servers.node_repl]\ncommand = ${JSON.stringify(missing)}\nenabled = true\n`,
    );
    expect(codexDesktopAppInstalled(home)).toBe(false);
  });

  it("returns true when the node_repl command path exists", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    const home = tmpHome();
    const binDir = path.join(home, "bin");
    mkdirSync(binDir);
    const bin = path.join(binDir, "node_repl");
    writeFileSync(bin, "#!/bin/sh\n");
    writeFileSync(
      path.join(home, "config.toml"),
      `[mcp_servers.node_repl]\ncommand = ${JSON.stringify(bin)}\nenabled = true\n`,
    );
    expect(codexDesktopAppInstalled(home)).toBe(true);
  });
});
