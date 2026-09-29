# Browser regression tests

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
foreign-origin rejection and no-store/no-referrer headers. It also checks 404s
for removed minutes routes and availability of the remaining module pages. Bearer route handlers
are covered separately by `tests/api-parity.test.ts`; schema/source drift and the
complete versioned route inventory by `tests/api-contract.test.ts` (`npm test`).

`workflow-migration.test.ts` requires an **empty isolated** PostgreSQL database
whose name starts with `gremio_workflows_upgrade_test_`, passed explicitly through
`TEST_MIGRATION_DATABASE_URL`. It applies pre-0062 migrations, creates synthetic
legacy rows, applies later migrations and verifies unchanged values/configuration.
Before 0066 it populates all nine retired minutes tables, including links to a card.
It verifies that removing these tables preserves every other row and constraint. It refuses
nonempty databases. Other DB tests use `DATABASE_URL`; always use an isolated test DB.


`home-dashboard.cjs` mounts the personal start page with local persistence doubles.
It checks desktop/mobile ordering and visibility for tasks, boards, finances and
inventories, including persisted preferences from before the removal of minutes
and usability at 200% text.

Use an existing Playwright installation and Chrome (no production dependency):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_PATH=/absolute/path/to/chrome \
node tests/browser/home-dashboard.cjs
```

Browser execution is separate from `npm test`. The fixture bundle uses the existing
esbuild and Tailwind tools. Production tests require a separate production build.

`mcp-production.cjs` starts a real production server with an isolated database
(`gremio_workflows_test_*`) and a local mock OIDC issuer. It checks signed OIDC
login, return to OAuth consent, board/read-write selection, actual SDK MCP calls,
live grant edits, revocation and denial, original PDF downloads, and PDF text
including filled form fields. Set `GREMIO_TEST_STANDALONE_DIR` to an assembled
standalone directory (with `.next/static`, `public`, and `drizzle`) to check the
packaged server and PDF worker instead of `next start`. Screenshots cover desktop, mobile and
200% text. Use the same `PLAYWRIGHT_MODULE` and `CHROME_PATH` variables. All
credentials and users are synthetic; uploads and screenshots use a temporary
folder. No external identity provider or Nextcloud is used.

The production workflow also creates internal attachment folders, rejects duplicate
folder names, renames/moves a PDF through real Server Actions, checks unchanged
file bytes and ZIP subfolders, and verifies that public pages and the public API
expose no folder controls or metadata. `attachment-folders-db.test.ts` verifies
board membership, hidden attachments, cross-ticket boundaries and cascade cleanup
against an isolated `gremio_workflows_test_*` database.
