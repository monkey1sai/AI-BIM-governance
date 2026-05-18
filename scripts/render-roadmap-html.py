#!/usr/bin/env python3
"""Regenerate the human-readable HTML view of the SaaS roadmap.

Source of truth is the Markdown file; this only produces a derived view, as
required by AGENTS.md §0.1 / roadmap §1.6 ("每次 OpenSpec sync / archive 後
重新產生同名 HTML 檢視版，內容源自同名 Markdown").

Behaviour:
  - The existing HTML's <head> (template + CSS) is preserved verbatim, so the
    visual layout never drifts.
  - Only <body> (sidebar TOC + main content) is regenerated from the current
    Markdown via python-markdown (toc/tables/fenced_code), keeping TOC anchors
    and heading ids internally consistent.

Usage:
  python scripts/render-roadmap-html.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import markdown

DOCS = Path(__file__).resolve().parent.parent / "docs" / "plans"
MD_PATH = DOCS / "AI-BIM-governance-saas-roadmap-2026-05.md"
HTML_PATH = DOCS / "AI-BIM-governance-saas-roadmap-2026-05.html"

BODY_MARKER = "<body>"


def main() -> int:
    if not MD_PATH.exists():
        print(f"missing markdown source: {MD_PATH}", file=sys.stderr)
        return 1
    if not HTML_PATH.exists():
        print(f"missing html template: {HTML_PATH}", file=sys.stderr)
        return 1

    old_html = HTML_PATH.read_text(encoding="utf-8")
    if BODY_MARKER not in old_html:
        print("existing html has no <body> marker; refusing to guess template", file=sys.stderr)
        return 1
    # Preserve everything up to (and excluding) <body> verbatim — the styled
    # template/CSS must not drift.
    head_prefix = old_html[: old_html.index(BODY_MARKER)]

    md_text = MD_PATH.read_text(encoding="utf-8")
    md = markdown.Markdown(
        extensions=["toc", "tables", "fenced_code", "sane_lists", "attr_list"],
        output_format="html5",
    )
    body_html = md.convert(md_text)
    toc_html = md.toc  # <div class="toc">...</div>, anchors match heading ids

    out = (
        head_prefix
        + "<body>\n"
        + '  <div class="layout">\n'
        + "    <aside>\n"
        + '      <p class="toc-title">目錄</p>\n'
        + "      <nav>\n"
        + toc_html
        + "</nav>\n"
        + "    </aside>\n"
        + "    <main>\n"
        + body_html
        + "\n    </main>\n"
        + "  </div>\n"
        + "</body>\n"
        + "</html>\n"
    )
    HTML_PATH.write_text(out, encoding="utf-8", newline="\n")
    print(f"regenerated {HTML_PATH.name} from {MD_PATH.name} ({len(out):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
