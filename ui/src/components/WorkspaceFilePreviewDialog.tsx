import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { userWorkspacesApi } from "../api/userWorkspaces";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryKeys } from "../lib/queryKeys";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const PREVIEW_TEXT_CHARS = 200_000; // ~200 KB of decoded text in the modal is plenty

export type FilePreviewTarget = {
  workspaceId: string;
  relativePath: string;
  name: string;
};

type Props = {
  target: FilePreviewTarget | null;
  onClose: () => void;
};

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Decide what kind of preview to render for a given file.
 *
 * Image detection is by extension — works for the common cases and dodges
 * having to sniff magic bytes. For everything else we try to decode the
 * bytes as UTF-8 with `fatal: true`; if that throws OR if the decoded text
 * has any NUL bytes (classic binary tell), we treat it as binary.
 */
type Preview =
  | { kind: "image"; mime: string; dataUrl: string }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "binary"; size: number };

function detectPreview(name: string, base64: string, size: number): Preview {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) {
    const mime =
      ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    return { kind: "image", mime, dataUrl: `data:${mime};base64,${base64}` };
  }
  // Try text. The browser's TextDecoder handles big base64-decoded buffers.
  try {
    const bin = atob(base64);
    // Quick binary sniff before full decode — null bytes in the first 8 KB
    // are a reliable signal for binaries that happen to be valid UTF-8.
    for (let i = 0; i < Math.min(bin.length, 8192); i++) {
      if (bin.charCodeAt(i) === 0) {
        return { kind: "binary", size };
      }
    }
    // Convert the binary string from atob() into a Uint8Array for TextDecoder.
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const decoded = decoder.decode(bytes);
    const truncated = decoded.length > PREVIEW_TEXT_CHARS;
    return {
      kind: "text",
      text: truncated ? decoded.slice(0, PREVIEW_TEXT_CHARS) : decoded,
      truncated,
    };
  } catch {
    return { kind: "binary", size };
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function WorkspaceFilePreviewDialog({ target, onClose }: Props) {
  // useQuery runs unconditionally (`enabled` short-circuits the actual fetch
  // when target is null), so the hook order stays stable across opens/closes.
  const { data, isLoading, error } = useQuery({
    queryKey: target
      ? queryKeys.userWorkspaces.fileContent(target.workspaceId, target.relativePath)
      : ["user-workspaces", "file-content", "__noop__"],
    queryFn: () =>
      userWorkspacesApi.readFile(target!.workspaceId, target!.relativePath),
    enabled: !!target,
    staleTime: 30_000,
  });

  const preview = useMemo<Preview | null>(() => {
    if (!data || !target) return null;
    return detectPreview(target.name, data.contents, data.size);
  }, [data, target]);

  return (
    <Dialog open={!!target} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="text-sm font-medium truncate">{target?.name}</DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground/80 truncate">
            {target?.relativePath}
            {data ? ` · ${formatBytes(data.size)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
          {isLoading && (
            <div className="px-5 py-8 text-sm text-muted-foreground/80">Loading…</div>
          )}
          {error && (
            <div className="px-5 py-8 text-sm text-destructive/90">
              {error instanceof ApiError ? error.message : "Failed to read file"}
            </div>
          )}
          {!isLoading && !error && preview && (
            <PreviewBody preview={preview} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ preview }: { preview: Preview }) {
  if (preview.kind === "image") {
    return (
      <div className="flex items-center justify-center bg-muted/30 p-6">
        <img
          src={preview.dataUrl}
          alt=""
          className="max-w-full max-h-[60vh] object-contain rounded"
        />
      </div>
    );
  }
  if (preview.kind === "binary") {
    return (
      <div className="px-5 py-8 text-sm text-muted-foreground/80">
        Binary file ({formatBytes(preview.size)}) — no preview available.
      </div>
    );
  }
  return (
    <>
      <pre className="px-5 py-4 text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-all">
        {preview.text}
      </pre>
      {preview.truncated && (
        <div className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground/80">
          Preview truncated — showing first {(PREVIEW_TEXT_CHARS / 1000).toFixed(0)} KB.
        </div>
      )}
    </>
  );
}
