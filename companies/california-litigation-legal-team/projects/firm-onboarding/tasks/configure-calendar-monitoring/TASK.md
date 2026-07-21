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

Define `calendar_monitor_profile`: provider, connector status, authorized calendars or manual source, read-only scope, exclusions, lookback/lookahead, watched categories, privacy and dedupe rules, schedule, owner, and status. If access, scope, or the governing calendaring policy is missing, record an Operational Interruption for the owner. Read-only review and proposed deadline tables proceed within an enabled profile. Calendar writes, invitations, notifications, and email require an Attorney Decision.

Also define silent no-change behavior and how a material finding is summarized: date or procedural change, reliable source, practical effect, recommended action, and one decision only if required.

Verify the imported Paperclip routine `run-calendar-monitor` exists, is assigned to `calendar-agent`, has a schedule trigger, uses `coalesce_if_active` and `skip_missed`, and is either `setup-ready / paused`, `setup-ready / pending connector`, `manual-source`, or explicitly `enabled / runnable`. If it remains paused, say plainly that setup is complete but monitoring is not live, and leave one next action: enable the routine under this approved profile, connect the missing provider, use manual-source intake, or keep it paused. If the routine is missing, create it from the company package defaults or mark this setup issue blocked with a product/setup note; do not mark Calendar monitoring configured when no routine exists. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Calendar monitoring is read-only. Do not create, update, delete, invite, notify, or email without an Attorney Decision and an authorized actor. Add a section-ready update or direct document edit to `firm-operations-guide`.
