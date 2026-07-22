# Optional PDF Operator Tooling

This directory contains optional deployment helpers retained from the original PDF skill. They are not imported as a business skill and do not define the Legal Document Intake standard.

Before using a helper, the deployment owner must review its dependencies, trust, permitted source locations, destination for derived material, and whether any content leaves the approved environment. Record the approved implementation in the private Firm Operations Guide.

- `scripts/pdf_runtime_probe.sh` inventories locally available document capabilities.
- `scripts/ocr_pdf_intake.ps1` is an optional local preparation helper.
- `three_stage_pdf_pipeline.py` is an optional reference implementation.

Legal users should request a reviewable, page-complete document set. They should not be asked to choose one of these implementations.
