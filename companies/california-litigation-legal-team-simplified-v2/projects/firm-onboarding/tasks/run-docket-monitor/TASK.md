---
schema: agentcompanies/v1
kind: task
slug: run-docket-monitor
name: Configure and run Docket monitor
assignee: docket-agent
project: firm-onboarding
priority: medium
recurring: true
---

Run public, read-only docket monitoring under the approved `docket_monitor_profile` in this routine's variables, and report candidate matter changes to Legal Ops Supervisor per `references/monitoring-report-contract.md`. Apply the gating criteria in `gating/docket-monitoring-gates.md`.

## Setup (first run, or whenever the profile is missing)

A complete `docket_monitor_profile` names: connector/browser status, authorized courts or portals, public-only rule, authorized public-document access, matter/case list source, case-identifier storage location, check cadence, lookback window, change-detection rule, redaction policy, routing criteria, and report cadence.

Configure the profile with the operator before any portal check, and define the lawyer-facing output shape (one-sentence summary, recommended next action, and the exact approval or source choice needed if more access is required). Store the result in this routine's variables. Then confirm the routine's schedule trigger uses `coalesce_if_active` and `skip_missed` and is either `setup-ready / paused` or `enabled / runnable`; if paused, report that setup is complete but monitoring is not live and leave one next action (enable or keep paused). Do not report docket monitoring as configured without a working schedule trigger. Monitoring goes live only after the board/operator enables the routine.
