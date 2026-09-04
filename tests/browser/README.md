# Document editor browser regression

`pdf-legacy.cjs` mounts the actual PDF editor and reads a local sample supplied via
`PDF_LEGACY_SAMPLE`. It checks every text overlay, repeated fields and radio states
at desktop/mobile widths and verifies the source SHA-256 remains unchanged.
The sample is served on loopback only, never uploaded, saved or copied into the
repository. Use `PLAYWRIGHT_MODULE` and `CHROME_PATH` as below. Synthetic native,
detached/merged, rotated, missing-radio-flag and ambiguous form structures plus
explicit-save appearance consistency are covered by `pdf-widget-compat.test.ts`.

`workflows.cjs` checks actual trigger selectors, immediate multi-upload queues,
per-file errors/retry, explicit purposes, disabled submit while uploading,
retained results after live gate revocation, required per-position accounts,
budget totals, retained drafts and confirmed removal at 1400 and 390 pixels.
It uses local server-action doubles only; no real uploads or archives.
Run with the same `PLAYWRIGHT_MODULE` and `CHROME_PATH` options below.

`workflows-production.cjs` additionally starts the built Next server on a random
loopback port. It requires the normal local test environment and `DATABASE_URL`
pointing to a database named `gremio_workflows_test_*`. It creates/cleans its own
records, uses a sealed test-user session (no OIDC calls), and exercises real Server
Actions, file storage, live refresh and the public API. Files/screenshots remain
in a printed temporary directory; no real Nextcloud archive is configured.
The HTTP checks cover public catalogs, total amounts, simultaneous receipt and
resubmission gates, archive precedence, attachment lists, token-type isolation,
foreign-origin rejection and no-store/no-referrer headers. Bearer route handlers
are covered separately by `tests/api-parity.test.ts`; schema/source drift and the
complete versioned route inventory by `tests/api-contract.test.ts` (`npm test`).

`workflow-migration.test.ts` requires an **empty isolated** PostgreSQL database
whose name starts with `gremio_workflows_upgrade_test_`, passed explicitly through
`TEST_MIGRATION_DATABASE_URL`. It applies pre-0062 migrations, creates synthetic
legacy rows, applies 0062 and verifies unchanged values/configuration. It refuses
nonempty databases. Other DB tests use `DATABASE_URL`; always use an isolated test DB.


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
