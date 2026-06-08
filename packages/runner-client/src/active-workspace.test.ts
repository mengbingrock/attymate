import { describe, expect, it } from "vitest";
import { selectActiveWorkspacePath } from "./active-workspace.js";

type Row = {
  id: string;
  workspacePath: string;
  grantedAt: string;
  updatedAt: string;
  activeAt: string | null;
};

const row = (over: Partial<Row> & { id: string; workspacePath: string }): Row => ({
  grantedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  activeAt: null,
  ...over,
});

describe("selectActiveWorkspacePath", () => {
  it("returns null for an empty list", () => {
    expect(selectActiveWorkspacePath([])).toBeNull();
  });

  it("falls back to the oldest grant when none is marked active", () => {
    const rows = [
      row({ id: "b", workspacePath: "/b", grantedAt: "2026-02-01T00:00:00.000Z" }),
      row({ id: "a", workspacePath: "/a", grantedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(selectActiveWorkspacePath(rows)).toBe("/a");
  });

  it("prefers the marked-active folder over the oldest grant", () => {
    const rows = [
      row({ id: "a", workspacePath: "/a", grantedAt: "2026-01-01T00:00:00.000Z" }),
      row({
        id: "b",
        workspacePath: "/b",
        grantedAt: "2026-02-01T00:00:00.000Z",
        activeAt: "2026-03-01T00:00:00.000Z",
      }),
    ];
    expect(selectActiveWorkspacePath(rows)).toBe("/b");
  });

  it("returns the most-recently activated folder when several are marked", () => {
    const rows = [
      row({
        id: "a",
        workspacePath: "/a",
        activeAt: "2026-03-01T00:00:00.000Z",
      }),
      row({
        id: "b",
        workspacePath: "/b",
        activeAt: "2026-05-01T00:00:00.000Z",
      }),
    ];
    expect(selectActiveWorkspacePath(rows)).toBe("/b");
  });
});
