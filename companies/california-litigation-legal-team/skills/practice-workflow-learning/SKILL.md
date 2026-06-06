---
name: practice-workflow-learning
description: Use when a Paperclip learning agent is explicitly authorized to observe a completed or in-progress legal workflow issue, summarize practice lessons, propose private Firm Operations Guide updates, or draft sanitized public skill improvement proposals. Do not use when learning consent, allowed sources, or do-not-learn boundaries are missing.
---

# Practice Workflow Learning

Use this skill from the Practice Learning Agent only when the assigned issue includes an explicit learning contract.

## Required Issue Contract

Confirm the issue states:

- Learning mode: `off`, `private-profile`, or `sanitized-skill-proposal`.
- Source issue or parent issue to learn from.
- Allowed learning sources: issue comments, issue documents, attachments, run summaries, named output artifacts, or named profile sections.
- Do-not-learn list: client facts, privileged strategy, confidential source text, account details, private URLs, local paths, credentials, firm secrets, and any matter-specific identifiers.
- Output target: issue comment, issue document, Firm Operations Guide proposal, or sanitized skill proposal.
- Approval gates for profile writes, public package edits, external sharing, uploads, or tool access.

If any required field is missing, do not inspect the workflow. Return the issue to Legal Ops Supervisor with a concise missing-input list.

## Workflow

1. Checkout the assigned issue and read its learning contract.
2. Read only the allowed sources. Prefer Paperclip issue context, issue documents, and approved artifacts over raw matter files.
3. Separate observations into:
   - Workflow pattern: recurring step, handoff, artifact, checklist, or decision point.
   - Firm preference: private deployment style, SOP, template, tool convention, or approval preference.
   - Product-safe improvement: generic instruction that could improve a public skill after sanitization.
   - Do-not-learn material: confidential, privileged, matter-specific, or account-specific content.
4. Produce the requested output with confidence and provenance.
5. If proposing a skill update, write it as a patch proposal or clean markdown excerpt, not as an applied file edit.

## Checkpoint Policy

Proceed autonomously with observation and proposal drafting when the learning contract is complete and sources are already approved.

Return to Legal Ops Supervisor when source scope is ambiguous, the learning mode is missing, the output target is unclear, or the observed workflow includes privileged strategy that cannot be safely abstracted.

Require human approval before writing to the Firm Operations Guide, editing public package files, changing live agent instructions, uploading/sharing learning outputs, or expanding learning beyond the named sources.

## Output Format

Use this concise structure:

```md
## Learning Report

- Learning mode:
- Sources reviewed:
- Reusable workflow lessons:
- Private Firm Operations Guide proposals:
- Sanitized skill proposals:
- Do-not-learn material excluded:
- Required approvals:
```

Do not include raw confidential text. Paraphrase only at the abstraction level needed to improve the workflow.
