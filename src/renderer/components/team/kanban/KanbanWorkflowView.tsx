import { memo, useCallback, useMemo, useRef } from 'react';

import { useAppTranslation } from '@features/localization/renderer';
import { cn } from '@renderer/lib/utils';

import type { KanbanColumnId, ResolvedTeamMember, TaskHistoryEvent, TeamTask } from '@shared/types';

/**
 * Sandstone-inspired workflow view: tasks rendered as complete workflows on a
 * vertical spine, grouped under a stage rail (intake → approved). Stage labels
 * and status pills are deliberate mono-caps design text, matching the rail
 * treatment of the reference art direction.
 */

const STAGE_ORDER: readonly KanbanColumnId[] = [
  'todo',
  'in_progress',
  'review',
  'done',
  'approved',
];

const STAGE_LABELS: Record<KanbanColumnId, string> = {
  todo: 'INTAKE',
  in_progress: 'WORK EXECUTION',
  review: 'REVIEW',
  done: 'COMPLETION',
  approved: 'APPROVED & STORED',
};

const WF_VARS: React.CSSProperties = {
  ['--wf-dune' as string]: '#2b2119',
  ['--wf-dune-high' as string]: '#4a3728',
  ['--wf-paper' as string]: '#f4efe6',
  ['--wf-paper-shade' as string]: '#eae2d2',
  ['--wf-ink' as string]: '#2a2118',
  ['--wf-ink-soft' as string]: 'rgba(42, 33, 24, 0.62)',
  ['--wf-clay' as string]: '#b0432c',
  ['--wf-sage' as string]: '#4f7247',
  ['--wf-rail' as string]: 'rgba(244, 239, 230, 0.45)',
  ['--wf-rail-active' as string]: '#f4efe6',
};

const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SERIF_STACK = '"Iowan Old Style", Palatino, Georgia, serif';

interface JourneyStep {
  label: string;
  detail?: string;
  timestamp?: string;
  tone: 'neutral' | 'clay' | 'sage';
}

function formatEventTime(timestamp?: string): string {
  if (!timestamp) return '';
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const sameDay = new Date().toDateString() === date.toDateString();
  const hm = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return hm;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hm}`;
}

function describeHistoryEvent(event: TaskHistoryEvent): JourneyStep | null {
  switch (event.type) {
    case 'task_created':
      return { label: 'Task created', tone: 'neutral', timestamp: event.timestamp };
    case 'status_changed':
      return {
        label: `Moved to ${event.to.replace('_', ' ')}`,
        detail: event.actor,
        tone: event.to === 'completed' ? 'sage' : 'neutral',
        timestamp: event.timestamp,
      };
    case 'owner_changed':
      return {
        label: event.to ? `Assigned to ${event.to}` : 'Owner cleared',
        tone: 'neutral',
        timestamp: event.timestamp,
      };
    case 'review_requested':
      return {
        label: 'Review requested',
        detail: event.actor,
        tone: 'neutral',
        timestamp: event.timestamp,
      };
    case 'review_started':
      return {
        label: 'Review started',
        detail: event.actor,
        tone: 'neutral',
        timestamp: event.timestamp,
      };
    case 'review_changes_requested':
      return {
        label: 'Changes requested',
        detail: event.actor,
        tone: 'clay',
        timestamp: event.timestamp,
      };
    case 'review_approved':
      return { label: 'Approved', detail: event.actor, tone: 'sage', timestamp: event.timestamp };
    default:
      return null;
  }
}

function buildJourney(task: TeamTask): JourneyStep[] {
  const events = task.historyEvents ?? [];
  const steps = events
    .map(describeHistoryEvent)
    .filter((step): step is JourneyStep => step !== null);
  if (steps.length === 0 && task.createdAt) {
    steps.push({ label: 'Task created', tone: 'neutral', timestamp: task.createdAt });
  }
  return steps;
}

interface StatusPill {
  text: string;
  tone: 'neutral' | 'clay' | 'sage';
}

function getStatusPill(task: TeamTask, columnId: KanbanColumnId): StatusPill {
  if (task.needsClarification) return { text: 'FLAGGED', tone: 'clay' };
  switch (columnId) {
    case 'todo':
      return { text: 'QUEUED', tone: 'neutral' };
    case 'in_progress':
      return { text: 'IN PROGRESS', tone: 'neutral' };
    case 'review':
      return { text: 'IN REVIEW', tone: 'neutral' };
    case 'done':
      return { text: 'DONE', tone: 'sage' };
    case 'approved':
      return { text: 'APPROVED', tone: 'sage' };
  }
}

function pillClasses(tone: StatusPill['tone']): string {
  switch (tone) {
    case 'clay':
      return 'border-[var(--wf-clay)] text-[var(--wf-clay)]';
    case 'sage':
      return 'border-[var(--wf-sage)] text-[var(--wf-sage)]';
    default:
      return 'border-[var(--wf-ink-soft)] text-[var(--wf-ink-soft)]';
  }
}

interface WorkflowTaskCardProps {
  task: TeamTask;
  columnId: KanbanColumnId;
  memberColor?: string;
  onTaskClick?: (task: TeamTask) => void;
}

const WorkflowTaskCard = memo(function WorkflowTaskCard({
  task,
  columnId,
  memberColor,
  onTaskClick,
}: WorkflowTaskCardProps) {
  const journey = useMemo(() => buildJourney(task), [task]);
  const pill = getStatusPill(task, columnId);
  const commentCount = task.comments?.length ?? 0;
  const updatedLabel = formatEventTime(task.updatedAt ?? task.createdAt);

  return (
    <button
      type="button"
      onClick={onTaskClick ? () => onTaskClick(task) : undefined}
      className={cn(
        'block w-full overflow-hidden rounded-2xl text-left shadow-[0_10px_30px_rgba(20,12,5,0.35)]',
        'bg-[var(--wf-paper)] text-[var(--wf-ink)] outline-none transition-transform',
        'focus-visible:ring-2 focus-visible:ring-[var(--wf-rail-active)]',
        'motion-safe:hover:-translate-y-0.5'
      )}
    >
      {/* Header band */}
      <div className="border-b border-[rgba(42,33,24,0.08)] bg-[var(--wf-paper-shade)] px-5 py-3">
        <div className="mb-1 flex items-center justify-between gap-3">
          {task.displayId ? (
            <span
              className="text-[11px] tracking-wider text-[var(--wf-ink-soft)]"
              style={{ fontFamily: MONO_STACK }}
            >
              #{task.displayId}
            </span>
          ) : (
            <span />
          )}
          <span
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] tracking-[0.12em]',
              pillClasses(pill.tone)
            )}
            style={{ fontFamily: MONO_STACK }}
          >
            {pill.text}
          </span>
        </div>
        <div className="line-clamp-2 text-[15px] font-semibold leading-snug">{task.subject}</div>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        {task.owner ? (
          <div className="mb-3 flex items-center gap-2 text-[12px] text-[var(--wf-ink-soft)]">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: memberColor ?? 'var(--wf-ink-soft)' }}
            />
            <span className="tracking-[0.14em]" style={{ fontFamily: MONO_STACK }}>
              OWNER
            </span>
            <span className="font-medium text-[var(--wf-ink)]">{task.owner}</span>
          </div>
        ) : null}
        {task.description ? (
          <p className="mb-3 line-clamp-2 text-[13px] leading-relaxed text-[var(--wf-ink-soft)]">
            {task.description}
          </p>
        ) : null}

        {/* Journey — the complete workflow of this task */}
        {journey.length > 0 ? (
          <ol className="space-y-1.5">
            {journey.map((step, index) => (
              <li key={index} className="flex items-baseline gap-2 text-[12px]">
                <span
                  className={cn(
                    'mt-px inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full',
                    step.tone === 'clay'
                      ? 'bg-[var(--wf-clay)]'
                      : step.tone === 'sage'
                        ? 'bg-[var(--wf-sage)]'
                        : 'bg-[rgba(42,33,24,0.3)]'
                  )}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    step.tone === 'clay'
                      ? 'text-[var(--wf-clay)]'
                      : step.tone === 'sage'
                        ? 'text-[var(--wf-sage)]'
                        : 'text-[var(--wf-ink-soft)]'
                  )}
                >
                  {step.label}
                  {step.detail ? <span className="opacity-70"> — {step.detail}</span> : null}
                </span>
                <span
                  className="shrink-0 text-[10px] text-[rgba(42,33,24,0.4)]"
                  style={{ fontFamily: MONO_STACK }}
                >
                  {formatEventTime(step.timestamp)}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      {/* Footer band */}
      {(updatedLabel || commentCount > 0) && (
        <div className="border-t border-[rgba(42,33,24,0.08)] bg-[var(--wf-paper-shade)] px-5 py-2 text-[11px] italic text-[var(--wf-ink-soft)]">
          {updatedLabel ? `Updated ${updatedLabel}` : ''}
          {updatedLabel && commentCount > 0 ? ' · ' : ''}
          {commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : ''}
        </div>
      )}
    </button>
  );
});

interface KanbanWorkflowViewProps {
  tasksByColumn: ReadonlyMap<KanbanColumnId, TeamTask[]>;
  members: ResolvedTeamMember[];
  memberColorMap: ReadonlyMap<string, string>;
  onTaskClick?: (task: TeamTask) => void;
}

export const KanbanWorkflowView = memo(function KanbanWorkflowView({
  tasksByColumn,
  memberColorMap,
  onTaskClick,
}: KanbanWorkflowViewProps) {
  const { t } = useAppTranslation('team');
  const sectionRefs = useRef<Partial<Record<KanbanColumnId, HTMLElement | null>>>({});

  // The spine reads as a timeline: within each stage, earliest-created task on
  // top, most recent on the bottom, regardless of the board's sort setting.
  const chronologicalByColumn = useMemo(() => {
    const result = new Map<KanbanColumnId, TeamTask[]>();
    for (const stage of STAGE_ORDER) {
      const stageTasks = [...(tasksByColumn.get(stage) ?? [])];
      stageTasks.sort((a, b) => {
        const aMs = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY;
        const bMs = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY;
        return aMs - bMs;
      });
      result.set(stage, stageTasks);
    }
    return result;
  }, [tasksByColumn]);

  const stagesWithTasks = useMemo(
    () => STAGE_ORDER.filter((stage) => (chronologicalByColumn.get(stage)?.length ?? 0) > 0),
    [chronologicalByColumn]
  );

  const insights = useMemo(() => {
    const all = STAGE_ORDER.flatMap((stage) => tasksByColumn.get(stage) ?? []);
    const finished = all.filter((task) => {
      const stage = task.status === 'completed';
      return stage;
    });
    const inReview = tasksByColumn.get('review')?.length ?? 0;
    const cycleTimesMs = finished
      .map((task) => {
        const created = task.createdAt ? Date.parse(task.createdAt) : NaN;
        const updated = task.updatedAt ? Date.parse(task.updatedAt) : NaN;
        return Number.isFinite(created) && Number.isFinite(updated) ? updated - created : NaN;
      })
      .filter((ms) => Number.isFinite(ms) && ms > 0);
    const avgCycleMs =
      cycleTimesMs.length > 0
        ? cycleTimesMs.reduce((sum, ms) => sum + ms, 0) / cycleTimesMs.length
        : null;
    const formatCycle = (ms: number): string => {
      const minutes = ms / 60_000;
      if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
      const hours = minutes / 60;
      if (hours < 48) return `${hours.toFixed(1)}h`;
      return `${(hours / 24).toFixed(1)}d`;
    };
    return {
      completed: finished.length,
      inReview,
      avgCycle: avgCycleMs != null ? formatCycle(avgCycleMs) : '—',
    };
  }, [tasksByColumn]);

  const scrollToStage = useCallback((stage: KanbanColumnId) => {
    sectionRefs.current[stage]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const totalTasks = STAGE_ORDER.reduce(
    (sum, stage) => sum + (tasksByColumn.get(stage)?.length ?? 0),
    0
  );

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl"
      style={{
        ...WF_VARS,
        background:
          'radial-gradient(120% 90% at 85% 0%, var(--wf-dune-high) 0%, var(--wf-dune) 55%, #201811 100%)',
      }}
    >
      <div className="flex gap-6 px-6 py-8 md:px-10">
        {/* Stage rail */}
        <nav
          aria-label="Workflow stages"
          className="sticky top-8 hidden h-fit w-48 shrink-0 self-start md:block"
        >
          <ol className="relative">
            {STAGE_ORDER.map((stage, index) => {
              const count = tasksByColumn.get(stage)?.length ?? 0;
              const active = count > 0;
              return (
                <li key={stage} className="relative pb-7 last:pb-0">
                  {index < STAGE_ORDER.length - 1 ? (
                    <span
                      aria-hidden
                      className="absolute left-[5px] top-4 h-full w-px bg-[rgba(244,239,230,0.18)]"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => scrollToStage(stage)}
                    disabled={!active}
                    className={cn(
                      'group flex items-center gap-3 outline-none',
                      active ? 'cursor-pointer' : 'cursor-default'
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'relative z-10 inline-block h-[11px] w-[11px] rounded-full border',
                        active
                          ? 'border-[var(--wf-rail-active)] bg-[var(--wf-rail-active)]'
                          : 'border-[rgba(244,239,230,0.3)] bg-transparent'
                      )}
                    />
                    <span
                      className={cn(
                        'text-[11px] tracking-[0.22em] transition-colors',
                        active
                          ? 'text-[var(--wf-rail-active)] group-hover:opacity-80'
                          : 'text-[rgba(244,239,230,0.35)]'
                      )}
                      style={{ fontFamily: MONO_STACK }}
                    >
                      {STAGE_LABELS[stage]}
                      {active ? ` · ${count}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Spine */}
        <div className="min-w-0 max-w-[640px] flex-1">
          <p
            className="mb-1 text-[11px] tracking-[0.3em] text-[var(--wf-rail)]"
            style={{ fontFamily: MONO_STACK }}
          >
            AGENT WORKFLOWS
          </p>
          <h2
            className="mb-8 text-[26px] leading-tight text-[var(--wf-paper)]"
            style={{ fontFamily: SERIF_STACK }}
          >
            From intake to approval.
          </h2>

          {totalTasks === 0 ? (
            <div className="rounded-2xl bg-[rgba(244,239,230,0.06)] px-6 py-10 text-center text-[13px] text-[var(--wf-rail)]">
              {t('kanban.board.addTask', { defaultValue: 'Add a task to start a workflow.' })}
            </div>
          ) : (
            stagesWithTasks.map((stage) => {
              const stageTasks = chronologicalByColumn.get(stage) ?? [];
              return (
                <section
                  key={stage}
                  ref={(el) => {
                    sectionRefs.current[stage] = el;
                  }}
                  className="mb-2 scroll-mt-8"
                >
                  <div className="mb-4 flex justify-center">
                    <span
                      className="rounded-full bg-[rgba(244,239,230,0.1)] px-4 py-1.5 text-[10px] tracking-[0.24em] text-[var(--wf-rail-active)]"
                      style={{ fontFamily: MONO_STACK }}
                    >
                      {STAGE_LABELS[stage]} — {stageTasks.length}
                    </span>
                  </div>
                  {stageTasks.map((task, index) => (
                    <div key={task.id}>
                      <WorkflowTaskCard
                        task={task}
                        columnId={stage}
                        memberColor={task.owner ? memberColorMap.get(task.owner) : undefined}
                        onTaskClick={onTaskClick}
                      />
                      {/* Connector */}
                      <div aria-hidden className="mx-auto flex h-9 w-px flex-col items-center">
                        <span className="h-full w-px bg-[rgba(244,239,230,0.25)]" />
                        {index === stageTasks.length - 1 ? null : (
                          <span className="-mt-1 text-[10px] text-[rgba(244,239,230,0.4)]">↓</span>
                        )}
                      </div>
                    </div>
                  ))}
                </section>
              );
            })
          )}

          {/* Insights */}
          {totalTasks > 0 ? (
            <>
              <div className="mb-6 mt-2 flex justify-center">
                <span
                  className="whitespace-nowrap rounded-full bg-[rgba(32,24,17,0.75)] px-5 py-2 text-[10px] tracking-[0.16em] text-[var(--wf-rail-active)]"
                  style={{ fontFamily: MONO_STACK }}
                >
                  INSIGHTS FROM THIS BOARD
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 pb-2">
                {[
                  { value: String(insights.completed), caption: 'Completed' },
                  { value: String(insights.inReview), caption: 'In review' },
                  { value: insights.avgCycle, caption: 'Avg. cycle' },
                ].map((tile) => (
                  <div
                    key={tile.caption}
                    className="rounded-2xl bg-[var(--wf-paper)] px-2 py-5 text-center text-[var(--wf-ink)]"
                  >
                    <div className="text-[28px] leading-none" style={{ fontFamily: SERIF_STACK }}>
                      {tile.value}
                    </div>
                    <div className="mt-2 text-[10px] text-[var(--wf-ink-soft)]">{tile.caption}</div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
});
