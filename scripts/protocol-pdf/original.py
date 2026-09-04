#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
protokoll_pdf.py — wandelt ein Markdown-Protokoll in ein fertiges PDF um.

Aus dem YAML-Kopf des Dokuments werden gelesen:
    author            -> PDF-Autor  (Standard: Erik Engler)
    sitzungsdatum     -> Kopfzeile links
    beginn            -> Kopfzeile links (Uhrzeit des Sitzungsbeginns)
    ende              -> Kopfzeile links (Uhrzeit des Sitzungsendes)
    sitzungsort       -> Kopfzeile links
    sitzungsleitung   -> Kopfzeile links
    protokollfuehrer  -> Kopfzeile links
    logo              -> Logo-Datei; per --logo überschreibbar, sonst YAML,
                         sonst logo.png im Ordner des Protokolls (relativ)
    title             -> optionale Überschrift / PDF-Titel

Ergebnis: Logo rechts + Infos links als Kopfzeile auf JEDER Seite,
Seitenzahl unten mittig, kein Überlappen mit dem Text.

Das PDF wird neben der Quelldatei abgelegt. Die Quelldatei bleibt erhalten.

Aufruf:
    python3 protokoll_pdf.py  meinprotokoll.md                 -> meinprotokoll.pdf
    python3 protokoll_pdf.py  --logo /pfad/fsr.png  datei.md
    python3 protokoll_pdf.py  datei.md  fertig.pdf
"""

import sys, os, re, base64, mimetypes, html
from pathlib import Path

import markdown
from weasyprint import HTML

try:
    import yaml
except ImportError:
    yaml = None

DEFAULT_AUTHOR = "Erik Engler"
DEFAULT_LOGO   = "logo.png"   # relativ zum Ordner des Protokolls

# Reihenfolge + Beschriftung der Kopfzeilen-Felder
HEADER_FIELDS = [
    ("sitzungsdatum",    "Sitzungsdatum"),
    ("beginn",           "Beginn"),
    ("ende",             "Ende"),
    ("sitzungsort",      "Sitzungsort"),
    ("sitzungsleitung",  "Sitzungsleitung"),
    ("protokollfuehrer", "Protokollführung"),
]

# Erlaubte Schreibweisen je Feld (die erste gefüllte gewinnt).
ALIASES = {
    "protokollfuehrer": ("protokollfuehrung", "protokollfuehrer", "protokollfuehrerin"),
    "sitzungsleitung":  ("sitzungsleitung", "sitzungsleiter", "sitzungsleiterin"),
}


def field_value(meta, key):
    for k in ALIASES.get(key, (key,)):
        v = str(meta.get(k, "")).strip()
        if v:
            return v
    return ""


def parse_front_matter(text: str):
    """Trennt YAML-Kopf vom Markdown-Text. Robust gegen fehlenden Kopf."""
    meta, body = {}, text
    if text.lstrip().startswith("---"):
        text = text.lstrip()
        end = text.find("\n---", 3)
        if end != -1:
            fm = text[3:end].strip()
            body = text[end + 4:].lstrip("\n")
            if yaml:
                try:
                    meta = yaml.safe_load(fm) or {}
                except Exception:
                    meta = {}
            if not meta:  # Fallback ohne PyYAML / bei Parse-Fehler
                for line in fm.splitlines():
                    if ":" in line and not line.strip().startswith("#"):
                        k, v = line.split(":", 1)
                        meta[k.strip()] = v.strip().strip("'\"")
    return meta, body


def _slugify(text, used):
    """GitHub-Slug – identisch zur Logik in toc_einfuegen.py, damit die
    Tagesordnungs-Links auf die richtigen Überschriften-Anker zeigen."""
    s = text.strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    base, n = s, 1
    while s in used:
        s = f"{base}-{n}"
        n += 1
    used.add(s)
    return s


def add_heading_ids(html_str):
    """Gibt jeder Überschrift eine id (Slug), damit interne Links im PDF springen."""
    used = set()

    def repl(m):
        level, attrs, inner = m.group(1), m.group(2), m.group(3)
        if re.search(r"\bid\s*=", attrs):        # schon eine id -> unverändert
            return m.group(0)
        text = re.sub(r"<[^>]+>", "", inner)     # HTML-Tags aus dem Titel entfernen
        text = html.unescape(text).strip()
        return f'<h{level}{attrs} id="{_slugify(text, used)}">{inner}</h{level}>'

    return re.sub(r"<h([1-6])([^>]*)>(.*?)</h\1>", repl, html_str, flags=re.DOTALL)


def logo_data_uri(path: str, base_dir: Path):
    if not path:
        return None
    p = Path(os.path.expanduser(str(path)))
    if not p.is_absolute():           # relativer Pfad -> ab Ordner des Protokolls
        p = (base_dir / p)
    if not p.exists():
        print(f"  ! Logo nicht gefunden: {p}  (Kopfzeile bleibt ohne Logo)")
        return None
    mime = mimetypes.guess_type(str(p))[0] or "image/png"
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def build_header_html(meta: dict, logo_uri):
    rows = []
    for key, label in HEADER_FIELDS:
        val = field_value(meta, key)
        if val:
            rows.append(
                f'<div><span class="lbl">{html.escape(label)}</span>'
                f'<span class="val">{html.escape(val)}</span></div>'
            )
    info = "\n".join(rows)
    logo = f'<div class="logo"><img src="{logo_uri}" alt="Logo"></div>' if logo_uri else ""
    return f'<div id="protokoll-header"><div class="info">{info}</div>{logo}</div>'


def build_signatures(meta: dict):
    """Zwei Unterschriftenfelder am Dokumentende: Sitzungsleitung links,
    Protokollführung rechts. Abschaltbar mit  unterschriften: false  im YAML."""
    off = str(meta.get("unterschriften", "")).strip().lower()
    if off in ("false", "nein", "no", "0", "off"):
        return ""

    def col(role: str, name_key: str, field_name: str):
        name = field_value(meta, name_key)
        name_html = f'<div class="name">{html.escape(name)}</div>' if name else ""
        return (
            '<div class="sig">'
            '<div class="space"></div>'
            '<div class="line"></div>'
            '<div class="cap">Unterschrift</div>'
            f'<div class="role">{role}</div>'
            f'{name_html}'
            f'<div class="datum">Datum: <input type="text" name="{field_name}"></div>'
            '</div>'
        )

    return ('<div class="signatures">'
            + col("Sitzungsleitung", "sitzungsleitung", "datum_sitzungsleitung")
            + col("Protokollführung", "protokollfuehrer", "datum_protokollfuehrung")
            + '</div>')


CSS = """
@page {
  size: A4;
  margin: 42mm 22mm 20mm 22mm;   /* oben groß für die Kopfzeile */
  @bottom-center { content: "Seite " counter(page) " / " counter(pages);
                   font: 8.5pt "IBM Plex Sans", Helvetica, Arial, sans-serif; color: #8a8a8a; }
}
html { font-size: 10.5pt; }
body { font-family: "IBM Plex Sans", Helvetica, Arial, sans-serif; font-weight: 400;
       color: #1c1c1c; line-height: 1.55; margin: 0; }

/* ---- laufende Kopfzeile: Infos links (ausgerichtete Spalten), Logo rechts ---- */
#protokoll-header {
  position: fixed; top: -32mm; left: 0; right: 0; height: 28mm;
  display: flex; justify-content: space-between; align-items: center; gap: 10mm;
  padding-bottom: 3mm; border-bottom: 0.8pt solid #3a3a3a;
  font-size: 8.7pt; line-height: 1.45;
}
#protokoll-header .info { display: table; }
#protokoll-header .info > div { display: table-row; }
#protokoll-header .info .lbl { display: table-cell; color: #6a6a6a; font-weight: 600;
                               padding-right: 7mm; white-space: nowrap; }
#protokoll-header .info .lbl::after { content: ":"; }
#protokoll-header .info .val { display: table-cell; }
#protokoll-header .logo { flex: 0 0 auto; text-align: right; }
#protokoll-header .logo img { max-height: 22mm; max-width: 50mm; object-fit: contain; }

/* ---- Überschriften ---- */
h1, h2, h3, h4, h5, h6 { font-family: "IBM Plex Serif", Georgia, serif; color: #14181f; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 2rem;
     padding-bottom: 0.45rem; border-bottom: 1.5pt solid #14181f; }
h2 { font-size: 1.3rem; margin: 1.7rem 0 0.6rem;
     padding-bottom: 0.2rem; border-bottom: 0.5pt solid #cccccc; }
h3 { font-size: 1.12rem; margin: 1.15rem 0 0.35rem; }
h4, h5, h6 { font-size: 1rem; margin: 0.9rem 0 0.3rem; }

/* ---- Fließtext, Listen ---- */
p  { margin: 0.5rem 0; }
ul, ol { margin: 0.45rem 0; padding-left: 1.6rem; }
li { margin: 0.25rem 0; }
li::marker { color: #6a6a6a; }
blockquote { margin: 0.9rem 0; padding: 0.5rem 1rem; border-left: 3px solid #b8c4d0;
             background: #f6f8fa; color: #333; }

/* Links: externe dezent blau, Inhaltsverzeichnis-Links wie normaler Text */
a { color: #23527c; text-decoration: underline; }
a[href^="#"] { color: inherit; text-decoration: none; }

/* ---- Tabellen ---- */
table { border-collapse: collapse; margin: 0.9rem 0; width: 100%; font-size: 0.97em; }
th, td { border: 1px solid #d3d3d3; padding: 5px 9px; text-align: left; vertical-align: top; }
th { background: #eef1f4; font-weight: 600; }
tr:nth-child(even) td { background: #fafbfc; }

/* ---- Sonstiges ---- */
code { background: #f2f2f2; padding: 1px 5px; border-radius: 3px;
       font-family: "IBM Plex Mono", Menlo, Consolas, monospace; font-size: 0.9em; }
pre { background: #f6f8fa; padding: 10px 12px; border-radius: 5px; overflow-x: auto; }
hr { border: none; border-top: 1px solid #dcdcdc; margin: 1.3rem 0; }

/* ---- Unterschriftenfelder ---- */
.signatures { display: flex; justify-content: space-between; gap: 18mm;
              margin-top: 16mm; page-break-inside: avoid; }
.signatures .sig { flex: 1 1 0; }
.signatures .sig .space { height: 20mm; }          /* Platz zum Signieren */
.signatures .sig .line { border-top: 0.9pt solid #333; }
.signatures .sig .cap { font-size: 8.5pt; color: #6a6a6a; margin-top: 1.5mm; }
.signatures .sig .role { font-family: "IBM Plex Serif", Georgia, serif;
                         font-weight: 600; margin-top: 2.5mm; }
.signatures .sig .name { color: #444; margin-top: 0.3mm; }
.signatures .sig .datum { margin-top: 5mm; font-size: 8.5pt; color: #555; }
.signatures .sig .datum input {
  appearance: auto; width: 32mm; height: 5.5mm; margin-left: 1mm;
  border: none; border-bottom: 0.6pt solid #888;
  font: 9pt "IBM Plex Sans", Helvetica, Arial, sans-serif; color: #1c1c1c;
}

/* ---- Umbruchverhalten ---- */
h1, h2, h3, h4 { page-break-after: avoid; }
table, blockquote, pre, li { page-break-inside: avoid; }
"""


def convert(md_path: Path, pdf_path: Path, logo_override=None):
    raw = md_path.read_text(encoding="utf-8")
    meta, body = parse_front_matter(raw)

    author = str(meta.get("author") or DEFAULT_AUTHOR).strip()
    title  = str(meta.get("title") or md_path.stem).strip()
    logo_src = logo_override or meta.get("logo") or DEFAULT_LOGO
    logo_uri = logo_data_uri(logo_src, md_path.parent)

    body_html = markdown.markdown(
        body, extensions=["extra", "sane_lists", "nl2br", "tables"]
    )
    body_html = add_heading_ids(body_html)
    header_html = build_header_html(meta, logo_uri)
    signatures_html = build_signatures(meta)

    document = f"""<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<title>{html.escape(title)}</title>
<meta name="author" content="{html.escape(author)}">
<style>{CSS}</style>
</head><body>
{header_html}
<main>{body_html}
{signatures_html}</main>
</body></html>"""

    HTML(string=document, base_url=str(md_path.parent)).write_pdf(str(pdf_path))
    print(f"  ✓ {pdf_path.name}   (Autor: {author})")


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(
        description="Wandelt ein Markdown-Protokoll in ein PDF um "
                    "(neben der Quelldatei; die .md bleibt erhalten).")
    ap.add_argument("md", help="Markdown-Datei")
    ap.add_argument("pdf", nargs="?", help="optional: Ziel-PDF (Standard: neben der .md)")
    ap.add_argument("--logo", dest="logo", help="Pfad zur Logo-Datei (überschreibt YAML)")
    args = ap.parse_args(argv[1:])

    md_path = Path(args.md).expanduser()
    if not md_path.exists():
        print(f"Datei nicht gefunden: {md_path}")
        return 1
    pdf_path = Path(args.pdf).expanduser() if args.pdf else md_path.with_suffix(".pdf")

    print(f"Konvertiere {md_path.name} …")
    convert(md_path, pdf_path, logo_override=args.logo)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
