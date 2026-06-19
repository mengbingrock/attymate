# Matter Planning Playbook

Legal Ops Supervisor uses this playbook whenever a user request, monitor finding, new source, or litigation event may affect a matter. The goal is to identify the matter, map the event, and plan all triggered workstreams at once.

## Matter Resolution

1. Check the parent issue, Firm Operations Guide matter mapping, and any supplied issue context for an existing matter match.
2. Match by lawyer-provided label, case number, court, parties, source summary, or existing matter context index. Do not inspect unrelated matter folders to guess.
3. If the match is reliable, attach the event to the existing parent matter issue and update the Matter Dashboard.
4. If no reliable match exists but the user clearly wants new matter setup, create a new parent matter issue with a tentative label and safe source scope.
5. If neither is clear, ask one plain-language question with practical choices before creating specialist child issues.

When a matter/output root is approved, create or confirm the Matter Home described in `references/matter-context-artifacts.md`. If not approved, keep outputs in parent issue documents and mark the Matter Dashboard as `not yet filed into Matter Home`.

## Event Plan

For each matter event, create or update a concise Matter Plan on the parent issue. Classify each possible workstream as:

- `create now` - safe, source-bound work can begin with the current scope.
- `schedule/monitor` - timing should be tracked through a proposed deadline table, issue monitor, or routine where supported.
- `conditional on lawyer strategy` - prepare the question or recommendation, but do not draft or launch the strategy-dependent work until confirmed.
- `blocked on source/approval` - name the missing source, profile, or hard-gate approval.
- `no action with reason` - explain why the workstream is not needed.

Use the active Matter Safety Contract, not hidden memory, as the source of authority for child issues. Each child issue should include the relevant matter context artifact paths from `references/matter-context-artifacts.md`, not the full folder by default.

## Work Packet Before Child Issues

Before creating children, write a compact work packet on the parent Matter Plan:

- event;
- one-line legal/work-product objective;
- available source scope;
- planned active lanes;
- deferred or conditional lanes;
- next lawyer decision, if any.

Default active child lanes are capped at `3-5`. More than five active children for one matter event requires an explicit reason in the Matter Dashboard.

Use the no-child rule from `references/workflow-efficiency-budget.md`: dashboard edits, dedupe, monitor triage, short status answers, and small safe local updates stay on the parent issue.

## Matter Dashboard Coverage

Every planning pass must update the parent Matter Dashboard from `references/matter-status-digest.md`. The dashboard is the lawyer-facing source of truth and must include a Coverage table with these rows:

| Workstream | Default treatment |
| --- | --- |
| Intake / matter mapping | Identify existing matter or temporary parent. |
| Source review | Create only if a safe source set exists or a source approval is needed. |
| Calendar / deadlines | Propose dates and reminders; calendar writes stay gated. |
| Docket / procedural history | Use public/read-only or approved docket facts; route deadlines to Calendar. |
| Discovery | Track source-bound discovery issues; strategy-dependent motions stay conditional. |
| Drafting | Draft local recommendations or rough artifacts only when source scope supports them. |
| Research / authorities | Use supplied authorities by default; external/new authorities stay gated. |
| QA / review | Create when a draft or source-bound artifact needs review. |
| External actions | Record only approved hard gates; never imply external action is authorized. |
| Blocked decisions | Batch the smallest useful lawyer/board decision. |

Do not make the lawyer inspect child issue chains to know whether a workstream is covered. Link the latest artifact in the dashboard and keep detailed audit notes in child issues.

## Question Batching

Ask at most one pending decision per matter planning cycle. Batch related choices into one plain-English prompt when a lawyer decision is required. Prefer choices like:

- close / no action;
- proceed with safe local work;
- provide a source package or Matter Home path;
- approve one named hard-gate action.

If safe local/source-bound work can continue, create or update the relevant child issue and continue without asking. If no safe work remains, ask the batched decision and set the parent to `in_review`, not `blocked`, when a real interaction is pending.

## Common Event Patterns

| Event | Workstreams to consider |
| --- | --- |
| New complaint or amended complaint | Source intake, pleading/service index, party/counsel/court info, procedural history, responsive deadline proposal, strategy questions, possible research, drafting plan |
| Answer received | Source intake, procedural history update, deadline review, discovery planning, form interrogatories if strategy confirms, demurrer/strike or other response only if strategy confirms, party/counsel updates |
| Discovery served or received | Source index, discovery tracker, response deadline proposal, deficiency review, meet-and-confer plan, motion-to-compel pathway if strategy confirms |
| New order or hearing notice | Source intake, procedural history, calendar proposal, court/rules check, drafting or compliance tasks if required |
| Docket change | Docket report, procedural history update, calendar proposal if deadlines may change, Legal Ops triage before substantive child issues |
| Email or calendar monitor finding | Triage summary, matter match/new matter decision, source approval question if needed, then scoped child issues |

## Child Issue Rules

- Set `parentId` to the matter parent issue.
- Assign the correct specialist agent.
- Include the focused Matter Safety Contract fields needed for the child.
- Include a small relevant artifact set, based on the tiered context rules.
- Place or link lawyer-facing outputs in the Matter Home when approved; keep issue audit output under `_paperclip_issues/{issue-identifier}` when filesystem output is used.
- Create children only for specialist-owned durable deliverables, longer specialist/tool runs, parallel lanes, true blockers, hard-gate approval paths, or review of an existing draft/artifact.
- Do not create child issues for coordination-only work, dashboard edits, dedupe notes, minor monitor cues, or another plan with no deliverable.
- Do not create every possible downstream drafting issue as active work when it depends on lawyer strategy. Create a strategy-confirmation question or a blocked/conditional planning item instead.
- Use Calendar Agent for proposed deadlines and pre-deadline reminders. Calendar writes, invites, notifications, and emails remain hard gates.

## Parent Cleanup Rule

Before a parent matter is set to `done`, `in_review`, or `blocked`, Legal Ops must:

- update the Matter Dashboard and Coverage table;
- clear stale `blockedByIssueIds` that have resolved;
- list exactly what remains open and who owns it;
- verify that every child issue is done, not needed, linked in Coverage, or blocked by a named pending decision;
- avoid `blocked` when the real state is an answered/ pending interaction or an active agent dependency.

A parent matter must not remain blocked without either a first-class blocker or a pending user/board interaction.

## Completion Standard

A matter planning pass is complete when the parent issue shows:

- existing matter match or new matter creation decision;
- the event being planned;
- all plausible workstreams classified;
- child issues created for safe work now;
- scheduled/monitor items recorded where supported;
- strategy, source, or approval blockers batched into the smallest useful lawyer question;
- Matter Dashboard updated with coverage, latest artifacts, owner, next action, and whether the lawyer needs to act.
