import { describe, expect, it } from "vitest";
import { resolveWorkspaceChildPath } from "../routes/user-workspace.ts";

// Workspace folders can legitimately contain spaces (e.g. "/Users/me/My Workspace"
// or "C:\Users\Jane Doe\AttyMate Workspace"). Path resolution + containment must
// handle them: the path is carried as data (not interpolated into a shell), so a
// space must not break resolution or be misread as a separate path segment.
describe("resolveWorkspaceChildPath with spaces in the workspace path", () => {
  it("resolves a relative child under a POSIX root with spaces", () => {
    const r = resolveWorkspaceChildPath("/Users/me/My Workspace", "docs/sub dir/file.md");
    expect(r.resolvedAbs).toBe("/Users/me/My Workspace/docs/sub dir/file.md");
    expect(r.rel).toBe("docs/sub dir/file.md");
    expect(r.escapes).toBe(false);
  });

  it("treats the root itself (empty relative) as in-bounds", () => {
    const r = resolveWorkspaceChildPath("/Users/me/My Workspace", "");
    expect(r.resolvedAbs).toBe("/Users/me/My Workspace");
    expect(r.escapes).toBe(false);
  });

  it("still flags traversal that escapes a space-containing root", () => {
    const r = resolveWorkspaceChildPath("/Users/me/My Workspace", "../Other Folder/secret");
    expect(r.escapes).toBe(true);
  });

  it("resolves under a Windows root with spaces using win32 semantics", () => {
    const r = resolveWorkspaceChildPath("C:\\Users\\Jane Doe\\My Workspace", "docs\\my file.md");
    expect(r.resolvedAbs).toBe("C:\\Users\\Jane Doe\\My Workspace\\docs\\my file.md");
    expect(r.escapes).toBe(false);
  });
});
