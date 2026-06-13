---
schema: agentcompanies/v1
kind: task
slug: configure-gmail-monitoring
name: Configure Gmail monitoring
assignee: gmail-monitor-agent
project: firm-onboarding
priority: medium
---

Initialize the Gmail Monitor Agent: scan the available Gmail/mailbox connections, list them for the user, and confirm which one the user selects to monitor.

Once the user confirms the mailbox selection, propose or create a Paperclip routine assigned to `gmail-monitor-agent` with status `paused` until the board/operator enables it. Use `coalesce_if_active` and `skip_missed`. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Gmail monitoring is read-only. Do not send, reply, forward, label, archive, delete, mark read/unread, download attachments, upload content, create calendar entries, file, serve, sign, or draft legal work product without visible approval on the issue.
