# Protocol PDF renderer

`original.py` is the unmodified `protokoll_pdf.py` supplied by the project owner
(from `protokoll-tools`). Its CSS, header and heading IDs are
reused by `render.py`. The original command-line entry point is **not** exposed
to web requests.

`render.py` reads one JSON request on stdin and writes PDF bytes to stdout. Its
metadata comes from the Markdown: the PDF title is the first rendered H1 (falling
back to the source filename without its extension), and its author is the YAML
`protokollfuehrung` value, including its supported aliases, or empty if absent.
Legacy YAML `title`, `author` and `logo` values are ignored. Logos come exclusively
from area settings, using the export selection or the area default. Without area
logos the export has no logo; session files are never used as a logo fallback. All IBM Plex
fonts are bundled unmodified; their OFL license is in `fonts/LICENSE.txt`.

Differences from the original desktop script:

- No arbitrary filesystem paths, network requests, or HTML/CSS resource loads.
  Only supplied, verified raster images and the bundled fonts are fetchable.
- Raw body HTML is restricted to document formatting; scripts, CSS, forms,
  attachments and active elements are stripped. Signature blocks retain the
  original lines, roles and names, but omit date labels and date form fields.
- The Node adapter enforces a 60-second wall timeout, a 25 MB output limit and
  two concurrent renderers per Node process. Linux workers additionally have
  45-second CPU and 1 GB address-space limits. The child does not receive
  Nextcloud credentials, database URLs, authentication or encryption secrets.
- Local image references may use validated subfolders inside the session,
  including `attachments`. The Markdown attribute list `{width=420}` sets a
  bounded pixel width with preserved aspect ratio; arbitrary styles are rejected.
  Unknown
  external resources cause an explicit export failure rather than silent loss.

## Local setup (macOS)

```sh
brew install pango
python3 -m venv .venv-protocol-pdf
.venv-protocol-pdf/bin/pip install -r scripts/protocol-pdf/requirements.txt
PROTOCOL_PDF_PYTHON="$PWD/.venv-protocol-pdf/bin/python" npm run dev
```

`PROTOCOL_PDF_PYTHON` is an administrator-controlled executable path; otherwise
`python3` is used. Docker installs the pinned requirements into
`/opt/protocol-pdf` and includes the scripts and fonts automatically. There is
no external conversion service.

For sandboxed local PDF inspection, give Fontconfig a writable cache directory.
The actual export uses explicit `@font-face` rules, not host font fallbacks.

References: [WeasyPrint security](https://doc.courtbouillon.org/weasyprint/latest/first_steps.html#security),
[IBM Plex license](https://github.com/IBM/plex/blob/master/LICENSE.txt).
