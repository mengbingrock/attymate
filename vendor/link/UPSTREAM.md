# Link upstream provenance

This directory vendors the minimal Link indexing and retrieval runtime used by
AttyMate's Matter Dashboard.

- Upstream project: https://github.com/gowtham0992/link
- License: MIT
- Copyright: Copyright (c) 2026 Gowtham Sarveswaran
- Upstream base revision: `f0b1a0194e2ae7c7936b9246e8a191175392fc09`
- Direct-project integration patch SHA-256: `363f73d8871c9a37c05c3c13af4d84e8ea2ab42180b40c3c1e6c5d1bf82488e5`
- Snapshot date: 2026-08-03

The vendored snapshot includes the local direct-project indexing changes used by the
AttyMate integration. Those changes allow Link to index a matter workspace directly,
without requiring users to move every source into a separate `raw/` directory.

To avoid shipping unused code, the snapshot is trimmed to AttyMate's three-command
contract: `init`, `ingest-status`, and `query`. `link.py` is an AttyMate-specific thin
wrapper around the retained upstream modules. The retained `link_core` files are the
transitive Python import closure of initialization, source coverage analysis, index
construction, backlink construction, and query packet retrieval. Link's web server,
MCP, backup, sharing, Obsidian import, agent hooks, and generic CLI renderers are not
included.

The complete upstream license is preserved in `LICENSE`. AttyMate invokes this source
through Python and does not claim authorship of the retained Link implementation.
