# Workspace Setup

Use runtime paths from the Matter Safety Contract and Firm Operations Guide. Do not hardcode local paths in reusable skills.

Recommended portable folders:

- `{matter_root}`: selected matter folder or approved source set.
- `{output_root}`: approved intermediary work folder for this issue.
- `{output_root}/OCR`: OCR and text sidecars.
- `{output_root}/Drafts`: new draft sections and working copies.
- `{output_root}/Tables`: chronology, issue, authority, exhibit, and replacement tables.
- `{output_root}/QA`: checklists, risk notes, and unresolved-input lists.

Rules:

- Keep source roots read-only.
- Keep new artifacts under `{output_root}` unless the issue expressly approves another location.
- Use numbered artifact names for intermediary work when sequence matters.
- Do not inspect other matters or deployment-private folders outside the approved source roots.
- Do not overwrite user-edited, signed, filed, served, final, or gold-standard documents without red-gate approval.
