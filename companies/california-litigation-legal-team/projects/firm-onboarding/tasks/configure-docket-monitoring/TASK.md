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

Define `docket_monitor_profile`: connector/browser status, authorized courts or portals, public-only rule, matter/case list source, case-identifier storage location, check cadence, lookback window, change-detection rule, report cadence, routine owner, routine status, and hard gates. If public portal scope or case-list scope is missing, stop with a setup checklist and docket-check plan rather than browsing. Public no-login checks inside the approved profile are green; login, CAPTCHA, payment, external downloads, filing, service, signing, email, calendar writes, and external upload/share are hard gates.

Also define how Docket findings should be summarized for a lawyer: one-sentence lawyer summary, recommended next action, and the exact approval or source choice needed if Legal Ops must ask for more access.

Verify the imported Paperclip routine `run-docket-monitor` exists, is assigned to `docket-agent`, has a schedule trigger, uses `coalesce_if_active` and `skip_missed`, and remains `paused` until the board/operator enables it. If the routine is missing, create it from the company package defaults or mark this setup issue blocked with a product/setup note; do not mark Docket monitoring configured when no routine exists. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Docket monitoring is public and read-only by default. Do not cross login, CAPTCHA, payment, paid retrieval, download, filing, service, email, or calendar-write gates without visible approval on the issue. Add a section-ready update or direct document edit to `firm-operations-guide`.
