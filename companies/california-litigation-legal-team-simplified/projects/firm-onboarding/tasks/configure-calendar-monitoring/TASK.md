---
schema: agentcompanies/v1
kind: task
slug: configure-calendar-monitoring
name: Configure Calendar monitoring
assignee: calendar-agent
project: firm-onboarding
priority: medium
---

Initialize the Calendar Agent: scan the available calendar connections, list them for the user, and confirm which one the user selects to monitor.

Once the user confirms the calendar selection, propose or create a Paperclip routine assigned to `calendar-agent` with status `paused` until the board/operator enables it. Use `coalesce_if_active` and `skip_missed`. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.


