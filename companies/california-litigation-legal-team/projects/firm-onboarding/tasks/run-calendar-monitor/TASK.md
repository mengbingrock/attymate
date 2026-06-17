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
- The profile names the authorized calendars, exclusions, lookback/lookahead windows, deadline/event categories, dedupe rule, redaction policy, routing criteria, and policy source.
- The routine is enabled by the board/operator after onboarding confirms the profile is ready.

If the profile is missing, disabled, or too broad, do not inspect calendars. Post a blocked monitor report that names the missing setup field and asks Legal Ops for the one next configuration step.

Allowed work is read-only review within the approved profile and a report under `references/monitoring-report-contract.md`. Proposed deadline tables are allowed when the triggering facts and policy source are supplied. Do not create, update, delete, invite, notify, email, or create substantive legal-work child issues directly. Route all candidate matter actions to Legal Ops Supervisor.
