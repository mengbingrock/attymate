# California Litigation Legal Team

This is a reusable Paperclip `agentcompanies/v1` package for California litigation workflows. It packages one board-facing Legal Ops Supervisor, eight specialist agents, and reusable legal skills for intake, OCR, research, drafting, docket checks, calendaring, NotebookLM-style knowledge bases, QA, and subpoena motion-to-compel work.

## Import

From a running Paperclip instance:

```powershell
npx.cmd paperclipai company import https://github.com/mengbingrock/attymate/tree/master/companies/california-litigation-legal-team --target new --new-company-name "California Litigation Legal Team" --include company,agents,projects,skills --yes --api-base http://127.0.0.1:3100
```

For local development from a checked-out repository:

```powershell
npx.cmd paperclipai company import .\companies\california-litigation-legal-team --target new --new-company-name "California Litigation Legal Team" --include company,agents,projects,skills --yes --api-base http://127.0.0.1:3100
```

## Post-Import Setup

- Configure each `codex_local` agent with the deployment's absolute `cwd` / workspace root.
- Configure authenticated Codex CLI access or an approved deployment-specific API-key auth mechanism.
- Set budgets, model choices, and approval policies appropriate for the deployment.
- Configure external-tool access before use: Lexis or browser research, docket portals, calendar connectors, email, Drive/Docs, NotebookLM, filing, service, and upload/download workflows.
- Start live work only from a parent issue assigned to Legal Ops Supervisor.
- Put exact `{matter_root}`, `{output_root}`, read-only source roots, forbidden roots, allowed outputs, and approval gates in every live issue's Matter Safety Contract.

## Confidentiality And Portability

This package is intended for public reuse. Do not add client names, matter identifiers, case numbers, firm-specific procedures, private URLs, credentials, account IDs, notebook IDs, calendar IDs, hardcoded local paths, or source matter files.

Deployment-specific behavior belongs in issue contracts, approved deployment profiles, local adapter configuration, or private firm policy documents supplied at runtime. MTC remains a workflow owned by Legal Ops and the unified specialists, not a separate sub-organization.
