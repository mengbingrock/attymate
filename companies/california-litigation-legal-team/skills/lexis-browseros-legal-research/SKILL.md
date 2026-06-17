---
schema: agentcompanies/v1
slug: lexis-browseros-legal-research
name: lexis-browseros-legal-research
description: Use when a Paperclip legal research agent must perform approved Lexis research, citation verification, Shepardizing, authority-table creation, or source-supported legal research memoranda through BrowserOS or another authorized browser tool. Do not use for memory-derived authorities, unapproved external research, Lexis AI/Protege, or account-specific login instructions.
---

# lexis-browseros-legal-research

*How the California Litigation Legal Team runs Lexis and browser-based legal research — source-bound and supervised, never from memory, never beyond the approved source set.*

## When to load this skill

- A Legal Research Agent is assigned to a scoped research issue and is opening it for the first time.
- An issue requires citation verification, Shepardizing, or treatment-checking of authorities the legal point depends on.
- An authority table or source-supported research memorandum must be built from approved sources.
- Approved Lexis or authenticated-browser research has been authorized and a session is about to begin.
- This skill is generic and reusable: it carries no client facts, matter examples, firm accounts, saved searches, internal URLs, or private credentials.

## Inputs

Before research begins, confirm the issue states the contract fields:

- Research question and jurisdiction.
- Matter label to use for audit purposes, supplied at runtime.
- Approved source scope and whether external Lexis research is authorized.
- Output root for research logs, authority tables, exports, and memos.
- Authority-use limits, including whether only supplied authorities may be used.
- Forbidden roots and no-cross-matter inspection rule.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, approval profile, learning mode, and any visible hard-gate approvals already granted.

If research scope or matter label is missing, return the missing-field list to the supervisor. If external Lexis access is not approved, continue with supplied or already-approved authorities and record what external work remains.

Inputs may include issue research questions, supplied authority files, public law, user-approved search terms, and approved Lexis results.

Apply `ca-subpoena-mtc-autonomous-runner/references/human-approval-gates.md`: supplied-authority work is green, but Lexis, new external legal research, external downloads, and new authorities remain hard gates.

## Procedure

1. **Checkout the assigned issue.**
2. **Read context.** Read the parent issue, comments, supplied authorities, and research scope.
3. **Confirm external-research approval.** Before opening Lexis or authenticated browser sessions, confirm hard-gate approval for external Lexis research; otherwise perform supplied-authority workup only.
4. **Search source-bound.** Search targeted public/legal databases using source-bound terms. Use BrowserOS or another deployment-authorized browser. Pause for manual login/MFA; never store credentials.
5. **Verify before relying.** Open and verify primary authorities before relying on them. Prefer official Lexis page text, exports, or PDFs when available, but treat all authority claims as needing source verification. Never use authorities derived from memory.
6. **Check treatment.** Shepardize or treatment-check key authorities when the legal point matters.
7. **Log everything.** Keep a research log with search strings, filters, sources reviewed, accepted authorities, rejected authorities, and treatment notes.
8. **Checkpoint and gate.** Proceed autonomously with green work: supplied-authority tables, citation formatting checks from supplied text, issue research logs, and source-supported memo notes using approved sources. Route yellow issues to the Legal Ops Supervisor when scope expands or a discrete legal strategy question can be separated from source verification — but continue supplied-authority work where possible. Hard-gate approval is required before: browser authentication, Lexis login, or MFA; adding new authorities beyond the supplied/approved source set; using Lexis AI, Protege, or similar generative research features; downloading, exporting, uploading, emailing, filing, serving, or finalizing; or adopting legal theory, relief, sanctions, privacy, or protective-order recommendations through external action or protected mutation.
9. **Post and save.** Post findings and save approved outputs under `{output_root}`.

## Outputs

- Outputs may include issue comments, research logs, authority tables, treatment notes, and source-supported research memos.
- Mark done only after posting a source-supported answer, an authority table, and an unresolved external-research list.
- Return discrete yellow or hard-gate issues to the Legal Ops Supervisor, but continue supplied-authority work when possible.
- Do not embed credentials, private account details, client secrets, or confidential facts in reusable skill files.

## Anti-patterns

- Citing authorities from memory. Every authority claim needs source verification.
- Opening Lexis, authenticating, or completing MFA before hard-gate approval.
- Adding authorities beyond the supplied or approved source set without approval.
- Using Lexis AI, Protege, or similar generative research features — hard-gated.
- Downloading, exporting, uploading, emailing, filing, serving, or finalizing without approval.
- Storing credentials, or embedding client secrets, private account details, or confidential facts in this reusable skill.
- Blocking indefinitely on a missing field instead of continuing safe supplied-authority work and recording what remains.

## Reference

- `references/research-output-format.md`: generic research-log and authority-table fields.
