# Operations — California Litigation Legal Team

*How this firm works, what gets shipped, and where decisions live.*

This file is the firm's operating manual. `COMPANY.md` is the constitution (identity and hard constraints), the skills are the domain authority (legal workflow discipline), and Paperclip is the control plane (issues, approvals, audit trail). When those three disagree, escalate to the board rather than guessing.

## Phase model

Phase 1 is **onboarding and runtime readiness** — there is no live matter work until it is done. Turn the company intent into a configured deployment: workspace structure, Codex/Paperclip runtime, Python/OCR tooling, external connectors, Gmail/Calendar/Docket monitor profiles, firm SOPs and templates, matter mapping, approval policy, and learning policy, all consolidated into the private Firm Operations Guide (`firm-operations-guide`). Phase 2 — live, matter-scoped litigation work — begins only after the readiness smoke test is green and a supervising attorney owns the work product.

| Function | Phase 1 "done" when |
|---|---|
| Legal Ops Supervisor | Firm Operations Guide exists and is current; onboarding tasks closed; readiness smoke test posted green. |
| Source Intake Agent | Knows its approved source roots and output root, and has run one source-bound intake end to end. |
| Facts & Evidence Agent | Can tie every fact to a source from the approved set; no reliance on gold/final drafts. |
| Legal Research Agent | Knows its authority-use limits; runs on supplied/approved authorities with external research gated. |
| Drafting & Assembly Agent | Produces source-bound draft text under the output root without touching live/final files. |
| Legal QA Agent | Has a working confidentiality/source/authority/approval checklist and applies it to one artifact. |
| Calendar Agent | Has a calendar policy source, optional `calendar_monitor_profile`, and posts proposals before any approved write. |
| Docket Agent | Knows the public-docket scope, optional `docket_monitor_profile`, and the paid/login/CAPTCHA gates it must not cross. |
| Practice Learning Agent | Learning mode default `off`; activates only under an explicit learning contract. |
| Gmail Monitor Agent | A `gmail_monitor_profile` exists; runs read-only and routes candidates to Legal Ops. |

## Idle-state protocol

Specialists proceed on local/source-bound work, Legal Ops Supervisor cures yellow scope/routing issues, and hard gates go to the board. When an agent clears its assigned issues and no next action is authorized, it surfaces one concrete proposal tied to a goal or issue rather than inventing work. Inventing cross-matter inspection, unrequested research, speculative drafts, or "tidy-up" sweeps to look busy is a drift signal, not productivity. Idle with a useful proposal pending is healthy.

## Reporting cadence

| Report | From | To | Cadence |
|---|---|---|---|
| Onboarding readiness status | legal-ops-supervisor | Board / firm owner | Until Phase 1 closes |
| Per-matter parent-issue status | legal-ops-supervisor | Board / supervising attorney | Per active matter |
| Matter Dashboard | legal-ops-supervisor | Parent matter issue | On creation, blocker changes, child delegation, monitor routing, and lawyer status questions |
| Readiness smoke (green/yellow/red) | legal-ops-supervisor | Board | On environment change |
| Monitor findings | gmail-monitor-agent / calendar-agent / docket-agent | legal-ops-supervisor | Per approved monitor profile |

## Communication conventions

Use the parent matter issue for matter-level decisions and child-issue comments for execution detail. Every delegated child issue must carry a **Matter Safety Contract** (see `references/matter-safety-contract.md`) and name the receiving agent, the approved scope, the approval profile, the allowed outputs, and any visible hard-gate approvals already granted. Cross-agent handoffs route through Legal Ops Supervisor unless the parent issue authorizes a direct handoff. Never paste client facts, case numbers, party names, credentials, or local paths into a public package file — those live in the private Firm Operations Guide or scoped issue documents only.

For every new matter event, Legal Ops uses `references/matter-planning-playbook.md` to match or create the matter parent, update the Matter Dashboard, and classify all plausible workstreams before delegating child issues. Matter context artifacts are reusable but relevance-based: agents check the matter context index and the role-relevant artifacts named in the child issue, not the entire context folder by default. When a matter/output root is approved, use the Matter Home convention in `references/matter-context-artifacts.md`.

Lawyer-facing intake uses **Light Intake Mode** by default. Legal Ops asks short plain-English questions, offers safe defaults, and translates the answers into the internal Matter Safety Contract. If work must stop, the blocker comment starts with "I need one thing before I can continue:" and gives 2-3 practical answer choices.

Every active parent matter issue also gets a **Matter Dashboard** using `references/matter-status-digest.md`. It should explain the matter, current status, covered workstreams, latest artifacts, blocker, next-step owner, whether the lawyer needs to act, and what happens next. Child issues may carry technical details, but the parent issue should always have one lawyer-readable dashboard.

Use `references/lawyer-facing-output-standard.md` for comments, reports, and handoffs: lawyer summary first, short tables for findings or coverage, and technical safety details in `Audit Details`.

## Approval and merge rules — green / yellow / red

- **Green (autonomous, logged):** source-bound intake, fact/evidence tables, supplied-authority workup, draft text under the output root, calendar *proposals*, public docket *checks*, QA findings, sanitized learning proposals. Proceed and log.
- **Yellow (Legal Ops may cure):** routing/scope ambiguities the parent issue already authorizes the scope for. Legal Ops cures or returns the issue; specialists do not self-expand scope.
- **Red (board/user approval required before action):** follow `skills/ca-subpoena-mtc-autonomous-runner/references/human-approval-gates.md`. Agents proceed on local/source-bound work, output-root artifacts, new output-root working copies, draft recommendations, QA, issue updates, and internal routing. Stop only for external side effects; authentication, payment, or legal-authority expansion; and destructive or protected mutation. Use `approval_profile: sandbox_autopilot` to label local non-client-facing test work.
- **Never autonomous:** changing the company identity, the hard constraints, the matter scope, or the confidentiality rules.

## Delegation quality checklist

Before delegating any child issue, confirm:

- The lawyer was not asked to fill out the Matter Safety Contract directly; Legal Ops translated plain-language answers into the contract.
- The parent matter issue has an up-to-date Matter Dashboard with a Coverage table.
- The Matter Safety Contract is complete (matter root, output root, workflow type, autonomy level, approval profile, Firm Operations Guide reference, read-only source roots, forbidden roots, allowed outputs, learning mode, visible hard-gate approvals already granted, no-cross-matter inspection).
- The owning specialist agent is named and the work is inside its lane.
- Completion criteria are concrete and source-bound.
- Handoffs, approval profile, and gate approvals are explicit.
- `PROJECT-INVENTORY.md` was checked so the deliverable is not a duplicate.

## Anti-drift checks

Before doing or delegating work, ask:

- Does this still serve the north star — **source-bound, confidentiality-safe, approval-gated work product a supervising attorney can rely on, without ever acting outside the matter scope**? If not, stop.
- Does this accidentally make us a **legal-advice service** (issuing opinions or conclusions the supervising attorney has not reviewed and adopted)? If yes, stop and escalate.
- Does this accidentally make us an **autonomous actor** (filing, serving, signing, emailing, writing to calendars, uploading/sharing externally, or mutating protected live/final drafts without visible approval)? If yes, stop and escalate.
- Does this accidentally make us a **cross-matter knowledge base** (inspecting, citing, or carrying facts from another matter, or learning client facts into reusable assets)? If yes, stop and escalate.
- Constraint check: every material statement is tied to an approved source — no authorities or facts from memory.
- Constraint check: work stays inside the named matter root and approved read-only source roots; forbidden roots are untouched.
- Constraint check: hard gates are not crossed without visible approval on the issue.
- Constraint check: learning is `off` unless an explicit learning contract is present.
- Does this duplicate a deliverable already in `PROJECT-INVENTORY.md`?

## Duplicate prevention

Before creating any substantial deliverable, read `PROJECT-INVENTORY.md`, the relevant project/matter folder, and the owning agent's notes. If it already exists, reference it instead of creating a second copy. Update the inventory when work is completed.

## Routine slots

| Routine | Owner | Suggested cadence |
|---|---|---|
| Onboarding sweep (until Phase 1 closes) | legal-ops-supervisor | Daily |
| Readiness smoke re-check | legal-ops-supervisor | On environment change |
| Gmail read-only intake monitor (if enabled) | gmail-monitor-agent | Per `gmail_monitor_profile` schedule |
| Calendar read-only monitor (if enabled) | calendar-agent | Per `calendar_monitor_profile` schedule |
| Docket public-record monitor (if enabled) | docket-agent | Per `docket_monitor_profile` schedule |
| Per-matter status roll-up | legal-ops-supervisor | Per active matter |

Monitor runs must write a durable `monitor-report` issue document. Actionable findings are deduped and routed to Legal Ops triage; no-findings reports close without creating unnecessary work.

## Critical rules summary

1. North star: source-bound, confidentiality-safe, approval-gated California litigation work product a supervising attorney can rely on — never acting outside the matter scope.
2. Source-bound only. No legal authorities or facts from memory; every artifact traces to an approved source.
3. Matter-scoped only. No cross-matter inspection. No carrying facts between matters.
4. Hard gates require visible approval on the issue: external side effects; authentication, payment, or legal-authority expansion; and destructive or protected mutation.
5. Learning is `off` by default and runs only under an explicit, scoped learning contract.
6. No client data, firm-specific procedure, credential, or local path in public package files — those live in the private Firm Operations Guide.
7. Specialists proceed on safe local/source-bound work; Legal Ops Supervisor approves routing; the board owns hard gates and identity changes.
8. Check `PROJECT-INVENTORY.md` before creating new deliverables.
