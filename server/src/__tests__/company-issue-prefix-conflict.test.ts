import { describe, expect, it } from "vitest";
import { isIssuePrefixConflict } from "../services/companies.ts";

// Mirrors drizzle-orm@0.45's DrizzleQueryError: the wrapper Error carries the
// failed-query message, and the real PostgresError lives on `.cause`.
class FakeDrizzleQueryError extends Error {
  cause: unknown;
  constructor(cause: unknown) {
    super("Failed query: insert into \"companies\" ...");
    this.name = "DrizzleQueryError";
    this.cause = cause;
  }
}

function postgresUniqueViolation(constraint: string) {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint_name: constraint,
  });
}

describe("isIssuePrefixConflict", () => {
  it("detects the issue-prefix conflict on the underlying PostgresError", () => {
    const pg = postgresUniqueViolation("companies_issue_prefix_idx");
    expect(isIssuePrefixConflict(pg)).toBe(true);
  });

  it("detects the conflict when wrapped in a DrizzleQueryError (.cause chain)", () => {
    const wrapped = new FakeDrizzleQueryError(postgresUniqueViolation("companies_issue_prefix_idx"));
    expect(isIssuePrefixConflict(wrapped)).toBe(true);
  });

  it("also reads the legacy `constraint` property", () => {
    const pg = Object.assign(new Error("dup"), { code: "23505", constraint: "companies_issue_prefix_idx" });
    expect(isIssuePrefixConflict(new FakeDrizzleQueryError(pg))).toBe(true);
  });

  it("ignores unique violations on other constraints", () => {
    const wrapped = new FakeDrizzleQueryError(postgresUniqueViolation("companies_name_idx"));
    expect(isIssuePrefixConflict(wrapped)).toBe(false);
  });

  it("ignores non-unique-violation errors and plain values", () => {
    const wrapped = new FakeDrizzleQueryError(
      Object.assign(new Error("oops"), { code: "23502", constraint_name: "companies_issue_prefix_idx" }),
    );
    expect(isIssuePrefixConflict(wrapped)).toBe(false);
    expect(isIssuePrefixConflict(new Error("plain"))).toBe(false);
    expect(isIssuePrefixConflict(null)).toBe(false);
    expect(isIssuePrefixConflict("nope")).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const loop = new Error("loop") as Error & { cause?: unknown };
    loop.cause = loop;
    expect(isIssuePrefixConflict(loop)).toBe(false);
  });
});
