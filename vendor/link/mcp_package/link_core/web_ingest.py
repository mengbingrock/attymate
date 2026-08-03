"""HTML renderer for Link's guided ingest web view."""
from __future__ import annotations

import html
import urllib.parse
from collections.abc import Callable, Mapping

from .mcp_verify import display_command
from .web_layout import render_stat_grid


PageHref = Callable[[str], str]
PageLayout = Callable[[str, str], str]


def render_ingest_page(
    status: Mapping[str, object],
    *,
    page_href: PageHref,
    layout: PageLayout,
) -> str:
    guidance = _mapping(status.get("guidance"))
    agent_prompt = str(guidance.get("agent_prompt") or "")
    commands = _list(status_value=guidance.get("commands"))
    notes = _list(status_value=guidance.get("notes"))
    plan = _mapping(status.get("plan"))
    pending = _dict_list(status.get("pending_raw"))
    represented = _dict_list(status.get("represented_raw"))
    safety = _mapping(status.get("safety"))
    completion = _mapping(status.get("completion"))
    plan_batch = _dict_list(plan.get("batch"))
    plan_first = plan_batch[0] if plan_batch else {}
    first_raw = str(plan_first.get("raw") or "")
    if not first_raw:
        first_raw = str(pending[0].get("raw") or "<file>") if pending else "<file>"
    ingest_prompt = agent_prompt or f"ingest {first_raw} into Link"
    memory_prompt = str(plan.get("memory_prompt") or f"propose memories from {first_raw}")
    propose_href = "/propose?source=" + urllib.parse.quote(first_raw) if pending else "/propose"
    state = str(guidance.get("state") or plan.get("state") or "unknown")
    command_target = str(status.get("target") or "").strip()

    stats = render_stat_grid([
        (int(status.get("raw_count") or 0), "target files"),
        (int(status.get("represented_count") or 0), "represented"),
        (int(status.get("pending_count") or 0), "pending"),
        (int(status.get("stale_count") or 0), "stale"),
        (status.get("backlinks_status") or "unknown", "graph"),
        (safety.get("status") or "unknown", "safety"),
    ])
    safety_html = _render_safety(safety)
    progress_html = _render_progress(status, state)
    actions = _render_actions(agent_prompt, commands)
    next_html, ingest_prompt, optional_memory_html = _render_next_step(
        agent_prompt=agent_prompt,
        commands=commands,
        command_target=command_target,
        state=state,
        first_raw=first_raw,
        propose_href=propose_href,
        memory_prompt=memory_prompt,
    )
    guide_html = _render_guide(
        first_raw,
        ingest_prompt,
        optional_memory_html,
        validate_command=_link_command(command_target, "validate"),
    )
    pending_html = _render_pending(pending, represented)
    notes_html = _render_notes(notes)
    source_warning_html = _render_source_warnings(_dict_list(status.get("source_read_warnings")))
    plan_html = _render_plan(plan)
    completion_html = _render_completion(completion, page_href=page_href)
    body = (
        '<div class="breadcrumb"><a href="/">Link</a> / ingest</div>'
        '<h1>Ingest</h1>'
        f'<p class="summary">{html.escape(str(guidance.get("summary") or "Check target source ingest state."))}</p>'
        f'{_render_raw_source_form()}'
        f'{stats}'
        f'{progress_html}'
        f'{safety_html}'
        f'{source_warning_html}'
        f'{next_html}'
        f'{guide_html}'
        f'{actions}'
        f'{plan_html}'
        f'{completion_html}'
        f'{pending_html}'
        f'{notes_html}'
    )
    return layout("Ingest", body)


def copy_button(text: object, label: str = "Copy") -> str:
    value = str(text or "")
    if not value:
        return ""
    return (
        '<button type="button" class="copy-button" '
        f'data-copy-text="{html.escape(value, quote=True)}">{html.escape(label)}</button>'
    )


def _render_safety(safety: Mapping[str, object]) -> str:
    if not safety:
        return ""
    labels = _list(status_value=safety.get("labels"))
    labels_text = ", ".join(html.escape(str(label)) for label in labels)
    labels_html = f"<p>Warnings: {labels_text}</p>" if labels_text else ""
    return (
        f'<div class="memory-next"><strong>Source safety: {html.escape(str(safety.get("status") or "unknown"))}</strong>'
        f'<p>{html.escape(str(safety.get("summary") or ""))}</p>{labels_html}</div>'
    )


def _render_progress(status: Mapping[str, object], state: str) -> str:
    raw_count = int(status.get("raw_count") or 0)
    represented_count = int(status.get("represented_count") or 0)
    pending_count = int(status.get("pending_count") or 0)
    stale_count = int(status.get("stale_count") or 0)
    backlinks_status = str(status.get("backlinks_status") or "unknown")
    safety = _mapping(status.get("safety"))
    safety_state = str(safety.get("status") or "unknown")

    source_state = "done" if raw_count else "next"
    ingest_state = "done" if represented_count and not pending_count and not stale_count else ("next" if raw_count else "wait")
    validate_state = "done" if backlinks_status == "current" and state == "ready" else ("blocked" if backlinks_status != "current" else "wait")
    memory_state = "next" if represented_count else "wait"
    if safety_state == "blocked":
        source_state = "blocked"
        ingest_state = "blocked"
        validate_state = "wait"
        memory_state = "wait"
    elif stale_count:
        ingest_state = "next"
        validate_state = "wait"

    phases = [
        ("Source", source_state, f"{raw_count} target file{'s' if raw_count != 1 else ''}"),
        ("Ingest", ingest_state, f"{represented_count} represented · {pending_count} pending"),
        ("Validate", validate_state, f"graph {backlinks_status}"),
        ("Memory", memory_state, "proposal review optional"),
    ]
    rows = "".join(
        '<article class="ingest-progress-step" data-state="'
        f'{html.escape(phase_state, quote=True)}">'
        f'<strong>{html.escape(label)}</strong>'
        f'<span>{html.escape(phase_state)}</span>'
        f'<small>{html.escape(detail)}</small>'
        "</article>"
        for label, phase_state, detail in phases
    )
    return f'<section class="ingest-progress" aria-label="Ingest progress">{rows}</section>'


def _render_actions(agent_prompt: str, commands: list[object]) -> str:
    action_rows = ""
    if agent_prompt:
        action_rows += (
            '<div class="memory-action-row"><span class="memory-action-head"><strong>Ask your agent</strong></span>'
            f'{copy_button(agent_prompt, "Copy prompt")}<code>{html.escape(agent_prompt)}</code></div>'
        )
    for command in commands:
        action_rows += (
            '<div class="memory-action-row"><span class="memory-action-head"><strong>Run</strong></span>'
            f'{copy_button(command, "Copy command")}<code>{html.escape(str(command))}</code></div>'
        )
    return f'<div class="memory-actions">{action_rows}</div>' if action_rows else ""


def _render_next_step(
    *,
    agent_prompt: str,
    commands: list[object],
    command_target: str,
    state: str,
    first_raw: str,
    propose_href: str,
    memory_prompt: str,
) -> tuple[str, str, str]:
    if agent_prompt:
        next_detail = "Copy this into your agent chat. The agent should ingest the target file, rebuild indexes, and validate before reporting done."
        next_code = agent_prompt
        next_extra = (
            '<p>If the source contains preferences, decisions, or project facts, '
            f'<a href="{html.escape(propose_href, quote=True)}">open memory proposals first</a>.</p>'
        )
    elif state == "blocked_secrets":
        next_detail = "Redact secret-looking values in the flagged target file before asking any agent to ingest it."
        next_code = f"edit {first_raw}"
        next_extra = ""
    elif state == "blocked_raw_access":
        next_detail = "Fix target file access before asking any agent to ingest it. Link could not inspect the source for safety."
        next_code = f"inspect {first_raw}"
        next_extra = ""
    elif state == "blocked_source_access":
        next_detail = "Fix source page access before relying on ingest state. Link could not inspect represented source pages."
        next_code = _first_command(commands, _link_command(command_target, "ingest-status"))
        next_extra = ""
    elif state == "stale_graph":
        next_detail = "Repair the graph index before relying on search, context, or the graph view. Run the remaining checks below after this step."
        next_code = _first_command(commands, _link_command(command_target, "rebuild-backlinks"))
        next_extra = ""
    elif state == "empty":
        next_detail = "Add a note, article, transcript, or project file under the target, then refresh this page."
        next_code = _link_command(command_target, "ingest-status")
        next_extra = ""
    elif state == "ready":
        next_detail = "No ingest is pending. Ask Link for context, or add another source when there is new material."
        next_code = _link_command(command_target, "brief", "current task")
        next_extra = ""
    else:
        next_detail = "Initialize or repair the Link folder before ingesting sources."
        next_code = _first_command(commands, _link_command(command_target, "init"))
        next_extra = ""

    ingest_prompt = agent_prompt or f"ingest {first_raw} into Link"
    if state == "blocked_secrets":
        ingest_prompt = f"redact secret-looking values in {first_raw} before ingest"
        optional_memory_html = '<code>redact before memory proposals</code>'
    elif state == "blocked_raw_access":
        ingest_prompt = f"fix target source access for {first_raw} before ingest"
        optional_memory_html = '<code>fix access before memory proposals</code>'
    elif state == "blocked_source_access":
        ingest_prompt = "fix source page access before ingest"
        optional_memory_html = '<code>fix source access first</code>'
    else:
        optional_memory_html = (
            f'<a href="{html.escape(propose_href, quote=True)}"><code>{html.escape(memory_prompt)}</code></a>'
        )
    next_html = (
        '<div class="memory-next"><strong>Next step</strong>'
        f'<p>{html.escape(next_detail)}</p>'
        f'<code>{html.escape(next_code)}</code>'
        f'{copy_button(next_code, "Copy next step")}'
        f'{next_extra}</div>'
    )
    return next_html, ingest_prompt, optional_memory_html


def _render_guide(first_raw: str, ingest_prompt: str, optional_memory_html: str, *, validate_command: str) -> str:
    return (
        '<section class="ingest-path" aria-label="Ingest path">'
        '<article class="ingest-step"><span class="step-num">1</span>'
        '<h3>Add source</h3><p>Put notes, articles, transcripts, or project files anywhere under the target.</p>'
        f'<code>{html.escape(first_raw)}</code></article>'
        '<article class="ingest-step"><span class="step-num">2</span>'
        '<h3>Ask agent</h3><p>Have your agent convert the source into source-backed wiki pages.</p>'
        f'<code>{html.escape(ingest_prompt)}</code></article>'
        '<article class="ingest-step"><span class="step-num">3</span>'
        '<h3>Validate</h3><p>Check page shape, links, and graph freshness before relying on the result.</p>'
        f'<code>{html.escape(validate_command)}</code></article>'
        '<article class="ingest-step"><span class="step-num">4</span>'
        '<h3>Optional memory</h3><p>Only save preferences, decisions, or project facts after approval.</p>'
        f'{optional_memory_html}</article>'
        '</section>'
    )


def _first_command(commands: list[object], fallback: str) -> str:
    for command in commands:
        text = str(command or "").strip()
        if text:
            return text
    return fallback


def _link_command(command_target: str, *parts: str) -> str:
    command = ["link", *parts]
    if command_target:
        command.append(command_target)
    return display_command(command)


def _render_pending(pending: list[dict[str, object]], represented: list[dict[str, object]]) -> str:
    if not pending:
        return "" if represented else '<p>No target source files found yet.</p>'
    rows = ""
    for item in pending[:50]:
        raw_path = str(item.get("raw") or "")
        propose_href = "/propose?source=" + urllib.parse.quote(raw_path)
        ingest_prompt = f"ingest {raw_path} into Link" if raw_path else "ingest <file> into Link"
        actions = ""
        secret_warnings = _list(status_value=item.get("secret_warnings"))
        if secret_warnings:
            meta = (
                f'{int(item.get("size_bytes") or 0)} bytes · secret warning: '
                f'{", ".join(html.escape(str(label)) for label in secret_warnings)} · redact before ingest'
            )
            actions = copy_button(f"redact secret-looking values in {raw_path} before ingest", "Copy redaction prompt")
        elif item.get("scan_error"):
            meta = (
                f'{int(item.get("size_bytes") or 0)} bytes · '
                f'could not inspect: {html.escape(str(item.get("scan_error") or ""))} · fix access before ingest'
            )
            actions = copy_button(f"fix target source access for {raw_path} before ingest", "Copy access prompt")
        elif item.get("stale"):
            target_pages = _list(status_value=item.get("source_page_paths"))
            target_label = ", ".join(html.escape(str(page)) for page in target_pages if page)
            target_text = f" · refresh {target_label}" if target_label else " · refresh existing source page"
            meta = (
                f'{int(item.get("size_bytes") or 0)} bytes · '
                f'{html.escape(str(item.get("stale_reason") or "target file changed after wiki source page"))}'
                f'{target_text}'
            )
            actions = copy_button(ingest_prompt, "Copy ingest prompt")
        else:
            meta = (
                f'{int(item.get("size_bytes") or 0)} bytes · '
                f'<a href="{html.escape(propose_href, quote=True)}">propose memories</a>'
            )
            actions = (
                f'<a href="{html.escape(propose_href, quote=True)}">memory proposals</a>'
                f'{copy_button(ingest_prompt, "Copy ingest prompt")}'
            )
        rows += (
            '<li class="ingest-pending-item">'
            f'<code>{html.escape(raw_path)}</code><span class="type">{meta}</span>'
            f'<span class="ingest-pending-actions">{actions}</span></li>'
        )
    if len(pending) > 50:
        rows += f'<li>... {len(pending) - 50} more</li>'
    return '<div class="section-heading"><h2>Pending Target Files</h2><a href="/propose">propose memories</a></div><ul class="page-list">' + rows + "</ul>"


def _render_notes(notes: list[object]) -> str:
    return "<ul>" + "".join(f"<li>{html.escape(str(note))}</li>" for note in notes) + "</ul>" if notes else ""


def _render_source_warnings(source_warnings: list[dict[str, object]]) -> str:
    if not source_warnings:
        return ""
    rows = "".join(
        f'<li><code>{html.escape(str(item.get("page") or ""))}</code>'
        f'<span class="type">could not inspect: {html.escape(str(item.get("error") or ""))}</span></li>'
        for item in source_warnings[:50]
    )
    return f'<h2>Source Page Warnings</h2><ul class="page-list">{rows}</ul>'


def _render_plan(plan: Mapping[str, object]) -> str:
    if not plan:
        return ""
    steps = _list(status_value=plan.get("steps"))
    batch = _dict_list(plan.get("batch"))
    post_checks = _list(status_value=plan.get("post_checks"))
    step_html = "".join(f"<li>{html.escape(str(step))}</li>" for step in steps[:6])
    batch_html = ""
    if batch:
        rows = "".join(
            f'<li><code>{html.escape(str(item.get("raw") or ""))}</code>'
            f'<span class="type">{html.escape(str(item.get("target_source_page") or item.get("suggested_source_page") or ""))}</span></li>'
            for item in batch[:5]
        )
        batch_html = f'<h3>Batch</h3><ul class="page-list">{rows}</ul>'
    checks_html = ""
    if post_checks:
        rows = "".join(
            f'<li><code>{html.escape(str(check))}</code>'
            f'<span class="type">run before reporting done {copy_button(check)}</span></li>'
            for check in post_checks[:6]
        )
        checks_html = f'<h3>Post-ingest checks</h3><ul class="page-list">{rows}</ul>'
    return (
        f'<section><h2>{html.escape(str(plan.get("title") or "Suggested Workflow"))}</h2>'
        f'<p class="summary">{html.escape(str(plan.get("summary") or ""))}</p>'
        f'<ol>{step_html}</ol>{batch_html}{checks_html}</section>'
    )


def _render_completion(completion: Mapping[str, object], *, page_href: PageHref) -> str:
    completion_items = _dict_list(completion.get("items"))
    if not completion_items:
        return ""
    cards = ""
    for item in completion_items:
        raw_path = str(item.get("raw") or "")
        pages = _dict_list(item.get("source_pages"))
        page_links = ""
        for page in pages:
            page_name = str(page.get("name") or "")
            page_title = str(page.get("title") or page_name)
            if not page_name:
                continue
            page_links += (
                f'<a href="{html.escape(page_href(page_name), quote=True)}" '
                f'title="{html.escape(str(page.get("path") or ""), quote=True)}">{html.escape(page_title)}</a>'
            )
        if not page_links:
            page_links = '<span class="type">source page not found</span>'
        warnings = _list(status_value=item.get("secret_warnings"))
        warning_html = ""
        if warnings:
            warning_html = (
                '<p class="proposal-warning">Source warnings: '
                + ", ".join(html.escape(str(label)) for label in warnings)
                + "</p>"
            )
        propose_link = "/propose?source=" + urllib.parse.quote(raw_path) if raw_path else "/propose"
        cards += (
            '<article class="ingest-completion-card">'
            f'<h3>{html.escape(raw_path)}</h3>'
            f'<p>{int(item.get("size_bytes") or 0)} bytes represented by:</p>'
            f'<div class="ingest-completion-pages">{page_links}</div>'
            f'{warning_html}'
            '<div class="ingest-completion-actions">'
            f'<a href="{html.escape(propose_link, quote=True)}">propose memories</a>'
            f'{copy_button(str(item.get("memory_prompt") or ""), "Copy memory prompt")}'
            f'{copy_button(str(item.get("query_prompt") or ""), "Copy query prompt")}'
            '</div>'
            '</article>'
        )
    more_html = ""
    if completion.get("has_more"):
        more_html = f'<p class="summary">Showing {int(completion.get("shown_count") or 0)} of {int(completion.get("represented_count") or 0)} represented sources.</p>'
    next_prompt = str(completion.get("next_prompt") or "")
    next_html_for_completion = ""
    if next_prompt:
        next_html_for_completion = (
            '<div class="memory-next"><strong>After ingest</strong>'
            '<p>Use this to confirm the new context is retrievable before moving on.</p>'
            f'<code>{html.escape(next_prompt)}</code>{copy_button(next_prompt, "Copy prompt")}</div>'
        )
    return (
        f'<section><div class="section-heading"><h2>{html.escape(str(completion.get("title") or "Ingest Completion"))}</h2>'
        '<a href="/all">all pages</a></div>'
        f'<p class="summary">{html.escape(str(completion.get("summary") or ""))}</p>'
        f'<div class="ingest-completion-grid">{cards}</div>{more_html}{next_html_for_completion}</section>'
    )


def _render_raw_source_form() -> str:
    return (
        '<section><div class="section-heading"><h2>Add Source</h2><a href="/propose">memory proposals</a></div>'
        '<p class="summary">Paste a note, article excerpt, transcript, or project context. Link saves it in '
        'the target directory, blocks secret-looking values, and gives you the exact ingest prompt.</p>'
        '<form class="raw-source-form" data-raw-source-form>'
        '<div class="raw-source-controls">'
        '<label>Title<input name="title" autocomplete="off" placeholder="Release notes, meeting transcript, project context"></label>'
        '<label>Filename optional<input name="filename" autocomplete="off" placeholder="release-notes.md"></label>'
        '</div>'
        '<label>Source text<textarea name="text" placeholder="Paste the source text to preserve locally before ingest."></textarea></label>'
        '<div class="raw-source-actions"><button type="submit">Save to target</button>'
        '<span>Nothing becomes durable memory until you approve memory proposals.</span></div>'
        '<div class="raw-source-status" data-raw-source-status aria-live="polite"></div>'
        '</form></section>'
    )


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, Mapping) else {}


def _list(*, status_value: object) -> list[object]:
    return list(status_value) if isinstance(status_value, list) else []


def _dict_list(value: object) -> list[dict[str, object]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []
