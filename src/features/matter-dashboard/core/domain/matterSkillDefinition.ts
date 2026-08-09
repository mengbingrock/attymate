/**
 * The matter dashboard workflow, as an ordinary user skill.
 *
 * This markdown seeds the app's model-agnostic skill library
 * (`<userData>/skills/library/matter-dashboard/SKILL.md`) the first time the app
 * runs, then is never touched again — the user owns and edits it like any other
 * skill, and each team gets its own copy under `<userData>/skills/teams/<team>/`.
 * The lead is pointed at that on-disk copy rather than being sent this text, so
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

- \`matter_get { teamName, matterId? }\` — the team's matters (with ids), any pending proposal,
  and the section schema. Always call this first: propose only what actually changed.
- \`matter_propose { teamName, matterId?, summary, changes, taskRefs?, sourceMode?, sourceRevision?, evidence? }\`
  — submit a proposal for user review. \`summary\` is a list of plain-language lines describing
  what changed; \`changes\` holds only the sections that changed. Re-proposing replaces your
  previous pending proposal.

## Multiple matters

Matters exist independently of teams; a team may work several. \`matter_get\` lists the
matters linked to this team with their ids. Pass \`matterId\` to both tools; omit it only
when the team has at most one matter. A team with no matter yet proposes without a
\`matterId\` — approving the proposal creates the matter.

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
replace the previous list wholesale — resend the FULL array when changing any record in it,
and keep each record's \`id\` so it stays the same record.

- \`caption\`, \`status\`, \`matterNumber\`, \`client\`, \`caseNumber\`, \`department\`,
  \`currentStage\` (\`pleading\` | \`discovery\` | \`trial\` | \`settlement\` | \`post\`)
- \`coreFields[]\` / \`systemFields[]\`: \`{ label, value }\`
- \`stages[]\`: \`{ id, label?, dates?, summary? }\`
- \`nextDeadline\`: \`{ date, label }\`
- \`parties[]\`: \`{ id?, name, role?, side?, kind?, contact?, phone?, email?, address?, notes? }\`
- \`counsel[]\`: \`{ id?, partyId?, name, role?, firm?, bar?, phone?, email?, address?, notes? }\`
  — \`partyId\` links counsel to the party they represent
- \`pleading\`: \`{ statusNote?, records[] }\`; each record
  \`{ id?, partyId?, type, status?, filed?, served?, responseDue?, responseFiled?, related?, amendmentDue?, claims?, dir? }\`
  (\`partyId\` = filing party; \`dir\` = workspace folder or document path)
- \`discovery\`: \`{ statusNote?, requests[], motions[], meetAndConfers[], productions[], depositions[] }\`
- \`trial\`: \`{ statusNote?, settings[], continuances[], pretrialDeadlines[], pretrialFilings[], witnesses[], exhibits[], motionsInLimine[], sessions[], verdicts[], postTrialMotions[] }\`
- \`settlement\`: \`{ statusNote?, records[] (demands/offers/counteroffers with parties, amount, outcome, terms), mediations[] }\`
- \`postJudgment\`: \`{ statusNote?, judgmentStatus?, judgmentDate?, judgmentAmount?, interest?, satisfaction?, enforcementStatus?, enforcementDeadline?, enforcementActions[] }\`
- \`events[]\`: \`{ id?, date, time?, type?, group?, description?, parties?, docs?, note? }\`
  — MANUAL timeline entries only. The procedural history derives automatically from the
  records above; add \`events\` only for docket facts that have no record home.

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

/**
 * The bundled markdown's `## Sections` and `## Multiple matters` blocks \u2014 the
 * authoritative schema appended at prompt time when the user's installed copy
 * predates the current app version (their edits are never overwritten, but
 * the lead must still learn the current section shapes).
 */
export function extractSkillSchemaReference(): string {
  const blocks: string[] = [];
  for (const heading of ['## Multiple matters', '## Sections']) {
    const start = MATTER_SKILL_MARKDOWN.indexOf(heading);
    if (start === -1) continue;
    const rest = MATTER_SKILL_MARKDOWN.slice(start + heading.length);
    const end = rest.search(/\n## /u);
    blocks.push(`${heading}${end === -1 ? rest : rest.slice(0, end)}`.trim());
  }
  return blocks.join('\n\n');
}
