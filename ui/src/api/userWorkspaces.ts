import { api } from "./client";

export type UserWorkspace = {
  id: string;
  workspacePath: string;
  grantedAt: string;
  updatedAt: string;
  /** When this folder was last marked active; the newest non-null wins. */
  activeAt: string | null;
};

export type WorkspaceFileEntry = {
  name: string;
  kind: "dir" | "file" | "symlink" | "other";
  size?: number;
  mtime?: string | null;
};

export type WorkspaceListing = {
  entries: WorkspaceFileEntry[];
  truncated: boolean;
  total: number;
};

export type WorkspaceFileContent = {
  contents: string; // base64
  encoding: "base64";
  size: number;
  mtime: string;
};

export const userWorkspacesApi = {
  // Workspaces are company-scoped: list/add take the active companyId.
  list: (companyId: string) =>
    api.get<UserWorkspace[]>(`/users/me/workspaces?companyId=${encodeURIComponent(companyId)}`),
  add: (companyId: string, workspacePath: string) =>
    api.post<UserWorkspace>("/users/me/workspaces", { workspacePath, companyId }),
  remove: (id: string) => api.delete<void>(`/users/me/workspaces/${id}`),
  setActive: (id: string) =>
    api.post<UserWorkspace>(`/users/me/workspaces/${id}/active`, {}),
  listFiles: (workspaceId: string, relativePath: string) => {
    const qs = relativePath ? `?path=${encodeURIComponent(relativePath)}` : "";
    return api.get<WorkspaceListing>(`/users/me/workspaces/${workspaceId}/files${qs}`);
  },
  readFile: (workspaceId: string, relativePath: string) =>
    api.get<WorkspaceFileContent>(
      `/users/me/workspaces/${workspaceId}/files/read?path=${encodeURIComponent(relativePath)}`,
    ),
};
