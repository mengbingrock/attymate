---
name: lexis-browseros-legal-research
description: Use when a Paperclip legal research agent must perform approved Lexis research, citation verification, Shepardizing, authority-table creation, or source-supported legal research memoranda through BrowserOS or another authorized browser tool. Do not use for memory-derived authorities, unapproved external research, Lexis AI/Protege, or account-specific login instructions.
---

# Lexis Browser Legal Research

## Paperclip Role

Use this skill from a Legal Research Agent assigned to a scoped research issue. The skill is generic and reusable: it contains no client facts, matter examples, firm accounts, saved searches, internal URLs, or private credentials.

## Required Issue Contract

Before research begins, confirm the issue states:

- Research question and jurisdiction.
- Matter label to use for audit purposes, supplied at runtime.
- Approved source scope and whether external Lexis research is authorized.
- Output root for research logs, authority tables, exports, and memos.
- Authority-use limits, including whether only supplied authorities may be used.
- Forbidden roots and no-cross-matter inspection rule.
- Environment profile reference, autonomy level, learning mode, and red gates already approved.

If research scope or matter label is missing, return the missing-field list to the supervisor. If external Lexis access is not approved, continue with supplied or already-approved authorities and record what external work remains.

## Heartbeat Workflow

1. Checkout the assigned issue.
2. Read the parent issue, comments, supplied authorities, and research scope.
3. Confirm approval for external Lexis research before opening Lexis or authenticated browser sessions; otherwise perform supplied-authority workup only.
4. Search targeted public/legal databases using source-bound terms.
5. Open and verify primary authorities before relying on them.
6. Shepardize or treatment-check key authorities when the legal point matters.
7. Keep a research log with search strings, filters, sources reviewed, accepted authorities, rejected authorities, and treatment notes.
8. Post findings and save approved outputs under `{output_root}`.

## Checkpoint Policy

Proceed autonomously with green work: supplied-authority tables, citation formatting checks from supplied text, issue research logs, and source-supported memo notes using approved sources.

Route yellow issues to Legal Ops Supervisor when scope expands or a discrete legal strategy question can be separated from source verification.

Red-gate approval is required before:

- Browser authentication, Lexis login, or MFA.
- Adding new authorities beyond the supplied/approved source set.
- Using Lexis AI, Protege, or similar generative research features.
- Downloading, exporting, uploading, emailing, filing, serving, or finalizing.
- Changing legal theory, relief, sanctions posture, privacy strategy, or protective-order strategy.

## Inputs And Outputs

Inputs may include issue research questions, supplied authority files, public law, user-approved search terms, and approved Lexis results.

Outputs may include issue comments, research logs, authority tables, treatment notes, and source-supported research memos. Do not embed credentials, private account details, client secrets, or confidential facts in reusable skill files.

## Tool Policy

Use BrowserOS or another deployment-authorized browser. Pause for manual login/MFA. Do not store credentials. Prefer official Lexis page text, exports, or PDFs when available, but treat all authority claims as needing source verification.

## Handoff Rules

Return discrete yellow/red issues to the supervisor, but continue supplied-authority work when possible. Mark done only after posting a source-supported answer, authority table, and unresolved external-research list.

## Reference Files

- `references/research-output-format.md`: generic research-log and authority-table fields.
