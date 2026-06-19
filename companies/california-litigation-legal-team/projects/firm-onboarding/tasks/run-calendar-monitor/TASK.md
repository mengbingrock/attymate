---
schema: agentcompanies/v1
kind: task
slug: run-calendar-monitor
name: Run Calendar monitor
assignee: calendar-agent
project: firm-onboarding
priority: medium
recurring: true
---

Run the approved read-only calendar monitoring profile and report candidate litigation deadline or event findings to Legal Ops Supervisor.

Preconditions:

- `calendar_monitor_profile` exists in the private Firm Operations Guide or the routine variables.
- The profile names the authorized calendars, authorized event-content access, exclusions, lookback/lookahead windows, deadline/event categories, dedupe rule, redaction policy, routing criteria, and policy source.
- The routine is enabled by the board/operator after onboarding confirms the profile is ready.

If the profile is missing, disabled, or too broad, do not inspect calendars. Write a `monitor-report` issue document that names the missing setup field and asks Legal Ops for the one next configuration step.

Allowed work is read-only review within the approved profile and a durable `monitor-report` under `references/monitoring-report-contract.md`. Event title/body/description/location/attendees/recurrence/notes and event attachments or linked files may be read when the profile authorizes them. Proposed deadline tables are allowed when the triggering facts and policy source are supplied. Dedupe before creating anything. If there are no reportable or duplicate findings, write the report and close. If there is an actionable candidate, create or update a non-substantive Legal Ops triage issue linked to the report. Do not create, update, delete, invite, notify, email, or create substantive legal-work child issues directly.
