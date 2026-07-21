# Autonomy Modes

Use the parent issue's autonomy level.

## safe-draft-only

Agents may read permitted sources, prepare OCR sidecars, conduct routine research, add verified authorities, create and revise output-root working copies, draft recommendations, run QA, and coordinate internally. Attorney Decisions remain required under the canonical matrix.

## supervised-tools

Agents may use configured local tools and read-only connectors within the parent authorization. Login or tool failure is an Operational Interruption.

## approved-external-actions

Agents may perform only the specific external action recorded in the Attorney Decision. One decision does not authorize a different external act, payment, scope expansion, protected-file mutation, or material strategy choice. Permitted source downloads and new verified authorities within scope and budget remain standing-authorized.

Default to `safe-draft-only` when the issue is ambiguous.
