# California Litigation Legal Team

> Reusable Paperclip `agentcompanies/v1` package for California litigation workflows with supervised issue scope, approvals, and specialist agents — source-bound, matter-scoped, and confidentiality-first.

It packages one board-facing Legal Ops Supervisor, reusable specialist agents, a read-only Gmail Monitor Agent, one opt-in Practice Learning Agent, onboarding tasks, and reusable legal skills for intake, OCR, research, drafting, docket checks, calendaring, QA, workflow learning, and subpoena motion-to-compel work. Paperclip owns coordination (issues, assignment, heartbeats, approvals, audit trail); the legal skills own domain workflow discipline.

## Overview

| Field | Value |
| --- | --- |
| Tags | — |
| Tone | `green` |
| Agents | 10 |
| Projects | 1 (Firm Onboarding) |
| Tasks | 15 (onboarding and paused monitor routines) |
| Goals | 4 |
| Skills | 9 |

## How the firm operates

Hub-and-spoke around a single front door. The **Legal Ops Supervisor** is the only board-facing role: it runs onboarding, takes in each matter, selects the workflow, and creates parent-linked child issues — each carrying a complete **Matter Safety Contract** — for the specialists. Specialists do source-bound work inside their lane, propose, and hand results back; they never self-expand scope. Every action is graded green / yellow / red:

- **Green** — source-bound work proceeds autonomously and is logged.
- **Yellow** — Legal Ops cures routing/scope ambiguity the parent issue already authorizes.
- **Red** — only external side effects, authentication/payment/legal-authority expansion, and destructive or protected mutation require visible board approval before action.

Identity and constraints live in [COMPANY.md](COMPANY.md); operating governance in [OPERATIONS.md](OPERATIONS.md); the deliverable ledger in [PROJECT-INVENTORY.md](PROJECT-INVENTORY.md).

Default intake is **Light Intake Mode**. Legal Ops starts from the user's description, an already-approved monitor summary, or an approved source list; produces an intake summary, missing-input list, and proposed next step; and asks for only the next decision needed to continue. Legal Ops prepares the Matter Safety Contract internally from plain-language answers. Local/source-bound work, output-root artifacts, new output-root working copies, draft recommendations, QA, issue updates, and internal routing proceed without human approval when scope is clear; hard gates still require visible approval.

Active parent matter issues should also carry a **Matter Status Digest**. This is the lawyer-facing summary that explains what the matter is, what the team already did, what is blocking progress, who owns the next step, whether the lawyer needs to act, and what happens next. Technical blocker chains stay available for audit, but they should not be the first thing a lawyer has to decode.

Matter context is reusable but relevance-based. Legal Ops should create or confirm a matter context index for active matters, and specialists should check only the context artifacts relevant to their role and assignment. See `references/matter-context-artifacts.md` for the tiered checking rule and role defaults.

## Org chart

```mermaid
graph TD
  LOS[Legal Ops Supervisor]
  LOS --> SIA[Source Intake Agent]
  LOS --> FEA[Facts & Evidence Agent]
  LOS --> LRA[Legal Research Agent]
  LOS --> DAA[Drafting & Assembly Agent]
  LOS --> QA[Legal QA Agent]
  LOS --> CAL[Calendar Agent]
  LOS --> DOC[Docket Agent]
  LOS --> PLA[Practice Learning Agent]
  LOS --> GMA[Gmail Monitor Agent]
```

## Agents

Each agent is defined by four files: `AGENTS.md` (role, triggers, handoffs, deliverables, decision rights, escalation), `SOUL.md` (identity and operating instincts), `HEARTBEAT.md` (runtime journal), and `TOOLS.md` (Paperclip API, file system, domain tools).

| Agent | Title | Reports to | Key skills |
| --- | --- | --- | --- |
| [Legal Ops Supervisor](agents/legal-ops-supervisor/AGENTS.md) | Reusable Litigation Workflow Supervisor | — | all workflows (front door) |
| [Source Intake Agent](agents/source-intake-agent/AGENTS.md) | Source Intake, Pleading Review, and OCR Specialist | legal-ops-supervisor | ca-pleading-intake-review, docling-pdf-processing |
| [Facts & Evidence Agent](agents/facts-evidence-agent/AGENTS.md) | Facts, Evidence, Exhibits, and Citation Table Specialist | legal-ops-supervisor | ca-litigation-drafting-workflow |
| [Legal Research Agent](agents/legal-research-agent/AGENTS.md) | Lexis Research and Citation Verification Specialist | legal-ops-supervisor | lexis-browseros-legal-research |
| [Drafting & Assembly Agent](agents/drafting-assembly-agent/AGENTS.md) | California Litigation Drafting and Working-Copy Assembly Specialist | legal-ops-supervisor | ca-litigation-drafting-workflow, ca-subpoena-mtc-drafting-workflow |
| [Legal QA Agent](agents/legal-qa-agent/AGENTS.md) | Confidentiality and Source Discipline Reviewer | legal-ops-supervisor | ca-litigation-drafting-workflow, lexis-browseros-legal-research |
| [Calendar Agent](agents/calendar-agent/AGENTS.md) | Litigation Calendar Proposal Specialist | legal-ops-supervisor | legal-calendaring-workflow |
| [Docket Agent](agents/docket-agent/AGENTS.md) | Public Docket Check Specialist | legal-ops-supervisor | lasc-browseros-docket-check |
| [Practice Learning Agent](agents/practice-learning-agent/AGENTS.md) | Private Workflow Learning Specialist | legal-ops-supervisor | practice-workflow-learning |
| [Gmail Monitor Agent](agents/gmail-monitor-agent/AGENTS.md) | Read-Only Legal Intake Monitor | legal-ops-supervisor | — (read-only routing) |

## Goals

- [Complete firm onboarding and runtime readiness](goals/complete-firm-onboarding-and-runtime-readiness/GOAL.md)
- [Run matter-scoped litigation work safely](goals/run-matter-scoped-litigation-work-safely/GOAL.md)
- [Produce source-bound litigation work product](goals/produce-source-bound-litigation-work-product/GOAL.md)
- [Improve firm workflow through opt-in learning](goals/improve-firm-workflow-through-opt-in-learning/GOAL.md)

## Projects

- [Firm Onboarding](projects/firm-onboarding/PROJECT.md) — import-time onboarding to configure workspace, runtime, local tools, connectors, Gmail/Calendar/Docket monitor profiles, SOPs, matter mapping, and policy before any live matter work. Twelve setup tasks are owned by the Legal Ops Supervisor, and three paused recurring monitor tasks are imported for Gmail, Calendar, and Docket monitoring.

The subpoena motion-to-compel workflow is a skill-triggered workflow owned by Legal Ops and the unified specialists — not an import-time project or a separate sub-organization. Live work begins only from a user-created parent issue with a complete Matter Safety Contract.

## Skills

`legal-calendaring-workflow` · `lexis-browseros-legal-research` · `ca-litigation-drafting-workflow` · `ca-pleading-intake-review` · `docling-pdf-processing` · `lasc-browseros-docket-check` · `ca-subpoena-mtc-autonomous-runner` · `ca-subpoena-mtc-drafting-workflow` · `practice-workflow-learning`

## Import

From a running Paperclip instance:

```powershell
npx.cmd paperclipai company import https://github.com/mengbingrock/attymate/tree/master/companies/california-litigation-legal-team --target new --new-company-name "California Litigation Legal Team" --include company,goals,agents,projects,tasks,skills --yes --api-base http://127.0.0.1:3100
```

For local development from a checked-out repository:

```powershell
npx.cmd paperclipai company import .\companies\california-litigation-legal-team --target new --new-company-name "California Litigation Legal Team" --include company,goals,agents,projects,tasks,skills --yes --api-base http://127.0.0.1:3100
```

To import the company without onboarding starter issues, omit `tasks` from `--include`.

## Onboarding Troubleshooting

Use `references/onboarding-unblock-runbook.md` when onboarding is blocked by workspace selection, runner policy, or Paperclip status-update tooling. The active AttyMate WORKSPACE selection is the deployment source of truth; deployment-specific paths belong in the private Firm Operations Guide and must not be committed to this reusable package.

If an onboarding task is substantively complete but the issue cannot be marked done, record the terminal disposition and route the technical blocker to the Paperclip/AttyMate product owner instead of rerunning the same setup task.

## Post-Import Setup

- Complete the imported Firm Onboarding issues before live matter work.
- Configure each `codex_local` agent with the deployment's absolute `cwd` / workspace root.
- Configure authenticated Codex CLI access or an approved deployment-specific API-key auth mechanism.
- Configure Python, OCR/PDF tooling, Docling or equivalent local processing, and approved output roots.
- Review executable-script trust before using repo helper scripts. The MTC drafting skill references an optional local OCR helper at `skills/ca-subpoena-mtc-drafting-workflow/scripts/ocr_pdf_intake.ps1`; it requires explicit `{matter_root}` / `{output_root}` scope, writes only under the approved output root, and must be run only in a deployment-approved Python/OCR environment. Paperclip company import stores the markdown skill/reference files; deployments that want the helper should review and copy or run it from the repository source after approval.
- Set budgets, model choices, and approval policies appropriate for the deployment.
- Use the relaxed default approval matrix for testing and product iteration: proceed on local/source-bound output-root work and stop only for external side effects, authentication/payment/legal-authority expansion, or destructive/protected mutation. Use `approval_profile: sandbox_autopilot` to label local non-client-facing test matters.
- Configure external-tool access before use: BrowserOS or equivalent browser tooling, Gmail, Google Calendar, Google Drive, Lexis, LASC, external knowledge-base/upload systems, filing, service, and upload/download workflows.
- Configure `gmail_monitor_profile`, `calendar_monitor_profile`, `docket_monitor_profile`, and `monitoring_report_policy` before enabling monitor routines.
- Keep monitor routines paused until the board/operator approves the profile and schedule. Monitor reports go to Legal Ops Supervisor; monitors do not open substantive legal work directly.
- Use `references/matter-planning-playbook.md` when a new event arrives. Legal Ops should match or create the matter parent, classify all plausible workstreams, create child issues for safe work now, and record strategy/source/approval blockers in one batched plan.
- Use `references/matter-context-artifacts.md` to create or maintain matter context. Agents should check the matter context index plus role-relevant artifacts, not the entire context folder by default.
- Keep the completed Firm Operations Guide private to the deployment.
- Start live work only from a parent issue assigned to Legal Ops Supervisor.
- Keep the parent issue's Matter Status Digest current whenever child issues are created, blockers change, or the lawyer asks for status.
- Let Legal Ops translate lawyer-facing intake answers into the Matter Safety Contract. A live issue should still carry `{matter_root}` or an approved source set, `{output_root}` when configured, Firm Operations Guide reference, read-only source roots, forbidden roots, allowed outputs, autonomy level, learning mode, approval profile, and hard gates, but lawyers should be asked for these in plain language.

## Confidentiality And Portability

This package is intended for public reuse. Do not add client names, matter identifiers, case numbers, firm-specific procedures, private URLs, credentials, account IDs, knowledge-base IDs, calendar IDs, hardcoded local paths, or source matter files.

Deployment-specific behavior belongs in issue contracts, the private Firm Operations Guide, local adapter configuration, or private firm policy documents supplied at runtime. MTC remains a workflow owned by Legal Ops and the unified specialists, not an import-time project or separate sub-organization. Gmail monitoring is optional and read-only until configured. Practice learning is opt-in and private by default.

## References

- Agent Companies specification: https://agentcompanies.io/specification
- Paperclip: https://github.com/paperclipai/paperclip
