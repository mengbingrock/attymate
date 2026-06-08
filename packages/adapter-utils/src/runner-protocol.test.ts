import { describe, expect, it } from "vitest";
import {
  RUNNER_PROTOCOL_VERSION,
  RUNNER_WS_PATH,
  RUNNER_AUTH_HEADER,
  RUNNER_COMPANY_HEADER,
  parseRunnerFrame,
} from "./runner-protocol.js";

describe("runner-protocol constants", () => {
  it("exposes stable wire constants", () => {
    expect(RUNNER_WS_PATH).toBe("/api/runner/ws");
    expect(RUNNER_AUTH_HEADER).toBe("x-paperclip-runner-token");
    expect(RUNNER_COMPANY_HEADER).toBe("x-paperclip-runner-company");
    expect(RUNNER_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe("parseRunnerFrame", () => {
  it("parses a valid run.start frame", () => {
    const raw = JSON.stringify({ type: "run.start", id: "r1", spec: { runId: "r1" } });
    const frame = parseRunnerFrame(raw);
    expect(frame?.type).toBe("run.start");
  });

  it("parses a run.event frame", () => {
    const raw = JSON.stringify({
      type: "run.event",
      id: "r1",
      seq: 3,
      event: { kind: "log", stream: "stdout", chunk: "hi" },
    });
    const frame = parseRunnerFrame(raw);
    expect(frame?.type).toBe("run.event");
  });

  it("returns null for non-JSON input", () => {
    expect(parseRunnerFrame("not json {")).toBeNull();
  });

  it("returns null for JSON without a string type", () => {
    expect(parseRunnerFrame(JSON.stringify({ id: "x" }))).toBeNull();
    expect(parseRunnerFrame(JSON.stringify({ type: 42 }))).toBeNull();
  });

  it("returns null for JSON primitives and arrays", () => {
    expect(parseRunnerFrame("123")).toBeNull();
    expect(parseRunnerFrame("null")).toBeNull();
    expect(parseRunnerFrame(JSON.stringify(["a", "b"]))).toBeNull();
  });
});
