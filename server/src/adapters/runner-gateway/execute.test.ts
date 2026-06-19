import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerExecutionSpec } from "@paperclipai/adapter-utils/runner-protocol";
import type { AdapterExecutionContext } from "../types.js";

const dispatchRun = vi.fn();
const isRunnerOnline = vi.fn(() => true);

vi.mock("../../realtime/runner-ws.js", () => ({
  isRunnerOnline: (...args: unknown[]) => isRunnerOnline(...(args as [])),
  dispatchRun: (...args: unknown[]) => dispatchRun(...(args as [])),
}));

import { execute } from "./execute.js";

function makeCtx(runnerAdapterType: string): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Agent One",
      adapterType: `${runnerAdapterType}_runner`,
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { runnerAdapterType },
    context: {},
    onLog: async () => {},
  };
}

describe("runner_gateway execute — runtimeCommandSpec", () => {
  beforeEach(() => {
    dispatchRun.mockReset();
    isRunnerOnline.mockReset();
    isRunnerOnline.mockReturnValue(true);
    dispatchRun.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false });
  });

  it("ships the inner adapter's localInstallCommand so the client can auto-install", async () => {
    await execute(makeCtx("codex_local"));

    expect(dispatchRun).toHaveBeenCalledTimes(1);
    const spec = dispatchRun.mock.calls[0][1] as RunnerExecutionSpec;
    expect(spec.runtimeCommandSpec).toMatchObject({
      command: "codex",
      detectCommand: "codex",
      localInstallCommand: `if ! command -v 'codex' >/dev/null 2>&1; then npm install -g '@openai/codex'; fi`,
    });
  });

  it("returns runner_offline without dispatching when no runner is connected", async () => {
    isRunnerOnline.mockReturnValue(false);

    const result = await execute(makeCtx("codex_local"));

    expect(result.errorCode).toBe("runner_offline");
    expect(dispatchRun).not.toHaveBeenCalled();
  });
});
