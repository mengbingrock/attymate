# Autonomy Modes

Use the parent issue's autonomy level.

## safe-draft-only

Agents may read approved sources, create new output-root artifacts, prepare OCR sidecars, tables, outlines, draft text, QA notes, and proposed child issues. They stop before external tools, active Word writes, finalization, filing, service, email, signing, overwrite, deletion, rename, or strategy changes.

## supervised-tools

Agents may use local tools already approved in the Firm Operations Guide and issue contract, such as local OCR or document inspection, while still stopping at external-tool and finalization red gates.

## approved-external-actions

Agents may perform only the specific external actions named in the parent issue approval. Approval for one external action does not imply approval for uploads, downloads, emails, calendar writes, filing, service, signing, paid retrieval, or new authorities.

Default to `safe-draft-only` when the issue is ambiguous.
