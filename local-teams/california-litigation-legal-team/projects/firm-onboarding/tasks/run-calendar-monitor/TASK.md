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
- The profile names the provider (`google_calendar`, `outlook_calendar`, or `other`), connector status, authorized calendars/shared calendars/groups or manual-source export, authorized event-content access, exclusions, lookback/lookahead windows, deadline/event categories, dedupe rule, redaction policy, routing criteria, and policy source.
- The routine is enabled by the board/operator after onboarding confirms the profile is ready.

If the profile is missing, disabled, too broad, or names a live provider connector that is unavailable, do not inspect calendars. Write a `monitor-report` issue document that names the missing setup field and asks Legal Ops for the one next configuration step. If an Outlook/Microsoft calendar connector is unavailable, report `setup-ready / pending connector` or manual-source mode instead of running fake live monitoring.

Allowed work is read-only review within the approved profile. Event details and authorized attachments or linked files may be reviewed. Proposed deadline tables are allowed when triggering facts and the policy source are supplied. Dedupe before creating anything. If there is no new reportable finding, finish silently with a one-line run/routine result. If there is an actionable candidate, create or update one batched `monitor-report` and one Legal Ops triage item. Do not create, update, delete, invite, notify, email, or create substantive legal-work child issues directly.
