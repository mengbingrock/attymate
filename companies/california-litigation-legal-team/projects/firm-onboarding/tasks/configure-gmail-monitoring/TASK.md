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

Define `gmail_monitor_profile`: connector status, authorized account or mailbox scope, allowed queries or labels, exclusions, lookback window, max messages per run, authorized content access, dedupe rule, redaction policy, candidate-routing criteria, report cadence, routine owner, routine status, and hard gates. If connector access, auth, or scope is missing, stop with a setup checklist rather than reviewing Gmail. Read-only review inside a complete profile is green, including matching message bodies, thread context, metadata, and attachment contents when the profile authorizes them; sending/replying, labels/archive/trash, external forwarding/share, and mailbox mutation are hard gates.

Also define how Gmail findings should be summarized for a lawyer: one-sentence lawyer summary, recommended next action, and the exact approval or source choice needed if Legal Ops must ask for more access.

Verify the imported Paperclip routine `run-gmail-monitor` exists, is assigned to `gmail-monitor-agent`, has a schedule trigger, uses `coalesce_if_active` and `skip_missed`, and is either `setup-ready / paused` or explicitly `enabled / runnable`. If it remains paused, say plainly that setup is complete but monitoring is not live, and leave one next action: enable the routine under this approved profile or keep it paused. If the routine is missing, create it from the company package defaults or mark this setup issue blocked with a product/setup note; do not mark Gmail monitoring configured when no routine exists. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Do not send, reply, forward, label, archive, delete, mark read/unread, save attachments outside the approved reporting/workspace flow, upload content, create calendar entries, file, serve, sign, or draft legal work product. Add a section-ready update or direct document edit to `firm-operations-guide`.
