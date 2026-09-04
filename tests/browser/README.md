# Document editor browser regression

This optional suite mounts the actual `DocumentEditor` with local save/reload doubles.
It does not access Nextcloud or require login. It checks character-by-character
formatting, source round-trips, inline caret placement, paragraphs, lists, undo/redo,
YAML preservation, table insertion, cell typing, navigation, and saving at desktop
and mobile widths. Screenshots and the compiled fixture remain in the printed
temporary directory.

Live and read-only preview also share a geometry and pixel-equality regression
at 1500, 600, and 390 pixels: headings, blank lines, wrapped paragraphs, lists,
quotes, inline formatting, tables, code fences, and hidden YAML/comments.
The test verifies that preview stays read-only and preserves clickable links.

Image tests upload through local action doubles, verify that concurrent typing
survives, and check relative attachment URLs, corner resizing, aspect ratio,
source width persistence, preview parity, undo/redo, saves, and upload errors.
Clipboard paste events exercise image insertion in live/raw mode, cursor capture,
concurrent typing, busy/error cases, and unchanged normal text-paste behavior.
The fixture uses a temporary loopback HTTP server to serve local image bytes;
no actual Nextcloud upload is performed.

Document search is checked in all three modes: Ctrl/Cmd+F, inline/table matches,
forward/backward wraparound, source/YAML matches, no results, updates after edits,
Escape cleanup, and unchanged document contents.

Header checks cover compact action heights and button order, collapsing everything
above the formatting strip, a permanently reachable toggle on small screens,
keyboard expansion, save/search while collapsed, and read-only preview behavior.

Use a separately available Playwright installation and Chrome (no production
dependency is added):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_PATH=/absolute/path/to/chrome \
node tests/browser/markdown-live.cjs
```

If Playwright and its browser are already installed locally, both variables may
be omitted. The fixture bundle uses the project's existing esbuild (from tsx)
and Tailwind tooling. Browser execution is separate from `npm test`.

`protocol-settings.cjs` mounts the actual area settings and embedded Markdown
editors at desktop/mobile widths. It checks collapsed area-local templates,
literal Markdown round-trips, formatting and undo, conditional board fields,
unchecked defaults, keyboard/pointer sorting, board switching, saved settings
after reload, and insertion/save of the configured finance block in the actual
document editor. Persistence is a local fixture double, not Nextcloud or the DB.
The separate `protocol-area-config-db.test.ts` covers actual PostgreSQL settings,
area isolation, board permissions, relational field values and hidden fields.
The settings browser suite also checks the shared collapsible cards, WebDAV
field order, app-styled selection menus and calendars, modal confirmation/cancel,
retained session-form drafts, and the absence of native selects/date inputs or
browser confirm dialogs. Popovers are checked for viewport bounds on mobile.

`protocol-folders.cjs` additionally mounts the actual session page with local
directory/action doubles and the real upload component. It checks folder-name
and Open links, breadcrumbs, nested automatic uploads, scoped media/Markdown URLs,
and root-only protocol discovery at desktop/mobile widths.
It also tests Markdown creation in both root/subfolders, duplicate-name errors,
cancellation, and navigation to the new document with its folder preserved.
Run it with the same `PLAYWRIGHT_MODULE` and `CHROME_PATH` environment variables. No live Nextcloud
files are read or changed.
