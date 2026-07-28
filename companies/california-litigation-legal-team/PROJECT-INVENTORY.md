# Project Inventory — California Litigation Legal Team

## Purpose

Read this before creating any task, child issue, or deliverable. This is the firm's inventory of what exists and what is in flight. If the deliverable already appears here, do not create a second version; reference the existing work and update its status instead.

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
**Success condition:** All one-time setup tasks closed; Email/Calendar/Docket monitor routines imported and left paused until enabled; Firm Operations Guide complete and current; readiness smoke test posted ready; learning mode set to `off` with an explicit opt-in path documented.

**Expected deliverables (onboarding tasks):**
- Configure workspace structure — `legal-ops-supervisor`
- Configure agent runtime (Codex/Paperclip) — `legal-ops-supervisor`
- Configure local tools (Python, local OCR/PDF, optional layout backends) — `legal-ops-supervisor`
- Connect external tools (BrowserOS, email provider, calendar provider, Drive, Lexis, LASC, filing) — `legal-ops-supervisor`
- Configure Email monitoring profile and verify paused routine — `legal-ops-supervisor`
- Configure Calendar monitoring profile and verify paused routine — `legal-ops-supervisor`
- Configure Docket monitoring profile and verify paused routine — `legal-ops-supervisor`
- Run Email monitor routine (paused until enabled) — `email-monitor-agent`
- Run Calendar monitor routine (paused until enabled) — `calendar-agent`
- Run Docket monitor routine (paused until enabled) — `docket-agent`
- Maintain Firm Operations Guide (`firm-operations-guide` issue document) — `legal-ops-supervisor`
- Onboard firm SOPs & templates — `legal-ops-supervisor`
- Onboard existing matters (high-level mapping, no client facts in package) — `legal-ops-supervisor`
- Run environment readiness smoke (ready/limited/not ready) — `legal-ops-supervisor`
- Configure learning/feedback policy (default `off`) — `legal-ops-supervisor`

**Status:** `in_progress`

## Matter capabilities (skill-triggered, not import-time projects)

These are reusable legal capabilities owned by Legal Ops Supervisor and the unified specialists. They are **not** import-time starter projects and do **not** create a separate sub-organization. Live work begins from a user-created parent issue with a Matter Authorization Package and a lawyer-facing Matter Dashboard. Descendants inherit that authorization through focused work assignments.

| Capability | Entry skill | Owner | Professional result |
|---|---|---|---|
| Matter intake | `legal-matter-intake` | legal-ops-supervisor | Authorized Matter, defined objective, and focused work assignments. |
| California pleading review | `california-pleading-review` | source-intake-agent | Procedural and substantive pleading analysis with stable source references. |
| California litigation drafting & motion practice | `california-litigation-drafting` | drafting-assembly-agent | Reviewable, source-supported litigation work product and motion packages; MTC is one supported profile. |
| Litigation deadline management | `litigation-deadline-management` | calendar-agent | Verified proposed dates, authority, consequence, and owner. |
| Court docket review | `court-docket-review` | docket-agent | Material docket event, practical effect, and recommended action. |
| Legal research | `legal-research` | legal-research-agent | Verified authority analysis, adverse authority, application, and recommendation. |
| Legal document intake | `legal-document-intake` | source-intake-agent | Page-complete review set with material exceptions. |
| Legal practice improvement | `legal-practice-improvement` | practice-learning-agent | Authorized, sanitized, reusable practice recommendations. |

## In-flight deliverables

| Deliverable | Owner | Started | ETA |
|---|---|---|---|
| *(none claimed yet)* | — | — | — |

## Protocol

**Adding a completed deliverable:** move its row from "In-flight" to "Completed deliverables" with the completion date and the on-disk location or issue reference. Do not record client facts or matter identifiers here — use the deliverable's issue link.

**Claiming a deliverable:** add a row to "In-flight deliverables" before starting. If another agent already claimed it, comment on that work instead of duplicating it.

**Removing a starter project:** strike through the block and record the decision. Do not delete the history.
