# Protocol PDF renderer

`original.py` is the unmodified `protokoll_pdf.py` supplied by the project owner
(from `protokoll-tools`). Its CSS, header, signature blocks and heading IDs are
reused by `render.py`. The original command-line entry point is **not** exposed
to web requests.

`render.py` reads one JSON request on stdin and writes PDF bytes to stdout. Its
metadata comes exclusively from the Markdown frontmatter. The selected logo is
an explicit override, just like the original `--logo` argument. All IBM Plex
fonts are bundled unmodified; their OFL license is in `fonts/LICENSE.txt`.

Differences from the original desktop script:

- No arbitrary filesystem paths, network requests, or HTML/CSS resource loads.
  Only supplied, verified raster images and the bundled fonts are fetchable.
- Raw body HTML is restricted to document formatting; scripts, CSS, forms,
  attachments and active elements are stripped. The generated signature date
  fields remain interactive, as in the original.
- The Node adapter enforces a 60-second wall timeout, a 25 MB output limit and
  two concurrent renderers per Node process. Linux workers additionally have
  45-second CPU and 1 GB address-space limits. The child does not receive
  Nextcloud credentials, database URLs, authentication or encryption secrets.
- Local image references must be files directly in the session folder. Unknown
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
