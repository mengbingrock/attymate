import { describe, expect, it } from "vitest";
import { buildMirrorRelativePath } from "../services/document-mirror.ts";

describe("buildMirrorRelativePath", () => {
  it("uses the issue identifier as the folder and key as the filename", () => {
    expect(
      buildMirrorRelativePath({ issueIdentifier: "ENG-12", issueId: "uuid-1", key: "plan", format: "markdown" }),
    ).toBe("ENG-12/plan.md");
  });

  it("uses a .txt extension for non-markdown formats", () => {
    expect(
      buildMirrorRelativePath({ issueIdentifier: "ENG-12", issueId: "uuid-1", key: "notes", format: "text" }),
    ).toBe("ENG-12/notes.txt");
  });

  it("falls back to the issue id when there is no identifier", () => {
    expect(
      buildMirrorRelativePath({ issueIdentifier: null, issueId: "abc-123", key: "plan", format: "markdown" }),
    ).toBe("abc-123/plan.md");
  });

  it("sanitizes unsafe characters in the identifier and key to dashes", () => {
    expect(
      buildMirrorRelativePath({
        issueIdentifier: "feat/cool thing",
        issueId: "uuid-1",
        key: "design notes",
        format: "markdown",
      }),
    ).toBe("feat-cool-thing/design-notes.md");
  });

  it("strips traversal/leading dots so a segment can never escape", () => {
    expect(
      buildMirrorRelativePath({ issueIdentifier: "../../etc", issueId: "uuid-1", key: "..", format: "markdown" }),
    ).toBe("etc/document.md");
  });

  it("falls back to the issue id when the identifier sanitizes to empty", () => {
    expect(
      buildMirrorRelativePath({ issueIdentifier: "...", issueId: "uuid-9", key: "plan", format: "markdown" }),
    ).toBe("uuid-9/plan.md");
  });
});
