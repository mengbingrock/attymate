import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  File as FileIcon,
  FileSymlink,
  Folder as FolderIcon,
  FolderOpen,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError } from "../api/client";
import {
  userWorkspacesApi,
  type UserWorkspace,
  type WorkspaceFileEntry,
} from "../api/userWorkspaces";
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

// Indentation per nesting level (px). Mirrors the visual rhythm of the rest
// of the sidebar — small enough to nest deep, big enough to scan.
const INDENT_PX = 12;

export function SidebarWorkspace() {
  const [open, setOpen] = useState(true);
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const isElectron = inAttyMate();

  const { data: workspaces } = useQuery({
    queryKey: queryKeys.userWorkspaces.list,
    queryFn: () => userWorkspacesApi.list(),
    enabled: isElectron,
  });

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.userWorkspaces.list });

  const addMutation = useMutation({
    mutationFn: (folder: string) => userWorkspacesApi.add(folder),
    onSuccess: invalidateList,
    onError: (err: unknown) => {
      const message =
        err instanceof ApiError ? err.message : "Could not add workspace folder";
      pushToast({ tone: "error", title: "Add folder failed", body: message });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => userWorkspacesApi.remove(id),
    onSuccess: invalidateList,
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
      if (!folder) return;
      addMutation.mutate(folder);
    } catch (err) {
      pushToast({
        tone: "error",
        title: "Folder picker failed",
        body: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

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
        <TooltipProvider delayDuration={400}>
          <div className="flex flex-col gap-0.5">
            {workspaces.map((ws) => (
              <WorkspaceRoot
                key={ws.id}
                workspace={ws}
                onRemove={() => removeMutation.mutate(ws.id)}
                removing={removeMutation.isPending && removeMutation.variables === ws.id}
              />
            ))}
          </div>
        </TooltipProvider>
      ) : (
        <div className="px-3 py-1.5 text-[12px] text-muted-foreground/60">
          No folders yet. Use + to add one.
        </div>
      )}
    </SidebarSection>
  );
}

type WorkspaceRootProps = {
  workspace: UserWorkspace;
  onRemove: () => void;
  removing: boolean;
};

function WorkspaceRoot({ workspace, onRemove, removing }: WorkspaceRootProps) {
  const [open, setOpen] = useState(false);
  const label = displayName(workspace.workspacePath);

  return (
    <div className={cn(removing && "opacity-50")}>
      <FolderRow
        depth={0}
        label={label}
        labelTooltip={workspace.workspacePath}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        trailing={
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "shrink-0 h-5 w-5 text-muted-foreground/60 hover:text-foreground",
              "opacity-0 group-hover/workspace-row:opacity-100 focus-visible:opacity-100",
            )}
            aria-label={`Remove ${workspace.workspacePath}`}
            disabled={removing}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        }
      />
      {open && (
        <FolderContents workspaceId={workspace.id} relativePath="" depth={1} />
      )}
    </div>
  );
}

type FolderNodeProps = {
  workspaceId: string;
  parentPath: string;
  name: string;
  depth: number;
};

function FolderNode({ workspaceId, parentPath, name, depth }: FolderNodeProps) {
  const [open, setOpen] = useState(false);
  const relativePath = parentPath ? `${parentPath}/${name}` : name;

  return (
    <div>
      <FolderRow
        depth={depth}
        label={name}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      {open && (
        <FolderContents workspaceId={workspaceId} relativePath={relativePath} depth={depth + 1} />
      )}
    </div>
  );
}

type FolderContentsProps = {
  workspaceId: string;
  relativePath: string;
  depth: number;
};

function FolderContents({ workspaceId, relativePath, depth }: FolderContentsProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.userWorkspaces.files(workspaceId, relativePath),
    queryFn: () => userWorkspacesApi.listFiles(workspaceId, relativePath),
    // Folder contents don't change while we're looking at them; cache for a
    // minute so re-expanding a folder is instant. Future: invalidate on a
    // write through this workspace if we ever wire mutations to it.
    staleTime: 60_000,
  });

  if (isLoading) {
    return <LeafMessage depth={depth} label="Loading…" />;
  }
  if (error) {
    const message = error instanceof ApiError ? error.message : "Failed to read folder";
    return <LeafMessage depth={depth} label={message} tone="error" />;
  }
  if (!data || data.entries.length === 0) {
    return <LeafMessage depth={depth} label="empty" />;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {data.entries.map((entry) =>
        entry.kind === "dir" ? (
          <FolderNode
            key={entry.name}
            workspaceId={workspaceId}
            parentPath={relativePath}
            name={entry.name}
            depth={depth}
          />
        ) : (
          <FileRow key={entry.name} depth={depth} entry={entry} />
        ),
      )}
      {data.truncated && (
        <LeafMessage
          depth={depth}
          label={`Showing first ${data.entries.length} of ${data.total}`}
        />
      )}
    </div>
  );
}

type FolderRowProps = {
  depth: number;
  label: string;
  labelTooltip?: string;
  open: boolean;
  onToggle: () => void;
  trailing?: React.ReactNode;
};

function FolderRow({ depth, label, labelTooltip, open, onToggle, trailing }: FolderRowProps) {
  const Icon = open ? FolderOpen : FolderIcon;
  const labelEl = (
    <span className="flex-1 truncate select-none">{label}</span>
  );
  return (
    <div
      className={cn(
        "group/workspace-row flex items-center gap-1.5 py-1 text-[13px] font-medium",
        "text-foreground/80 hover:bg-accent/50 hover:text-foreground transition-colors",
        "cursor-default",
      )}
      style={{ paddingLeft: 12 + depth * INDENT_PX, paddingRight: 12 }}
      onDoubleClick={onToggle}
      role="treeitem"
      aria-expanded={open}
    >
      <ChevronRight
        className={cn(
          "h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform",
          open && "rotate-90",
        )}
        aria-hidden="true"
      />
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />
      {labelTooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{labelEl}</TooltipTrigger>
          <TooltipContent side="right" className="max-w-[28rem] break-all text-[11px]">
            {labelTooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        labelEl
      )}
      {trailing}
    </div>
  );
}

type FileRowProps = {
  depth: number;
  entry: WorkspaceFileEntry;
};

function FileRow({ depth, entry }: FileRowProps) {
  const Icon = entry.kind === "symlink" ? FileSymlink : FileIcon;
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 py-1 text-[13px]",
        "text-foreground/70 hover:bg-accent/40 transition-colors cursor-default",
      )}
      style={{ paddingLeft: 12 + depth * INDENT_PX + 12, paddingRight: 12 }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      <span className="flex-1 truncate select-none">{entry.name}</span>
    </div>
  );
}

function LeafMessage({
  depth,
  label,
  tone,
}: {
  depth: number;
  label: string;
  tone?: "error";
}) {
  return (
    <div
      className={cn(
        "py-1 text-[12px]",
        tone === "error" ? "text-destructive/80" : "text-muted-foreground/60",
      )}
      style={{ paddingLeft: 12 + depth * INDENT_PX + 12, paddingRight: 12 }}
    >
      {label}
    </div>
  );
}
