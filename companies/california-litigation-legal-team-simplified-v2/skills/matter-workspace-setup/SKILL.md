---
schema: agentcompanies/v1
slug: matter-workspace-setup
name: matter-workspace-setup
description: Use when any matter-scoped agent must establish or confirm the portable matter workspace before source-bound work — resolving matter root and output root from the Matter Safety Contract, creating the OCR/Drafts/Tables/QA folders, and applying read-only source and artifact-naming rules. Do not use to hardcode local paths, inspect other matters or deployment-private folders, write outside the approved output root, or overwrite user-edited, signed, filed, served, final, or gold-standard documents.
---

# matter-workspace-setup

*How the California Litigation Legal Team lays out a matter workspace before any source-bound work — portable, read-only at the source, and supervised.*

## When to load this skill

- Starting a matter-scoped issue that approves intake, drafting, research, evidence, QA, or calendaring work and needs an output location.
- Confirming where OCR sidecars, draft sections, tables, and QA notes belong before producing them.
- Checking whether an intended write target is inside the approved output root or is protected.
- The skill is reusable for any California litigation matter and contains no client facts, firm templates, private style rules, or hardcoded paths.

## Inputs

Before creating or writing to any folder, confirm the issue states:

- Matter root and output root.
- Read-only source roots, including pleadings, exhibits, context, authorities, examples, and prior drafts that may be inspected.
- Forbidden roots, including other matters and deployment-private folders.
- Allowed outputs for this issue, if the issue narrows them.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, approval profile, and any visible hard-gate approvals already granted.

Take runtime paths from the Matter Safety Contract and Firm Operations Guide. Do not hardcode local paths in reusable skills, and do not reuse a machine-specific path from prior work.

If the matter root or output root is missing, return the missing-field list to the supervisor. If both are clear, continue and log narrower unresolved boundaries instead of blocking.

Apply `gating/human-approval-gates.md`: creating and writing folders under `{output_root}` is green; writing outside it, or mutating protected documents, is a hard gate.

## Procedure

1. **Resolve `{matter_root}` and `{output_root}`** from the issue contract. Confirm both exist and that `{output_root}` is writable before producing artifacts.
2. **Create or confirm the portable folders** under the output root, creating only the ones the assigned work needs:
   - `{matter_root}`: selected matter folder or approved source set.
   - `{output_root}`: approved intermediary work folder for this issue.
   - `{output_root}/OCR`: OCR and text sidecars.
   - `{output_root}/Drafts`: new draft sections and working copies.
   - `{output_root}/Tables`: chronology, issue, authority, exhibit, and replacement tables.
   - `{output_root}/QA`: checklists, risk notes, and unresolved-input lists.
3. **Classify every path before writing** as approved output, read-only source, or forbidden. Keep source roots read-only.
4. **Name intermediary artifacts** with a leading number when sequence matters, so downstream agents can follow the order of work.
5. **Stop at a hard gate** before writing outside `{output_root}`, or before overwriting, deleting, or renaming any user-edited, signed, filed, served, final, or gold-standard document.
6. **Report the resolved layout** on the issue so downstream specialists write to the same folders instead of inventing their own.

## Outputs

- The confirmed workspace layout: resolved `{matter_root}` and `{output_root}`, plus the subfolders created for this issue.
- New artifacts under `{output_root}` unless the issue expressly approves another location.
- An unresolved-input list for any path, boundary, or approval that is still missing.

## Anti-patterns

- Hardcoding a local or machine-specific path instead of resolving it from the contract.
- Writing new artifacts outside `{output_root}` without express issue approval.
- Treating a source root as writable, or editing source evidence in place.
- Inspecting other matters or deployment-private folders outside the approved source roots.
- Overwriting, deleting, or renaming user-edited, signed, filed, served, final, or gold-standard documents without hard-gate approval.
- Blocking on a narrow missing boundary when the matter root and output root already support safe work — log it instead.

## Related skills

- `ca-litigation-drafting-workflow`: source-bound drafting, tables, and Word working-copy discipline once the workspace is set.
- `ca-subpoena-mtc-drafting-workflow`: carries its own MTC-specific workspace layout; use that skill's `references/workspace-setup.md` for subpoena motion-to-compel work.
- `docling-pdf-processing`: writes OCR sidecars and manifests into the folders established here.
