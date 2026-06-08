---
name: ca-subpoena-mtc-autonomous-runner
description: Coordinate a low-interruption California subpoena motion-to-compel run in Paperclip while preserving matter selection, Launch Intake, authority discipline, file safety, QA, and human approval gates.
---

# California Subpoena MTC Autonomous Runner For Paperclip

Use this skill from the Legal Ops Supervisor when a Paperclip issue asks for a California subpoena motion-to-compel workflow.

Use this Paperclip-native wrapper as the runtime authority for MTC coordination, issue delegation, autonomy boundaries, and approval gates.

## Paperclip Role

Legal Ops Supervisor uses this skill to run a low-interruption MTC workflow from one user-created parent issue. The skill coordinates intake, child issue creation, approvals, status, and QA; specialist skills control drafting, source review, OCR, research, assembly, and QA details.

## Required Contract And Gates

- Begin with user-owned matter selection.
- Require a parent issue assigned to Legal Ops Supervisor. Do not start from import-time MTC seed issues.
- Confirm Matter Safety Contract fields: workflow type, autonomy level, Firm Operations Guide reference or scoped guide excerpt, matter root, output root, source roots, forbidden roots, allowed outputs, learning mode, do-not-learn list, and red gates already approved.
- In planning, inspect only the selected matter and produce a Launch Intake Packet.
- Do not create files, OCR sidecars, draft sections, Word copies, or run-state artifacts during planning.
- After implementation is authorized, create `Intermediary work\00_Autonomous Run State.md` or the matter's equivalent new run-state artifact.
- Create only new intermediary artifacts and new working draft copies.
- Do not overwrite source files, user-edited drafts, final drafts, signed documents, served documents, or filing documents without explicit approval.
- Do not use legal authorities from memory.
- Stop at red gates: external research/upload, Lexis or new authorities, external knowledge-base/upload systems, browser auth, external downloads, paid retrieval, email, filing, service, signing, finalization, Word writes to active drafts, strategy changes, sanctions changes, relief changes, privacy/protective-order changes, or conflicting draft selection.
- Continue green work without asking: source inventory, safe OCR planning, source-bound tables, draft text under the output root, research logs from supplied authorities, QA notes, and proposed child issue descriptions.

## Required Issue Contract

The parent issue and every implementation child issue must include the Matter Safety Contract or a focused child-task subset with workflow type, autonomy level, Firm Operations Guide reference, matter root, output root, read-only source roots, forbidden roots, allowed outputs, learning mode, do-not-learn list, no-cross-matter rule, authority limits, and red gates already approved.

## Approval Gates

Run-start approval is required after Launch Intake before implementation child issues begin. Separate red-gate approval is required before external research, new authorities, external uploads or downloads, external knowledge-base/upload systems, browser auth, paid retrieval, calendar writes, email, active Word writes, finalization, filing, service, signing, overwriting, deleting, renaming, source mutation, strategy changes, relief changes, sanctions changes, privacy/protective-order changes, or selecting between conflicting controlling drafts.

Approval for one red-gate action does not authorize any other red-gate action.

## Launch Intake Packet

Before implementation child issues are created, post a Launch Intake Packet on the parent issue with:

- Selected matter and confirmed no-cross-matter boundary.
- Workflow type, requested relief, autonomy level, Firm Operations Guide reference, learning mode, and do-not-learn list.
- Matter root, output root, read-only source roots, forbidden roots, and allowed outputs.
- Subpoena basics, objections, meet-and-confer status, production status, deadlines, hearing/reservation facts if supplied, and known protective-order/privacy issues.
- Approved authority sources, example shells, drafting templates, and whether external research is approved.
- Available local environment profile: Codex cwd, Python/OCR tools, document tooling, browser tooling, and connector status.
- Recommended child issues, assignees, budgets, red gates, and batched questions.

## Paperclip Mapping

- Parent issue: "Run subpoena MTC package for selected matter."
- Child issues: create dynamically after intake; use `parentId` for Source Intake/OCR, Facts & Evidence, Legal Research/Authority Workup, Drafting & Assembly, QA Review, and Practice Learning when learning is enabled.
- Approval interactions: use Paperclip request confirmation or approval requests only for red gates or plan acceptance that truly stops further safe work.
- Durable state: keep both Paperclip issue history and matter-local run state current.

## Child Issue Pattern

Create child issues only after launch intake and run-start approval. Every child issue must include the focused Matter Safety Contract, `parentId`, exact assignee, allowed outputs, Firm Operations Guide reference, and red gates already approved.

Recommended MTC child issue set:

- Source Intake/OCR: inventory approved sources, assess OCR, create sidecars and source manifest under `{output_root}`.
- Facts & Evidence: exhibit list, factual narrative, source crosswalk, objection/evidence table, and replacement table.
- Legal Research: supplied-authority table, citation verification, treatment notes, and approved external research only after red-gate approval.
- Drafting & Assembly: motion/memorandum, separate statement, declarations, RJN, proposed order, TOC/TOA, and new working-copy assembly after approval.
- Legal QA: authority discipline, source support, stale terms, placeholders, numbering, finalization boundary, and approval-gate audit.
- Practice Learning: only when learning mode authorizes private profile or sanitized skill proposal work.

## Inputs And Outputs

Inputs may include parent issue instructions, Firm Operations Guide excerpts, approved source roots, subpoena materials, objections, meet-and-confer records, productions, pleadings, authorities, approved examples, and specialist child issue outputs.

Outputs must stay in Paperclip issue history or under `{output_root}` after implementation approval: Launch Intake Packet, child issue descriptions, run-state artifact, status summaries, review packets, safe source-bound artifacts, and final review packets. Do not create substantive matter files during planning.

## Tool Policy

Use Paperclip task and approval tools for coordination. Use local file, OCR, document, browser, legal research, email, calendar, or external connector tools only when the Matter Safety Contract and approval state permit that tool class. Do not rely on hidden memory or unstated local configuration.

## Handoff Rules

Legal Ops Supervisor cures yellow scope and routing issues, delegates child issues with `parentId`, consolidates specialist outputs, and escalates only true red gates or unresolved strategy decisions to the board/user. Specialists should receive enough scoped context to proceed without inspecting other matters.

## Heartbeat Workflow

1. Checkout the parent issue, current comments, documents, Firm Operations Guide reference, and any prior run state.
2. If Launch Intake is incomplete, complete read-only intake and post the Launch Intake Packet.
3. If run-start approval is missing, request it once with batched questions and recommended defaults.
4. If approved, create or update parent-linked child issues with complete Matter Safety Contracts.
5. Monitor child issue progress, cure yellow scope defects, consolidate status, and request human approval only for red gates.
6. Maintain durable status in Paperclip and the approved matter-local run-state artifact after implementation is authorized.
7. Present final review package only after QA confirms source discipline, authority discipline, no prohibited finalization, and unresolved risks.

## Reference Files

- `references/startup-inputs.md`: launch intake fields and discovery order.
- `references/autonomy-modes.md`: autonomy levels and default behavior.
- `references/human-approval-gates.md`: green/yellow/red checkpoint matrix and review packet format.
- `references/run-state.md`: run-state artifact and status fields.
- `references/qa-checklist.md`: final MTC package QA checks.
