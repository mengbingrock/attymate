# Matter Dashboard

Use this on every active parent matter issue. It is the lawyer-facing control page for the matter: what the team knows, what has been covered, what is waiting, and where the latest work product lives. It replaces long technical status digests as the default parent-matter summary.

Preferred issue-document key: `matter-dashboard`. If an existing company or imported matter already uses `matter-status-digest`, Legal Ops may update that document in the same format until the matter is migrated.

Legal Ops Supervisor owns the dashboard. Update it when a parent matter is created, a monitor finding is routed, child issues are created or completed, a blocker changes, a lawyer answers an interaction, a specialist reports a hard gate, or the lawyer asks for status.

## Required Format

```md
# Matter Dashboard

## Status

**Matter:** [Plain-English matter label.]
**Current posture:** [Working / needs your input / waiting on agent / ready for review / done.]
**Bottom line:** [1-2 sentences: what happened, why it matters, and whether lawyer action is needed.]
**Next action:** [Owner + next step. If lawyer action is needed, ask one decision with 2-3 choices.]

## Coverage

| Workstream | Status | Owner | Latest artifact | Next action |
| --- | --- | --- | --- | --- |
| Intake / matter mapping | Not started / working / covered / waiting / not needed | Legal Ops | [link] | [next step] |
| Source review | Not started / working / covered / waiting / not needed | Source Intake | [link] | [next step] |
| Calendar / deadlines | Not started / working / covered / waiting / not needed | Calendar Agent | [link] | [next step] |
| Docket / procedural history | Not started / working / covered / waiting / not needed | Docket or Facts | [link] | [next step] |
| Discovery | Not started / working / covered / waiting / not needed | Facts / Legal Ops | [link] | [next step] |
| Drafting | Not started / working / covered / waiting / not needed | Drafting | [link] | [next step] |
| Research / authorities | Not started / working / covered / waiting / not needed | Research | [link] | [next step] |
| QA / review | Not started / working / covered / waiting / not needed | QA | [link] | [next step] |
| External actions | Not approved / approved / done / not needed | Legal Ops | [link] | [next step] |
| Blocked decisions | None / needs lawyer / needs tool owner | Legal Ops | [link] | [one decision] |

## Recent Work

- [Short, lawyer-readable progress item with link.]

## Open Decisions

- [One batched decision when needed, with 2-3 choices.]

## Audit Details

- Scope, hard gates, source limits, and technical issue links, only as needed for audit.
```

## Style Rules

- Write for a busy lawyer, not for an engineer.
- The top `Status` section must be enough to understand the matter without reading child issues.
- The `Coverage` table is mandatory, even when most rows say `not started` or `not needed`.
- Use links to child issues and documents instead of replaying their reports.
- Put technical safety language in `Audit Details`; do not lead with it.
- If no lawyer action is needed, say `No action needed from you right now`.
- If lawyer action is needed, ask one batched decision and offer 2-3 practical choices.

## Blocker Language

When a blocker is covered by active agent work:

> No action needed from you right now. The team is working on the dependency.

When a lawyer or board decision is needed:

> I need one thing before I can continue: [plain-language decision].

When a tool or connector cannot complete a step:

> The team reached a tool limit: [plain-language limit]. The safe next choices are [choice A] or [choice B].

## Parent Cleanup Rule

Before setting a parent matter to `done`, `in_review`, or `blocked`, Legal Ops must update the Matter Dashboard, clear stale blockers, list open decisions, and confirm that all child issues are either done, not needed, blocked by a named decision, or linked in the Coverage table. A parent must not remain blocked without a first-class blocker or a pending interaction.
