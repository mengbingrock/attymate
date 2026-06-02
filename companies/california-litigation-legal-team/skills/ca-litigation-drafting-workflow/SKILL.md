---
name: ca-litigation-drafting-workflow
description: Use when a Paperclip drafting or QA agent must draft, revise, organize, or review California litigation work product, including pleadings, motions, memoranda, declarations, meet-and-confer letters, proposed orders, source indexes, issue tables, and Word working-copy updates. Do not use to insert unapproved authorities, overwrite user-edited files, finalize, sign, file, serve, or email.
---

# California Litigation Drafting Workflow

## Paperclip Role

Use this skill from the Drafting & Assembly Agent, Legal QA Agent, or supervisor-delegated drafting child issue. It is reusable for California litigation and contains no client facts, firm templates, private style rules, or hardcoded paths.

## Required Issue Contract

Before drafting begins, confirm the issue states:

- Matter root and output root.
- Read-only source roots, including any pleadings, exhibits, authorities, examples, or prior drafts that may be inspected.
- Forbidden roots, including other matters and final/signed/filed/served/user-edited documents unless expressly approved.
- Allowed outputs, such as new draft sections, tables, QA notes, or new working-copy documents.
- Authority source limits.
- Drafting profile or style policy, if deployment-specific style is required.
- Environment profile reference, autonomy level, learning mode, and red gates already approved.

If scope, source, or output boundaries are missing, return the missing-field list to the supervisor. If approved sources and output root are clear, continue safe draft work and log unresolved issues instead of blocking.

## Heartbeat Workflow

1. Checkout the assigned issue.
2. Read the parent issue, comments, contract, and approved sources.
3. Build or update intermediary tables before major drafting when needed.
4. Draft only from approved source facts and approved authorities.
5. Post draft text, issue tables, or artifact paths for review.
6. Request approval only before Word writes to active drafts, finalization, or other red-gate actions.
7. Preserve formatting and existing user edits when a Word update is approved.
8. Post a change log, remaining placeholders, unresolved citations, and QA risks.

## Checkpoint Policy

Proceed autonomously with green drafting work: source-bound draft text, outlines, issue tables, QA notes, change logs, and new artifacts under `{output_root}`.

Route yellow issues to Legal Ops Supervisor when facts conflict, child scope needs repair, or a strategy question can be separated from safe drafting.

Red-gate approval is required before:

- Updating a Word file or active draft.
- Using new authorities beyond supplied/approved sources.
- Making strategy, relief, sanctions, privacy, or protective-order changes.
- Overwriting, deleting, renaming, finalizing, signing, filing, serving, emailing, or uploading.
- Relying on examples or prior drafts outside the approved source roots.

## Inputs And Outputs

Inputs may include source pleadings, exhibits, declarations, discovery, authority tables, public law, approved examples, and drafting profiles.

Outputs must be source-bound: draft text, tables, outlines, QA notes, change logs, and new working-copy documents under `{output_root}`. Do not introduce authorities from memory.

## Tool Policy

Use document tooling only for new working copies or approved active-draft updates. Use legal research tools only after approval. Use OCR/PDF tools through a scoped PDF/OCR issue when extraction quality matters.

## Handoff Rules

Return discrete yellow/red issues to the supervisor, but do not stop safe drafting when approved sources and output boundaries support continued work. Mark done only after posting the draft artifact and unresolved-issue list.

## Reference Files

- `references/drafting-output-format.md`: generic artifact and QA output format.
