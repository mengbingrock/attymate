---
schema: agentcompanies/v1
kind: project
slug: firm-onboarding
name: Firm Onboarding
description: Import-time onboarding project for configuring a reusable litigation AI firm before live matter work.
owner: legal-ops-supervisor
includes:
  - tasks/configure-workspace-structure/TASK.md
  - tasks/configure-agent-runtime/TASK.md
  - tasks/configure-local-tools/TASK.md
  - tasks/connect-external-tools/TASK.md
  - tasks/onboard-firm-sops-templates/TASK.md
  - tasks/onboard-existing-matters/TASK.md
  - tasks/run-environment-readiness-smoke/TASK.md
  - tasks/configure-learning-feedback-policy/TASK.md
---

# Firm Onboarding

Use this project to prepare the deployment for legal work. These starter tasks should create a private runtime profile through issue documents or comments, not through public package files. No client facts, firm secrets, local absolute paths, credentials, OAuth artifacts, account IDs, notebook IDs, calendar IDs, or matter files belong in this package.
