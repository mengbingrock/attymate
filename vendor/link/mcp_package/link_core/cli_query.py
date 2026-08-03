"""Text rendering helpers for Link query and graph CLI commands."""
from __future__ import annotations

import json
from collections.abc import Mapping, Sequence

from .mcp_verify import display_command


def render_query_text(
    payload: Mapping[str, object],
    *,
    query_text: str,
    command_target: object = "",
) -> tuple[int, str]:
    if not payload.get("found"):
        lines = [f"No Link context found for: {query_text}"]
        if payload.get("error"):
            lines.append(f"Error: {payload['error']}")
            return 1, "\n".join(lines)
        target = str(command_target or "").strip()
        target_parts = [target] if target else []
        lines.extend([
            "",
            "Next:",
            "- Add source material under the target and ask your agent to ingest the new files",
            f"- Run: {display_command(['link', 'ingest-status', *target_parts])}",
            f"- Then rerun: {display_command(['link', 'query', query_text, *target_parts])}",
        ])
        return 0, "\n".join(lines)

    lines = [f"Link context packet: {payload['query']}"]
    if payload.get("project"):
        lines.append(f"Project: {payload['project']}")
    strategy = payload["strategy"]
    if not isinstance(strategy, Mapping):
        raise ValueError("Invalid query payload strategy")
    lines.extend([
        f"Budget: {payload['budget']} · Mode: {strategy['mode']}",
        "",
    ])

    memory = payload["memory"]
    if not isinstance(memory, Mapping):
        raise ValueError("Invalid query payload memory section")
    lines.append(f"Memory ({memory['count']})")
    memory_items = memory.get("items", [])
    if isinstance(memory_items, Sequence) and not isinstance(memory_items, (str, bytes)):
        for item in memory_items:
            if not isinstance(item, Mapping):
                continue
            lines.append(f"- {item['title']} ({item.get('memory_type', 'memory')} · {item.get('scope', '')})")
            lines.append(f"  {item.get('summary', '')}")
            recall_info = item.get("recall", {})
            if isinstance(recall_info, Mapping) and recall_info.get("state"):
                lines.append(f"  Recall: {recall_info['state']} · {item['why_selected']}")
    if not memory_items:
        lines.append("- none")

    wiki = payload["wiki"]
    if not isinstance(wiki, Mapping):
        raise ValueError("Invalid query payload wiki section")
    pages = wiki.get("pages", [])
    lines.extend([
        "",
        f"Wiki ({len(pages) if isinstance(pages, Sequence) else 0} pages · primary: {wiki['primary'] or 'none'})",
    ])
    if isinstance(pages, Sequence) and not isinstance(pages, (str, bytes)):
        for item in pages:
            if not isinstance(item, Mapping):
                continue
            lines.append(f"- [{item['relationship']}] {item['title']} ({item.get('type', '')})")
            content = " ".join(str(item.get("content", "")).split())
            if content:
                lines.append(f"  {content[:240]}{'...' if len(content) > 240 else ''}")
            lines.append(f"  Why: {item['why_selected']}")
    if not pages:
        lines.append("- none")

    lines.extend(["", "Agent guidance"])
    for item in payload.get("agent_guidance", []):
        lines.append(f"- {item}")
    return 0, "\n".join(lines)


def render_graph_summary_text(payload: Mapping[str, object], *, topic: str = "") -> tuple[int, str]:
    title = "Link graph summary"
    if topic:
        title += f": {topic}"
    lines = [
        title,
        f"Mode: {payload['mode']} · Search backend: {payload['search_backend']}",
        (
            "Scale: "
            f"{payload['node_count']} nodes · {payload['edge_count']} edges · "
            f"returned {payload['returned_nodes']} nodes/{payload['returned_edges']} edges"
        ),
    ]
    if payload.get("truncated"):
        lines.append("Scope: bounded for agent context; use follow-up actions only if needed.")
    lines.extend(["", "Nodes"])
    nodes = payload.get("nodes", [])
    if isinstance(nodes, Sequence) and not isinstance(nodes, (str, bytes)):
        for node in nodes:
            if not isinstance(node, Mapping):
                continue
            lines.append(f"- {node['title']} ({node['id']} · degree {node['degree']})")
            if node.get("summary"):
                lines.append(f"  {node['summary']}")
            lines.append(f"  Why: {node['why_selected']}")
    if not nodes:
        lines.append("- none")
    lines.extend(["", "Follow-up"])
    follow_up = payload.get("follow_up", [])
    if isinstance(follow_up, Sequence) and not isinstance(follow_up, (str, bytes)):
        for action in follow_up:
            if not isinstance(action, Mapping):
                continue
            tool = action.get("tool", "")
            args = action.get("arguments", {})
            when = action.get("when", "")
            suffix = f" — {when}" if when else ""
            lines.append(f"- {tool} {json.dumps(args, ensure_ascii=False) if args else ''}{suffix}".rstrip())
    return 0, "\n".join(lines)
