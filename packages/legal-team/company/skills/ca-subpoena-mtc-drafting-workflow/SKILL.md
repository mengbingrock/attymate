---
name: ca-subpoena-mtc-drafting-workflow
description: Draft, revise, organize, and QA California subpoena motion-to-compel work product using source-bound artifacts, section confirmation, Word safety, and supplied-authority discipline.
---

# ca-subpoena-mtc-drafting-workflow

*How the California Litigation Legal Team drafts and QAs subpoena motion-to-compel work product — source-bound and supervised, one reviewable section at a time, never touching active Word drafts without approval.*

## When to load this skill

- A scoped tasks involves California subpoena motion-to-compel drafting or QA.
- The agent is a Legal Ops Supervisor, Facts & Evidence Agent, Legal Research Agent, Drafting & Assembly Agent, Source Intake Agent, or Legal QA Agent picking up such an task.
- The task needs the runtime authority for drafting standards, OCR intake, intermediary artifacts, Word editing after confirmation, live change logs, deliverable templates, and subpoena MTC checklists.
- This the pi orchestrator-native wrapper is adapted from reusable workflow rules and contains no client facts, firm templates, private account details, or hardcoded paths.

## Inputs

Before drafting begins, confirm the task states the Matter Safety Contract fields: workflow type, autonomy level, approval profile, Firm Operations Guide reference or scoped excerpt, matter root, output root, read-only source roots, forbidden roots, allowed outputs, learning mode, do-not-learn list, authority limits, and any visible hard-gate approvals already granted.

If the task lacks matter root, output root, approved source roots, no-cross-matter scope, or Firm Operations Guide reference, return the missing-field list to the Legal Ops Supervisor. If those fields are present, continue green source-bound work and log unresolved inputs instead of repeatedly blocking.

Inputs may include subpoena materials, objections, meet-and-confer records, productions, declarations, pleadings, exhibits, approved authorities, approved example shells, and upstream document-review artifacts.

Apply `ca-subpoena-mtc-autonomous-runner/references/human-approval-gates.md` in both standard and `sandbox_autopilot` modes: local/source-bound draft artifacts and new output-root working copies are green, and only the three hard gate categories stop execution. `sandbox_autopilot` labels test/demo matters; it is not the only low-friction path.

## Procedure

1. **Checkout context.** Checkout the assigned task, matter record, Matter Safety Contract, Firm Operations Guide excerpt, and approved source roots.
2. **Intake and OCR.** Start with document intake and OCR assessment. Preserve original PDF page order; OCR must be sidecar work product. Use local OCR/PDF tools only within the approved matter/output scope. The optional OCR helper in `scripts/ocr_pdf_intake.ps1` writes only under the approved output root and is never a substitute for source review.
3. **Check for upstream handoffs.** Before creating a drafting outline, check approved output/intermediary sources for upstream subpoena document-review handoff artifacts — any downstream MTC handoff memo, completeness table, usefulness table, custodian-affidavit notes, and potential additional-subpoena notes.
4. **Build intermediary work first.** Build or update intermediary tables before major drafting: source/document index, exhibit/RJN list, objection table, replacement table, factual narrative, authority table, needed-input list, TOC, and TOA.
5. **Draft source-bound sections.** Draft sections from source materials and approved examples, one reviewable section or artifact at a time, under `{output_root}`. Identify the evidence, objection, authority, and declaration support for each section. Use only supplied, workspace, example-shell, authority-table, or approved-Lexis authorities. Track placeholders, unresolved citations, stale shell terms, and missing page/line citations. Maintain a live change log for confirmed updates.
6. **Checkpoint and gate.** Proceed autonomously with green work: source-bound draft text, tables, outlines, QA notes, replacement tables, draft recommendations, new artifacts, and new working-copy drafts under the approved output root. Route yellow tasks to the Legal Ops Supervisor when source scope, routing, or internal assumptions need repair, but do not stop safe drafting while approved source-bound work remains. Request approval only for the three hard gate categories — and approval for one gate action never authorizes any other. Active in-place Word/Google Docs edits, external side effects, new external legal research, new authorities, external uploads/downloads, browser auth, paid retrieval, calendar writes, email, finalization, filing, service, signing, overwriting, deleting, renaming, source mutation, or adopting material strategy/relief/sanctions/privacy/protective-order recommendations through external action or protected mutation remain gated by the canonical matrix.
7. **Post results.** Post artifact paths, change log, unresolved placeholders, and QA risks.

## Outputs

Outputs must be new artifacts under `{output_root}`: OCR sidecars, source indexes, exhibit/RJN lists, objection tables, replacement tables, factual narratives, draft sections, TOC/TOA drafts, proposed order text, declaration text, QA notes, draft recommendations, and new output-root working-copy documents.

- Use Word/document tools only for new working copies or approved active-draft updates.
- Return narrow yellow tasks to the Legal Ops Supervisor when source scope, routing, or internal assumptions need repair. Stop for hard gates only when no safe source-bound drafting remains.
- Mark done only after posting the draft artifacts, live change log or change-log update, unresolved-input list, and QA risks.

## Anti-patterns

- Inserting into active Word/Google Docs drafts without the applicable hard-gate approval.
- Drafting from memory or unapproved authorities instead of supplied, workspace, example-shell, authority-table, or approved-Lexis sources.
- Reordering original PDF pages or treating OCR as anything but sidecar work product.
- Drafting major sections before the intermediary tables and index exist.
- Treating one hard-gate approval as authorization for any other hard-gate action.
- Performing external research, new-authority retrieval, uploads/downloads, browser auth, paid retrieval, calendar writes, email, finalization, filing, service, signing, overwriting, deleting, renaming, source mutation, or applying strategy/relief/sanctions/privacy/protective-order recommendations through external action or protected mutation without hard-gate approval.
- Using the OCR helper script as a substitute for source review, or running it before the required executable-script trust review.
- Blocking repeatedly on a missing field when source-bound work remains; continue green work and log unresolved inputs.

## Reference

- `references/pdf-ocr-intake.md`: PDF intake, OCR sidecar, and optional script rules.
- `references/workspace-setup.md`: matter workspace and output conventions.
- `references/intermediary-work-product.md`: numbered artifacts and drafting support tables.
- `references/drafting-sequence.md`: MTC package drafting order.
- `references/word-editing-protocol.md`: Word working-copy and active-draft safety.
- `references/live-draft-change-log.md`: change-log requirements.
- `references/subpoena-mtc-checklists.md`: MTC task, evidence, and QA checklists.
- `references/deliverable-templates.md`: generic table and work-product formats.
- `scripts/ocr_pdf_intake.ps1`: optional scoped local OCR helper; executable-script trust review required before use.
