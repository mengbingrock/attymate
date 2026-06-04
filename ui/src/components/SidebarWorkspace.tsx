import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError } from "../api/client";
import { userWorkspacesApi, type UserWorkspace } from "../api/userWorkspaces";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { SidebarSection } from "./SidebarSection";

// Ambient hook into AttyMate's contextBridge-exposed API (see electron/preload.cjs).
// Pure browser callers don't get `window.attymate`, so every read here is
// optional-chained — the section just renders nothing in that case.
declare global {
  interface Window {
    attymate?: {
      shell?: "electron";
      pickFolder?: () => Promise<string | null>;
    };
  }
}

function inAttyMate(): boolean {
  return typeof window !== "undefined" && window.attymate?.shell === "electron";
}

function displayName(workspacePath: string): string {
  const trimmed = workspacePath.replace(/\/+$/, "");
  const last = trimmed.split("/").pop() ?? "";
  return last || workspacePath;
}

export function SidebarWorkspace() {
  // Hooks run unconditionally even in non-Electron browsers, but we early-return
  // the rendered output below so we never actually fire the network request.
  const [open, setOpen] = useState(true);
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const isElectron = inAttyMate();

  const { data: workspaces } = useQuery({
    queryKey: queryKeys.userWorkspaces.list,
    queryFn: () => userWorkspacesApi.list(),
    enabled: isElectron,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.userWorkspaces.list });

  const addMutation = useMutation({
    mutationFn: (folder: string) => userWorkspacesApi.add(folder),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      const message =
        err instanceof ApiError ? err.message : "Could not add workspace folder";
      pushToast({ tone: "error", title: "Add folder failed", body: message });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => userWorkspacesApi.remove(id),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      const message =
        err instanceof ApiError ? err.message : "Could not remove workspace folder";
      pushToast({ tone: "error", title: "Remove folder failed", body: message });
    },
  });

  const handleAdd = async () => {
    if (!window.attymate?.pickFolder) return;
    try {
      const folder = await window.attymate.pickFolder();
      if (!folder) return; // user cancelled the native dialog
      addMutation.mutate(folder);
    } catch (err) {
      pushToast({
        tone: "error",
        title: "Folder picker failed",
        body: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  // Web-only renderers (paperclip.attymate.com in a regular browser) have no
  // local filesystem to grant — hide the section entirely rather than show an
  // empty state that the user has no way to fill.
  if (!isElectron) return null;

  return (
    <SidebarSection
      label="Workspace"
      collapsible={{ open, onOpenChange: setOpen }}
      headerAction={{
        ariaLabel: "Add local folder",
        icon: Plus,
        onClick: handleAdd,
      }}
    >
      {workspaces && workspaces.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {workspaces.map((ws) => (
            <WorkspaceItem
              key={ws.id}
              workspace={ws}
              onRemove={() => removeMutation.mutate(ws.id)}
              removing={removeMutation.isPending && removeMutation.variables === ws.id}
            />
          ))}
        </div>
      ) : (
        <div className="px-3 py-1.5 text-[12px] text-muted-foreground/60">
          No folders yet. Use + to add one.
        </div>
      )}
    </SidebarSection>
  );
}

type WorkspaceItemProps = {
  workspace: UserWorkspace;
  onRemove: () => void;
  removing: boolean;
};

function WorkspaceItem({ workspace, onRemove, removing }: WorkspaceItemProps) {
  return (
    <TooltipProvider delayDuration={400}>
      <div
        className={cn(
          "group/workspace-item flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium",
          "text-foreground/80 transition-colors",
          removing && "opacity-50",
        )}
      >
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex-1 truncate cursor-default">{displayName(workspace.workspacePath)}</span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[28rem] break-all text-[11px]">
            {workspace.workspacePath}
          </TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            "shrink-0 h-5 w-5 text-muted-foreground/60 hover:text-foreground",
            "opacity-0 group-hover/workspace-item:opacity-100 focus-visible:opacity-100",
          )}
          aria-label={`Remove ${workspace.workspacePath}`}
          disabled={removing}
          onClick={onRemove}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </TooltipProvider>
  );
}
