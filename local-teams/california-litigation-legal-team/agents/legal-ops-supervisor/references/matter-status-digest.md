# Matter Dashboard

Use one `matter-dashboard` issue document as the lawyer's status surface for each active matter. Update it only when legal posture, a deliverable, a material risk/deadline, ownership of the next action, or a pending lawyer decision changes. Do not update it for agent starts, internal handoffs, routine progress, or no-change checks.

## Format

```md
# Matter Dashboard

## Current Posture

**Matter:** [Plain-English matter label.]
**Status:** [Working / ready for review / decision needed / waiting on third party / complete.]
**Bottom line:** [One or two sentences stating what matters now.]
**Attorney action:** [No action needed | one specific action and deadline.]

## Active Work

| Workstream | Material status | Latest work product | Next owner/action |
| --- | --- | --- | --- |
| [Only an active or legally relevant workstream] | [Short status] | [Direct link] | [Owner + next step] |

## Recent Material Work

- [Up to three lawyer-relevant developments with direct links.]

## Decision Needed

[Omit when none. Otherwise link one batched first-class decision interaction and state the recommended option and deadline.]
```

## Rules

- The Current Posture section must stand alone.
- Show no more than five active or legally relevant workstreams. Omit `not started`, `not needed`, inactive, and purely internal lanes.
- Show no more than three Recent Material Work items.
- Keep at most one batched lawyer decision open for the matter.
- Link to the controlling work product instead of replaying specialist reports.
- Operational details belong in internal audit records. Mention an operational interruption only when it changes delivery timing, reliability, or attorney action.
- If nothing material changed, do not revise the dashboard.

## Decision Language

When no attorney action is needed:

> No action needed. The next step is owned by [agent/third party].

When a decision is required:

> Decision needed by [date]: [plain-language choice]. Recommendation: [option and one-sentence reason].

When a tool owner must act:

> Delivery is waiting on [specific access/tool issue]. Legal Ops owns the fix; no attorney action is needed.

## Closing Rule

Before a parent matter moves to `done`, `in_review`, or `blocked`, confirm the dashboard identifies the latest work product, any material unresolved issue, and the true next owner. Do not keep a parent blocked for completed child work, stale status, or internal coordination.
