---
name: ca-pleading-intake-review
description: Use when a Paperclip intake agent must perform source-bound California pleading intake or review, including complaints, amended complaints, answers, proofs of service, filing/service facts, allegation summaries, party/caption checks, and local source manifests. Do not use for external legal research, calendaring writes, drafting beyond intake summaries, or NotebookLM upload without approval.
---

# California Pleading Intake Review

## Paperclip Role

Use this skill from the Source Intake Agent assigned to a scoped intake issue. The skill is product-safe and contains no client facts, matter examples, firm paths, private templates, or account details.

## Required Issue Contract

Before intake begins, confirm the issue states:

- Matter root and output root.
- Read-only source roots or exact files to inspect.
- Forbidden roots and no-cross-matter inspection rule.
- Allowed outputs, such as inventories, OCR sidecars, source manifests, and intake summaries.
- Whether external mailbox, drive, OCR, or NotebookLM tools are authorized.
- Environment profile reference, autonomy level, learning mode, and red gates already approved.

If the contract is missing, return a concise missing-field list to the supervisor. If approved source files and output root are clear, continue safe intake work and log unresolved gaps.

## Heartbeat Workflow

1. Checkout the assigned issue.
2. Read issue scope, comments, parent context, and approved source roots.
3. Inventory source pleadings and identify extraction/OCR needs.
4. Create only approved sidecar artifacts under `{output_root}`.
5. Summarize pleadings with source page, paragraph, exhibit, filing, or service references where available.
6. Flag extraction gaps, visual-verification needs, missing proofs, caption inconsistencies, and unresolved party issues.
7. Prepare a NotebookLM handoff manifest only if approved; do not upload.

## Checkpoint Policy

Proceed autonomously with green work: local source inventories, extraction/OCR need assessment, source manifests, intake summaries, and approved sidecar artifacts under `{output_root}`.

Route yellow issues to Legal Ops Supervisor when filing/service facts conflict, source scope needs repair, or a drafting handoff needs clearer routing.

Red-gate approval is required before:

- Downloading from email/drive systems unless the issue authorizes it.
- Uploading to NotebookLM or another external system.
- Emailing, filing, serving, signing, finalizing, or calendar writing.
- Editing originals or user-edited documents.
- Expanding into legal research or drafting beyond intake summaries.

## Inputs And Outputs

Inputs may include pleadings, proofs of service, docket facts, email attachments, and approved source folders.

Outputs may include pleading inventories, POS review notes, allegation/procedural summaries, extraction-gap logs, OCR sidecars, and source manifests under `{output_root}`.

## Tool Policy

Use PDF/OCR tools when source text is unavailable or unreliable. Use mailbox/drive connectors only when the deployment and issue authorize them. Treat source PDFs as read-only.

## Handoff Rules

Return discrete yellow/red issues to Legal Ops Supervisor, but continue safe intake when approved sources and output boundaries allow it. Hand off drafting to the Drafting & Assembly Agent.

## Reference Files

- `references/intake-output-format.md`: generic intake deliverable format.
