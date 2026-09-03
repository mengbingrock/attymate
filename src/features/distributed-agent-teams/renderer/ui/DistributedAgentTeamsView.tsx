import { Button } from '@renderer/components/ui/button';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Network,
  RefreshCw,
  Server,
  Users,
} from 'lucide-react';

import { latestDistributedAssignments } from '../adapters/buildDistributedTeamSummaries';

import type {
  DistributedAssignmentEventDto,
  DistributedAssignmentEventsDto,
  DistributedTopologyDto,
  DistributedWorkerDto,
} from '../../contracts';

interface DistributedAgentTeamsViewProps {
  topology: DistributedTopologyDto | null;
  assignmentEvents: DistributedAssignmentEventsDto | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}

function shortId(value: string | undefined): string {
  if (!value) return '—';
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

function formatTime(value: string | undefined): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? value
    : new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(timestamp);
}

const WorkerCard = ({ worker }: { worker: DistributedWorkerDto }): React.JSX.Element => {
  const connected = worker.status === 'connected';
  return (
    <article className="rounded-lg border border-border bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`}
              aria-hidden="true"
            />
            <h3 className="truncate text-sm font-semibold text-text">{worker.label}</h3>
          </div>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            node {shortId(worker.nodeId)}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            connected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
          }`}
        >
          {worker.status}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-text-muted">Worker instance</dt>
          <dd className="mt-0.5 font-mono text-text-secondary">
            {shortId(worker.workerInstanceId)}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Generation</dt>
          <dd className="mt-0.5 text-text-secondary">{worker.workerGeneration}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Heartbeat</dt>
          <dd className="mt-0.5 text-text-secondary">{formatTime(worker.lastHeartbeatAt)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Sequence</dt>
          <dd className="mt-0.5 text-text-secondary">{worker.lastHeartbeatSequence}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-text-muted">Team discovery</dt>
          <dd className="mt-0.5 text-text-secondary">
            {worker.autoJoinTeamId
              ? `Advertising auto-join for ${shortId(worker.autoJoinTeamId)}`
              : 'Available for lead enrollment'}
          </dd>
        </div>
      </dl>
    </article>
  );
};

const AssignmentRow = ({ event }: { event: DistributedAssignmentEventDto }): React.JSX.Element => {
  const completed = event.state === 'completed';
  const failed = event.state === 'failed' || event.state === 'rejected';
  const StateIcon = completed ? CheckCircle2 : failed ? AlertTriangle : Clock3;
  return (
    <article className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <StateIcon
        className={`mt-0.5 size-4 shrink-0 ${
          completed ? 'text-emerald-500' : failed ? 'text-red-500' : 'text-accent'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-xs text-text">{shortId(event.assignmentId)}</p>
          <span className="rounded bg-surface-overlay px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
            {event.state.replaceAll('_', ' ')}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-text-secondary">{event.reason}</p>
        <p className="mt-1 text-[10px] text-text-muted">
          {shortId(event.sourceNodeId)} · revision {event.revision} · {formatTime(event.receivedAt)}
        </p>
      </div>
    </article>
  );
};

export const DistributedAgentTeamsView = ({
  topology,
  assignmentEvents,
  loading,
  refreshing,
  error,
  onRefresh,
}: DistributedAgentTeamsViewProps): React.JSX.Element => {
  const workers = topology?.workers ?? [];
  const assignments = latestDistributedAssignments(assignmentEvents?.events ?? []);
  const connectedWorkers = workers.filter((worker) => worker.status === 'connected').length;
  const latestTeamEvent = assignmentEvents?.events.findLast((event) => Boolean(event.teamId));
  const degraded = topology?.degraded || assignmentEvents?.degraded;
  const warning = topology?.warning ?? assignmentEvents?.warning;

  return (
    <main
      data-testid="distributed-agent-teams-view"
      className="size-full overflow-auto bg-surface text-text"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Network className="size-5 text-accent" />
              <h1 className="text-lg font-semibold">Distributed Agent Team</h1>
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              Local workers connected through the remote relay protocol.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </header>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}
        {degraded && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {warning ?? 'The distributed relay is reporting degraded state.'}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Team summary">
          <div className="rounded-lg border border-border bg-surface-raised p-4">
            <Server className="size-4 text-text-muted" />
            <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-text-muted">
              Relay
            </p>
            <p className="mt-1 truncate text-sm font-medium text-text">
              {topology?.relayUrl ?? (loading ? 'Connecting…' : 'Unavailable')}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-raised p-4">
            <Users className="size-4 text-text-muted" />
            <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-text-muted">
              Workers
            </p>
            <p className="mt-1 text-sm font-medium text-text">
              {connectedWorkers} connected{' '}
              <span className="text-text-muted">/ {workers.length}</span>
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-raised p-4">
            <Activity className="size-4 text-text-muted" />
            <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-text-muted">
              Assignments
            </p>
            <p className="mt-1 text-sm font-medium text-text">{assignments.length} tracked</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-raised p-4">
            <Network className="size-4 text-text-muted" />
            <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-text-muted">
              Team
            </p>
            <p className="mt-1 truncate font-mono text-sm font-medium text-text">
              {shortId(latestTeamEvent?.teamId)}
            </p>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Worker roster</h2>
            <span className="text-xs text-text-muted">Remote protocol v2</span>
          </div>
          {workers.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {workers.map((worker) => (
                <WorkerCard key={worker.workerInstanceId} worker={worker} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">
              {loading ? 'Loading worker topology…' : 'No workers are connected to the relay.'}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold">Assignment activity</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
            {assignments.length > 0 ? (
              assignments.map((event) => <AssignmentRow key={event.assignmentId} event={event} />)
            ) : (
              <p className="p-6 text-center text-sm text-text-muted">
                {loading ? 'Loading assignment activity…' : 'No remote assignments yet.'}
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};
