#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Leviora Studio
"""Isolated server adapter for the supplied renderer; no network or arbitrary file fetches."""

import base64
import html
import json
import logging
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

import markdown
import yaml
from weasyprint import HTML
from weasyprint.text.fonts import FontConfiguration

import original

logging.getLogger("weasyprint").setLevel(logging.ERROR)


class SafeBody(HTMLParser):
    tags = set("p br hr h1 h2 h3 h4 h5 h6 ul ol li dl dt dd blockquote pre code em strong b i u s del sub sup table thead tbody tfoot tr th td a img div span abbr".split())
    blocked = set("script style svg math iframe object embed form input textarea button link meta base".split())

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = []

    def handle_starttag(self, tag, attrs):
        if self.skip or tag in self.blocked:
            if tag not in {"input", "embed", "link", "meta", "base"}:
                self.skip.append(tag)
            return
        if tag not in self.tags:
            return
        safe = []
        for key, value in attrs:
            value = value or ""
            if key in {"id", "class", "title", "alt"}:
                safe.append((key, value))
            elif tag == "a" and key == "href" and re.match(r"^(https?://|#|mailto:)", value, re.I):
                safe.append((key, value))
            elif tag == "img" and key == "src":
                safe.append((key, value))
            elif tag == "img" and key == "width" and value.isdigit() and 48 <= int(value) <= 1600:
                safe.append(("style", f"width: {int(value)}px"))
            elif key in {"colspan", "rowspan", "start"} and value.isdigit() and 0 < int(value) <= 100:
                safe.append((key, value))
        attributes = "".join(f' {key}="{html.escape(value, quote=True)}"' for key, value in safe)
        self.parts.append(f"<{tag}{attributes}>")

    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip[-1]:
                self.skip.pop()
            return
        if tag in self.tags and tag not in {"br", "hr", "img"}:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(html.escape(data))


class DocumentTitle(HTMLParser):
    """Read the first rendered H1, including inline formatting but not its tags."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = False
        self.finished = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "h1" and not self.finished:
            self.active = True
        if self.active and tag == "br":
            self.parts.append(" ")
        if self.active and tag == "img":
            self.parts.append(dict(attrs).get("alt") or "")

    def handle_endtag(self, tag):
        if tag == "h1" and self.active:
            self.active = False
            self.finished = True

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)


def frontmatter(raw):
    match = re.match(r"^\ufeff?[ \t]*(?:\r?\n[ \t]*)*---[ \t]*\r?\n(.*?)^---[ \t]*(?:\r?\n|$)", raw, re.S | re.M)
    if not match:
        return {}, raw
    header = match.group(1)
    if len(header) > 32000 or any(isinstance(token, yaml.tokens.AliasToken) for token in yaml.scan(header)):
        raise ValueError("Invalid YAML")
    meta = yaml.load(header, Loader=yaml.BaseLoader) or {}
    if not isinstance(meta, dict):
        raise ValueError("Invalid YAML mapping")
    return meta, raw[match.end():].lstrip("\r\n")


def build_signatures(meta):
    """Keep the original signature layout, without date labels or form fields."""
    if str(meta.get("unterschriften", "")).strip().lower() in ("false", "nein", "no", "0", "off"):
        return ""
    columns = []
    for role, key in [("Sitzungsleitung", "sitzungsleitung"), ("Protokollführung", "protokollfuehrer")]:
        name = original.field_value(meta, key)
        name_html = f'<div class="name">{html.escape(name)}</div>' if name else ""
        columns.append(
            '<div class="sig"><div class="space"></div><div class="line"></div>'
            '<div class="cap">Unterschrift</div>'
            f'<div class="role">{role}</div>{name_html}</div>'
        )
    return '<div class="signatures">' + "".join(columns) + '</div>'


def render(request):
    meta, body = frontmatter(request["markdown"])
    author = original.field_value(meta, "protokollfuehrer")
    fonts = Path(__file__).resolve().parent / "fonts"
    resources = {}
    font_css = []
    for family in ["Sans", "Serif", "Mono"]:
        for variant, weight, style in [("Regular", 400, "normal"), ("Italic", 400, "italic"), ("SemiBold", 600, "normal"), ("SemiBoldItalic", 600, "italic"), ("Bold", 700, "normal"), ("BoldItalic", 700, "italic")]:
            path = fonts / f"IBMPlex{family}-{variant}.ttf"
            uri = path.as_uri()
            resources[uri] = {"string": path.read_bytes(), "mime_type": "font/ttf"}
            font_css.append(f'@font-face {{font-family: "IBM Plex {family}"; font-weight: {weight}; font-style: {style}; src: url("{uri}");}}')
    logo = request.get("logo")
    logo_uri = "https://gremio.invalid/__selected_logo__" if logo else None
    if logo:
        resources[logo_uri] = {"string": base64.b64decode(logo, validate=True), "mime_type": "image/png"}
    for name, asset in request.get("images", {}).items():
        resources["https://gremio.invalid/" + quote(name)] = {"string": base64.b64decode(asset["data"], validate=True), "mime_type": asset["mime"]}
    denied = []

    def fetch(url, *args, **kwargs):
        if url not in resources:
            denied.append(True)
            raise ValueError("Resource not permitted")
        return dict(resources[url])

    body_html = markdown.markdown(body, extensions=["extra", "sane_lists", "nl2br", "tables"])
    body_html = re.sub(
        r"<!--\s*gremio:agenda:start\s*-->(.*?)<!--\s*gremio:agenda:end\s*-->",
        r'<div class="gremio-agenda">\1</div>',
        body_html,
        flags=re.S,
    )
    sanitizer = SafeBody()
    sanitizer.feed(body_html)
    body_html = original.add_heading_ids("".join(sanitizer.parts))
    heading = DocumentTitle()
    heading.feed(body_html)
    title = " ".join("".join(heading.parts).split()) or request["sourceName"].rsplit(".", 1)[0]
    document = f'''<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>{html.escape(title)}</title><meta name="author" content="{html.escape(author)}">
<style>{''.join(font_css)}{original.CSS} main img {{max-width: 100%; height: auto;}} .gremio-agenda > ul {{padding-left: 0;}} .gremio-agenda ul {{list-style: none;}} .gremio-agenda li::marker {{content: "";}} ol {{list-style: none; counter-reset: item;}} ol > li {{counter-increment: item;}} ol > li::before {{content: counters(item, ".") ". "; color: #6a6a6a;}}</style></head><body>
{original.build_header_html(meta, logo_uri)}<main>{body_html}{build_signatures(meta)}</main></body></html>'''
    pdf = HTML(string=document, base_url="https://gremio.invalid/", url_fetcher=fetch).write_pdf(font_config=FontConfiguration())
    if denied:
        raise ValueError("An image or resource is not a permitted session file")
    if len(pdf) > 25 * 1024 * 1024:
        raise ValueError("PDF exceeds size limit")
    return pdf


if __name__ == "__main__":
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
        if sys.platform.startswith("linux"):
            resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
        request = json.loads(sys.stdin.buffer.read(40 * 1024 * 1024 + 1))
        sys.stdout.buffer.write(render(request))
    except Exception:
        print("PDF rendering failed; check YAML and local image references.", file=sys.stderr)
        sys.exit(1)
