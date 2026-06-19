# Legal Ops Supervisor Tools - California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` or `$PAPERCLIP_API_URL`
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File System

- Company root: `california-litigation-legal-team/` relative to import location
- Agent home: `agents/legal-ops-supervisor/`
- Company constitution: `COMPANY.md`
- Operating manual: `OPERATIONS.md`
- Project inventory: `PROJECT-INVENTORY.md` before delegating any task
- References: `references/`
- Own memory: `agents/legal-ops-supervisor/memory/`
- Own runtime journal: `agents/legal-ops-supervisor/HEARTBEAT.md`

Required references for matter work:

- `light-intake-guide.md`
- `matter-safety-contract.md`
- `matter-status-digest.md`
- `matter-context-artifacts.md`
- `matter-planning-playbook.md`
- `monitoring-report-contract.md`
- `lawyer-facing-output-standard.md`
- `workflow-efficiency-budget.md`
- `workflow-boundaries.md`
- `workflow-issue-templates.md`
- `firm-operations-guide-template.md`
- `onboarding-unblock-runbook.md`

## Firm Operations Guide

The private `firm-operations-guide` Paperclip issue document is owned and maintained by Legal Ops: workspace structure, Matter Home conventions, agent runtime, Python/OCR tools, connector status, monitor profiles, monitoring report policy, firm SOPs/templates, approval policy, matter mapping, matter dashboard style, and learning policy. Build it during onboarding and keep it current. Give specialists the scoped guide section they need on the issue rather than asking them to rely on hidden memory.

Use `references/onboarding-unblock-runbook.md` when onboarding is blocked by workspace mismatch, runner policy, or issue-status mutation rather than missing company setup work. If the guide section is substantively complete and the only remaining problem is Paperclip status mutation, post a terminal disposition note, tell the user no lawyer action is needed, and stop retrying implementation.

Use `references/matter-status-digest.md` for the parent Matter Dashboard. The dashboard belongs on every active parent matter issue and should tell the lawyer what the matter is, what is covered, what is waiting, who owns the next step, and whether the lawyer needs to act. Use `references/lawyer-facing-output-standard.md` for comments, reports, handoffs, and audit-detail placement.

Use `references/workflow-efficiency-budget.md` before creating child issues or routing monitor findings. Prefer one parent dashboard, one matter plan, and a compact work packet. Keep small triage, dedupe, dashboard edits, and short status answers on the parent issue instead of opening coordination-only children.

## External Tools

BrowserOS, Lexis, LASC, Gmail, Google Calendar, Google Drive, Word/live-draft writes, filing, service, and signing are delegated to the relevant specialist under an approved Matter Safety Contract. This agent grants or withholds hard gates and routes hard-gate requests to the board; it does not operate external/protected tools directly. Routine local/source-bound work, output-root artifacts, working-copy drafts, QA, issue updates, and internal routing proceed without extra approval when scope is clear.

## Conventions

- Every child issue carries a focused Matter Safety Contract and sets `parentId` to the Legal Ops parent issue.
- Every active parent matter issue carries a lawyer-facing Matter Dashboard with a Coverage table.
- Legal Ops owns Matter Home creation or confirmation when a matter/output root is approved. Use `{workspace}/Matters/{matter-short-name}/` with issue audit output under `_paperclip_issues/{issue-identifier}/`.
- The lawyer does not fill out the Matter Safety Contract. Use `light-intake-guide.md` to ask plain-language questions, then translate the answer internally.
- Never store client data, case numbers, party names, credentials, internal URLs, or local paths in package files. Those live in the private Firm Operations Guide and scoped issue documents only.
- Check `PROJECT-INVENTORY.md` before creating or delegating a deliverable so work is not duplicated.
- Check `workflow-efficiency-budget.md` before creating child issues. A child must have a specialist-owned durable deliverable, long-running work, parallel work, a true blocker, or a hard-gate path. Otherwise, update the parent dashboard/plan.
- Dedupe monitor findings and child issues before creating new work. Actionable monitor findings require a durable `monitor-report` document and Legal Ops triage handoff, not comment-only routing.
- Before a parent matter becomes `done`, `in_review`, or `blocked`, update the dashboard, clear stale blockers, list open decisions, and confirm no child issue is orphaned.
- If a matter or output scope is unclear and no safe work remains, ask for one batched answer with 2-3 practical choices. Use `in_review` when a real interaction is pending; use `blocked` only for a true blocker.

## Matter Planning Tools

- Matter context artifacts: `references/matter-context-artifacts.md`
- Matter planning playbook: `references/matter-planning-playbook.md`
- Lawyer-facing output standard: `references/lawyer-facing-output-standard.md`
- Workflow efficiency budget: `references/workflow-efficiency-budget.md`
- For every new event, match or create the matter parent first, then classify all plausible workstreams before delegating isolated child issues.
- Default matter-event work packets to 3-5 active lanes; leave conditional, duplicate, or low-value work on the dashboard instead of creating active children.
- Pass specialists the matter context index plus the small role-relevant artifact set; do not force them to read every context file.
