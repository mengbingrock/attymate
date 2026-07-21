---
schema: agentcompanies/v1
kind: task
slug: configure-workspace-structure
name: Configure workspace structure
assignee: legal-ops-supervisor
project: firm-onboarding
priority: high
---

Create or update the Firm Operations Guide section for workspace structure.

Record the deployment's workspace root, matter folder conventions, default output folder conventions, source/document folder naming, forbidden folders, and expected per-matter intermediary work location. Use the active AttyMate WORKSPACE selection as the source of truth for the deployment root, and never copy stale cross-machine paths from prior run history into the guide. Do not store local paths in public package files. If a path is not supplied or the active workspace is missing, ask once for the operator to choose a reachable folder in AttyMate -> WORKSPACE rather than creating live matter work. Add a section-ready update or direct document edit to `firm-operations-guide`.

If the section is complete but the issue cannot be marked done because of runner or Paperclip status-update tooling, follow `references/onboarding-unblock-runbook.md`: post a terminal disposition note and stop retrying implementation.
