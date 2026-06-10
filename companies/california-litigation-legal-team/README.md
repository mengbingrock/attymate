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
| Tasks | 9 (onboarding) |
| Goals | 4 |
| Skills | 9 |

## How the firm operates

Hub-and-spoke around a single front door. The **Legal Ops Supervisor** is the only board-facing role: it runs onboarding, takes in each matter, selects the workflow, and creates parent-linked child issues — each carrying a complete **Matter Safety Contract** — for the specialists. Specialists do source-bound work inside their lane, propose, and hand results back; they never self-expand scope. Every action is graded green / yellow / red:

- **Green** — source-bound work proceeds autonomously and is logged.
- **Yellow** — Legal Ops cures routing/scope ambiguity the parent issue already authorizes.
- **Red** — filing, service, signing, email, live-draft writes, external research/auth, paid retrieval, calendar writes, and finalization require visible board approval before action.

Identity and constraints live in [COMPANY.md](COMPANY.md); operating governance in [OPERATIONS.md](OPERATIONS.md); the deliverable ledger in [PROJECT-INVENTORY.md](PROJECT-INVENTORY.md).

Default intake is **Light Intake Mode**. Legal Ops starts from the user's description, an already-approved monitor summary, or an approved source list; produces an intake summary, missing-input list, and proposed next step; and asks for only the next decision needed to continue. Legal Ops prepares the Matter Safety Contract internally from plain-language answers. Red gates still require visible approval.

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

- [Firm Onboarding](projects/firm-onboarding/PROJECT.md) — import-time onboarding to configure workspace, runtime, local tools, connectors, SOPs, matter mapping, and policy before any live matter work. Nine onboarding tasks, all owned by the Legal Ops Supervisor.

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

## Post-Import Setup

- Complete the imported Firm Onboarding issues before live matter work.
- Configure each `codex_local` agent with the deployment's absolute `cwd` / workspace root.
- Configure authenticated Codex CLI access or an approved deployment-specific API-key auth mechanism.
- Configure Python, OCR/PDF tooling, Docling or equivalent local processing, and approved output roots.
- Review executable-script trust before using repo helper scripts. The MTC drafting skill references an optional local OCR helper at `skills/ca-subpoena-mtc-drafting-workflow/scripts/ocr_pdf_intake.ps1`; it requires explicit `{matter_root}` / `{output_root}` scope, writes only under the approved output root, and must be run only in a deployment-approved Python/OCR environment. Paperclip company import stores the markdown skill/reference files; deployments that want the helper should review and copy or run it from the repository source after approval.
- Set budgets, model choices, and approval policies appropriate for the deployment.
- Configure external-tool access before use: BrowserOS or equivalent browser tooling, Gmail, Google Calendar, Google Drive, Lexis, LASC, external knowledge-base/upload systems, filing, service, and upload/download workflows.
- Configure `gmail_monitor_profile` before enabling Gmail Monitor Agent routines.
- Keep the completed Firm Operations Guide private to the deployment.
- Start live work only from a parent issue assigned to Legal Ops Supervisor.
- Let Legal Ops translate lawyer-facing intake answers into the Matter Safety Contract. A live issue should still carry `{matter_root}` or an approved source set, `{output_root}` when configured, Firm Operations Guide reference, read-only source roots, forbidden roots, allowed outputs, autonomy level, learning mode, and red gates, but lawyers should be asked for these in plain language.

## Confidentiality And Portability

This package is intended for public reuse. Do not add client names, matter identifiers, case numbers, firm-specific procedures, private URLs, credentials, account IDs, knowledge-base IDs, calendar IDs, hardcoded local paths, or source matter files.

Deployment-specific behavior belongs in issue contracts, the private Firm Operations Guide, local adapter configuration, or private firm policy documents supplied at runtime. MTC remains a workflow owned by Legal Ops and the unified specialists, not an import-time project or separate sub-organization. Gmail monitoring is optional and read-only until configured. Practice learning is opt-in and private by default.

## References

- Agent Companies specification: https://agentcompanies.io/specification
- Paperclip: https://github.com/paperclipai/paperclip
