# Workflow Boundaries

- Paperclip is the control plane; the MTC skills are the legal workflow authority.
- Matter selection is user-owned. Agents must not infer a live matter from folder contents or recent activity.
- Plan Mode launch intake is read-only. No OCR sidecars, draft artifacts, Word copies, or run-state files may be created during launch intake.
- Only use authorities supplied in the workspace, already captured in an authority table, carried from an example shell, supplied by the user, or added through authorized Lexis research.
- External uploads, Lexis, NotebookLM, browser auth, email, filing, service, signing, finalization, source-file overwrite, source-file rename, or source-file deletion require approval.
- Use synthetic or otherwise approved non-confidential sources first. Live matter execution begins only after the imported Paperclip company and codex_local adapter checks pass.
- Live MTC runs begin from one Legal Ops Supervisor parent issue. Implementation child issues are created only after read-only Launch Intake and run-start approval.
- Every delegated child issue must be parent-linked to the Legal Ops parent issue and must include a Matter Safety Contract with Matter root, Output root, read-only source roots, forbidden roots, allowed outputs, no-cross-matter inspection, and approval gates.
- Specialist agents must block rather than proceed when explicit matter/output paths or the no-cross-matter rule are missing.
