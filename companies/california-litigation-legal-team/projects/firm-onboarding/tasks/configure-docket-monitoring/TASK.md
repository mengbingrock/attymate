---
schema: agentcompanies/v1
kind: task
slug: configure-docket-monitoring
name: Configure Docket monitoring
assignee: legal-ops-supervisor
project: firm-onboarding
priority: medium
---

Create or update the Firm Operations Guide section for public docket monitoring before any portal check begins.

Define `docket_monitor_profile`: connector/browser status, authorized courts or portals, public-only rule, matter/case list source, case-identifier storage location, check cadence, lookback window, change-detection rule, report cadence, routine owner, routine status, and red gates. If browser access, public portal scope, or case-list scope is missing, stop with a setup checklist and docket-check plan rather than browsing.

Also define how Docket findings should be summarized for a lawyer: one-sentence lawyer summary, recommended next action, and the exact approval or source choice needed if Legal Ops must ask for more access.

If the profile is approved, propose or create a Paperclip routine assigned to `docket-agent` with status `paused` until the board/operator enables it. Use `coalesce_if_active` and `skip_missed` unless the profile says otherwise. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Docket monitoring is public and read-only by default. Do not cross login, CAPTCHA, payment, paid retrieval, download, filing, service, email, or calendar-write gates without visible approval on the issue. Add a section-ready update or direct document edit to `firm-operations-guide`.
