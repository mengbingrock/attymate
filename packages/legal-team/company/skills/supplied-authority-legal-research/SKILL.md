---
name: supplied-authority-legal-research
description: Use when a pi legal research agent must perform source-bound legal research from supplied or already-approved authorities, including citation verification against supplied source text, treatment notes, authority-table creation, and source-supported legal research memoranda. Do not use for memory-derived authorities or unapproved external research; no live external research tooling (Lexis, browser) exists in this deployment — unresolved external research needs are escalated to the supervisor.
---

# supplied-authority-legal-research

*How the California Litigation Legal Team runs legal research — source-bound and supervised, never from memory, never beyond the approved source set. This deployment has no browser or Lexis tooling: all research is workup of supplied or already-approved authorities.*

## When to load this skill

- A Legal Research Agent is assigned to a scoped research task and is opening it for the first time.
- A task requires citation verification or treatment-checking of authorities the legal point depends on, from supplied source text.
- An authority table or source-supported research memorandum must be built from approved sources.
- This skill is generic and reusable: it carries no client facts, matter examples, firm accounts, saved searches, internal URLs, or private credentials.

## Inputs

Before research begins, confirm the task states the contract fields:

- Research question and jurisdiction.
- Matter label to use for audit purposes, supplied at runtime.
- Approved source scope: the supplied authority files and any already-approved source materials.
- Output root for research logs, authority tables, and memos.
- Authority-use limits, including whether only supplied authorities may be used.
- Forbidden roots and no-cross-matter inspection rule.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, approval profile, learning mode, and any visible hard-gate approvals already granted.

If research scope or matter label is missing, return the missing-field list to the supervisor. External research is never available: when a legal point cannot be resolved from the supplied/approved set, record it on the unresolved external-research list and escalate rather than filling the gap from memory.

## Procedure

1. **Checkout the assigned task.**
2. **Read context.** Read the matter record, task reports, supplied authorities, and research scope.
3. **Verify before relying.** Open and verify primary authorities in the supplied source text before relying on them. Treat all authority claims as needing source verification. Never use authorities derived from memory.
4. **Check treatment.** Note treatment and subsequent-history signals only insofar as they appear in the supplied/approved materials; anything requiring live treatment-checking goes on the unresolved external-research list.
5. **Log everything.** Keep a research log with sources reviewed, accepted authorities, rejected authorities, and treatment notes.
6. **Checkpoint and gate.** Proceed autonomously with green work: supplied-authority tables, citation formatting checks from supplied text, task research logs, and source-supported memo notes using approved sources. Route yellow tasks to the Legal Ops Supervisor when scope expands or a discrete legal strategy question can be separated from source verification — but continue supplied-authority work where possible. Hard-gate approval is required before: adding new authorities beyond the supplied/approved source set; downloading, exporting, uploading, emailing, filing, serving, or finalizing; or adopting legal theory, relief, sanctions, privacy, or protective-order recommendations through external action or protected mutation.
7. **Post and save.** Post findings and save approved outputs under `{output_root}`.

## Outputs

- Outputs may include task reports, research logs, authority tables, treatment notes, and source-supported research memos.
- Mark done only after posting a source-supported answer, an authority table, and an unresolved external-research list.
- Return discrete yellow or hard-gate tasks to the Legal Ops Supervisor, but continue supplied-authority work when possible.
- Do not embed credentials, private account details, client secrets, or confidential facts in reusable skill files.

## Anti-patterns

- Citing authorities from memory. Every authority claim needs source verification.
- Adding authorities beyond the supplied or approved source set without approval.
- Attempting live external research; none exists in this deployment — escalate instead.
- Downloading, exporting, uploading, emailing, filing, serving, or finalizing without approval.
- Storing credentials, or embedding client secrets, private account details, or confidential facts in this reusable skill.
- Blocking indefinitely on a missing field instead of continuing safe supplied-authority work and recording what remains.

## Reference

- `references/research-output-format.md`: generic research-log and authority-table fields.
