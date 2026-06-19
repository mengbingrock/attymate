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
- The profile names the authorized mailbox/account scope, queries or labels, exclusions, lookback window, max messages per run, authorized content access, dedupe rule, redaction policy, and routing criteria.
- The routine is enabled by the board/operator after onboarding confirms the profile is ready.

If the profile is missing, disabled, or too broad, do not inspect Gmail. Write a `monitor-report` issue document that names the missing setup field and asks Legal Ops for the one next configuration step.

Allowed work is read-only review within the approved profile and a durable `monitor-report` under `references/monitoring-report-contract.md`. In-scope body text, thread context, metadata, and attachment contents may be read or parsed for local report summaries when the profile authorizes them. Dedupe before creating anything. If there are no reportable or duplicate findings, write the report and close. If there is an actionable candidate, create or update a non-substantive Legal Ops triage issue linked to the report. Do not send, reply, forward, label, archive, delete, mark read/unread, save attachments outside the approved reporting/workspace flow, create calendar entries, upload/share content, file, serve, sign, or create substantive legal-work child issues directly.
