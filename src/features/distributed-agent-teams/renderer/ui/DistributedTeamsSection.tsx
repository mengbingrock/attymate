import { Activity, Network, Radio, UsersRound } from 'lucide-react';

import type { DistributedTeamSummary } from '../adapters/buildDistributedTeamSummaries';

interface DistributedTeamsSectionProps {
  teams: DistributedTeamSummary[];
  onOpenTeam: (teamId: string) => void;
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

const DistributedTeamCard = ({
  team,
  onOpenTeam,
}: {
  team: DistributedTeamSummary;
  onOpenTeam: (teamId: string) => void;
}): React.JSX.Element => {
  const allConnected = team.workers.length > 0 && team.connectedWorkerCount === team.workers.length;

  return (
    <button
      type="button"
      className="team-row-zebra-card group relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border p-4 text-left transition-colors duration-200 hover:border-border-emphasis"
      onClick={() => onOpenTeam(team.teamId)}
    >
      <span className="flex min-w-0 items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-overlay transition-colors group-hover:border-border-emphasis">
          <Network className="size-4 text-accent" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text">{team.displayName}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-text-muted">
            {shortId(team.teamId)}
          </span>
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            allConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${allConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}
          />
          {allConnected ? 'Connected' : 'Partial'}
        </span>
      </span>

      <span className="mt-3 flex items-center gap-1.5 text-[10px] text-text-muted">
        <Radio className="size-3 shrink-0" />
        <span className="truncate">Remote protocol v2 · {team.relayUrl}</span>
      </span>

      <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <UsersRound className="size-3 text-text-muted" />
          {team.connectedWorkerCount}/{team.workers.length} workers
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Activity className="size-3 text-text-muted" />
          {team.activeAssignmentCount}/{team.assignmentCount} active assignments
        </span>
      </span>

      <span className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {team.workers.map((worker) => (
          <span
            key={worker.nodeId}
            className="inline-flex items-center gap-1 text-[10px] text-text-muted"
          >
            <span
              className={`size-1.5 rounded-full ${
                worker.status === 'connected'
                  ? 'bg-emerald-400'
                  : worker.status === 'stale'
                    ? 'bg-amber-400'
                    : 'bg-zinc-500'
              }`}
            />
            {worker.label}
          </span>
        ))}
      </span>
    </button>
  );
};

export const DistributedTeamsSection = ({
  teams,
  onOpenTeam,
}: DistributedTeamsSectionProps): React.JSX.Element | null => {
  if (teams.length === 0) return null;

  return (
    <section data-testid="distributed-teams-section">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
          Distributed teams
        </h3>
        <span className="rounded-full border border-border bg-surface-overlay px-1.5 py-0.5 text-[10px] font-medium leading-none text-text-secondary">
          {teams.length}
        </span>
      </div>
      <div className="team-row-zebra-grid grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((team) => (
          <DistributedTeamCard key={team.teamId} team={team} onOpenTeam={onOpenTeam} />
        ))}
      </div>
    </section>
  );
};
