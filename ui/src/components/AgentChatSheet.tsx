import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { MessageSquare, Send, Loader2, ExternalLink } from "lucide-react";
import type { HeartbeatRun } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { agentRouteRef } from "../lib/utils";
import { relativeTime } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AgentIcon } from "./AgentIconPicker";

const CHAT_REASON = "user_chat_message";

type AgentLike = {
  id: string;
  name: string;
  role: string;
  icon?: string | null;
  companyId: string;
};

function extractChatMessage(run: HeartbeatRun): string | null {
  const ctx = run.contextSnapshot as Record<string, unknown> | null | undefined;
  if (!ctx) return null;
  const directMessage =
    typeof (ctx as Record<string, unknown>).userMessage === "string"
      ? ((ctx as Record<string, unknown>).userMessage as string)
      : null;
  if (directMessage && directMessage.trim().length > 0) return directMessage;
  const payload = ctx.payload as Record<string, unknown> | undefined;
  const fromPayload =
    typeof payload?.userMessage === "string" ? payload.userMessage : null;
  if (fromPayload && fromPayload.trim().length > 0) return fromPayload;
  return null;
}

function extractAgentReply(run: HeartbeatRun): string | null {
  const result = run.resultJson as Record<string, unknown> | null | undefined;
  if (!result) return null;
  const text =
    typeof result.result === "string"
      ? result.result
      : typeof result.summary === "string"
        ? result.summary
        : typeof result.message === "string"
          ? result.message
          : null;
  return text && text.trim().length > 0 ? text : null;
}

function statusLabel(status: HeartbeatRun["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "succeeded":
      return "Replied";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "timed_out":
      return "Timed out";
    case "scheduled_retry":
      return "Retry scheduled";
    default:
      return status;
  }
}

function statusToneClass(status: HeartbeatRun["status"]): string {
  switch (status) {
    case "running":
    case "queued":
      return "text-cyan-600 dark:text-cyan-400";
    case "succeeded":
      return "text-green-600 dark:text-green-400";
    case "failed":
    case "timed_out":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}

export function AgentChatSheet({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentLike;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { data: heartbeats, isLoading } = useQuery({
    queryKey: queryKeys.heartbeats(agent.companyId, agent.id),
    queryFn: () => heartbeatsApi.list(agent.companyId, agent.id),
    enabled: open,
    refetchInterval: open ? 4000 : false,
  });

  const chatRuns = useMemo(() => {
    const all = heartbeats ?? [];
    return all
      .filter((run) => {
        const ctx = run.contextSnapshot as Record<string, unknown> | null;
        if (!ctx) return false;
        return (
          ctx.wakeReason === CHAT_REASON ||
          (typeof (ctx as Record<string, unknown>).payload === "object" &&
            (ctx as Record<string, unknown>).payload !== null &&
            "userMessage" in
              ((ctx as Record<string, unknown>).payload as Record<string, unknown>))
        );
      })
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [heartbeats]);

  const sendMessage = useMutation({
    mutationFn: async (message: string) => {
      const result = await agentsApi.wakeup(
        agent.id,
        {
          source: "on_demand",
          triggerDetail: "manual",
          reason: CHAT_REASON,
          payload: { userMessage: message },
        },
        agent.companyId,
      );
      if (!("id" in result)) {
        throw new Error(result.message ?? "Agent is paused or unavailable.");
      }
      return result;
    },
    onSuccess: () => {
      setDraft("");
      setSendError(null);
      queryClient.invalidateQueries({
        queryKey: queryKeys.heartbeats(agent.companyId, agent.id),
      });
      textareaRef.current?.focus();
    },
    onError: (err) => {
      setSendError(err instanceof Error ? err.message : "Failed to send message");
    },
  });

  const submit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || sendMessage.isPending) return;
    sendMessage.mutate(trimmed);
  }, [draft, sendMessage]);

  useEffect(() => {
    if (!open) {
      setSendError(null);
      return;
    }
    const id = window.setTimeout(() => textareaRef.current?.focus(), 100);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, chatRuns.length, heartbeats]);

  const agentRoute = agentRouteRef(agent);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <SheetHeader className="border-b">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
              <AgentIcon icon={agent.icon ?? null} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="truncate">Chat with {agent.name}</SheetTitle>
              <SheetDescription className="truncate">
                Messages are delivered as on-demand heartbeats with full agent context.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        >
          {isLoading && chatRuns.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading history...
            </div>
          )}
          {!isLoading && chatRuns.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No chat history yet. Send a message to start the conversation.
            </div>
          )}
          {chatRuns.map((run) => {
            const message = extractChatMessage(run);
            const reply = extractAgentReply(run);
            const inFlight = run.status === "queued" || run.status === "running";
            return (
              <div key={run.id} className="space-y-2">
                {message && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">
                      {message}
                    </div>
                  </div>
                )}
                <div className="flex justify-start">
                  <div className="max-w-[85%] space-y-1">
                    <div className="rounded-lg rounded-bl-sm bg-accent px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words">
                      <div className="flex items-center gap-1.5 mb-1 text-xs">
                        <AgentIcon icon={agent.icon ?? null} className="h-3 w-3" />
                        <span className="font-medium">{agent.name}</span>
                        <span className={statusToneClass(run.status)}>
                          · {statusLabel(run.status)}
                        </span>
                      </div>
                      {reply ? (
                        <div>{reply}</div>
                      ) : inFlight ? (
                        <div className="flex items-center gap-2 text-muted-foreground italic">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Thinking...
                        </div>
                      ) : (
                        <div className="text-muted-foreground italic">
                          {run.status === "failed" || run.status === "timed_out"
                            ? "No reply — run did not complete."
                            : "No reply text in this run."}
                        </div>
                      )}
                    </div>
                    <Link
                      to={`/agents/${agentRoute}/runs/${run.id}`}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground no-underline pl-1"
                    >
                      {relativeTime(run.createdAt)}
                      <ExternalLink className="h-2.5 w-2.5" />
                      <span>open full run</span>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t p-3 space-y-2">
          {sendError && (
            <p className="text-xs text-destructive">{sendError}</p>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={`Message ${agent.name}... (⌘+Enter to send)`}
              className={cn(
                "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
                "min-h-[60px] max-h-[200px] resize-none",
              )}
              disabled={sendMessage.isPending}
            />
            <Button
              onClick={submit}
              disabled={!draft.trim() || sendMessage.isPending}
              size="sm"
            >
              {sendMessage.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
