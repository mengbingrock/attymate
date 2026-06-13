---
schema: agentcompanies/v1
slug: legal-calendaring-workflow
name: legal-calendaring-workflow
description: Use when a Paperclip legal agent must calculate, propose, review, create, update, or verify litigation calendar entries, court deadlines, hearing dates, discovery deadlines, service dates, reminder schedules, or calendar QA. Do not use to write to a calendar, send notices, or apply firm-specific calendaring preferences unless the issue supplies the applicable calendar policy and the required approval has been granted.
---

# legal-calendaring-workflow

*How the California Litigation Legal Team calculates and verifies litigation deadlines — computed from approved facts and public rules, proposed before written, source-bound and supervised.*

## When to load this skill

- The Calendar Agent or a supervisor-delegated calendaring child issue must calculate or propose court deadlines, hearing dates, discovery deadlines, service dates, or reminder schedules.
- A proposed deadline table or calendar entry needs review or QA.
- An approved calendar write needs verification and read-back.
- This skill is product-safe: it contains no firm-specific rules, private calendar names, internal URLs, account details, or client facts. Deployment-specific policy must be supplied in the issue or a configured `{firm_profile}` reference.

## Inputs

Before work begins, confirm the issue states:

- Matter root or approved source set.
- Output root for proposed deadline tables and verification notes.
- Calendar policy source, such as `{firm_profile}.firm_calendar_policy`, public court rule, or user-supplied instruction.
- Jurisdiction, court, triggering event, triggering date, service method, hearing date, reservation date, or other calculation facts.
- Target calendar or a rule for asking the supervisor to choose one.
- Forbidden roots and the no-cross-matter inspection rule.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, learning mode, and red gates already approved.

Runtime inputs may include PDFs, docket facts, email text, service proofs, hearing notices, reservation receipts, public court rules, and deployment-supplied policy.

If a required calculation fact or policy source is missing, return a concise missing-input list. Do not infer facts from other matters. Continue with any proposed entries that can be calculated from approved facts.

## Procedure

1. Checkout the assigned issue before doing substantive work.
2. Read the issue body, comments, parent issue, and supplied policy references.
3. Confirm the required issue contract and approval state.
4. Extract dates and source facts only from approved sources.
5. Calculate deadlines using public rules, supplied policy, and verified holiday information. Use local date-calculation scripts only when they are deployment-safe and parameterized; do not rely on hardcoded firm calendars. Browser tools are allowed only for public court resources or approved private portal access.
6. Post a proposed deadline/calendar table to the issue or save a new artifact under `{output_root}` if allowed.
7. Request approval before any calendar write, update, deletion, invite, notification, or email. Use calendar connectors only when the deployment authorizes them.
8. After approved writes, read back the calendar entry and post verification details.
9. **Apply the checkpoint policy.** Green work proceeds autonomously and is logged: deadline calculations from approved facts, proposed calendar tables, verification notes, and artifact creation under `{output_root}`. Yellow routes to the Legal Ops Supervisor when facts are incomplete, policy conflicts exist, or a deadline depends on strategy. Red requires visible approval before the actions listed under Anti-patterns. Return discrete yellow/red issues to the supervisor but continue safe proposed-entry work when approved facts allow it.

## Outputs

- Proposed calendar entries, calculation notes, issue comments, verification notes, and new artifacts under `{output_root}`. Do not store passwords, PINs, account secrets, or private internal URLs.
- Discrete yellow/red issues returned to the Legal Ops Supervisor.
- Mark done only after posting the proposed entries or verified write results.

## Anti-patterns

Never do any of the following without visible red-gate approval:

- Creating, updating, deleting, inviting, notifying, or emailing from a calendar system.
- Opening authenticated portals or private firm resources.
- Applying a firm policy that was not supplied in the issue or deployment configuration.
- Treating a calculation as final when facts are incomplete or conflicting.
- Filing, serving, signing, or sending anything based on a calendar result.

## Reference

- `references/firm-calendar-policy-template.md`: deployment-safe policy fields a firm may provide.
- `references/calendar-output-format.md`: generic proposal and verification format.
