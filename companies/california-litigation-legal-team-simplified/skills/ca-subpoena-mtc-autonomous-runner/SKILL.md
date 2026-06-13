---
schema: agentcompanies/v1
slug: ca-subpoena-mtc-autonomous-runner
name: ca-subpoena-mtc-autonomous-runner
description: Coordinate a low-interruption California subpoena motion-to-compel run in Paperclip while preserving matter selection, Launch Intake, authority discipline, file safety, QA, and human approval gates.
---

# ca-subpoena-mtc-autonomous-runner

*How the California Litigation Legal Team runs a low-interruption subpoena motion-to-compel from one parent issue — source-bound and supervised.*

## When to load this skill

- Working from the Legal Ops Supervisor when a Paperclip issue asks for a California subpoena motion-to-compel workflow.
- Acting as the runtime authority for MTC coordination, issue delegation, autonomy boundaries, and approval gates from one user-created parent issue.
- Coordinating intake, child issue creation, approvals, status, and QA; specialist skills control drafting, source review, OCR, research, assembly, and QA details.

## Inputs

The parent issue and every implementation child issue must include the Matter Safety Contract (or a focused child-task subset):

- Workflow type and requested relief.
- Autonomy level, learning mode, and do-not-learn list.
- Firm Operations Guide reference or scoped guide excerpt.
- Matter root, output root, read-only source roots, forbidden roots, allowed outputs.
- No-cross-matter rule, authority limits, and red gates already approved.

Contract preconditions:

- Begin with user-owned matter selection.
- Require a parent issue assigned to Legal Ops Supervisor. Do not start from import-time MTC seed issues.
- Confirm Matter Safety Contract fields before starting.

Inputs may also include parent issue instructions, Firm Operations Guide excerpts, approved source roots, subpoena materials, objections, meet-and-confer records, productions, pleadings, authorities, approved examples, and specialist child issue outputs. If scope, source, or output boundaries are missing, cure the yellow scope issue or return the missing-field list before delegating.

## Procedure

1. **Checkout the parent issue,** current comments, documents, Firm Operations Guide reference, and any prior run state.
2. **Plan read-only.** Inspect only the selected matter. Do not create files, OCR sidecars, draft sections, Word copies, or run-state artifacts during planning.
3. **Post the Launch Intake Packet** on the parent issue with:
   - Selected matter and confirmed no-cross-matter boundary.
   - Workflow type, requested relief, autonomy level, Firm Operations Guide reference, learning mode, and do-not-learn list.
   - Matter root, output root, read-only source roots, forbidden roots, and allowed outputs.
   - Subpoena basics, objections, meet-and-confer status, production status, deadlines, hearing/reservation facts if supplied, and known protective-order/privacy issues.
   - Approved authority sources, example shells, drafting templates, and whether external research is approved.
   - Available local environment profile: Codex cwd, Python/OCR tools, document tooling, browser tooling, and connector status.
   - Recommended child issues, assignees, budgets, red gates, and batched questions.
4. **Request run-start approval once** with batched questions and recommended defaults, before any implementation child issues begin.
5. **After implementation is authorized, create the run-state artifact** — `Intermediary work\00_Autonomous Run State.md` or the matter's equivalent new run-state artifact. Create only new intermediary artifacts and new working draft copies.
6. **Create parent-linked child issues** with complete Matter Safety Contracts. Each child issue must include the focused Matter Safety Contract, `parentId`, exact assignee, allowed outputs, Firm Operations Guide reference, and red gates already approved. Recommended MTC child issue set:
   - **Source Intake/OCR:** inventory approved sources, assess OCR, create sidecars and source manifest under `{output_root}`.
   - **Facts & Evidence:** exhibit list, factual narrative, source crosswalk, objection/evidence table, and replacement table.
   - **Legal Research/Authority Workup:** supplied-authority table, citation verification, treatment notes, and approved external research only after red-gate approval.
   - **Drafting & Assembly:** motion/memorandum, separate statement, declarations, RJN, proposed order, TOC/TOA, and new working-copy assembly after approval.
   - **Legal QA:** authority discipline, source support, stale terms, placeholders, numbering, finalization boundary, and approval-gate audit.
   - **Practice Learning:** only when learning mode authorizes private profile or sanitized skill proposal work.
7. **Map the run in Paperclip.** Parent issue: "Run subpoena MTC package for selected matter." Child issues: created dynamically after intake; use `parentId` for each specialist. Use Paperclip request-confirmation or approval requests only for red gates or plan acceptance that truly stops further safe work. Keep both Paperclip issue history and matter-local run state current.
8. **Monitor child issue progress,** cure yellow scope defects, consolidate status, and request human approval only for red gates. Cure yellow scope and routing issues, delegate child issues with `parentId`, consolidate specialist outputs, and escalate only true red gates or unresolved strategy decisions to the board/user. Give specialists enough scoped context to proceed without inspecting other matters.
9. **Use tools within contract.** Use Paperclip task and approval tools for coordination. Use local file, OCR, document, browser, legal research, email, calendar, or external connector tools only when the Matter Safety Contract and approval state permit that tool class. Do not rely on hidden memory or unstated local configuration.
10. **Maintain durable status** in Paperclip and the approved matter-local run-state artifact after implementation is authorized.
11. **Present the final review package** only after QA confirms source discipline, authority discipline, no prohibited finalization, and unresolved risks.

## Checkpoint and approval gates

**Green — continue without asking:** source inventory, safe OCR planning, source-bound tables, draft text under the output root, research logs from supplied authorities, QA notes, and proposed child issue descriptions.

**Yellow — Legal Ops Supervisor cures:** scope and routing defects, child scope repair, and strategy questions separable from safe work.

**Run-start gate:** required after Launch Intake before implementation child issues begin.

**Red gates — separate human approval required before each:** external research/upload, Lexis or new authorities, external knowledge-base/upload systems, browser auth, external downloads, paid retrieval, calendar writes, email, filing, service, signing, finalization, Word writes to active drafts, strategy changes, sanctions changes, relief changes, privacy/protective-order changes, overwriting/deleting/renaming, source mutation, or selecting between conflicting controlling drafts.

Approval for one red-gate action does not authorize any other red-gate action. Do not use legal authorities from memory.

## Outputs

- Launch Intake Packet, child issue descriptions, run-state artifact, status summaries, review packets, safe source-bound artifacts, and the final review packet.
- Outputs stay in Paperclip issue history or under `{output_root}` after implementation approval.
- Do not create substantive matter files during planning.

## Anti-patterns

- Starting from import-time MTC seed issues instead of a user-created parent issue assigned to Legal Ops Supervisor.
- Creating files, OCR sidecars, draft sections, Word copies, or run-state artifacts during planning.
- Beginning implementation child issues before run-start approval.
- Overwriting source files, user-edited drafts, final drafts, signed/served/filing documents without explicit approval.
- Using legal authorities from memory.
- Crossing a red gate (external research/upload, new authorities, browser auth, email, filing, service, signing, finalization, active Word writes, strategy/relief/sanctions/privacy changes) without separate approval.
- Treating approval for one red-gate action as authorization for any other.
- Interrupting the user for anything that does not truly stop further safe work.
- Relying on hidden memory or unstated local configuration.

## Reference

- `references/startup-inputs.md`: launch intake fields and discovery order.
- `references/autonomy-modes.md`: autonomy levels and default behavior.
- `references/human-approval-gates.md`: green/yellow/red checkpoint matrix and review packet format.
- `references/run-state.md`: run-state artifact and status fields.
- `references/qa-checklist.md`: final MTC package QA checks.
