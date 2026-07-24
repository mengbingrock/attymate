export type InteractiveRuntimeKind = 'claude-interactive' | 'codex-lanes';

export interface RuntimeLaneBinding {
  memberName: string;
  isLead: boolean;
  paneId: string;
  windowIndex: number;
}

/**
 * On-disk `interactive-runtime.json` shape. Version 1 files predate the codex
 * lane runtime and carry no `runtime`/`lanes` fields; they always describe a
 * claude interactive lead.
 */
export interface InteractiveRuntimeBinding {
  version: 1 | 2;
  runtime: InteractiveRuntimeKind;
  teamName: string;
  runId: string;
  tmuxSessionName: string;
  leadSessionId: string | null;
  sessionTeamName: string | null;
  leadPaneId: string | null;
  lanes: RuntimeLaneBinding[];
  launchedAt: string;
}

function normalizeLanes(raw: unknown): RuntimeLaneBinding[] {
  if (!Array.isArray(raw)) return [];
  const lanes: RuntimeLaneBinding[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const lane = entry as Record<string, unknown>;
    if (typeof lane.memberName !== 'string' || typeof lane.paneId !== 'string') continue;
    lanes.push({
      memberName: lane.memberName,
      isLead: lane.isLead === true,
      paneId: lane.paneId,
      windowIndex: typeof lane.windowIndex === 'number' ? lane.windowIndex : 0,
    });
  }
  return lanes;
}

/** Parse a persisted binding, tolerating v1 files and unknown fields. */
export function parseRuntimeBinding(raw: string): InteractiveRuntimeBinding | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1 && candidate.version !== 2) return null;
  if (typeof candidate.tmuxSessionName !== 'string' || !candidate.tmuxSessionName) return null;
  if (typeof candidate.teamName !== 'string' || typeof candidate.runId !== 'string') return null;
  const runtime: InteractiveRuntimeKind =
    candidate.runtime === 'codex-lanes' ? 'codex-lanes' : 'claude-interactive';
  return {
    version: candidate.version,
    runtime,
    teamName: candidate.teamName,
    runId: candidate.runId,
    tmuxSessionName: candidate.tmuxSessionName,
    leadSessionId: typeof candidate.leadSessionId === 'string' ? candidate.leadSessionId : null,
    sessionTeamName:
      typeof candidate.sessionTeamName === 'string' ? candidate.sessionTeamName : null,
    leadPaneId: typeof candidate.leadPaneId === 'string' ? candidate.leadPaneId : null,
    lanes: normalizeLanes(candidate.lanes),
    launchedAt:
      typeof candidate.launchedAt === 'string' ? candidate.launchedAt : new Date(0).toISOString(),
  };
}
