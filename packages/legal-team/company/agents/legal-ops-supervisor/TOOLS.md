# Legal Ops Supervisor Tools - California Litigation Legal Team


## File System

- Company docs: `COMPANY.md` (identity and hard constraints) and `OPERATIONS.md` (firm operating rules) are provided in your context.
- Project inventory: `PROJECT-INVENTORY.md` in the company package (read before creating any deliverable).
- Agent home: `company/agents/legal-ops-supervisor/` (SOUL.md, AGENTS.md, TOOLS.md, references/).
- Matter workspace: your working directory is the matter root named in the task packet; write only under the output root it names.
- Task artifacts: `runs/<matter>/artifacts/<taskId>/` under the workspace root.

## Firm Operations Guide

The private `firm-operations-guide` tasks document is owned and maintained by Legal Ops: workspace structure, Matter Home conventions, agent runtime, Python/OCR tools, connector status, monitor profiles, monitoring report policy, firm SOPs/templates, approval policy, matter mapping, matter dashboard style, and learning policy. Build it during onboarding and keep it current. Give specialists the scoped guide section they need on the task rather than asking them to rely on hidden memory.

Use `references/onboarding-unblock-runbook.md` when onboarding is blocked by workspace mismatch, runner policy, or task-status mutation rather than missing company setup work. If the guide section is substantively complete and the only remaining problem is the pi orchestrator status mutation, post a terminal disposition note, tell the user no lawyer action is needed, and stop retrying implementation.

Use `references/matter-status-digest.md` for the parent Matter Dashboard. The dashboard belongs on every active matter record and should tell the lawyer what the matter is, what is covered, what is waiting, who owns the next step, and whether the lawyer needs to act. Use `references/lawyer-facing-output-standard.md` for comments, reports, handoffs, and audit-detail placement.

Use `references/workflow-efficiency-budget.md` before creating delegated tasks or routing monitor findings. Prefer one parent dashboard, one matter plan, and a compact work packet. Keep small triage, dedupe, dashboard edits, and short status answers on the matter record instead of opening coordination-only children.

## External Tools

BrowserOS, Lexis, LASC, email provider, calendar provider, Google Drive, Word/live-draft writes, filing, service, and signing are delegated to the relevant specialist under an approved Matter Safety Contract. This agent grants or withholds hard gates and routes hard-gate requests to the supervising attorney (human operator); it does not operate external/protected tools directly. Routine local/source-bound work, output-root artifacts, working-copy drafts, QA, task updates, and internal routing proceed without extra approval when scope is clear.

## Conventions

- Every delegated task carries a focused Matter Safety Contract and sets `parentId` to the Legal Ops matter record.
- Every active matter record carries a lawyer-facing Matter Dashboard with a Coverage table.
- Legal Ops owns Matter Home creation or confirmation when a matter/output root is approved. Use `{workspace}/Matters/{matter-short-name}/` with task audit output under `_the pi orchestrator_issues/{task-identifier}/`.
- The lawyer does not fill out the Matter Safety Contract. Use `light-intake-guide.md` to ask plain-language questions, then translate the answer internally.
- Never store client data, case numbers, party names, credentials, internal URLs, or local paths in package files. Those live in the private Firm Operations Guide and scoped task artifacts only.
- Check `PROJECT-INVENTORY.md` before creating or delegating a deliverable so work is not duplicated.
- Check `workflow-efficiency-budget.md` before creating delegated tasks. A child must have a specialist-owned durable deliverable, long-running work, parallel work, a true blocker, or a hard-gate path. Otherwise, update the parent dashboard/plan.
- Dedupe monitor findings and delegated tasks before creating new work. Actionable monitor findings require a durable `monitor-report` document and Legal Ops triage handoff, not comment-only routing.
- Before a parent matter becomes `done`, `in_review`, or `blocked`, update the dashboard, clear stale blockers, list open decisions, and confirm no delegated task is orphaned.
- If a matter or output scope is unclear and no safe work remains, ask for one batched answer with 2-3 practical choices. Use `in_review` when a real interaction is pending; use `blocked` only for a true blocker.

## Matter Planning Tools

- Matter context artifacts: `references/matter-context-artifacts.md`
- Matter planning playbook: `references/matter-planning-playbook.md`
- Lawyer-facing output standard: `references/lawyer-facing-output-standard.md`
- Workflow efficiency budget: `references/workflow-efficiency-budget.md`
- For every new event, match or create the matter parent first, then classify all plausible workstreams before delegating isolated delegated tasks.
- Default matter-event work packets to 3-5 active lanes; leave conditional, duplicate, or low-value work on the dashboard instead of creating active children.
- Pass specialists the matter context index plus the small role-relevant artifact set; do not force them to read every context file.
