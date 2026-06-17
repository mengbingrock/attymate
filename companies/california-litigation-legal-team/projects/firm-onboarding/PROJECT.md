---
schema: agentcompanies/v1
kind: project
slug: firm-onboarding
name: Firm Onboarding
description: Import-time onboarding project for configuring a reusable litigation AI firm before live matter work.
goals:
  - complete-firm-onboarding-and-runtime-readiness
owner: legal-ops-supervisor
includes:
  - tasks/configure-workspace-structure/TASK.md
  - tasks/configure-agent-runtime/TASK.md
  - tasks/configure-local-tools/TASK.md
  - tasks/connect-external-tools/TASK.md
  - tasks/configure-gmail-monitoring/TASK.md
  - tasks/configure-calendar-monitoring/TASK.md
  - tasks/configure-docket-monitoring/TASK.md
  - tasks/run-gmail-monitor/TASK.md
  - tasks/run-calendar-monitor/TASK.md
  - tasks/run-docket-monitor/TASK.md
  - tasks/maintain-firm-operations-guide/TASK.md
  - tasks/onboard-firm-sops-templates/TASK.md
  - tasks/onboard-existing-matters/TASK.md
  - tasks/run-environment-readiness-smoke/TASK.md
  - tasks/configure-learning-feedback-policy/TASK.md
---

# Firm Onboarding

Use this project to prepare the deployment for legal work. These starter tasks should create and maintain a private Firm Operations Guide through Paperclip issue documents, not through public package files. No client facts, firm secrets, local absolute paths, credentials, OAuth artifacts, account IDs, calendar IDs, or matter files belong in this package.
