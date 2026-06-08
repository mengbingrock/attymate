# California Litigation Legal Team

This is a reusable Paperclip `agentcompanies/v1` package for California litigation workflows. It packages one board-facing Legal Ops Supervisor, reusable specialist agents, a read-only Gmail Monitor Agent, one opt-in Practice Learning Agent, onboarding tasks, and reusable legal skills for intake, OCR, research, drafting, docket checks, calendaring, QA, workflow learning, and subpoena motion-to-compel work.

## Import

From a running Paperclip instance:

```powershell
npx.cmd paperclipai company import https://github.com/mengbingrock/attymate/tree/master/companies/california-litigation-legal-team --target new --new-company-name "California Litigation Legal Team" --include company,goals,agents,projects,tasks,skills --yes --api-base http://127.0.0.1:3100
```

For local development from a checked-out repository:

```powershell
npx.cmd paperclipai company import .\companies\california-litigation-legal-team --target new --new-company-name "California Litigation Legal Team" --include company,goals,agents,projects,tasks,skills --yes --api-base http://127.0.0.1:3100
```

To import the company without onboarding starter issues, omit `tasks` from `--include`.

## Post-Import Setup

- Complete the imported Firm Onboarding issues before live matter work.
- Configure each `codex_local` agent with the deployment's absolute `cwd` / workspace root.
- Configure authenticated Codex CLI access or an approved deployment-specific API-key auth mechanism.
- Configure Python, OCR/PDF tooling, Docling or equivalent local processing, and approved output roots.
- Review executable-script trust before using repo helper scripts. The MTC drafting skill references an optional local OCR helper at `skills/ca-subpoena-mtc-drafting-workflow/scripts/ocr_pdf_intake.ps1`; it requires explicit `{matter_root}` / `{output_root}` scope, writes only under the approved output root, and must be run only in a deployment-approved Python/OCR environment. Paperclip company import stores the markdown skill/reference files; deployments that want the helper should review and copy or run it from the repository source after approval.
- Set budgets, model choices, and approval policies appropriate for the deployment.
- Configure external-tool access before use: BrowserOS or equivalent browser tooling, Gmail, Google Calendar, Google Drive, Lexis, LASC, external knowledge-base/upload systems, filing, service, and upload/download workflows.
- Configure `gmail_monitor_profile` before enabling Gmail Monitor Agent routines.
- Keep the completed Firm Operations Guide private to the deployment.
- Start live work only from a parent issue assigned to Legal Ops Supervisor.
- Put exact `{matter_root}`, `{output_root}`, Firm Operations Guide reference, read-only source roots, forbidden roots, allowed outputs, autonomy level, learning mode, and red gates in every live issue's Matter Safety Contract.

## Confidentiality And Portability

This package is intended for public reuse. Do not add client names, matter identifiers, case numbers, firm-specific procedures, private URLs, credentials, account IDs, knowledge-base IDs, calendar IDs, hardcoded local paths, or source matter files.

Deployment-specific behavior belongs in issue contracts, the private Firm Operations Guide, local adapter configuration, or private firm policy documents supplied at runtime. MTC remains a workflow owned by Legal Ops and the unified specialists, not an import-time project or separate sub-organization. Gmail monitoring is optional and read-only until configured. Practice learning is opt-in and private by default.
