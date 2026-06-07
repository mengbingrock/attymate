import { describe, expect, it } from "vitest";
import { pickActiveWorkspace } from "../services/user-workspaces.ts";

type Row = { id: string; grantedAt: Date; activeAt: Date | null };

const d = (iso: string) => new Date(iso);

describe("pickActiveWorkspace", () => {
  it("returns null for no rows", () => {
    expect(pickActiveWorkspace([])).toBeNull();
  });

  it("falls back to the oldest grant when none is active", () => {
    const rows: Row[] = [
      { id: "b", grantedAt: d("2026-02-01"), activeAt: null },
      { id: "a", grantedAt: d("2026-01-01"), activeAt: null },
    ];
    expect(pickActiveWorkspace(rows)?.id).toBe("a");
  });

  it("prefers a marked-active row over the oldest grant", () => {
    const rows: Row[] = [
      { id: "a", grantedAt: d("2026-01-01"), activeAt: null },
      { id: "b", grantedAt: d("2026-02-01"), activeAt: d("2026-03-01") },
    ];
    expect(pickActiveWorkspace(rows)?.id).toBe("b");
  });

  it("returns the most-recently activated row when several are marked", () => {
    const rows: Row[] = [
      { id: "a", grantedAt: d("2026-01-01"), activeAt: d("2026-03-01") },
      { id: "b", grantedAt: d("2026-01-02"), activeAt: d("2026-05-01") },
    ];
    expect(pickActiveWorkspace(rows)?.id).toBe("b");
  });
});
