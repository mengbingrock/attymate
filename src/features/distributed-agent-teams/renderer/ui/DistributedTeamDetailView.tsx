import { useId, useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { Textarea } from '@renderer/components/ui/textarea';
import {
  Activity,
  AlertTriangle,
  Clock3,
  ListTodo,
  MessageSquare,
  Network,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Server,
  SquareTerminal,
  Users,
} from 'lucide-react';

import { RemoteRuntimeConsole } from './RemoteRuntimeConsole';

import type {
  CreateRemoteAssignmentRequest,
  DistributedMembershipRouteDto,
  DistributedRuntimeControlReceiptDto,
  DistributedRuntimeSessionDto,
  DistributedWorkerDto,
  SendDistributedRuntimeControlRequest,
} from '../../contracts';
import type {
  DistributedTeamActivityEntry,
  DistributedTeamAssignmentDetail,
  DistributedTeamDetailModel,
} from '../adapters/buildDistributedTeamDetail';
import type { LucideIcon } from 'lucide-react';

interface DistributedTeamDetailViewProps {
  model: DistributedTeamDetailModel;
  relayUrl: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  mutationError: string | null;
  creatingAssignment: boolean;
  startingTeam: boolean;
  insecureLanMode: boolean;
  selectedRuntimeNodeId: string | null;
  runtimeUnavailableDescription?: string;
  runtimeSession: DistributedRuntimeSessionDto | null;
  runtimeLoading: boolean;
  runtimeSending: boolean;
  runtimeError: string | null;
  onRefresh: () => void;
  onSelectRuntimeNode: (nodeId: string | null) => void;
  onRuntimeControl: (
    control: SendDistributedRuntimeControlRequest['control']
  ) => Promise<DistributedRuntimeControlReceiptDto>;
  onCreateAssignment: (request: CreateRemoteAssignmentRequest) => Promise<void>;
  onStartTeam: () => void;
}

type DetailTab = 'overview' | 'assignments' | 'activity' | 'messages' | 'debug';

const shortId = (value: string): string =>
  value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;

const formatTime = (value: string): string => {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(timestamp);
};

const stateTone = (state: DistributedTeamAssignmentDetail['state']): string => {
  if (state === 'completed' || state === 'ready_review') return 'text-emerald-400';
  if (state === 'failed' || state === 'rejected' || state === 'fenced') return 'text-red-400';
  if (state === 'running' || state === 'verifying' || state === 'committing') {
    return 'text-blue-400';
  }
  return 'text-amber-400';
};

const assignmentColumn = (state: DistributedTeamAssignmentDetail['state']): string => {
  if (['offered', 'proposed', 'deferred'].includes(state)) return 'Offered';
  if (['accepted', 'queued', 'leased', 'preparing_workspace'].includes(state)) return 'Queued';
  if (
    [
      'running',
      'waiting_local_approval',
      'verifying',
      'committing',
      'awaiting_push',
      'reporting',
    ].includes(state)
  ) {
    return 'In progress';
  }
  if (['ready_review', 'completed'].includes(state)) return 'Done';
  return 'Stopped';
};

const WorkerPanel = ({
  worker,
  route,
  onOpenDebug,
}: {
  worker: DistributedWorkerDto;
  route?: DistributedMembershipRouteDto;
  onOpenDebug: (nodeId: string) => void;
}): React.JSX.Element => (
  <article className="rounded-lg border border-border bg-surface-raised p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${worker.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`}
          />
          <h3 className="truncate text-sm font-semibold text-text">{worker.label}</h3>
        </div>
        <p className="mt-1 font-mono text-[10px] text-text-muted">{shortId(worker.nodeId)}</p>
      </div>
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-emerald-400">
        {worker.status}
      </span>
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
      <div>
        <dt className="text-text-muted">Heartbeat</dt>
        <dd className="mt-0.5 text-text-secondary">{formatTime(worker.lastHeartbeatAt)}</dd>
      </div>
      <div>
        <dt className="text-text-muted">Sequence</dt>
        <dd className="mt-0.5 text-text-secondary">{worker.lastHeartbeatSequence}</dd>
      </div>
      <div>
        <dt className="text-text-muted">Membership</dt>
        <dd className="mt-0.5 font-mono text-text-secondary">
          {route ? shortId(route.membershipId) : 'Unbound'}
        </dd>
      </div>
      <div>
        <dt className="text-text-muted">Workspace</dt>
        <dd className="mt-0.5 font-mono text-text-secondary">
          {route ? shortId(route.workspaceId) : 'Unbound'}
        </dd>
      </div>
      <div className="col-span-2">
        <dt className="text-text-muted">Remote runtime</dt>
        <dd className="mt-0.5 text-text-secondary">
          {worker.runtimeCapabilities?.includes('turn.steer')
            ? 'Interactive Codex App Server'
            : 'Diagnostics only'}
        </dd>
      </div>
    </dl>
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mt-4 w-full"
      onClick={() => onOpenDebug(worker.nodeId)}
    >
      <SquareTerminal className="size-3.5" />
      Console
    </Button>
  </article>
);

const AssignmentCard = ({
  assignment,
}: {
  assignment: DistributedTeamAssignmentDetail;
}): React.JSX.Element => (
  <article className="rounded-md border border-border bg-surface p-3">
    <div className="flex items-start justify-between gap-2">
      <h4 className="text-xs font-semibold text-text">{assignment.title}</h4>
      <span className={`shrink-0 text-[9px] font-medium uppercase ${stateTone(assignment.state)}`}>
        {assignment.state.replaceAll('_', ' ')}
      </span>
    </div>
    {assignment.description ? (
      <p className="mt-2 line-clamp-3 text-[11px] text-text-muted">{assignment.description}</p>
    ) : null}
    <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-text-muted">
      <span className="truncate">{assignment.workerLabel}</span>
      <span className="font-mono">{shortId(assignment.assignmentId)}</span>
    </div>
    <p className="mt-1 truncate text-[10px] text-text-muted">{assignment.reason}</p>
  </article>
);

const CreateAssignmentDialog = ({
  open,
  teamId,
  workers,
  routes,
  creating,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  teamId: string;
  workers: DistributedWorkerDto[];
  routes: DistributedMembershipRouteDto[];
  creating: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (request: CreateRemoteAssignmentRequest) => Promise<void>;
}): React.JSX.Element => {
  const workerFieldId = useId();
  const titleFieldId = useId();
  const descriptionFieldId = useId();
  const [targetNodeId, setTargetNodeId] = useState(workers[0]?.nodeId ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const submit = async (): Promise<void> => {
    const route = routes.find((candidate) => candidate.nodeId === targetNodeId);
    try {
      await onCreate({
        targetNodeId,
        teamId,
        title,
        ...(description.trim() ? { description } : {}),
        ...(route ? { membershipId: route.membershipId, workspaceId: route.workspaceId } : {}),
      });
      setTitle('');
      setDescription('');
      onOpenChange(false);
    } catch {
      // The parent surfaces the relay error while keeping the form open for retry.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create remote assignment</DialogTitle>
          <DialogDescription>
            Route work to a connected worker through relay protocol v2.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label htmlFor={workerFieldId} className="block space-y-1.5 text-xs text-text-secondary">
            Worker
            <Select value={targetNodeId} onValueChange={setTargetNodeId}>
              <SelectTrigger id={workerFieldId}>
                <SelectValue placeholder="Select a worker" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((worker) => (
                  <SelectItem key={worker.nodeId} value={worker.nodeId}>
                    {worker.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label htmlFor={titleFieldId} className="block space-y-1.5 text-xs text-text-secondary">
            Title
            <Input
              id={titleFieldId}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={240}
            />
          </label>
          <label
            htmlFor={descriptionFieldId}
            className="block space-y-1.5 text-xs text-text-secondary"
          >
            Description
            <Textarea
              id={descriptionFieldId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              maxLength={20_000}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={creating || !targetNodeId || !title.trim()}
            onClick={() => void submit()}
          >
            {creating ? 'Creating…' : 'Create assignment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ActivityList = ({
  entries,
}: {
  entries: DistributedTeamActivityEntry[];
}): React.JSX.Element => (
  <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
    {entries.length === 0 ? (
      <p className="p-8 text-center text-sm text-text-muted">No relay activity yet.</p>
    ) : (
      entries.map((entry) => (
        <article key={entry.id} className="flex gap-3 border-b border-border p-3 last:border-b-0">
          {entry.kind === 'command' ? (
            <Radio className="mt-0.5 size-4 shrink-0 text-blue-400" />
          ) : (
            <Activity className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-mono text-xs text-text">{entry.type}</p>
              <span className="text-[10px] uppercase text-text-muted">{entry.status}</span>
            </div>
            <p className="mt-1 text-[10px] text-text-muted">
              {shortId(entry.nodeId)} · {formatTime(entry.timestamp)}
              {entry.assignmentId ? ` · ${shortId(entry.assignmentId)}` : ''}
            </p>
          </div>
        </article>
      ))
    )}
  </div>
);

export const DistributedTeamDetailView = ({
  model,
  relayUrl,
  loading,
  refreshing,
  error,
  mutationError,
  creatingAssignment,
  startingTeam,
  insecureLanMode,
  selectedRuntimeNodeId,
  runtimeUnavailableDescription,
  runtimeSession,
  runtimeLoading,
  runtimeSending,
  runtimeError,
  onRefresh,
  onSelectRuntimeNode,
  onRuntimeControl,
  onCreateAssignment,
  onStartTeam,
}: DistributedTeamDetailViewProps): React.JSX.Element => {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [createOpen, setCreateOpen] = useState(false);
  const assignmentsByColumn = useMemo(() => {
    const columns = new Map<string, DistributedTeamAssignmentDetail[]>();
    for (const assignment of model.assignments) {
      const column = assignmentColumn(assignment.state);
      columns.set(column, [...(columns.get(column) ?? []), assignment]);
    }
    return columns;
  }, [model.assignments]);
  const openDebug = (nodeId: string): void => {
    onSelectRuntimeNode(nodeId);
    setActiveTab('debug');
  };
  const connectedWorkers = model.workers.filter((worker) => worker.status === 'connected').length;
  const startableAssignments = model.assignments.filter((assignment) =>
    ['proposed', 'deferred'].includes(assignment.state)
  );
  const bootingAssignments = model.assignments.filter((assignment) =>
    ['accepted', 'queued', 'leased', 'preparing_workspace'].includes(assignment.state)
  );
  const activeAssignments = model.assignments.filter((assignment) =>
    [
      'running',
      'waiting_local_approval',
      'verifying',
      'committing',
      'awaiting_push',
      'reporting',
    ].includes(assignment.state)
  );
  const teamState =
    startingTeam || bootingAssignments.length > 0
      ? 'starting'
      : activeAssignments.length > 0 && startableAssignments.length === 0
        ? 'active'
        : 'idle';
  const canStart =
    !insecureLanMode &&
    startableAssignments.length > 0 &&
    connectedWorkers === model.workers.length &&
    !startingTeam;
  const overviewStats: Array<{ count: number; icon: LucideIcon; label: string }> = [
    { label: 'Assignments', count: model.assignments.length, icon: ListTodo },
    { label: 'Messages', count: model.messages.length, icon: MessageSquare },
    {
      label: 'Active leases',
      count: model.leases.filter((lease) => ['granted', 'active'].includes(lease.status)).length,
      icon: Clock3,
    },
    { label: 'Relay events', count: model.events.length, icon: Activity },
  ];

  return (
    <main data-testid="distributed-team-detail-view" className="size-full overflow-auto bg-surface">
      <div className="border-b border-border-emphasis bg-surface px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Network className="size-5 text-accent" />
              <h1 className="truncate text-base font-semibold text-text">
                {model.summary?.displayName ?? 'Distributed Team'}
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {connectedWorkers}/{model.workers.length} connected
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
              <span className="font-mono">{model.teamId}</span>
              <span className="inline-flex items-center gap-1">
                <Server className="size-3" /> {relayUrl}
              </span>
              <span>Remote protocol v2</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!canStart}
              onClick={onStartTeam}
              className={teamState === 'active' ? 'bg-emerald-600 hover:bg-emerald-600' : undefined}
            >
              {teamState === 'starting' ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {teamState === 'starting'
                ? 'Starting team…'
                : teamState === 'active'
                  ? 'Team active'
                  : 'Start team'}
            </Button>
            <Button variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              disabled={model.workers.length === 0}
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-3.5" />
              Assignment
            </Button>
          </div>
        </div>
      </div>

      {(error || mutationError) && (
        <div className="mx-5 mt-4 flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertTriangle className="size-4 shrink-0" />
          {mutationError ?? error}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DetailTab)}>
        <div className="bg-surface/95 sticky top-0 z-20 border-b border-border px-5 py-2 backdrop-blur">
          <TabsList>
            <TabsTrigger value="overview">
              <Users className="mr-1.5 size-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="assignments">
              <ListTodo className="mr-1.5 size-3.5" />
              Assignments
            </TabsTrigger>
            <TabsTrigger value="activity">
              <Activity className="mr-1.5 size-3.5" />
              Activity
            </TabsTrigger>
            <TabsTrigger value="messages">
              <MessageSquare className="mr-1.5 size-3.5" />
              Messages
            </TabsTrigger>
            <TabsTrigger value="debug">
              <SquareTerminal className="mr-1.5 size-3.5" />
              Console
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="p-5">
          <TabsContent value="overview" className="mt-0 space-y-6">
            <section>
              <h2 className="mb-3 text-sm font-semibold text-text">Members</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {model.workers.map((worker) => (
                  <WorkerPanel
                    key={worker.nodeId}
                    worker={worker}
                    route={model.membershipRoutes.find((route) => route.nodeId === worker.nodeId)}
                    onOpenDebug={openDebug}
                  />
                ))}
              </div>
            </section>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {overviewStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-border bg-surface-raised p-4"
                >
                  <stat.icon className="size-4 text-text-muted" />
                  <p className="mt-3 text-[10px] uppercase tracking-wide text-text-muted">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-text">{stat.count}</p>
                </div>
              ))}
            </section>
          </TabsContent>

          <TabsContent value="assignments" className="mt-0">
            {model.assignments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-text-muted">
                {loading ? 'Loading assignments…' : 'No assignments yet.'}
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-3 2xl:grid-cols-5">
                {['Offered', 'Queued', 'In progress', 'Done', 'Stopped'].map((column) => (
                  <section
                    key={column}
                    className="bg-surface-raised/60 min-w-0 rounded-lg border border-border p-3"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-text-secondary">{column}</h3>
                      <span className="text-[10px] text-text-muted">
                        {assignmentsByColumn.get(column)?.length ?? 0}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {(assignmentsByColumn.get(column) ?? []).map((assignment) => (
                        <AssignmentCard key={assignment.assignmentId} assignment={assignment} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="activity" className="mt-0">
            <ActivityList entries={model.activity} />
          </TabsContent>

          <TabsContent value="messages" className="mt-0">
            <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
              {model.messages.length === 0 ? (
                <p className="p-10 text-center text-sm text-text-muted">No peer messages yet.</p>
              ) : (
                model.messages.map((message) => (
                  <article
                    key={message.messageId}
                    className="border-b border-border p-4 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p className="font-medium text-text">
                        {message.senderLabel} → {message.recipientLabel}
                      </p>
                      <span className="text-[10px] uppercase text-text-muted">
                        {message.deliveryStatus}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">
                      {message.message}
                    </p>
                    <p className="mt-2 text-[10px] text-text-muted">{formatTime(message.sentAt)}</p>
                  </article>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="debug" className="mt-0">
            <div className="mb-3 flex justify-end">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>Worker</span>
                <Select
                  value={selectedRuntimeNodeId ?? 'all'}
                  onValueChange={(value) => onSelectRuntimeNode(value === 'all' ? null : value)}
                >
                  <SelectTrigger className="h-7 w-56 border-white/10 bg-white/5 text-xs text-neutral-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All workers</SelectItem>
                    {model.workers.map((worker) => (
                      <SelectItem key={worker.nodeId} value={worker.nodeId}>
                        {worker.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <RemoteRuntimeConsole
              session={runtimeSession}
              insecureLanMode={insecureLanMode}
              inactiveDescription={runtimeUnavailableDescription}
              loading={runtimeLoading}
              sending={runtimeSending}
              error={runtimeError}
              onRefresh={onRefresh}
              onControl={onRuntimeControl}
            />
          </TabsContent>
        </div>
      </Tabs>

      <CreateAssignmentDialog
        open={createOpen}
        teamId={model.teamId}
        workers={model.workers}
        routes={model.membershipRoutes}
        creating={creatingAssignment}
        onOpenChange={setCreateOpen}
        onCreate={onCreateAssignment}
      />
    </main>
  );
};
