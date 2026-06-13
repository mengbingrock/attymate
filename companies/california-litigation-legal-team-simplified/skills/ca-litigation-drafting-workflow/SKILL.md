---
schema: agentcompanies/v1
slug: ca-litigation-drafting-workflow
name: ca-litigation-drafting-workflow
description: Use when a Paperclip drafting or QA agent must draft, revise, organize, or review California litigation work product, including pleadings, motions, memoranda, declarations, meet-and-confer letters, proposed orders, source indexes, issue tables, and Word working-copy updates. Do not use to insert unapproved authorities, overwrite user-edited files, finalize, sign, file, serve, or email.
---

# ca-litigation-drafting-workflow

*How the California Litigation Legal Team drafts, revises, and reviews litigation work product — source-bound and supervised.*

## When to load this skill

- Working from the Drafting & Assembly Agent, Legal QA Agent, Facts & Evidence Agent, Source Intake Agent, or a supervisor-delegated drafting child issue.
- Drafting or revising pleadings, motions, memoranda, declarations, meet-and-confer letters, or proposed orders.
- Building or reviewing source indexes, issue tables, QA notes, or Word working-copy updates.
- The skill is reusable for California litigation and contains no client facts, firm templates, private style rules, or hardcoded paths.

## Inputs

Before drafting begins, confirm the issue states:

- Matter root and output root.
- Read-only source roots, including any pleadings, exhibits, authorities, examples, or prior drafts that may be inspected.
- Forbidden roots, including other matters and final/signed/filed/served/user-edited documents unless expressly approved.
- Allowed outputs, such as new draft sections, tables, QA notes, or new working-copy documents.
- Authority source limits.
- Drafting profile or style policy, if deployment-specific style is required.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, learning mode, and red gates already approved.

If scope, source, or output boundaries are missing, return the missing-field list to the supervisor. If approved sources and output root are clear, continue safe draft work and log unresolved issues instead of blocking.

Inputs may also include source pleadings, exhibits, declarations, discovery, authority tables, public law, approved examples, and drafting profiles.

## Procedure

1. **Checkout the assigned issue.** Read the parent issue, comments, contract, and approved sources.
2. **Build or update intermediary tables** before major drafting when needed (source indexes, issue tables, chronology tables, authority tables).
3. **Draft only from approved source facts and approved authorities.** Never introduce authorities from memory. Keep internal drafting notes separate from court-facing text.
4. **Consult references before format-sensitive work.** When a task involves a court-facing Word filing, consult the pleading-paper reference before any formatting work. When a task involves an existing draft with supervising-attorney edits, consult the supervising-attorney and Word editing references before changing organization, wording, or formatting.
5. **Post draft text, issue tables, or artifact paths for review.**
6. **Hit the checkpoint before any red-gate action** (see gates below). Proceed autonomously on green drafting work — source-bound draft text, outlines, issue tables, QA notes, change logs, and new artifacts under `{output_root}`. Route yellow issues to the Legal Ops Supervisor when facts conflict, child scope needs repair, or a strategy question can be separated from safe drafting. Request red-gate approval before:
   - Updating a Word file or active draft.
   - Using new authorities beyond supplied/approved sources.
   - Making strategy, relief, sanctions, privacy, or protective-order changes.
   - Overwriting, deleting, renaming, finalizing, signing, filing, serving, emailing, or uploading.
   - Relying on examples or prior drafts outside the approved source roots.

   Approval for one action does not authorize different external tools, new authorities, active draft writes, finalization, filing, service, signing, email, source mutation, or strategy changes.
7. **Use tooling within policy.** Use document tooling only for new working copies or approved active-draft updates. Use legal research tools only after approval. Use OCR/PDF tools through a scoped PDF/OCR issue when extraction quality matters.
8. **Preserve formatting and existing user edits** when a Word update is approved.
9. **Post a change log,** remaining placeholders, unresolved citations, and QA risks.

## Outputs

- Source-bound work product only: draft text, tables, outlines, QA notes, change logs, and new working-copy documents under `{output_root}`.
- Keep internal drafting notes separate from court-facing text.
- Return discrete yellow/red issues to the supervisor, but do not stop safe drafting when approved sources and output boundaries support continued work.
- Mark done only after posting the draft artifact and the unresolved-issue list.

## Anti-patterns

- Introducing authorities from memory or beyond the approved source roots.
- Updating a Word file, active draft, or relying on examples/prior drafts outside approved roots without red-gate approval.
- Overwriting, deleting, renaming, finalizing, signing, filing, serving, emailing, or uploading without approval.
- Making strategy, relief, sanctions, privacy, or protective-order changes without approval.
- Treating approval for one action as authorization for a different external tool, new authority, or red-gate action.
- Using document tooling on active drafts, or legal research tools, before approval.
- Blocking on a missing field when approved sources and output root already support safe work — log it instead.

## Reference

- `references/drafting-output-format.md`: generic artifact and QA output format.
- `references/intake-and-ocr.md`: source intake, OCR triage, and sidecar rules.
- `references/workspace-setup.md`: portable matter workspace conventions.
- `references/intermediary-work-product.md`: recommended source indexes, issue tables, chronology tables, authority tables, and change logs.
- `references/legal-drafting-workflow.md`: source-bound drafting sequence for common California litigation work product.
- `references/drafting-protocol.md`: section-by-section drafting and review workflow.
- `references/supervising-attorney-review.md`: how to tighten or reorganize drafts without erasing reviewer judgment.
- `references/word-editing-protocol.md`: Word working-copy safety and formatting preservation.
- `references/pleading-paper-word-formatting.md`: filing-format readiness gate for pleading paper, captions, pagination, TOC, and TOA.
- `references/related-case-response.md`: source-bound response pattern for related-case notices or filings.
