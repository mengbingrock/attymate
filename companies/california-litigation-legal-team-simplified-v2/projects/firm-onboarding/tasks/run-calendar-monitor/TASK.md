---
schema: agentcompanies/v1
kind: task
slug: run-calendar-monitor
name: Configure and run Calendar monitor
assignee: calendar-agent
project: firm-onboarding
priority: medium
recurring: true
---

Run read-only calendar monitoring under the approved `calendar_monitor_profile` in this routine's variables, and report candidate litigation deadline or event findings to Legal Ops Supervisor per `references/monitoring-report-contract.md`. Apply the gating criteria in `gating/calendar-monitoring-gates.md`.

## Setup (first run, or whenever the profile is missing)

A complete `calendar_monitor_profile` names: provider (`google_calendar`, `outlook_calendar`, or `other`), connector status, authorized/excluded calendars, shared calendars/groups or manual-source export, authorized event-content access, lookback/lookahead windows, deadline/event categories to watch, dedupe rule, redaction policy, routing criteria, policy source, and report cadence.

Configure interactively: ask the user in the chatbox for each choice (provider, calendars, windows, cadence, approvals) instead of assuming defaults, and define the lawyer-facing output shape (one-sentence summary, next action, any approval needed). Store the result in this routine's variables. Then confirm the routine's schedule trigger uses `coalesce_if_active` and `skip_missed` and has a clear status; if paused, report that setup is done but monitoring is not live. Monitoring goes live only after the board/operator enables the routine.
