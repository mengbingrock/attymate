---
schema: agentcompanies/v1
slug: practice-workflow-learning
name: practice-workflow-learning
description: Use when a Paperclip learning agent is explicitly authorized to observe a completed or in-progress legal workflow issue, summarize practice lessons, propose private Firm Operations Guide updates, or draft sanitized public skill improvement proposals. Do not use when learning consent, allowed sources, or do-not-learn boundaries are missing.
---

# practice-workflow-learning

*How the California Litigation Legal Team learns from its own workflows — source-bound and supervised, capturing reusable patterns while never learning client facts or privileged strategy.*

## When to load this skill

- The Practice Learning Agent is assigned an issue that includes an explicit learning contract.
- A completed or in-progress legal workflow issue is to be observed for practice lessons.
- Private Firm Operations Guide updates or sanitized public skill improvement proposals are to be drafted.
- Do not use when learning consent, allowed sources, or do-not-learn boundaries are missing.

## Inputs

Confirm the issue states:

- Learning mode: `off`, `private-profile`, or `sanitized-skill-proposal`.
- Source issue or parent issue to learn from.
- Allowed learning sources: issue comments, issue documents, attachments, run summaries, named output artifacts, or named profile sections.
- Do-not-learn list: client facts, privileged strategy, confidential source text, account details, private URLs, local paths, credentials, firm secrets, and any matter-specific identifiers.
- Output target: issue comment, issue document, Firm Operations Guide proposal, or sanitized skill proposal.
- Approval gates for profile writes, public package edits, external sharing, uploads, or tool access.

If any required field is missing, do not inspect the workflow. Return the issue to the Legal Ops Supervisor with a concise missing-input list.

## Procedure

1. **Checkout and read the contract.** Checkout the assigned issue and read its learning contract.
2. **Read only allowed sources.** Read only the allowed sources. Prefer Paperclip issue context, issue documents, and approved artifacts over raw matter files.
3. **Classify observations.** Separate observations into:
   - Workflow pattern: recurring step, handoff, artifact, checklist, or decision point.
   - Firm preference: private deployment style, SOP, template, tool convention, or approval preference.
   - Product-safe improvement: generic instruction that could improve a public skill after sanitization.
   - Do-not-learn material: confidential, privileged, matter-specific, or account-specific content — excluded, never captured.
4. **Checkpoint and gate.** Proceed autonomously with observation and proposal drafting when the learning contract is complete and sources are already approved. Return to the Legal Ops Supervisor when source scope is ambiguous, the learning mode is missing, the output target is unclear, or the observed workflow includes privileged strategy that cannot be safely abstracted. Require human approval before writing to the Firm Operations Guide, editing public package files, changing live agent instructions, uploading/sharing learning outputs, or expanding learning beyond the named sources.
5. **Produce the output.** Produce the requested output with confidence and provenance.
6. **Propose, do not apply.** If proposing a skill update, write it as a patch proposal or clean markdown excerpt, not as an applied file edit.

## Outputs

Use this concise Learning Report structure:

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

- Skill-update proposals are patch proposals or clean markdown excerpts, never applied file edits.
- Do not include raw confidential text. Paraphrase only at the abstraction level needed to improve the workflow.

## Anti-patterns

- Inspecting the workflow when learning consent, allowed sources, or do-not-learn boundaries are missing.
- Learning client facts, privileged strategy, confidential source text, account details, private URLs, local paths, credentials, firm secrets, or matter-specific identifiers.
- Reading beyond the named allowed sources, or preferring raw matter files over approved issue context and artifacts.
- Writing to the Firm Operations Guide, editing public package files, changing live agent instructions, or uploading/sharing outputs without human approval.
- Applying a skill update as a file edit instead of proposing it as a patch or excerpt.
- Including raw confidential text instead of paraphrasing at the minimum abstraction level.

## Reference

Pair this skill with the workflow skills it observes — `ca-motion-drafting-workflow` and `lexis-browseros-legal-research` — and route all profile writes and public-package edits through the Legal Ops Supervisor and the required human approval gates.
