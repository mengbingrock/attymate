# Link upstream provenance

This directory vendors the Link command-line runtime used by AttyMate's Matter Dashboard.

- Upstream project: https://github.com/gowtham0992/link
- License: MIT
- Copyright: Copyright (c) 2026 Gowtham Sarveswaran
- Upstream base revision: `f0b1a0194e2ae7c7936b9246e8a191175392fc09`
- Direct-project integration patch SHA-256: `363f73d8871c9a37c05c3c13af4d84e8ea2ab42180b40c3c1e6c5d1bf82488e5`
- Snapshot date: 2026-08-03

The vendored snapshot includes the local direct-project indexing changes used by the
AttyMate integration. Those changes allow Link to index a matter workspace directly,
without requiring users to move every source into a separate `raw/` directory.

The complete upstream license is preserved in `LICENSE`. AttyMate invokes this source
through Python and does not rename the upstream Link APIs or claim authorship of Link.
