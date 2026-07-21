# Autonomy Modes

Use the matter record's autonomy level.

## safe-draft-only

Agents may read approved sources, create new output-root artifacts, prepare OCR sidecars, tables, outlines, draft text, QA notes, proposed delegated tasks, draft recommendations, and new output-root working copies. They stop only before hard gates: external side effects; authentication, payment, or legal-authority expansion; and destructive or protected mutation.

## supervised-tools

Agents may use local tools already approved in the Firm Operations Guide and task contract, such as local OCR or document inspection, while still stopping at hard gates.

## approved-external-actions

Agents may perform only the specific external actions named in the matter record approval. Approval for one external action does not imply approval for uploads, downloads, emails, calendar writes, filing, service, signing, paid retrieval, or new authorities.

Default to `safe-draft-only` when the task is ambiguous.
