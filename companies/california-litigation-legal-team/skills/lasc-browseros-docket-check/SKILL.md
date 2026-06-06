---
name: lasc-browseros-docket-check
description: Use when a Paperclip docket agent must check Los Angeles Superior Court public civil docket information, summarize register-of-actions entries, identify hearings, compare docket facts to supplied source material, or prepare a procedural status note through BrowserOS. Do not use to file, serve, buy paid documents, send email, calendar deadlines, or bypass CAPTCHA/login/payment gates.
---

# LASC Browser Docket Check

## Paperclip Role

Use this skill from a Docket Agent assigned to a public docket-check issue. The skill contains no case numbers, party names, account details, payment instructions, or firm-specific procedures.

## Required Issue Contract

Before docket work begins, confirm the issue states:

- Case number or exact public docket search parameters.
- Jurisdiction/court and scope of review.
- Output root for notes or status artifacts.
- Whether browser access is approved.
- Forbidden actions, including filing, service, paid retrieval, email, and calendaring unless separately approved.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, learning mode, and red gates already approved.

If search parameters are missing, return a concise missing-field list to the supervisor. If browser approval is missing, prepare a docket-check plan or local source comparison and record the external work that remains.

## Heartbeat Workflow

1. Checkout the assigned issue.
2. Confirm case number/search scope and browser approval.
3. Use BrowserOS with snapshot-before-action discipline only when browser access is approved.
4. Search the public docket using the supplied parameters.
5. Record confirmed docket facts separately from inference and unresolved access limits.
6. Post a status summary or save a new artifact under `{output_root}`.

## Checkpoint Policy

Proceed autonomously with green work: local source comparison, docket-check planning, public docket summaries when browser access is approved, and status notes under `{output_root}`.

Route yellow issues to Legal Ops Supervisor when docket data conflicts with source documents or deadline/calendar work should be delegated.

Red-gate approval is required before:

- Login, MFA, CAPTCHA continuation, payment, or paid document retrieval.
- Downloading documents when the issue did not authorize it.
- Filing, serving, signing, emailing, or calendar writing.
- Treating docket facts as certified records.

## Inputs And Outputs

Inputs include case number, party names supplied at runtime, hearing facts, and source materials to compare. Outputs include docket-status comments, register-of-actions summaries, hearing lists, conflict notes, and access-limit notes.

## Tool Policy

Use BrowserOS or another approved browser tool. Do not store credentials. Do not bypass access restrictions. For deadline calculations, hand off to the Calendar Agent rather than embedding calendaring policy in this skill.

## Handoff Rules

Return discrete yellow/red issues to the supervisor, but continue safe local comparison or public docket summary work when possible.

## Reference Files

- `references/docket-output-format.md`: generic docket-status output format.
