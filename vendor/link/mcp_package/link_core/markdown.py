"""Small safe Markdown renderer used by the local Link web UI."""
from __future__ import annotations

import html
import re
import urllib.parse
from collections.abc import Callable


def default_page_href(name: str) -> str:
    return "/page/" + urllib.parse.quote(name.strip(), safe="")


def inline_markdown(text: str, page_href: Callable[[str], str] = default_page_href) -> str:
    """Render the inline subset Link supports while escaping unsafe HTML."""
    html_spans: list[str] = []

    def _stash(rendered: str) -> str:
        html_spans.append(rendered)
        return f"\x00HTML{len(html_spans) - 1}\x00"

    def _safe_href(href: str) -> str:
        href = html.unescape(href).strip()
        parsed = urllib.parse.urlparse(href)
        if href.startswith("//") or (parsed.scheme and parsed.scheme.lower() not in {"http", "https", "mailto"}):
            return "#"
        return html.escape(href, quote=True)

    def _wikilink(match: re.Match[str]) -> str:
        inner = html.unescape(match.group(1))
        target, label = (inner.split("|", 1) if "|" in inner else (inner, inner))
        href = html.escape(page_href(target), quote=True)
        return _stash(f'<a href="{href}">{html.escape(label.strip())}</a>')

    def _markdown_link(match: re.Match[str]) -> str:
        label = html.unescape(match.group(1))
        href = _safe_href(match.group(2))
        return _stash(f'<a href="{href}">{html.escape(label)}</a>')

    text = html.escape(str(text), quote=False)

    def _save_code(match: re.Match[str]) -> str:
        return _stash(f"<code>{match.group(1)}</code>")

    text = re.sub(r"`([^`]+)`", _save_code, text)
    text = re.sub(r"\[\[([^\]]+)\]\]", _wikilink, text)
    text = re.sub(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)", _markdown_link, text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", text)
    for index, span in enumerate(html_spans):
        text = text.replace(f"\x00HTML{index}\x00", span)
    return text


def markdown_to_html(markdown: str, page_href: Callable[[str], str] = default_page_href) -> str:
    """Render Link's intentionally small wiki Markdown subset to HTML."""
    out: list[str] = []
    in_code = False
    in_table = False
    in_list = False
    list_type: str | None = None
    code_lang = ""
    in_blockquote = False
    blockquote_lines: list[str] = []

    def _flush_blockquote() -> None:
        if blockquote_lines:
            out.append(f"<blockquote>{'<br>'.join(blockquote_lines)}</blockquote>")
            blockquote_lines.clear()

    for line in str(markdown).split("\n"):
        stripped = line.strip()
        if stripped.startswith("```"):
            _flush_blockquote()
            in_blockquote = False
            if in_code:
                out.append("</code></pre>")
                in_code = False
                code_lang = ""
            else:
                code_lang = stripped[3:].strip()
                lang_attr = f' class="language-{html.escape(code_lang)}"' if code_lang else ""
                out.append(f"<pre><code{lang_attr}>")
                in_code = True
            continue
        if in_code:
            out.append(html.escape(line))
            continue
        if in_table and not stripped.startswith("|"):
            out.append("</tbody></table>")
            in_table = False
        if in_list and not re.match(r"^\s*[-*]\s|^\s*\d+\.\s", line) and stripped:
            out.append(f'</{"ul" if list_type == "ul" else "ol"}>')
            in_list = False
        if stripped.startswith(">"):
            if in_list:
                out.append(f'</{"ul" if list_type == "ul" else "ol"}>')
                in_list = False
            if in_table:
                out.append("</tbody></table>")
                in_table = False
            blockquote_lines.append(inline_markdown(stripped[1:].strip(), page_href))
            in_blockquote = True
            continue
        if in_blockquote:
            _flush_blockquote()
            in_blockquote = False
        if stripped in ("---", "***", "___") and not in_table:
            out.append("<hr>")
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)", line)
        if heading:
            level = len(heading.group(1))
            out.append(f"<h{level}>{inline_markdown(heading.group(2), page_href)}</h{level}>")
            continue
        if stripped.startswith("|"):
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            if all(re.match(r"^[-:]+$", cell) for cell in cells):
                continue
            if not in_table:
                out.append(
                    "<table><thead><tr>"
                    + "".join(f"<th>{inline_markdown(cell, page_href)}</th>" for cell in cells)
                    + "</tr></thead><tbody>"
                )
                in_table = True
            else:
                out.append("<tr>" + "".join(f"<td>{inline_markdown(cell, page_href)}</td>" for cell in cells) + "</tr>")
            continue
        unordered = re.match(r"^\s*[-*]\s+(.*)", line)
        if unordered:
            if not in_list or list_type != "ul":
                if in_list:
                    out.append(f'</{"ul" if list_type == "ul" else "ol"}>')
                out.append("<ul>")
                in_list, list_type = True, "ul"
            out.append(f"<li>{inline_markdown(unordered.group(1), page_href)}</li>")
            continue
        ordered = re.match(r"^\s*\d+\.\s+(.*)", line)
        if ordered:
            if not in_list or list_type != "ol":
                if in_list:
                    out.append(f'</{"ul" if list_type == "ul" else "ol"}>')
                out.append("<ol>")
                in_list, list_type = True, "ol"
            out.append(f"<li>{inline_markdown(ordered.group(1), page_href)}</li>")
            continue
        if not stripped:
            out.append("")
            continue
        out.append(f"<p>{inline_markdown(stripped, page_href)}</p>")
    if in_code:
        out.append("</code></pre>")
    if in_table:
        out.append("</tbody></table>")
    if in_list:
        out.append(f'</{"ul" if list_type == "ul" else "ol"}>')
    _flush_blockquote()
    return "\n".join(out)
