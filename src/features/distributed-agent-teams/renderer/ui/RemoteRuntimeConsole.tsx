import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { Textarea } from '@renderer/components/ui/textarea';
import {
  AlertTriangle,
  Check,
  FileCode2,
  FileDiff,
  Folder,
  FolderOpen,
  Loader2,
  OctagonX,
  Play,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  SquareTerminal,
  X,
} from 'lucide-react';
import remarkGfm from 'remark-gfm';

import type {
  DistributedRuntimeControlReceiptDto,
  DistributedRuntimeSessionDto,
  SendDistributedRuntimeControlRequest,
} from '../../contracts';

interface RemoteRuntimeConsoleProps {
  session: DistributedRuntimeSessionDto | null;
  insecureLanMode: boolean;
  loading: boolean;
  sending: boolean;
  error: string | null;
  onRefresh: () => void;
  onControl: (
    control: SendDistributedRuntimeControlRequest['control']
  ) => Promise<DistributedRuntimeControlReceiptDto>;
}

interface RuntimeBindingProjection {
  threadId?: string;
  turnId?: string;
  appServerGeneration?: number;
  state?: string;
  turnStatus?: string;
}

interface WorkspaceEntryProjection {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

interface WorkspaceListingProjection {
  path: string;
  entries: WorkspaceEntryProjection[];
}

interface WorkspaceFileProjection {
  path: string;
  content: string;
  revision: string;
  size: number;
  modifiedAt: string;
}

type CodexTranscriptEntryKind = 'assistant' | 'error' | 'notice' | 'reasoning' | 'tool' | 'user';

interface CodexTranscriptEntry {
  id: string;
  kind: CodexTranscriptEntryKind;
  text: string;
  detail?: string;
  order: number;
  submissionError?: string;
  submissionId?: string;
  submissionStatus?: SubmittedMessageStatus;
}

type SubmittedMessageStatus = 'confirmed' | 'failed' | 'pending';

interface SubmittedMessage {
  id: string;
  text: string;
  submittedAt: number;
  status: SubmittedMessageStatus;
  error?: string;
}

const CONTROL_RESULT_TIMEOUT_MS = 30_000;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const eventPayload = (event: DistributedRuntimeSessionDto['events'][number]) =>
  asRecord(event.event.payload);

const parseBinding = (session: DistributedRuntimeSessionDto | null): RuntimeBindingProjection => {
  const snapshot = [...(session?.events ?? [])]
    .reverse()
    .find((event) => event.event.kind === 'runtime.snapshot');
  if (snapshot === undefined) return {};
  return (asRecord(eventPayload(snapshot)?.binding) ?? {}) as RuntimeBindingProjection;
};

const parseControlResult = (
  session: DistributedRuntimeSessionDto | null,
  controlId: string | null
): Record<string, unknown> | null => {
  if (controlId === null) return null;
  const result = [...(session?.events ?? [])]
    .reverse()
    .map(eventPayload)
    .find((payload) => payload?.controlId === controlId);
  return result ?? null;
};

const parseListing = (value: unknown): WorkspaceListingProjection | null => {
  const record = asRecord(value);
  if (record === null || typeof record.path !== 'string' || !Array.isArray(record.entries)) {
    return null;
  }
  const entries = record.entries.flatMap((candidate): WorkspaceEntryProjection[] => {
    const entry = asRecord(candidate);
    if (
      entry === null ||
      typeof entry.name !== 'string' ||
      typeof entry.path !== 'string' ||
      (entry.type !== 'file' && entry.type !== 'directory') ||
      typeof entry.size !== 'number' ||
      typeof entry.modifiedAt !== 'string'
    ) {
      return [];
    }
    return [entry as unknown as WorkspaceEntryProjection];
  });
  return { path: record.path, entries };
};

const parseFile = (value: unknown): WorkspaceFileProjection | null => {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.path !== 'string' ||
    typeof record.content !== 'string' ||
    typeof record.revision !== 'string' ||
    typeof record.size !== 'number' ||
    typeof record.modifiedAt !== 'string'
  ) {
    return null;
  }
  return record as unknown as WorkspaceFileProjection;
};

const itemTextContent = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .flatMap((candidate): string[] => {
          const entry = asRecord(candidate);
          return entry?.type === 'text' && typeof entry.text === 'string' ? [entry.text] : [];
        })
        .join('\n')
    : '';

const commandText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
    return value.join(' ');
  }
  return '';
};

const summarizeToolItem = (
  item: Record<string, unknown>,
  completed: boolean
): Pick<CodexTranscriptEntry, 'detail' | 'kind' | 'text'> | null => {
  if (item.type === 'commandExecution') {
    const command = commandText(item.command) || 'command';
    const status = typeof item.status === 'string' ? item.status : '';
    const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null;
    const prefix = completed
      ? status === 'failed' || (exitCode !== null && exitCode !== 0)
        ? 'Command failed'
        : status === 'declined'
          ? 'Command declined'
          : 'Ran'
      : 'Running';
    return {
      kind: 'tool',
      text: `${prefix} ${command}`,
      detail: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput.trim() : undefined,
    };
  }
  if (item.type === 'fileChange') {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return {
      kind: 'tool',
      text: `${completed ? 'Updated' : 'Updating'} ${changes.length} file${changes.length === 1 ? '' : 's'}`,
    };
  }
  if (item.type === 'mcpToolCall') {
    const server = typeof item.server === 'string' ? item.server : 'MCP';
    const tool = typeof item.tool === 'string' ? item.tool : 'tool';
    return { kind: 'tool', text: `${completed ? 'Called' : 'Calling'} ${server}.${tool}` };
  }
  if (item.type === 'dynamicToolCall') {
    const tool = typeof item.tool === 'string' ? item.tool : 'tool';
    return { kind: 'tool', text: `${completed ? 'Called' : 'Calling'} ${tool}` };
  }
  if (item.type === 'webSearch') {
    const query = typeof item.query === 'string' ? item.query : 'the web';
    return { kind: 'tool', text: `Searched for ${query}` };
  }
  if (item.type === 'collabToolCall') {
    const tool = typeof item.tool === 'string' ? item.tool : 'agent';
    return { kind: 'tool', text: `${completed ? 'Finished' : 'Running'} ${tool}` };
  }
  if (item.type === 'imageView') {
    return {
      kind: 'tool',
      text: `Viewed ${typeof item.path === 'string' ? item.path : 'image'}`,
    };
  }
  if (item.type === 'contextCompaction') {
    return { kind: 'notice', text: 'Conversation context compacted' };
  }
  return null;
};

const projectCodexTranscript = (
  session: DistributedRuntimeSessionDto | null,
  submittedMessages: SubmittedMessage[]
): CodexTranscriptEntry[] => {
  const entries: CodexTranscriptEntry[] = [];
  const itemIndexes = new Map<string, number>();
  const appendOrReplaceItem = (
    itemId: string,
    entry: Omit<CodexTranscriptEntry, 'id' | 'order'>,
    eventId: string,
    order: number
  ): void => {
    const index = itemIndexes.get(itemId);
    if (index === undefined) {
      itemIndexes.set(itemId, entries.length);
      entries.push({ ...entry, id: eventId, order });
      return;
    }
    const previous = entries[index];
    if (previous !== undefined) entries[index] = { ...previous, ...entry };
  };

  for (const event of session?.events ?? []) {
    if (event.event.kind !== 'app-server.notification') continue;
    const payload = eventPayload(event);
    const method = typeof payload?.method === 'string' ? payload.method : '';
    const params = asRecord(payload?.params);
    const order = Date.parse(event.receivedAt) || event.cursor;

    if (method === 'item/started' || method === 'item/completed') {
      const item = asRecord(params?.item);
      if (item === null) continue;
      const itemId = typeof item.id === 'string' ? item.id : event.eventId;
      const completed = method === 'item/completed';
      if (item.type === 'userMessage') {
        const text = itemTextContent(item.content);
        if (text) appendOrReplaceItem(itemId, { kind: 'user', text }, event.eventId, order);
        continue;
      }
      if (item.type === 'agentMessage' || item.type === 'plan') {
        const text = typeof item.text === 'string' ? item.text : '';
        if (text) appendOrReplaceItem(itemId, { kind: 'assistant', text }, event.eventId, order);
        continue;
      }
      if (item.type === 'reasoning') {
        const reasoningItemId = `reasoning:${itemId}`;
        const summary = Array.isArray(item.summary)
          ? item.summary
              .map((part) => (typeof part === 'string' ? part : asRecord(part)?.text))
              .filter((part): part is string => typeof part === 'string')
              .join('\n')
          : '';
        if (summary) {
          appendOrReplaceItem(
            reasoningItemId,
            { kind: 'reasoning', text: summary },
            event.eventId,
            order
          );
        }
        continue;
      }
      const tool = summarizeToolItem(item, completed);
      if (tool !== null) appendOrReplaceItem(itemId, tool, event.eventId, order);
      continue;
    }

    if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') {
      const delta = typeof params?.delta === 'string' ? params.delta : '';
      if (!delta) continue;
      const itemId = typeof params?.itemId === 'string' ? params.itemId : 'agent-stream';
      const index = itemIndexes.get(itemId);
      if (index === undefined) {
        appendOrReplaceItem(itemId, { kind: 'assistant', text: delta }, event.eventId, order);
      } else {
        const previous = entries[index];
        if (previous !== undefined) entries[index] = { ...previous, text: previous.text + delta };
      }
      continue;
    }

    if (method === 'item/reasoning/summaryTextDelta') {
      const delta = typeof params?.delta === 'string' ? params.delta : '';
      if (!delta) continue;
      const itemId =
        typeof params?.itemId === 'string' ? `reasoning:${params.itemId}` : 'reasoning-stream';
      const index = itemIndexes.get(itemId);
      if (index === undefined) {
        appendOrReplaceItem(itemId, { kind: 'reasoning', text: delta }, event.eventId, order);
      } else {
        const previous = entries[index];
        if (previous !== undefined) entries[index] = { ...previous, text: previous.text + delta };
      }
      continue;
    }

    if (method === 'item/commandExecution/outputDelta') {
      const delta = typeof params?.delta === 'string' ? params.delta : '';
      const itemId = typeof params?.itemId === 'string' ? params.itemId : '';
      const index = itemIndexes.get(itemId);
      const previous = index === undefined ? undefined : entries[index];
      if (delta && index !== undefined && previous !== undefined) {
        entries[index] = { ...previous, detail: `${previous.detail ?? ''}${delta}` };
      }
      continue;
    }

    if (method === 'warning' || method === 'configWarning') {
      const text =
        typeof params?.message === 'string'
          ? params.message
          : typeof params?.summary === 'string'
            ? params.summary
            : '';
      if (text) entries.push({ id: event.eventId, kind: 'notice', text, order });
      continue;
    }

    if (method === 'error') {
      const eventError = asRecord(params?.error);
      const text =
        typeof eventError?.message === 'string' ? eventError.message : 'Codex turn failed';
      entries.push({ id: event.eventId, kind: 'error', text, order });
    }
  }

  const serverUserMessages = new Set(
    entries.filter((entry) => entry.kind === 'user').map((entry) => entry.text.trim())
  );
  for (const submitted of submittedMessages) {
    if (serverUserMessages.has(submitted.text.trim())) continue;
    entries.push({
      id: `submitted:${submitted.id}`,
      kind: 'user',
      text: submitted.text,
      order: submitted.submittedAt,
      submissionError: submitted.error,
      submissionId: submitted.id,
      submissionStatus: submitted.status,
    });
  }
  return entries.sort((left, right) => left.order - right.order);
};

const CODEX_MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-4 font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 font-semibold first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  code: ({ children, className }) => (
    <code className={`rounded bg-white/[0.07] px-1 py-0.5 text-[12px] ${className ?? ''}`}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[12px] leading-5">
      {children}
    </pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200"
    >
      {children}
    </a>
  ),
};

const approvalDescription = (method: string, value: unknown): { title: string; detail: string } => {
  const params = asRecord(value);
  if (method === 'item/commandExecution/requestApproval') {
    return {
      title: typeof params?.reason === 'string' ? params.reason : 'Run this command?',
      detail: commandText(params?.command) || 'Command details unavailable',
    };
  }
  if (method === 'item/fileChange/requestApproval') {
    return {
      title: typeof params?.reason === 'string' ? params.reason : 'Apply these file changes?',
      detail: typeof params?.grantRoot === 'string' ? params.grantRoot : 'Workspace files',
    };
  }
  return {
    title: 'Codex needs your approval',
    detail: typeof params?.reason === 'string' ? params.reason : 'Review this action to continue',
  };
};

export const RemoteRuntimeConsole = ({
  session,
  insecureLanMode,
  loading,
  sending,
  error,
  onRefresh,
  onControl,
}: RemoteRuntimeConsoleProps): React.JSX.Element => {
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('console');
  const [messageHistory, setMessageHistory] = useState<string[]>([]);
  const [submittedMessages, setSubmittedMessages] = useState<SubmittedMessage[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [directoryPath, setDirectoryPath] = useState('');
  const [listingControlId, setListingControlId] = useState<string | null>(null);
  const [fileControlId, setFileControlId] = useState<string | null>(null);
  const [saveControlId, setSaveControlId] = useState<string | null>(null);
  const [openedFile, setOpenedFile] = useState<WorkspaceFileProjection | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [resolvedApprovals, setResolvedApprovals] = useState<Set<number | string>>(() => new Set());
  const outputRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const runtimeScopeRef = useRef<string | null>(null);
  const submissionTimeoutsRef = useRef(new Map<string, number>());
  const binding = parseBinding(session);
  const listingResult = parseControlResult(session, listingControlId);
  const fileResult = parseControlResult(session, fileControlId);
  const saveResult = parseControlResult(session, saveControlId);
  const listing = parseListing(listingResult?.result);
  const loadedFile = parseFile(fileResult?.result);
  const savedFile = parseFile(saveResult?.result);
  const hasCapability = (
    capability: DistributedRuntimeSessionDto['capabilities'][number]
  ): boolean => session?.capabilities.includes(capability) === true;
  const canSteer =
    binding.state === 'active' && binding.turnId !== undefined && hasCapability('turn.steer');
  const canStartTurn =
    binding.state === 'completed' && binding.threadId !== undefined && hasCapability('turn.start');
  const pendingSubmission = submittedMessages.some((submitted) => submitted.status === 'pending');
  const runtimeScopeKey = session
    ? [
        session.scope.teamId,
        session.scope.nodeId,
        session.scope.assignmentId,
        session.scope.attemptId,
        session.scope.leaseId,
        session.scope.leaseEpoch,
      ].join(':')
    : null;

  useEffect(() => {
    if (runtimeScopeKey === null) return;
    if (runtimeScopeRef.current !== null && runtimeScopeRef.current !== runtimeScopeKey) {
      for (const timeout of submissionTimeoutsRef.current.values()) window.clearTimeout(timeout);
      submissionTimeoutsRef.current.clear();
      setMessage('');
      setMessageHistory([]);
      setSubmittedMessages([]);
      setHistoryIndex(null);
    }
    runtimeScopeRef.current = runtimeScopeKey;
  }, [runtimeScopeKey]);

  useEffect(
    () => () => {
      for (const timeout of submissionTimeoutsRef.current.values()) window.clearTimeout(timeout);
      submissionTimeoutsRef.current.clear();
    },
    []
  );

  useEffect(() => {
    const resultsByControlId = new Map<string, Record<string, unknown>>();
    for (const event of session?.events ?? []) {
      if (event.event.kind !== 'control.result') continue;
      const payload = eventPayload(event);
      if (typeof payload?.controlId === 'string')
        resultsByControlId.set(payload.controlId, payload);
    }
    const serverUserMessages = new Set(
      projectCodexTranscript(session, [])
        .filter((entry) => entry.kind === 'user')
        .map((entry) => entry.text.trim())
    );
    for (const controlId of resultsByControlId.keys()) {
      const timeout = submissionTimeoutsRef.current.get(controlId);
      if (timeout !== undefined) window.clearTimeout(timeout);
      submissionTimeoutsRef.current.delete(controlId);
    }
    setSubmittedMessages((current) => {
      let changed = false;
      const next = current.map((submitted): SubmittedMessage => {
        if (submitted.status !== 'pending') return submitted;
        const result = resultsByControlId.get(submitted.id);
        if (result?.ok === true || serverUserMessages.has(submitted.text.trim())) {
          changed = true;
          return { ...submitted, status: 'confirmed', error: undefined };
        }
        if (result?.ok === false) {
          changed = true;
          return {
            ...submitted,
            status: 'failed',
            error:
              typeof result.error === 'string'
                ? result.error
                : 'The remote worker rejected this input.',
          };
        }
        return submitted;
      });
      return changed ? next : current;
    });
  }, [session, submittedMessages.length]);

  useEffect(() => {
    const file = savedFile ?? loadedFile;
    if (file === null) return;
    setOpenedFile(file);
    setEditorContent(file.content);
  }, [loadedFile, savedFile]);

  const transcript = useMemo(
    () => projectCodexTranscript(session, submittedMessages),
    [session, submittedMessages]
  );
  const approvals = useMemo(() => {
    const requestsById = new Map<
      number | string,
      { id: number | string; method: string; params: unknown }
    >();
    for (const event of session?.events ?? []) {
      if (event.event.kind !== 'app-server.request') continue;
      const payload = eventPayload(event);
      if (
        (typeof payload?.id === 'number' || typeof payload?.id === 'string') &&
        typeof payload.method === 'string'
      ) {
        requestsById.set(payload.id, {
          id: payload.id,
          method: payload.method,
          params: payload.params,
        });
      }
    }
    return [...requestsById.values()];
  }, [session?.events]);
  const serverResolvedApprovals = useMemo(
    () =>
      new Set(
        (session?.events ?? []).flatMap((event): Array<number | string> => {
          if (event.event.kind !== 'app-server.notification') return [];
          const payload = eventPayload(event);
          if (payload?.method !== 'serverRequest/resolved') return [];
          const params = asRecord(payload.params);
          return typeof params?.requestId === 'number' || typeof params?.requestId === 'string'
            ? [params.requestId]
            : [];
        })
      ),
    [session?.events]
  );
  const diffs = useMemo(
    () =>
      (session?.events ?? []).flatMap((event) => {
        if (event.event.kind !== 'app-server.notification') return [];
        const payload = eventPayload(event);
        if (payload?.method !== 'turn/diff/updated') return [];
        const params = asRecord(payload.params);
        const diff =
          typeof params?.diff === 'string'
            ? params.diff
            : typeof params?.unifiedDiff === 'string'
              ? params.unifiedDiff
              : JSON.stringify(params, null, 2);
        return [{ id: event.eventId, diff, occurredAt: event.occurredAt }];
      }),
    [session?.events]
  );

  useEffect(() => {
    const output = outputRef.current;
    if (output !== null && followOutputRef.current) output.scrollTop = output.scrollHeight;
  }, [session?.nextCursor, transcript.length]);

  const submitMessage = async (text: string, replacedSubmissionId?: string): Promise<void> => {
    if (
      !text.trim() ||
      binding.threadId === undefined ||
      binding.appServerGeneration === undefined ||
      (!canSteer && !canStartTurn) ||
      pendingSubmission
    ) {
      return;
    }
    const submittedMessage = text.trim();
    const controlId = crypto.randomUUID();
    const submittedAt = Date.now();
    let submission: SubmittedMessage = {
      id: controlId,
      text: submittedMessage,
      submittedAt,
      status: 'pending',
    };
    try {
      await onControl(
        canStartTurn
          ? {
              controlId,
              type: 'turn.start',
              payload: {
                threadId: binding.threadId,
                appServerGeneration: binding.appServerGeneration,
                message: submittedMessage,
              },
            }
          : {
              controlId,
              type: 'turn.steer',
              payload: {
                threadId: binding.threadId,
                expectedTurnId: binding.turnId!,
                appServerGeneration: binding.appServerGeneration,
                message: submittedMessage,
              },
            }
      );
      const timeout = window.setTimeout(() => {
        submissionTimeoutsRef.current.delete(controlId);
        setSubmittedMessages((current) =>
          current.map((submitted) =>
            submitted.id === controlId && submitted.status === 'pending'
              ? {
                  ...submitted,
                  status: 'failed',
                  error: 'The remote worker did not confirm this input. Retry when it is ready.',
                }
              : submitted
          )
        );
      }, CONTROL_RESULT_TIMEOUT_MS);
      submissionTimeoutsRef.current.set(controlId, timeout);
    } catch (controlError) {
      submission = {
        ...submission,
        status: 'failed',
        error: controlError instanceof Error ? controlError.message : 'Remote input failed.',
      };
    }
    setSubmittedMessages((current) => [
      ...current.filter((submitted) => submitted.id !== replacedSubmissionId),
      submission,
    ]);
    setMessageHistory((current) =>
      [...current.filter((item) => item !== submittedMessage), submittedMessage].slice(-50)
    );
    setHistoryIndex(null);
    setMessage('');
  };

  const sendSteer = async (): Promise<void> => await submitMessage(message);

  const handleConsoleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendSteer();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (message.includes('\n') || messageHistory.length === 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp') {
      const nextIndex =
        historyIndex === null ? messageHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setMessage(messageHistory[nextIndex] ?? '');
      return;
    }
    if (historyIndex === null) return;
    const nextIndex = historyIndex + 1;
    if (nextIndex >= messageHistory.length) {
      setHistoryIndex(null);
      setMessage('');
    } else {
      setHistoryIndex(nextIndex);
      setMessage(messageHistory[nextIndex] ?? '');
    }
  };

  const resolveApproval = async (
    approvalRequestId: number | string,
    decision: 'accept' | 'decline'
  ): Promise<void> => {
    await onControl({
      controlId: crypto.randomUUID(),
      type: 'approval.resolve',
      payload: { approvalRequestId, decision },
    });
    setResolvedApprovals((current) => new Set(current).add(approvalRequestId));
  };

  const requestListing = async (path: string): Promise<void> => {
    const controlId = crypto.randomUUID();
    setListingControlId(controlId);
    setDirectoryPath(path);
    await onControl({ controlId, type: 'filesystem.list', payload: { path } });
  };

  const requestFile = async (path: string): Promise<void> => {
    const controlId = crypto.randomUUID();
    setFileControlId(controlId);
    await onControl({ controlId, type: 'filesystem.read', payload: { path } });
  };

  const saveFile = async (): Promise<void> => {
    if (openedFile === null) return;
    const controlId = crypto.randomUUID();
    setSaveControlId(controlId);
    await onControl({
      controlId,
      type: 'filesystem.write',
      payload: {
        path: openedFile.path,
        content: editorContent,
        expectedRevision: openedFile.revision,
      },
    });
  };

  if (insecureLanMode) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Authenticated remote controls are disabled</p>
          <p className="mt-1 text-xs text-amber-200/80">
            Configure separate Relay manager and Worker credentials before enabling terminal input,
            approvals, or workspace files.
          </p>
        </div>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border bg-[#090b10] p-4 text-sm text-neutral-300">
        <SquareTerminal className="mt-0.5 size-4 shrink-0 text-neutral-500" />
        <div className="flex-1">
          <p className="font-medium">Worker runtime is not active yet</p>
          <p className="mt-1 text-xs text-neutral-500">
            Start the team to accept its assignments, acquire execution leases, and launch an
            authenticated Codex App Server thread and turn.
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={onRefresh}>
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border border-white/[0.08] bg-[#141416] shadow-inner"
      style={{ fontFamily: 'Menlo, Monaco, "Courier New", monospace' }}
    >
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-3 py-2">
        <div
          className="flex items-center gap-2 text-xs text-neutral-300"
          aria-label="Authenticated remote Codex session"
        >
          <Sparkles className="size-3.5 text-emerald-400" />
          <span className="font-semibold text-neutral-100">Codex</span>
          <span className="text-neutral-600">remote</span>
          <span className="size-1.5 rounded-full bg-emerald-400" />
          <span className="text-neutral-500">
            {binding.state === 'active'
              ? 'working'
              : binding.state === 'completed'
                ? 'ready'
                : binding.state}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200"
          aria-label="Refresh remote console"
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          <AlertTriangle className="size-3.5" /> {error}
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="border-b border-white/[0.08] px-3 py-1.5">
          <TabsList className="h-7 bg-white/[0.04]">
            <TabsTrigger value="console">
              <SquareTerminal className="mr-1.5 size-3.5" /> Console
            </TabsTrigger>
            <TabsTrigger value="changes">
              <FileDiff className="mr-1.5 size-3.5" /> Changes
            </TabsTrigger>
            <TabsTrigger value="files">
              <FolderOpen className="mr-1.5 size-3.5" /> Files
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="console" className="m-0">
          <div
            ref={outputRef}
            data-testid="remote-runtime-output"
            className="max-h-[52vh] min-h-72 overflow-auto px-4 py-5 text-[13px] leading-5"
            onScroll={(event) => {
              const output = event.currentTarget;
              followOutputRef.current =
                output.scrollHeight - output.scrollTop - output.clientHeight < 24;
            }}
          >
            {transcript.length === 0 ? (
              <p className="p-8 text-center text-neutral-600">
                {loading ? 'Connecting to Codex…' : 'Waiting for Codex output…'}
              </p>
            ) : (
              <div className="space-y-4">
                {transcript.map((entry) => {
                  if (entry.kind === 'user') {
                    return (
                      <div key={entry.id} className="flex gap-3 text-neutral-100">
                        <span className="shrink-0 font-semibold text-emerald-400">›</span>
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap break-words">{entry.text}</p>
                          {entry.submissionStatus === 'pending' ? (
                            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-neutral-500">
                              <Loader2 className="size-3 animate-spin" /> Waiting for worker…
                            </p>
                          ) : null}
                          {entry.submissionStatus === 'failed' ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-red-300">
                              <span>Not delivered — {entry.submissionError}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[10px] text-red-200 hover:bg-red-500/10"
                                disabled={
                                  (!canSteer && !canStartTurn) || pendingSubmission || sending
                                }
                                onClick={() => void submitMessage(entry.text, entry.submissionId)}
                              >
                                Retry
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }
                  if (entry.kind === 'assistant') {
                    return (
                      <div key={entry.id} className="flex gap-3 text-neutral-200">
                        <span className="shrink-0 text-emerald-400">•</span>
                        <div className="min-w-0 flex-1 break-words">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={CODEX_MARKDOWN_COMPONENTS}
                          >
                            {entry.text}
                          </ReactMarkdown>
                        </div>
                      </div>
                    );
                  }
                  const tone =
                    entry.kind === 'error'
                      ? 'text-red-300'
                      : entry.kind === 'notice'
                        ? 'text-amber-300'
                        : entry.kind === 'reasoning'
                          ? 'text-neutral-500'
                          : 'text-sky-300';
                  const marker = entry.kind === 'error' ? '×' : entry.kind === 'notice' ? '!' : '•';
                  return (
                    <div key={entry.id} className={`flex gap-3 ${tone}`}>
                      <span className="shrink-0">{marker}</span>
                      <div className="min-w-0 flex-1">
                        <p className={entry.kind === 'reasoning' ? 'italic' : undefined}>
                          {entry.text}
                        </p>
                        {entry.detail ? (
                          <details className="mt-1 text-neutral-500">
                            <summary className="cursor-pointer select-none hover:text-neutral-300">
                              Show output
                            </summary>
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-3 text-[11px] leading-4 text-neutral-400">
                              {entry.detail}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {approvals
              .filter(
                (approval) =>
                  !resolvedApprovals.has(approval.id) && !serverResolvedApprovals.has(approval.id)
              )
              .map((approval) => {
                const description = approvalDescription(approval.method, approval.params);
                return (
                  <div
                    key={approval.id}
                    className="mt-5 border-l-2 border-amber-400/70 bg-amber-400/[0.06] px-4 py-3"
                  >
                    <p className="font-semibold text-amber-200">{description.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-300">
                      {description.detail}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        disabled={!hasCapability('approval.resolve') || sending}
                        onClick={() => void resolveApproval(approval.id, 'accept')}
                      >
                        <Check className="size-3.5" /> Approve once
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!hasCapability('approval.resolve') || sending}
                        onClick={() => void resolveApproval(approval.id, 'decline')}
                      >
                        <X className="size-3.5" /> Deny
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="border-t border-white/[0.08] p-3">
            <div className="flex items-end gap-2 rounded-md border border-white/10 bg-white/[0.035] px-3 py-2 focus-within:border-emerald-400/50">
              <span className="pb-2 text-sm font-semibold text-emerald-400">›</span>
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={handleConsoleKeyDown}
                placeholder="Ask Codex to continue…"
                rows={2}
                maxLength={20_000}
                disabled={(!canSteer && !canStartTurn) || pendingSubmission || sending}
                className="min-h-10 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-[13px] text-neutral-100 shadow-none focus-visible:ring-0"
              />
              <Button
                size="sm"
                className="size-8 shrink-0 p-0"
                aria-label="Send input"
                disabled={
                  (!canSteer && !canStartTurn) || !message.trim() || pendingSubmission || sending
                }
                onClick={() => void sendSteer()}
              >
                {sending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] text-neutral-600">
                Enter sends · Shift+Enter adds a line · ↑/↓ recalls input
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-neutral-500 hover:bg-white/[0.05] hover:text-red-300"
                disabled={
                  !hasCapability('turn.interrupt') ||
                  binding.state !== 'active' ||
                  binding.turnId === undefined ||
                  sending
                }
                onClick={() =>
                  void onControl({
                    controlId: crypto.randomUUID(),
                    type: 'turn.interrupt',
                    payload: { reason: 'user_requested_from_remote_console' },
                  })
                }
              >
                <OctagonX className="size-3.5" /> Interrupt
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="changes" className="m-0 p-3">
          <div className="mb-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={
                !hasCapability('review.start') ||
                binding.state !== 'active' ||
                binding.threadId === undefined ||
                sending
              }
              onClick={() =>
                binding.threadId &&
                void onControl({
                  controlId: crypto.randomUUID(),
                  type: 'review.start',
                  payload: { threadId: binding.threadId },
                })
              }
            >
              <Play className="size-3.5" /> Review uncommitted changes
            </Button>
          </div>
          {diffs.length === 0 ? (
            <p className="p-8 text-center text-xs text-neutral-500">No streamed changes yet.</p>
          ) : (
            diffs.map((diff) => (
              <pre
                key={diff.id}
                className="mb-3 max-h-[48vh] overflow-auto whitespace-pre text-[10px] leading-4 text-neutral-300"
              >
                {diff.diff}
              </pre>
            ))
          )}
        </TabsContent>

        <TabsContent value="files" className="m-0 p-3">
          <div className="flex gap-2">
            <Input
              value={directoryPath}
              onChange={(event) => setDirectoryPath(event.target.value)}
              placeholder="Workspace-relative directory"
              disabled={!hasCapability('filesystem.read') || sending}
              className="border-white/10 bg-white/5 text-neutral-100"
            />
            <Button
              variant="outline"
              disabled={!hasCapability('filesystem.read') || sending}
              onClick={() => void requestListing(directoryPath)}
            >
              <FolderOpen className="size-3.5" /> Open
            </Button>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="max-h-[48vh] overflow-auto rounded border border-white/10">
              {(listing?.entries ?? []).map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  disabled={!hasCapability('filesystem.read') || sending}
                  className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2 text-left text-xs text-neutral-300 hover:bg-white/5"
                  onClick={() =>
                    void (entry.type === 'directory'
                      ? requestListing(entry.path)
                      : requestFile(entry.path))
                  }
                >
                  {entry.type === 'directory' ? (
                    <Folder className="size-3.5 text-amber-300" />
                  ) : (
                    <FileCode2 className="size-3.5 text-sky-300" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
              {listing === null ? (
                <p className="p-6 text-center text-xs text-neutral-500">
                  Open a workspace directory to browse files.
                </p>
              ) : null}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[10px] text-neutral-400">
                  {openedFile?.path ?? 'No file selected'}
                </span>
                <Button
                  size="sm"
                  disabled={
                    !hasCapability('filesystem.write') ||
                    openedFile === null ||
                    editorContent === openedFile.content ||
                    sending
                  }
                  onClick={() => void saveFile()}
                >
                  <Save className="size-3.5" /> Save
                </Button>
              </div>
              <Textarea
                value={editorContent}
                onChange={(event) => setEditorContent(event.target.value)}
                rows={18}
                disabled={!hasCapability('filesystem.write') || openedFile === null || sending}
                className="min-h-80 resize-y border-white/10 bg-black/30 font-mono text-xs text-neutral-200"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
