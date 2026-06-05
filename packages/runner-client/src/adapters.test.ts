import { describe, expect, it } from "vitest";
import { resolveLocalExecute, SUPPORTED_LOCAL_ADAPTER_TYPES } from "./adapters.js";

describe("runner-client adapter registry", () => {
  it("supports the expected local adapter types", () => {
    for (const t of [
      "claude_local",
      "codex_local",
      "cursor_local",
      "cursor",
      "gemini_local",
      "opencode_local",
      "pi_local",
    ]) {
      expect(SUPPORTED_LOCAL_ADAPTER_TYPES).toContain(t);
    }
  });

  it("resolves a callable execute() for each supported type", () => {
    for (const t of SUPPORTED_LOCAL_ADAPTER_TYPES) {
      expect(typeof resolveLocalExecute(t)).toBe("function");
    }
  });

  it("throws a tagged error for an unsupported type", () => {
    try {
      resolveLocalExecute("nonexistent_adapter");
      throw new Error("expected resolveLocalExecute to throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("runner_adapter_unsupported");
      expect((err as Error).message).toContain("nonexistent_adapter");
    }
  });
});
