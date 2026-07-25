---
schema: agentcompanies/v1
kind: task
slug: run-email-monitor
name: Configure and run Email monitor
assignee: email-monitor-agent
project: firm-onboarding
priority: medium
recurring: true
---

Run read-only email monitoring under the approved `email_monitor_profile` in this routine's variables, and report candidate legal-work findings to Legal Ops Supervisor per `references/monitoring-report-contract.md`. Apply the gating criteria in `gating/email-monitoring-gates.md`.

## Setup (first run, or whenever the profile is missing)

A complete `email_monitor_profile` names: provider (`gmail`, `outlook`, or `other`), connector status, authorized account or mailbox scope, allowed folders/labels/categories/search terms or manual-source export, exclusions, lookback window, max messages per run, authorized content access, attachment policy, dedupe/redaction rules, candidate-routing criteria, and report cadence.

Configure the profile with the operator before any mailbox polling, and define the lawyer-facing output shape (one-sentence summary, recommended next action, and the exact approval or source choice needed if more access is required). Store the result in this routine's variables. Then confirm the routine's schedule trigger uses `coalesce_if_active` and `skip_missed` and has a clear status; if paused, report that setup is complete but monitoring is not live and leave one next action. Do not report email monitoring as configured without a working schedule trigger. Monitoring goes live only after the board/operator enables the routine.
