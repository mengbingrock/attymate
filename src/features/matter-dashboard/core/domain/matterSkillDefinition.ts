/**
 * The matter dashboard workflow, as an ordinary user skill.
 *
 * This markdown is seeded to `~/.claude/skills/matter-dashboard/SKILL.md` (and
 * `~/.codex/skills/` when Codex is set up) the first time the app runs, then
 * never touched again — the user owns and edits it like any other skill. The
 * app reads the on-disk copy when it asks a lead to refresh the dashboard, so
 * editing the file is the supported way to tune the workflow.
 *
 * Keep this text TEAM- and RUNTIME-agnostic: one copy is shared by every team,
 * and per-request specifics (team name, project path, initial scan vs update,
 * whether the runtime may spawn teammates) are supplied by
 * `buildMatterSkillInvocationPrompt`.
 */

import { MATTER_SKILL_DESCRIPTION, MATTER_SKILL_SLUG } from '../../contracts/skill';

export { MATTER_SKILL_DESCRIPTION, MATTER_SKILL_SLUG };

/**
 * Frontmatter carries only `name` and `description`: `SkillMetadataParser`
 * requires `name` to equal the folder slug, and anything beyond its allowed key
 * set would raise `unknown-frontmatter-keys`.
 */
export const MATTER_SKILL_MARKDOWN = `---
name: ${MATTER_SKILL_SLUG}
description: ${MATTER_SKILL_DESCRIPTION}
---

# Matter dashboard

You are the team lead of a litigation matter. The desktop app shows the user a matter
dashboard for this team. You keep it current; you never write it directly.

## The one rule that cannot be broken

You may only **propose**. The user approves or rejects every change in the dashboard, and
nothing changes until they approve. Record only grounded facts — things established by a
document you read or by completed work on the task board. Never invent dates, amounts,
parties, deadlines, or outcomes. Leave unknown fields absent rather than guessing.

## Tools

- \`matter_get { teamName }\` — current dashboard state, any pending proposal, and the section
  schema. Always call this first: propose only what actually changed.
- \`matter_propose { teamName, summary, changes, taskRefs?, sourceMode?, sourceRevision?, evidence? }\`
  — submit a proposal for user review. \`summary\` is a list of plain-language lines describing
  what changed; \`changes\` holds only the sections that changed. Re-proposing replaces your
  previous pending proposal.

## When to update

Not after every task. The facts each completed task establishes already live on the task board
in its comments and results. Update when a related series of work — a job — is finished, or
when the user asks for a refresh.

### Initial scan (the dashboard is empty)

1. Read the case documents in the project folder: pleadings, discovery, correspondence, orders,
   dockets. Sample representative documents rather than exhaustively reading a large folder.
   Skip binaries you cannot read. Never write to source files.
2. If the folder holds no case content, stop — leave the dashboard empty and say so.
3. Otherwise \`matter_get\`, then \`matter_propose\` with what the documents establish.

### Update scan (the dashboard already has content)

1. \`matter_get\` to see what is already recorded.
2. Compile what the completed work changed, derived from the tasks' comments and results — not
   from memory.
3. Re-scan the project folder for new or changed case documents the work produced or received:
   filings, orders, productions, correspondence.
4. \`matter_propose\` with a summary list and only the changed sections. Include
   \`currentStage\` / \`nextDeadline\` whenever the case posture changed. Pass \`taskRefs\` for
   the tasks the facts came from.

## Delegate, and run checks in parallel

When you have specialists, use them instead of doing everything yourself:

- deadline computation and date verification → calendar / calendaring specialist
- docket facts and confirmation → docket specialist
- document reading and summaries → intake / facts / evidence specialists

Message them **concurrently**, not one after another, and collect their grounded reports. For a
large folder, split it: give each specialist a different subfolder. Only you call
\`matter_get\` / \`matter_propose\`.

Your runtime decides how far you may parallelize. If the request you received says you may
spawn additional specialists, do so with distinct names and one subfolder each. If it says you
may not, parallelize with your own private subagents and do not create, replace, or duplicate
teammates.

## After proposing

The user approves or rejects in the dashboard. Do not re-propose unless the proposal is
rejected or new facts emerge. If it is rejected, the reason arrives in your inbox: revise per
that reason and propose again.

## Sections

Send only changed sections in \`changes\`. Object sections merge shallowly on apply; arrays
replace the previous list wholesale.

- \`caption\`, \`status\`, \`matterNumber\`, \`currentStage\` (\`pleading\` | \`discovery\` | \`trial\` | \`post\`)
- \`coreFields[]\` / \`systemFields[]\`: \`{ label, value }\`
- \`stages[]\`: \`{ id, label?, dates?, summary? }\`
- \`nextDeadline\`: \`{ date, label }\`
- \`pleading\`: \`{ statusNote?, operativePleading?, pleadingType?, amendmentDeadline?, causesOfAction? }\`
- \`discovery\`: \`{ statusNote?, requests[], meetConfer, pendingMotion, productions[], depositions[] }\`
- \`trial\`: \`{ statusNote?, trialDate?, trialType?, estimatedDuration?, settingStatus?, pretrialDeadlines[], witnesses[], exhibits[], continuancesNote? }\`
- \`postJudgment\`: \`{ statusNote?, judgmentStatus?, judgmentDate?, judgmentAmount?, enforcementStatus?, enforcementDeadline?, enforcementActions? }\`

When a proposal is backed by a Link evidence packet, pass \`sourceMode: "link"\` with the exact
\`sourceRevision\` you were given, and attach only the \`evidence\` references that actually
support it, each with \`fieldPaths\` naming the dashboard fields it supports.
`;

/** The `SKILL.md` body without its frontmatter, for injecting into a lead prompt. */
export function stripSkillFrontmatter(markdown: string): string {
  // \uFEFF: a leading byte-order mark would stop the fence from matching.
  const withoutBom = markdown.replace(/^\uFEFF/u, '');
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/u.exec(withoutBom);
  return (match ? match[1] : withoutBom).trim();
}
