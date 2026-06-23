import { describe, expect, it } from "vitest";
import {
  hasWorkspacePathTraversal,
  isAbsoluteWorkspacePath,
  isWindowsWorkspacePath,
  normalizeLegacyWindowsWorkspacePath,
} from "./workspace-path.js";

describe("isAbsoluteWorkspacePath", () => {
  it("accepts POSIX absolute paths", () => {
    expect(isAbsoluteWorkspacePath("/Users/martin/attymateworkspace")).toBe(true);
  });

  it("accepts Windows drive paths with either separator", () => {
    expect(isAbsoluteWorkspacePath("C:\\Users\\DL5420B-103-USER\\AttyMateWorkspace")).toBe(true);
    expect(isAbsoluteWorkspacePath("C:/Users/DL5420B-103-USER/AttyMateWorkspace")).toBe(true);
  });

  it("accepts Windows UNC paths", () => {
    expect(isAbsoluteWorkspacePath("\\\\server\\share\\folder")).toBe(true);
  });

  it("accepts the legacy /C:/ workaround form (starts with /)", () => {
    expect(isAbsoluteWorkspacePath("/C:/Users/DL5420B-103-USER/AttyMateWorkspace")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isAbsoluteWorkspacePath("Users/martin")).toBe(false);
    expect(isAbsoluteWorkspacePath("./foo")).toBe(false);
    expect(isAbsoluteWorkspacePath("C:relative")).toBe(false); // no separator after drive
  });
});

describe("isWindowsWorkspacePath", () => {
  it("detects native and legacy Windows paths", () => {
    expect(isWindowsWorkspacePath("C:\\Users\\x")).toBe(true);
    expect(isWindowsWorkspacePath("C:/Users/x")).toBe(true);
    expect(isWindowsWorkspacePath("\\\\srv\\share\\x")).toBe(true);
    expect(isWindowsWorkspacePath("/C:/Users/x")).toBe(true);
  });

  it("treats POSIX paths as non-Windows", () => {
    expect(isWindowsWorkspacePath("/Users/martin")).toBe(false);
  });
});

describe("hasWorkspacePathTraversal", () => {
  it("flags .. under either separator", () => {
    expect(hasWorkspacePathTraversal("/Users/../etc")).toBe(true);
    expect(hasWorkspacePathTraversal("C:\\Users\\..\\Windows")).toBe(true);
    expect(hasWorkspacePathTraversal("foo\\..\\bar")).toBe(true);
  });

  it("does not flag legitimate paths or names containing ..", () => {
    expect(hasWorkspacePathTraversal("/Users/martin/AttyMateWorkspace")).toBe(false);
    expect(hasWorkspacePathTraversal("C:\\Users\\my..folder")).toBe(false);
  });
});

describe("normalizeLegacyWindowsWorkspacePath", () => {
  it("strips the bogus leading slash from /C:/... records", () => {
    expect(normalizeLegacyWindowsWorkspacePath("/C:/Users/DL5420B-103-USER/AttyMateWorkspace")).toBe(
      "C:/Users/DL5420B-103-USER/AttyMateWorkspace",
    );
    expect(normalizeLegacyWindowsWorkspacePath("/C:\\Users\\x")).toBe("C:\\Users\\x");
  });

  it("leaves native Windows paths untouched", () => {
    expect(normalizeLegacyWindowsWorkspacePath("C:\\Users\\x")).toBe("C:\\Users\\x");
    expect(normalizeLegacyWindowsWorkspacePath("C:/Users/x")).toBe("C:/Users/x");
  });

  it("leaves genuine POSIX paths untouched", () => {
    expect(normalizeLegacyWindowsWorkspacePath("/Users/martin/workspace")).toBe(
      "/Users/martin/workspace",
    );
  });
});

describe("workspace paths containing spaces", () => {
  it("accepts POSIX and Windows paths with spaces as absolute", () => {
    expect(isAbsoluteWorkspacePath("/Users/martin/My Workspace")).toBe(true);
    expect(isAbsoluteWorkspacePath("C:\\Users\\Jane Doe\\My Workspace")).toBe(true);
    expect(isAbsoluteWorkspacePath("C:/Users/Jane Doe/My Workspace")).toBe(true);
    expect(isAbsoluteWorkspacePath("\\\\server\\team share\\My Workspace")).toBe(true);
  });

  it("does not flag a space-containing path as traversal (but still catches real ..)", () => {
    expect(hasWorkspacePathTraversal("/Users/martin/My Workspace/sub dir")).toBe(false);
    expect(hasWorkspacePathTraversal("C:\\Users\\Jane Doe\\My Workspace")).toBe(false);
    expect(hasWorkspacePathTraversal("/Users/martin/My Workspace/../escape")).toBe(true);
  });

  it("classifies space-containing Windows paths as Windows", () => {
    expect(isWindowsWorkspacePath("C:\\Users\\Jane Doe\\My Workspace")).toBe(true);
    expect(isWindowsWorkspacePath("/Users/martin/My Workspace")).toBe(false);
  });

  it("normalizes a legacy Windows path that has spaces", () => {
    expect(normalizeLegacyWindowsWorkspacePath("/C:/Users/Jane Doe/My Workspace")).toBe(
      "C:/Users/Jane Doe/My Workspace",
    );
  });
});
