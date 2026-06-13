---
schema: agentcompanies/v1
kind: task
slug: maintain-firm-operations-guide
name: Maintain Firm Operations Guide
assignee: legal-ops-supervisor
project: firm-onboarding
priority: high
---

Create and maintain the canonical private Firm Operations Guide as a Paperclip issue document.

Use document key `firm-operations-guide` and title `Firm Operations Guide`. Consolidate onboarding outputs into stable sections for workspace structure, agent runtime, local tools, external tools, Gmail monitor profile, Calendar monitor profile, Docket monitor profile, monitoring report policy, firm SOPs/templates, matter mapping, approval policy, learning policy, readiness status, Light Intake defaults, and lawyer-facing matter status style.

Do not store the guide in public package files. Do not include client facts, matter identifiers, credentials, OAuth artifacts, private URLs, account IDs, local absolute paths in exported packages, or confidential source text. Future live matter parent issues should cite the relevant guide sections or include scoped excerpts in their Matter Safety Contract, but lawyer-facing intake should remain conversational and should not ask the lawyer to complete the contract manually.

When an onboarding section is complete, leave a terminal disposition note. If direct issue status update is unavailable, follow `references/onboarding-unblock-runbook.md`: state the intended disposition, summarize the completed guide evidence, name the technical owner for status mutation, and do not rerun completed implementation.
