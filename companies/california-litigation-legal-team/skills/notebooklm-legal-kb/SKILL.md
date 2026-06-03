---
name: notebooklm-legal-kb
description: Use when a Paperclip knowledge-base agent must create, connect, populate, query, or audit a NotebookLM-style legal matter knowledge base from locally verified source manifests. Do not use to upload, delete, reconnect, or query external notebooks without issue scope, verified sources, and approval.
---

# NotebookLM Legal Knowledge Base

## Paperclip Role

Use this skill from a NotebookLM KB Agent assigned to a scoped knowledge-base issue. The skill is reusable and contains no notebook IDs, client facts, account names, auth paths, or firm conventions.

## Required Issue Contract

Before NotebookLM work begins, confirm the issue states:

- Matter root and output root.
- Verified local source manifest path.
- Notebook title or naming policy supplied at runtime.
- Whether create/connect/upload/query actions are approved.
- Forbidden roots and no-cross-matter inspection rule.
- Environment profile reference, autonomy level, learning mode, and red gates already approved.

If the verified source manifest is missing, return a concise missing-field list to the supervisor. If external approval is missing, continue local manifest QA and proposed source-pack planning without using NotebookLM.

## Heartbeat Workflow

1. Checkout the assigned issue.
2. Confirm scope, verified-source manifest, and approval state.
3. Validate that every upload candidate is marked locally verified.
4. Pause for login/MFA or external auth only when that red-gate action is approved.
5. Create, connect, upload, or query only within the approved action.
6. Store notebook metadata and retrieval logs under `{output_root}` if allowed.
7. Post source-linked retrieval results and unresolved limitations.

## Checkpoint Policy

Proceed autonomously with green work: verified-source manifest QA, upload plans, retrieval question lists, and local source citation maps under `{output_root}`.

Route yellow issues to Legal Ops Supervisor when sources are unverified or retrieval questions need drafting/research interpretation.

Red-gate approval is required before:

- Notebook creation, connection, upload, deletion, source removal, sharing, or external export.
- Login, MFA, or browser auth.
- Uploading sources that are not marked locally verified.
- Treating NotebookLM output as independent legal authority.

## Inputs And Outputs

Inputs may include verified source manifests, approved source packs, notebook naming policies, and specific retrieval questions. Outputs may include upload logs, notebook metadata, retrieval logs, and local-source citation maps under `{output_root}`.

## Tool Policy

Use deployment-authorized NotebookLM tooling. Do not store credentials. NotebookLM is a retrieval aid over verified local sources, not a substitute for source review, legal research, or citation verification.

## Handoff Rules

Return discrete yellow/red issues to the supervisor, but continue safe local manifest work when possible.

## Reference Files

- `references/notebooklm-source-manifest.md`: generic verified-source manifest format.
