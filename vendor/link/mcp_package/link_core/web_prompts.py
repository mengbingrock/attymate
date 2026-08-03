"""HTML helpers for Link starter prompt pages."""
from __future__ import annotations

import html
from collections.abc import Callable, Mapping

from .web_ingest import copy_button


PageLayout = Callable[[str, str], str]


def render_prompts_page(payload: Mapping[str, object], *, layout: PageLayout) -> str:
    prompt_rows = ""
    for item in payload.get("prompts", []):
        if not isinstance(item, dict):
            continue
        prompt_rows += (
            '<article class="proposal-card">'
            f'<h3>{html.escape(str(item.get("label") or "Prompt"))}</h3>'
            f'{copy_button(item.get("prompt") or "", "Copy prompt")}'
            f'<code class="proposal-command">{html.escape(str(item.get("prompt") or ""))}</code>'
            f'<p class="summary">{html.escape(str(item.get("when") or ""))}</p>'
            "</article>"
        )
    command_rows = "".join(
        f"<li>{copy_button(command, 'Copy command')}<code>{html.escape(str(command))}</code></li>"
        for command in payload.get("commands", [])
    )
    project_line = (
        f'<p class="summary">Project examples are scoped to <code>{html.escape(str(payload["project"]))}</code>.</p>'
        if payload.get("project")
        else '<p class="summary">These prompts work for a personal Link wiki. Add <code>?project=slug</code> for project wording.</p>'
    )
    shortcut = str(payload.get("shortcut") or "")
    shortcut_block = (
        '<section class="callout">'
        "<h2>One Command</h2>"
        "<p>Use this any time you forget what to ask next.</p>"
        f'{copy_button(shortcut, "Copy command")}'
        f'<code class="proposal-command">{html.escape(shortcut)}</code>'
        "</section>"
        if shortcut
        else ""
    )
    body = (
        '<div class="breadcrumb"><a href="/">Link</a> / prompts</div>'
        "<h1>Starter Prompts</h1>"
        f"{project_line}"
        f"{shortcut_block}"
        f'<section><h2>Ask Your Agent</h2><div class="proposal-results">{prompt_rows}</div></section>'
        f'<section><h2>Local Checks</h2><ul class="page-list">{command_rows}</ul></section>'
    )
    return layout("Starter Prompts", body)
