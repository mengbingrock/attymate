import { api } from "./client";

export type UserWorkspace = {
  id: string;
  workspacePath: string;
  grantedAt: string;
  updatedAt: string;
};

export const userWorkspacesApi = {
  list: () => api.get<UserWorkspace[]>("/users/me/workspaces"),
  add: (workspacePath: string) =>
    api.post<UserWorkspace>("/users/me/workspaces", { workspacePath }),
  remove: (id: string) => api.delete<void>(`/users/me/workspaces/${id}`),
};
