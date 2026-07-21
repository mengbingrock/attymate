---
schema: agentcompanies/v1
slug: legal-calendaring-workflow
name: legal-calendaring-workflow
description: Calculate, propose, review, write when approved, and verify litigation deadlines and calendar entries from verified trigger facts and a supplied policy source.
---

# legal-calendaring-workflow

## Procedure

1. Confirm the trigger fact, governing policy/rule source, time zone, target calendar scope, and requested reminders.
2. Calculate each proposed deadline with a source-backed trigger and rule.
3. Identify only uncertainties that can change the date.
4. Present the proposal using `references/calendar-output-format.md`.
5. A calendar write/invite/notification/email requires an attorney decision. After an approved write, read back and verify the entry without another approval.
6. Read-only monitoring within an approved profile is standing-authorized. No-change runs end silently; actionable changes follow `agents/calendar-agent/references/monitoring-report-contract.md`.

## Operational Interruptions

Expired login, MFA, unavailable connector, or missing configuration routes to Legal Ops/tool owner. Do not ask the lawyer unless only the lawyer can supply access or the interruption materially changes delivery.

## Communication

State the date/event, reliable trigger and authority, practical consequence, and next action. Keep calculation sheets, connector detail, entry IDs, and verification logs internal.

## Limits

Do not invent calendaring policy, inspect outside scope, or write to a calendar without the required decision.
