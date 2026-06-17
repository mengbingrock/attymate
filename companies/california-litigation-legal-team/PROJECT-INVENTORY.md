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
**Description:** Import-time onboarding to configure a reusable litigation AI firm — workspace, runtime, tools, connectors, monitor profiles, SOPs, matter mapping, and policy — before any live matter work. The durable output is the private Firm Operations Guide (`firm-operations-guide`).
**Success condition:** All onboarding tasks closed; Firm Operations Guide complete and current; readiness smoke test posted green; learning mode set to `off` with an explicit opt-in path documented.

**Expected deliverables (onboarding tasks):**
- Configure workspace structure — `legal-ops-supervisor`
- Configure agent runtime (Codex/Paperclip) — `legal-ops-supervisor`
- Configure local tools (Python, OCR/PDF, Docling) — `legal-ops-supervisor`
- Connect external tools (BrowserOS, Gmail, Calendar, Drive, Lexis, LASC, filing) — `legal-ops-supervisor`
- Configure Gmail monitoring profile and paused routine plan — `legal-ops-supervisor`
- Configure Calendar monitoring profile and paused routine plan — `legal-ops-supervisor`
- Configure Docket monitoring profile and paused routine plan — `legal-ops-supervisor`
- Maintain Firm Operations Guide (`firm-operations-guide` issue document) — `legal-ops-supervisor`
- Onboard firm SOPs & templates — `legal-ops-supervisor`
- Onboard existing matters (high-level mapping, no client facts in package) — `legal-ops-supervisor`
- Run environment readiness smoke (green/yellow/red table) — `legal-ops-supervisor`
- Configure learning/feedback policy (default `off`) — `legal-ops-supervisor`

**Status:** `in_progress`

## Matter workflows (skill-triggered, not import-time projects)

These are reusable workflows owned by Legal Ops Supervisor and the unified specialists. They are **not** import-time starter projects and do **not** create a separate sub-organization. Live work begins only from a user-created parent issue with a complete Matter Safety Contract.

| Workflow | Entry skill | Owner | Notes |
|---|---|---|---|
| Subpoena motion-to-compel run | `ca-subpoena-mtc-autonomous-runner` | legal-ops-supervisor | MTC Launch Intake → delegate to specialists. See `references/workflow-issue-templates.md`. |
| Pleading intake & review | `ca-pleading-intake-review` | source-intake-agent | Source-bound, read-only intake. |
| California litigation drafting | `ca-litigation-drafting-workflow` | drafting-assembly-agent | Source-bound drafts under output root. |
| Legal calendaring | `legal-calendaring-workflow` | calendar-agent | Proposals first; writes are hard-gated. |
| Public docket check | `lasc-browseros-docket-check` | docket-agent | Public records only; paid/login/CAPTCHA gates not crossed. |
| Lexis research & citation verification | `lexis-browseros-legal-research` | legal-research-agent | External research hard-gated. |
| Opt-in workflow learning | `practice-workflow-learning` | practice-learning-agent | Off by default; explicit learning contract required. |

## In-flight deliverables

| Deliverable | Owner | Started | ETA |
|---|---|---|---|
| *(none claimed yet)* | — | — | — |

## Protocol

**Adding a completed deliverable:** move its row from "In-flight" to "Completed deliverables" with the completion date and the on-disk location or issue reference. Do not record client facts or matter identifiers here — use the deliverable's issue link.

**Claiming a deliverable:** add a row to "In-flight deliverables" before starting. If another agent already claimed it, comment on that work instead of duplicating it.

**Removing a starter project:** strike through the block and record the decision. Do not delete the history.
