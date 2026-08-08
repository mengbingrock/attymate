import { createLogger } from '@shared/utils/logger';

const logger = createLogger('Service:TeamProjectPath');

export interface ResolveTeamProjectPathDeps {
  /** The cwd the team's LIVE runtime is actually working in, when alive. */
  getLiveCwd(teamName: string): string | null;
  /** The saved launch cwd (team.meta.json) — what the next launch will use. */
  getSavedCwd(teamName: string): Promise<string | null>;
  /** Config-derived fallback (CLI-owned config.json projectPath / member cwds). */
  getConfigProjectPath(teamName: string): Promise<string | null>;
}

/**
 * The ONE answer to "which folder is this team's authorized project root?".
 *
 * Historically each consumer picked its own source — the matter-scan prompt
 * read CLI-owned config.json while the lead's session ran in the launch cwd
 * from team.meta.json — and a team whose path changed between launches told
 * its lead to scan a folder it was not actually working in ("config says
 * CaseNO.000000, my session runs in CaseNO.1234567").
 *
 * Precedence, most-true-first:
 *   1. the live runtime's actual cwd — where the agents really are right now;
 *   2. the saved launch cwd — the truth for a stopped team's next launch
 *      (this is what "change project folder" updates);
 *   3. config-derived paths — historical CLI registration, last resort.
 */
export async function resolveTeamProjectPath(
  teamName: string,
  deps: ResolveTeamProjectPathDeps
): Promise<string | null> {
  const liveCwd = deps.getLiveCwd(teamName)?.trim() || null;
  const savedCwd = (await deps.getSavedCwd(teamName).catch(() => null))?.trim() || null;

  if (liveCwd) {
    if (savedCwd && savedCwd !== liveCwd) {
      // A stopped-team path change cannot cause this (it is refused while the
      // team runs), so this is pre-existing divergence worth a visible trace.
      logger.warn(
        `[${teamName}] live session cwd "${liveCwd}" differs from saved project path "${savedCwd}"; using the live cwd`
      );
    }
    return liveCwd;
  }
  if (savedCwd) return savedCwd;
  return (await deps.getConfigProjectPath(teamName).catch(() => null))?.trim() || null;
}
