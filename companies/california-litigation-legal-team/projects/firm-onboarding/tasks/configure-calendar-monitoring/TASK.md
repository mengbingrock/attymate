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

Define `calendar_monitor_profile`: connector status, authorized calendars or calendar groups, read-only scope, authorized event-content access, excluded calendars/events, lookback and lookahead windows, deadline/event categories to watch, privacy redaction rules, dedupe rule, report cadence, routine owner, routine status, and hard gates. If connector access, auth, profile scope, or policy source is missing, stop with a setup checklist rather than reviewing calendar data. Read-only monitoring is green inside a complete profile, including event title/body/description/location/attendees/recurrence/notes and event attachments or linked files when the profile authorizes them. Proposed deadline tables are green; calendar writes, invites, notifications, and email are hard gates.

Also define how Calendar findings should be summarized for a lawyer: one-sentence lawyer summary, recommended next action, and the exact approval or source choice needed if Legal Ops must ask for more access.

Verify the imported Paperclip routine `run-calendar-monitor` exists, is assigned to `calendar-agent`, has a schedule trigger, uses `coalesce_if_active` and `skip_missed`, and is either `setup-ready / paused` or explicitly `enabled / runnable`. If it remains paused, say plainly that setup is complete but monitoring is not live, and leave one next action: enable the routine under this approved profile or keep it paused. If the routine is missing, create it from the company package defaults or mark this setup issue blocked with a product/setup note; do not mark Calendar monitoring configured when no routine exists. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Calendar monitoring is read-only. Do not create, update, delete, invite, notify, email, or otherwise write to any calendar system without visible hard-gate approval on the issue. Add a section-ready update or direct document edit to `firm-operations-guide`.
