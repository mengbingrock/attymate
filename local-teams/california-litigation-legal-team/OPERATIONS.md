# Operations - California Litigation Legal Team

This file is the firm's operating manual. `COMPANY.md` defines identity and constraints, the skills define legal-work discipline, and Paperclip provides issues, assignments, decisions, and the audit trail.

## Phase Model

Phase 1 is onboarding and runtime readiness. Configure workspace structure, Codex/Paperclip runtime, local PDF/OCR tools, connectors, monitor profiles, firm procedures, matter mapping, and the private Firm Operations Guide before live matter work. Phase 2 begins after readiness is confirmed and a supervising attorney owns the work product.

## Matter Control

Legal Ops creates one Matter Authorization Package on the parent issue. It identifies the matter, permitted sources and outputs, budget, configured tools, material limits, and governing private references. Descendant issues inherit that authorization until the attorney revokes it, the scope changes, or the budget is exhausted.

A child work order contains only:

- objective and completion standard;
- relevant sources or context;
- expected output; and
- any exception from the parent authorization.

Agents may autonomously read approved sources, use configured read-only connectors, process PDF/OCR locally, organize facts, conduct routine legal research, add verified authorities, download permitted materials, create and revise working copies, run QA, repair scope within the parent authorization, and coordinate with other agents.

`skills/legal-matter-intake/references/human-approval-gates.md` is the sole authorization matrix. An Attorney Decision is required only for:

- filing, service, signature, email or message sending, calendar writes, and external upload or sharing;
- payment, paid retrieval, or work beyond the authorized budget;
- alteration of source evidence or final, filed, signed, or user-edited material;
- matter/source expansion or cross-matter use; and
- material legal strategy, including claims or defenses, requested relief, waiver, settlement, sanctions, and significant privacy or protective-order positions.

Login expiration, MFA, CAPTCHA, unavailable connectors, and tool failures are Operational Interruptions. Route them to Legal Ops or the tool owner without presenting them as legal decisions.

## Attorney Communication

The lawyer routinely reviews only the Matter Dashboard and the controlling work product. Follow `agents/legal-ops-supervisor/references/lawyer-facing-output-standard.md`:

- write substantive analysis once in an issue document or work product and link to it elsewhere;
- keep a lawyer-visible comment to about 120 words using `Status`, `Bottom line`, `Next action`, and the review link;
- keep the run result to two lines with terminal status and the artifact link;
- keep tool output, internal handoffs, run state, manifests, and audit detail in the child issue or `_paperclip_issues`; and
- do not comment for startup, routing, ordinary progress, safe work continuing, or a no-change check.

Only comment when a deliverable is ready, a material risk or deadline changed, an Attorney Decision is needed, the lawyer owns a blocker, or the matter is complete.

## Matter Dashboard

Every active parent matter uses `agents/legal-ops-supervisor/references/matter-status-digest.md`. The Dashboard leads with posture, bottom line, and whether the lawyer must act. It shows no more than five relevant workstreams, three recent substantive items, and one batched open decision. Update it only when there is a material change.

## Delegation

Use `agents/legal-ops-supervisor/references/matter-planning-playbook.md` and `workflow-efficiency-budget.md` before opening child issues. Default to one Dashboard, one matter plan, and three to five active lanes. Keep triage, dedupe, short status answers, and internal coordination on the parent. Open child issues for durable specialist deliverables, long tool runs, parallel lanes, material blockers, or review of an existing work product.

Internal delegation, handoff, and scope repair within the parent authorization do not require attorney approval. One matter may have only one pending first-class decision interaction; combine related choices into a decision card with the recommendation, two or three practical options, legal effect, and deadline.

## Monitoring

Email, Calendar, and Docket monitoring remains disabled until its profile and schedule are configured. Within an enabled profile, read-only review is authorized. A no-change or duplicate-only run ends silently with one line in the run or routine result; it does not create a report, comment, triage issue, or Dashboard update.

When a monitor finds a material change or a configuration interruption that requires owner action, create or update one batched `monitor-report` for the matter and route it to Legal Ops. The lawyer-facing portion states only the change, legal or practical effect, and recommended action.

## Quality And Drift Checks

Before delivery, confirm:

- every material factual or legal statement is traceable to a permitted source;
- work stays within the named matter and source/output scope;
- no protected file was altered and no external act occurred without the required Attorney Decision;
- the controlling analysis exists in only one place;
- any lawyer comment and run result do not repeat that analysis;
- no child duplicates an existing deliverable; and
- learning remains off unless an explicit, scoped learning contract authorizes it.

The supervising attorney reviews and owns final legal work product. Agents may analyze and recommend any issue, but they do not choose material legal strategy or take external action on the attorney's behalf.

## Routine Slots

| Routine | Owner | Cadence |
|---|---|---|
| Onboarding sweep | legal-ops-supervisor | Until onboarding closes |
| Readiness re-check | legal-ops-supervisor | On environment change |
| Email monitor | email-monitor-agent | Per enabled profile |
| Calendar monitor | calendar-agent | Per enabled profile |
| Docket monitor | docket-agent | Per enabled profile |
| Matter status roll-up | legal-ops-supervisor | On material change |

## Confidentiality And Portability

Never put client facts, case identifiers, credentials, private URLs, account IDs, or local paths in this public package. Deployment details belong in the private Firm Operations Guide, issue documents, or local adapter configuration. Never inspect or reuse material across matters unless an Attorney Decision expressly expands the scope.
