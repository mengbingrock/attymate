const SESSION_PREFIX = 'agteams-';
const VIEWER_PREFIX = 'con-';
const MAX_TEAM_SLUG_LENGTH = 32;

/** tmux session names must avoid `.` and `:` (target separators). */
export function slugifyTeamNameForTmux(teamName: string): string {
  const slug = teamName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_TEAM_SLUG_LENGTH);
  return slug || 'team';
}

export function buildInteractiveTmuxSessionName(teamName: string, runId: string): string {
  const runSuffix = runId.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'run';
  return `${SESSION_PREFIX}${slugifyTeamNameForTmux(teamName)}-${runSuffix}`;
}

export function isInteractiveTmuxSessionName(sessionName: string): boolean {
  return sessionName.startsWith(SESSION_PREFIX) && !sessionName.startsWith(VIEWER_PREFIX);
}

export function buildViewerSessionName(tmuxSessionName: string, sequence: number): string {
  return `${VIEWER_PREFIX}${tmuxSessionName}-${sequence}`;
}

export function isViewerSessionNameFor(sessionName: string, tmuxSessionName: string): boolean {
  return sessionName.startsWith(`${VIEWER_PREFIX}${tmuxSessionName}-`);
}
