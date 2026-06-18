import { describe, expect, it } from "vitest";
import { buildCodexExecArgs } from "./codex-args.js";

describe("buildCodexExecArgs", () => {
  it("enables Codex fast mode overrides for GPT-5.4", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.4",
      search: true,
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(true);
    expect(result.fastModeIgnoredReason).toBeNull();
    expect(result.args).toEqual([
      "--search",
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.network_access=true",
      "--model",
      "gpt-5.4",
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
      "-c",
      "apps_enabled=true",
      "-",
    ]);
  });

  it("enables Codex fast mode overrides for manual models", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.5",
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(true);
    expect(result.fastModeIgnoredReason).toBeNull();
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.network_access=true",
      "--model",
      "gpt-5.5",
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
      "-c",
      "apps_enabled=true",
      "-",
    ]);
  });

  it("ignores fast mode for unsupported models", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.3-codex",
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(false);
    expect(result.fastModeIgnoredReason).toContain(
      "currently only supported on gpt-5.4 or manually configured model IDs",
    );
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.network_access=true",
      "--model",
      "gpt-5.3-codex",
      "-c",
      "apps_enabled=true",
      "-",
    ]);
  });

  it("adds --skip-git-repo-check when requested", () => {
    const result = buildCodexExecArgs(
      {
        model: "gpt-5.3-codex",
      },
      { skipGitRepoCheck: true },
    );

    expect(result.args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.network_access=true",
      "--model",
      "gpt-5.3-codex",
      "-c",
      "apps_enabled=true",
      "-",
    ]);
  });

  it("selects the workspace-write sandbox with network access by default so agents can reach the API", () => {
    const result = buildCodexExecArgs({ model: "gpt-5.3-codex" });

    expect(result.args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.network_access=true",
      "--model",
      "gpt-5.3-codex",
      "-c",
      "apps_enabled=true",
      "-",
    ]);
  });

  it("omits the sandbox selection when bypassing the sandbox entirely", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.3-codex",
      dangerouslyBypassSandbox: true,
    });

    expect(result.args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.3-codex",
      "-c",
      "apps_enabled=true",
      "-",
    ]);
    expect(result.args).not.toContain("workspace-write");
    expect(result.args).not.toContain("sandbox_workspace_write.network_access=true");
  });

  it("keeps the workspace-write sandbox but drops network access when disabled", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.3-codex",
      sandboxNetworkAccess: false,
    });

    expect(result.args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--model",
      "gpt-5.3-codex",
      "-c",
      "apps_enabled=true",
      "-",
    ]);
    expect(result.args).not.toContain("sandbox_workspace_write.network_access=true");
  });

  it("does not override a caller-pinned sandbox from extraArgs", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.3-codex",
      extraArgs: ["--sandbox", "read-only"],
    });

    expect(result.args).toEqual([
      "exec",
      "--json",
      "--model",
      "gpt-5.3-codex",
      "-c",
      "apps_enabled=true",
      "--sandbox",
      "read-only",
      "-",
    ]);
    expect(result.args).not.toContain("workspace-write");
  });

  it("enables Codex Apps (codex_apps connectors) by default", () => {
    const result = buildCodexExecArgs({ model: "gpt-5.3-codex" });
    const i = result.args.indexOf("apps_enabled=true");
    expect(i).toBeGreaterThan(0);
    expect(result.args[i - 1]).toBe("-c");
  });

  it("omits apps_enabled when appsEnabled is false", () => {
    const result = buildCodexExecArgs({ model: "gpt-5.3-codex", appsEnabled: false });
    expect(result.args).not.toContain("apps_enabled=true");
  });

  it("lets extraArgs override apps_enabled (codex last-wins)", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.3-codex",
      extraArgs: ["-c", "apps_enabled=false"],
    });
    // both present; the caller's override is appended after, so codex resolves it last
    expect(result.args.lastIndexOf("apps_enabled=false")).toBeGreaterThan(
      result.args.indexOf("apps_enabled=true"),
    );
  });
});
