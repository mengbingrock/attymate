# Project Inventory — California Litigation Legal Team

## Purpose

Read this before creating any task, delegated task, or deliverable. This is the firm's inventory of what exists and what is in flight. If the deliverable already appears here, do not create a second version; reference the existing work and update its status instead.

Update this file after every completed deliverable. Keeping the inventory current is part of every agent's definition of done.

## Completed deliverables

| Deliverable | Owner | Location | Completed |
|---|---|---|---|
| *(none yet — starter package just generated)* | — | — | — |

## Starter projects

### Firm Onboarding

**Owner:** `legal-ops-supervisor`
**Goal:** `complete-firm-onboarding-and-runtime-readiness`
**Description:** Import-time onboarding to configure a reusable litigation AI firm — workspace, runtime, tools, connectors, monitor profiles, imported monitor routines, SOPs, matter mapping, matter context conventions, and policy — before any live matter work. The durable output is the private Firm Operations Guide (`firm-operations-guide`).
**Success condition:** All one-time setup tasks closed; Email/Calendar/Docket monitor routines imported and left paused until enabled; Firm Operations Guide complete and current; readiness smoke test posted green; learning mode set to `off` with an explicit opt-in path documented.

**Expected deliverables (onboarding tasks):**
- Configure workspace structure — `legal-ops-supervisor`
- Configure agent runtime (pi/the pi orchestrator) — `legal-ops-supervisor`
- Configure local tools (Python, OCR/PDF, Docling) — `legal-ops-supervisor`
- Connect external tools (email provider, calendar provider, Drive, filing) — `legal-ops-supervisor`
- Configure Email monitoring profile and verify paused routine — `legal-ops-supervisor`
- Configure Calendar monitoring profile and verify paused routine — `legal-ops-supervisor`
- Configure Docket monitoring profile and verify paused routine — `legal-ops-supervisor`
- Run Email monitor routine (paused until enabled) — `email-monitor-agent`
- Run Calendar monitor routine (paused until enabled) — `calendar-agent`
- Run Docket monitor routine (paused until enabled) — `docket-agent`
- Maintain Firm Operations Guide (`firm-operations-guide` task artifact) — `legal-ops-supervisor`
- Onboard firm SOPs & templates — `legal-ops-supervisor`
- Onboard existing matters (high-level mapping, no client facts in package) — `legal-ops-supervisor`
- Run environment readiness smoke (green/yellow/red table) — `legal-ops-supervisor`
- Configure learning/feedback policy (default `off`) — `legal-ops-supervisor`

**Status:** `in_progress`

## Matter workflows (skill-triggered, not import-time projects)

These are reusable workflows owned by Legal Ops Supervisor and the unified specialists. They are **not** import-time starter projects and do **not** create a separate sub-organization. Live work begins only from a user-created matter record with a complete Matter Safety Contract and a lawyer-facing Matter Dashboard. For each new event, use `references/matter-planning-playbook.md` to map the matter, confirm the Matter Home or task-document fallback, and classify all plausible workstreams before delegating individual delegated tasks.

| Workflow | Entry skill | Owner | Notes |
|---|---|---|---|
| Subpoena motion-to-compel run | `ca-subpoena-mtc-autonomous-runner` | legal-ops-supervisor | MTC Launch Intake → delegate to specialists. See `references/workflow-task-templates.md`. |
| Pleading intake & review | `ca-pleading-intake-review` | source-intake-agent | Source-bound, read-only intake. |
| California litigation drafting | `ca-litigation-drafting-workflow` | drafting-assembly-agent | Source-bound drafts under output root. |
| Legal calendaring | `legal-calendaring-workflow` | calendar-agent | Proposals first; writes are hard-gated. |
| Public docket check | deferred — no browser tooling; manual follow-up | docket-agent | Public records only; paid/login/CAPTCHA gates not crossed. |
| Supplied-authority research & citation verification | `supplied-authority-legal-research` | legal-research-agent | External research hard-gated. |
| Opt-in workflow learning | `practice-workflow-learning` | practice-learning-agent | Off by default; explicit learning contract required. |

## In-flight deliverables

| Deliverable | Owner | Started | ETA |
|---|---|---|---|
| *(none claimed yet)* | — | — | — |

## Protocol

**Adding a completed deliverable:** move its row from "In-flight" to "Completed deliverables" with the completion date and the on-disk location or task reference. Do not record client facts or matter identifiers here — use the deliverable's task link.

**Claiming a deliverable:** add a row to "In-flight deliverables" before starting. If another agent already claimed it, comment on that work instead of duplicating it.

**Removing a starter project:** strike through the block and record the decision. Do not delete the history.
