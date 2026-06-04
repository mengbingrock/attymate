import { api } from "./client";

export type UserWorkspace = {
  id: string;
  workspacePath: string;
  grantedAt: string;
  updatedAt: string;
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

export const userWorkspacesApi = {
  list: () => api.get<UserWorkspace[]>("/users/me/workspaces"),
  add: (workspacePath: string) =>
    api.post<UserWorkspace>("/users/me/workspaces", { workspacePath }),
  remove: (id: string) => api.delete<void>(`/users/me/workspaces/${id}`),
  listFiles: (workspaceId: string, relativePath: string) => {
    const qs = relativePath ? `?path=${encodeURIComponent(relativePath)}` : "";
    return api.get<WorkspaceListing>(`/users/me/workspaces/${workspaceId}/files${qs}`);
  },
};
