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

Define `docket_monitor_profile`: connector/browser status, authorized courts or portals, public-document access, matter/case source, identifier location, cadence, lookback, change rule, owner, and status. If scope is missing, stop with a setup checklist. Authorized public checks and free public-document downloads proceed within the profile. Payment, filing, service, signature, sending, calendar writes, and external sharing require an Attorney Decision; login, CAPTCHA, and tool failures are Operational Interruptions.

Also define silent no-change behavior and how a material finding is summarized: procedural change, reliable source, practical effect, recommended action, and one decision only if required.

Verify the imported Paperclip routine `run-docket-monitor` exists, is assigned to `docket-agent`, has a schedule trigger, uses `coalesce_if_active` and `skip_missed`, and is either `setup-ready / paused` or explicitly `enabled / runnable`. If it remains paused, say plainly that setup is complete but monitoring is not live, and leave one next action: enable the routine under this approved profile or keep it paused. If the routine is missing, create it from the company package defaults or mark this setup issue blocked with a product/setup note; do not mark Docket monitoring configured when no routine exists. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Docket monitoring is public and read-only by default. Free public documents may be reviewed and downloaded within scope. Route login/CAPTCHA/tool failures to the owner; obtain an Attorney Decision for payment, filing, service, sending, calendar writes, or external sharing. Add a section-ready update or direct document edit to `firm-operations-guide`.
