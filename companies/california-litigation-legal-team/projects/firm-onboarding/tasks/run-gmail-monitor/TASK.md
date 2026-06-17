---
schema: agentcompanies/v1
kind: task
slug: run-gmail-monitor
name: Run Gmail monitor
assignee: gmail-monitor-agent
project: firm-onboarding
priority: medium
recurring: true
---

Run the approved read-only Gmail monitoring profile and report candidate legal-work findings to Legal Ops Supervisor.

Preconditions:

- `gmail_monitor_profile` exists in the private Firm Operations Guide or the routine variables.
- The profile names the authorized mailbox/account scope, queries or labels, exclusions, lookback window, max messages per run, dedupe rule, redaction policy, and routing criteria.
- The routine is enabled by the board/operator after onboarding confirms the profile is ready.

If the profile is missing, disabled, or too broad, do not inspect Gmail. Post a blocked monitor report that names the missing setup field and asks Legal Ops for the one next configuration step.

Allowed work is read-only review within the approved profile and a report under `references/monitoring-report-contract.md`. Do not send, reply, forward, label, archive, delete, mark read/unread, download attachments, create calendar entries, upload/share content, file, serve, sign, or create substantive legal-work child issues directly. Route all candidate matter actions to Legal Ops Supervisor.
