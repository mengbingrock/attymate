---
schema: agentcompanies/v1
slug: lasc-browseros-docket-check
name: lasc-browseros-docket-check
description: Use when a Paperclip docket agent must check Los Angeles Superior Court public civil docket information, summarize register-of-actions entries, identify hearings, compare docket facts to supplied source material, or prepare a procedural status note through BrowserOS. Do not use to file, serve, buy paid documents, send email, calendar deadlines, or bypass CAPTCHA/login/payment gates.
---

# lasc-browseros-docket-check

*How the California Litigation Legal Team checks the LASC public civil docket through BrowserOS — confirmed facts kept apart from inference, source-bound and supervised.*

## When to load this skill

- The Docket Agent is assigned a public docket-check issue for a Los Angeles Superior Court matter.
- Register-of-actions entries, hearings, or procedural status need to be summarized from the public docket.
- Docket facts need to be compared against supplied source material.
- A procedural status note is required before deadline or calendar work is delegated elsewhere.
- This skill contains no case numbers, party names, account details, payment instructions, or firm-specific procedures.

## Inputs

Before docket work begins, confirm the issue states:

- Case number or exact public docket search parameters.
- Jurisdiction/court and scope of review.
- Output root for notes or status artifacts.
- Whether browser access is approved.
- Forbidden actions, including filing, service, paid retrieval, email, and calendaring unless separately approved.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, approval profile, learning mode, and approval gates already approved.

Runtime inputs include case number, party names supplied at runtime, hearing facts, and source materials to compare.

If search parameters are missing, return a concise missing-field list to the supervisor. If browser approval is missing, prepare a docket-check plan or local source comparison and record the external work that remains.

If the issue states `approval_profile: sandbox_autopilot`, apply `ca-subpoena-mtc-autonomous-runner/references/human-approval-gates.md`: public read-only docket checks without login, CAPTCHA, payment, download, filing, or service are green; those excluded actions remain hard gates.

## Procedure

1. Checkout the assigned issue.
2. Confirm case number/search scope and browser approval.
3. Use BrowserOS (or another approved browser tool) with snapshot-before-action discipline only when browser access is approved. Do not store credentials. Do not bypass access restrictions.
4. Search the public docket using the supplied parameters.
5. Record confirmed docket facts separately from inference and unresolved access limits.
6. Post a status summary or save a new artifact under `{output_root}`. For deadline calculations, hand off to the Calendar Agent rather than embedding calendaring policy here.
7. **Apply the checkpoint policy.** Green work proceeds autonomously and is logged: local source comparison, docket-check planning, public docket summaries when browser access is approved, and status notes under `{output_root}`. Yellow routes to the Legal Ops Supervisor when docket data conflicts with source documents or deadline/calendar work should be delegated. Red requires visible approval before the actions listed under Anti-patterns. Return discrete yellow/red issues to the supervisor but continue safe local comparison or public docket summary work when possible.

## Outputs

- Docket-status comments, register-of-actions summaries, hearing lists, conflict notes, and access-limit notes.
- Discrete yellow/red issues returned to the Legal Ops Supervisor.
- A handoff to the Calendar Agent for any deadline calculations.

## Anti-patterns

Never do any of the following without visible red-gate approval:

- Login, MFA, CAPTCHA continuation, payment, or paid document retrieval.
- Downloading documents when the issue did not authorize it.
- Filing, serving, signing, emailing, or calendar writing.
- Treating docket facts as certified records.

## Reference

- `references/docket-output-format.md`: generic docket-status output format.
