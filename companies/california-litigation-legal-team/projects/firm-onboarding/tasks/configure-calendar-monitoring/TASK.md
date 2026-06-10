---
schema: agentcompanies/v1
kind: task
slug: configure-calendar-monitoring
name: Configure Calendar monitoring
assignee: legal-ops-supervisor
project: firm-onboarding
priority: medium
---

Create or update the Firm Operations Guide section for read-only litigation calendar monitoring before any calendar review begins.

Define `calendar_monitor_profile`: connector status, authorized calendars or calendar groups, read-only scope, excluded calendars/events, lookback and lookahead windows, deadline/event categories to watch, privacy redaction rules, dedupe rule, report cadence, routine owner, routine status, and red gates. If connector access, auth, profile scope, or policy source is missing, stop with a setup checklist rather than reviewing calendar data.

If the profile is approved, propose or create a Paperclip routine assigned to `calendar-agent` with status `paused` until the board/operator enables it. Use `coalesce_if_active` and `skip_missed` unless the profile says otherwise. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Calendar monitoring is read-only. Do not create, update, delete, invite, notify, email, or otherwise write to any calendar system without a visible red-gate approval on the issue. Add a section-ready update or direct document edit to `firm-operations-guide`.
