import { MATTER_SKILL_SLUG, stripSkillFrontmatter } from '../../core/domain/matterSkillDefinition';

export type MatterRefreshMode = 'initial-scan' | 'update';
export type MatterRefreshTrigger = 'user-refresh' | 'job-wrap-up';

export interface MatterSkillInvocationInput {
  teamName: string;
  projectPath: string | null;
  mode: MatterRefreshMode;
  hasTeammates: boolean;
  canSpawnTeammates: boolean;
  /** Raw SKILL.md (the user's copy when present, else the bundled one). */
  skillMarkdown: string;
  trigger: MatterRefreshTrigger;
  /** Task the wrap-up nudge fired for, when there is one. */
  completedTaskLabel?: string;
}

/**
 * The message delivered to the lead when the dashboard should be refreshed.
 *
 * The skill itself is team- and runtime-agnostic, so everything situational is
 * added here: which team, which folder, whether this is a first scan, and what
 * the runtime permits. The skill body is inlined rather than merely named, so
 * the workflow arrives intact on runtimes that do not discover skills on their
 * own — and so the user's edits to SKILL.md take effect immediately.
 */
export function buildMatterSkillInvocationPrompt(input: MatterSkillInvocationInput): string {
  const lines: string[] = [];

  lines.push(
    input.trigger === 'user-refresh'
      ? `The user asked you to refresh the matter dashboard for team "${input.teamName}".`
      : `All tasks are complete${
          input.completedTaskLabel ? ` (last: ${input.completedTaskLabel})` : ''
        }. Update the matter dashboard for team "${input.teamName}".`
  );
  lines.push(`Project folder: ${input.projectPath ?? '(unresolved)'}`);
  lines.push(
    input.mode === 'initial-scan'
      ? 'The dashboard is still empty, so this is the INITIAL SCAN: read the case documents in the project folder and propose a first dashboard. If the folder holds no case content, say so and propose nothing.'
      : 'The dashboard already has content, so this is an UPDATE SCAN: compile what the completed work changed, re-scan the folder for new or changed case documents, and propose only what changed.'
  );

  if (input.hasTeammates) {
    lines.push(
      input.canSpawnTeammates
        ? 'You have specialists: delegate and message them IN PARALLEL. For a large folder you may spawn additional instances of the same specialist type with distinct names (e.g. source-intake-a, source-intake-b), each assigned a different subfolder.'
        : 'You have specialists: delegate and message them IN PARALLEL. For extra parallelism use your own private subagents — do NOT create, replace, or duplicate teammates; the app launches them.'
    );
  } else if (!input.canSpawnTeammates) {
    lines.push(
      'You have no teammates: do the work yourself, using your own private subagents for parallelism. Do NOT create teammates.'
    );
  }

  lines.push(
    '',
    `Follow the "${MATTER_SKILL_SLUG}" skill below (also installed in your skills directory):`,
    '',
    `--- ${MATTER_SKILL_SLUG} skill ---`,
    stripSkillFrontmatter(input.skillMarkdown),
    `--- end ${MATTER_SKILL_SLUG} skill ---`
  );

  return lines.join('\n');
}
