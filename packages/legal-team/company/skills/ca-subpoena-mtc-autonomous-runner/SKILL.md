---
name: ca-subpoena-mtc-autonomous-runner
description: Coordinate a low-interruption California subpoena motion-to-compel run in the pi orchestrator while preserving matter selection, Launch Intake, authority discipline, file safety, QA, and human approval gates.
---

# ca-subpoena-mtc-autonomous-runner

*How the California Litigation Legal Team runs a low-interruption subpoena motion-to-compel from one matter record — source-bound and supervised.*

## When to load this skill

- Working from the Legal Ops Supervisor when a tasks asks for a California subpoena motion-to-compel workflow.
- Acting as the runtime authority for MTC coordination, task delegation, autonomy boundaries, and approval gates from one user-created matter record.
- Coordinating intake, delegated task creation, approvals, status, and QA; specialist skills control drafting, source review, OCR, research, assembly, and QA details.

## Inputs

The matter record and every implementation delegated task must include the Matter Safety Contract (or a focused child-task subset):

- Workflow type and requested relief.
- Autonomy level, approval profile, learning mode, and do-not-learn list.
- Firm Operations Guide reference or scoped guide excerpt.
- Matter root, output root, read-only source roots, forbidden roots, allowed outputs.
- No-cross-matter rule, authority limits, and any visible hard-gate approvals already granted.

Contract preconditions:

- Begin with user-owned matter selection.
- Require a matter record assigned to Legal Ops Supervisor. Do not start from import-time MTC seed tasks.
- Confirm Matter Safety Contract fields before starting.

Inputs may also include matter record instructions, Firm Operations Guide excerpts, approved source roots, subpoena materials, objections, meet-and-confer records, productions, pleadings, authorities, approved examples, and specialist delegated task outputs. If scope, source, or output boundaries are missing, cure the yellow scope task or return the missing-field list before delegating.

## Procedure

1. **Checkout the matter record,** current comments, documents, Firm Operations Guide reference, and any prior run state.
2. **Plan read-only.** Inspect only the selected matter. Do not create files, OCR sidecars, draft sections, Word copies, or run-state artifacts during planning.
3. **Post the Launch Intake Packet** on the matter record with:
   - Selected matter and confirmed no-cross-matter boundary.
   - Workflow type, requested relief, autonomy level, Firm Operations Guide reference, learning mode, and do-not-learn list.
   - Approval profile, including whether `sandbox_autopilot` labels the run as local non-client-facing testing.
   - Matter root, output root, read-only source roots, forbidden roots, and allowed outputs.
   - Subpoena basics, objections, meet-and-confer status, production status, deadlines, hearing/reservation facts if supplied, and known protective-order/privacy tasks.
   - Approved authority sources, example shells, drafting templates, and whether external research is approved.
   - Available local environment profile: pi cwd, Python/OCR tools, document tooling, browser tooling, and connector status.
   - Recommended delegated tasks, assignees, budgets, hard gates, and batched questions.
4. **Apply the approval profile.** Treat local source reading, delegated task creation, OCR, draft artifacts, QA, run-state updates, and new output-root working copies as allowed when source scope and `{output_root}` are clear. Use `sandbox_autopilot` to label local non-client-facing testing, but do not require a separate run-start approval for routine local output-root work.
5. **Create the run-state artifact after Launch Intake.** Use `Intermediary work\00_Autonomous Run State.md` or the matter's equivalent new run-state artifact. Create only new intermediary artifacts and new working draft copies under `{output_root}`.
6. **Create parent-linked delegated tasks** with complete Matter Safety Contracts. Each delegated task must include the focused Matter Safety Contract, `parentId`, exact assignee, allowed outputs, Firm Operations Guide reference, approval profile, and any visible hard-gate approvals already granted. Recommended MTC delegated task set:
   - **Source Intake/OCR:** inventory approved sources, assess OCR, create sidecars and source manifest under `{output_root}`.
   - **Facts & Evidence:** exhibit list, factual narrative, source crosswalk, objection/evidence table, and replacement table.
   - **Legal Research/Authority Workup:** supplied-authority table, citation verification, treatment notes, and external research only after hard-gate approval.
   - **Drafting & Assembly:** motion/memorandum, separate statement, declarations, RJN, proposed order, TOC/TOA, and new output-root working-copy assembly.
   - **Legal QA:** authority discipline, source support, stale terms, placeholders, numbering, finalization boundary, and approval-gate audit.
   - **Practice Learning:** only when learning mode authorizes private profile or sanitized skill proposal work.
7. **Map the run in the pi orchestrator.** Matter record: "Run subpoena MTC package for selected matter." Delegated tasks: created dynamically after intake; use `parentId` for each specialist. Use the pi orchestrator request-confirmation or approval requests only for hard gates or plan acceptance that truly stops further safe work. Keep both tasks history and matter-local run state current.
8. **Monitor delegated task progress,** cure yellow scope defects, consolidate status, and request human approval only for hard gates. Cure yellow scope and routing tasks, delegate delegated tasks with `parentId`, consolidate specialist outputs, and escalate only true hard gates or unresolved adoption decisions to the supervising attorney (human operator)/user. Give specialists enough scoped context to proceed without inspecting other matters.
9. **Use tools within contract.** Use the pi orchestrator task and approval tools for coordination. Use local file, OCR, document, browser, legal research, email, calendar, or external connector tools only when the Matter Safety Contract and approval state permit that tool class. Do not rely on hidden memory or unstated local configuration.
10. **Maintain durable status** in the pi orchestrator and the approved matter-local run-state artifact after implementation is authorized.
11. **Present the final review package** only after QA confirms source discipline, authority discipline, no prohibited finalization, and unresolved risks.

## Checkpoint and approval gates

**Green — continue without asking:** source inventory, safe OCR planning, source-bound tables, draft text under the output root, research logs from supplied authorities, QA notes, and proposed delegated task descriptions.

**Yellow — Legal Ops Supervisor cures:** scope and routing defects, child scope repair, and strategy questions separable from safe work.

**Run-start gate:** not required for routine local/source-bound work once Launch Intake identifies approved source scope and `{output_root}`. Ask for one batched decision only when no safe local work remains.

**Hard gates — separate human approval required before each:** use `references/human-approval-gates.md` as the canonical matrix. Stop only for external side effects; authentication, payment, or legal-authority expansion; and destructive or protected mutation. Draft recommendations and output-root artifacts are allowed; applying them through external action or protected mutation is gated.

Approval for one red-gate action does not authorize any other red-gate action. Do not use legal authorities from memory.

## Outputs

- Launch Intake Packet, delegated task descriptions, run-state artifact, status summaries, review packets, safe source-bound artifacts, and the final review packet.
- Outputs stay in tasks history or under `{output_root}` after implementation approval.
- Do not create substantive matter files during planning.

## Anti-patterns

- Starting from import-time MTC seed tasks instead of a user-created matter record assigned to Legal Ops Supervisor.
- Creating files, OCR sidecars, draft sections, Word copies, or run-state artifacts during planning.
- Overwriting source files, user-edited drafts, final drafts, signed/served/filing documents without explicit approval.
- Using legal authorities from memory.
- Crossing a hard gate without separate approval.
- Treating approval for one red-gate action as authorization for any other.
- Interrupting the user for anything that does not truly stop further safe work.
- Relying on hidden memory or unstated local configuration.

## Reference

- `references/startup-inputs.md`: launch intake fields and discovery order.
- `references/autonomy-modes.md`: autonomy levels and default behavior.
- `references/human-approval-gates.md`: green/yellow/red checkpoint matrix and review packet format.
- `references/run-state.md`: run-state artifact and status fields.
- `references/qa-checklist.md`: final MTC package QA checks.
