import { createContext, useCallback, useContext, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Circle,
  CircleDot,
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
import {
  WorkspaceFilePreviewDialog,
  type FilePreviewTarget,
} from "./WorkspaceFilePreviewDialog";

// Avoids drilling an onPreview callback through 3 levels of recursive
// tree components. Only FileRow uses it; the Provider lives in SidebarWorkspace.
const FilePreviewContext = createContext<(target: FilePreviewTarget) => void>(() => {});

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

// Which folder this user's local-runner agents run in. Mirrors the server's
// getActive precedence: newest non-null activeAt wins; otherwise the oldest
// grant. Returns the active workspace id, or null when the list is empty.
function resolveActiveWorkspaceId(workspaces: UserWorkspace[]): string | null {
  if (workspaces.length === 0) return null;
  const marked = workspaces
    .filter((w) => w.activeAt)
    .sort((a, b) => new Date(b.activeAt as string).getTime() - new Date(a.activeAt as string).getTime());
  if (marked.length > 0) return marked[0].id;
  return [...workspaces].sort(
    (a, b) => new Date(a.grantedAt).getTime() - new Date(b.grantedAt).getTime(),
  )[0].id;
}

// Indentation per nesting level (px). Mirrors the visual rhythm of the rest
// of the sidebar — small enough to nest deep, big enough to scan.
const INDENT_PX = 12;

export function SidebarWorkspace() {
  const [open, setOpen] = useState(true);
  const [previewTarget, setPreviewTarget] = useState<FilePreviewTarget | null>(null);
  const openPreview = useCallback((t: FilePreviewTarget) => setPreviewTarget(t), []);
  const closePreview = useCallback(() => setPreviewTarget(null), []);
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

  const setActiveMutation = useMutation({
    mutationFn: (id: string) => userWorkspacesApi.setActive(id),
    onSuccess: invalidateList,
    onError: (err: unknown) => {
      const message =
        err instanceof ApiError ? err.message : "Could not set active workspace";
      pushToast({ tone: "error", title: "Set active failed", body: message });
    },
  });

  const activeWorkspaceId = workspaces ? resolveActiveWorkspaceId(workspaces) : null;

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
    <FilePreviewContext.Provider value={openPreview}>
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
                  isActive={ws.id === activeWorkspaceId}
                  onSetActive={() => setActiveMutation.mutate(ws.id)}
                  settingActive={
                    setActiveMutation.isPending && setActiveMutation.variables === ws.id
                  }
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
      <WorkspaceFilePreviewDialog target={previewTarget} onClose={closePreview} />
    </FilePreviewContext.Provider>
  );
}

type WorkspaceRootProps = {
  workspace: UserWorkspace;
  onRemove: () => void;
  removing: boolean;
  isActive: boolean;
  onSetActive: () => void;
  settingActive: boolean;
};

function WorkspaceRoot({
  workspace,
  onRemove,
  removing,
  isActive,
  onSetActive,
  settingActive,
}: WorkspaceRootProps) {
  const [open, setOpen] = useState(false);
  const label = displayName(workspace.workspacePath);

  return (
    <div className={cn(removing && "opacity-50")}>
      <FolderRow
        depth={0}
        label={label}
        labelTooltip={
          isActive
            ? `${workspace.workspacePath}\n(active — local-runner agents run here)`
            : workspace.workspacePath
        }
        open={open}
        onToggle={() => setOpen((v) => !v)}
        trailing={
          <>
            {/* Active indicator / set-active toggle. The active folder shows a
                filled dot always; others show a hollow dot on hover that sets
                them active when clicked. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "shrink-0 h-5 w-5",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground/60 hover:text-foreground opacity-0 group-hover/workspace-row:opacity-100 focus-visible:opacity-100",
                  )}
                  aria-label={
                    isActive ? "Active workspace" : `Set ${workspace.workspacePath} active`
                  }
                  aria-pressed={isActive}
                  disabled={settingActive || isActive}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isActive) onSetActive();
                  }}
                >
                  {isActive ? (
                    <CircleDot className="h-3.5 w-3.5" />
                  ) : (
                    <Circle className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-[11px]">
                {isActive ? "Active — agents run here" : "Set as active workspace"}
              </TooltipContent>
            </Tooltip>
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
          </>
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
          <FileRow
            key={entry.name}
            depth={depth}
            entry={entry}
            workspaceId={workspaceId}
            parentPath={relativePath}
          />
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none"
        aria-label={open ? "Collapse folder" : "Expand folder"}
      >
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
      </button>
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
  workspaceId: string;
  parentPath: string;
};

function FileRow({ depth, entry, workspaceId, parentPath }: FileRowProps) {
  const openPreview = useContext(FilePreviewContext);
  const Icon = entry.kind === "symlink" ? FileSymlink : FileIcon;
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  // Symlinks/other can't be safely previewed via the read op (it requires a
  // regular file). Keep the row visible but inert.
  const clickable = entry.kind === "file";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 py-1 text-[13px]",
        "text-foreground/70 transition-colors",
        clickable
          ? "hover:bg-accent/40 hover:text-foreground cursor-pointer"
          : "cursor-default",
      )}
      style={{ paddingLeft: 12 + depth * INDENT_PX + 12, paddingRight: 12 }}
      onClick={
        clickable
          ? () => openPreview({ workspaceId, relativePath, name: entry.name })
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openPreview({ workspaceId, relativePath, name: entry.name });
              }
            }
          : undefined
      }
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
