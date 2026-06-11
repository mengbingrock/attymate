---
schema: agentcompanies/v1
kind: task
slug: configure-gmail-monitoring
name: Configure Gmail monitoring
assignee: legal-ops-supervisor
project: firm-onboarding
priority: medium
---

Create or update the Firm Operations Guide section for the read-only Gmail monitor profile before any mailbox polling begins.

Define `gmail_monitor_profile`: connector status, authorized account or mailbox scope, allowed queries or labels, exclusions, lookback window, max messages per run, dedupe rule, redaction policy, candidate-routing criteria, report cadence, routine owner, routine status, and red gates. If connector access, auth, or scope is missing, stop with a setup checklist rather than reviewing Gmail.

Also define how Gmail findings should be summarized for a lawyer: one-sentence lawyer summary, recommended next action, and the exact approval or source choice needed if Legal Ops must ask for more access.

If the profile is approved, propose or create a Paperclip routine assigned to `gmail-monitor-agent` with status `paused` until the board/operator enables it. Use `coalesce_if_active` and `skip_missed` unless the profile says otherwise. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Do not send, reply, forward, label, archive, delete, mark read/unread, download attachments, upload content, create calendar entries, file, serve, sign, or draft legal work product. Add a section-ready update or direct document edit to `firm-operations-guide`.
