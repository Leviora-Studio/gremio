# Browser regression tests

Use Node 22, matching the Dockerfile and CI, for production workflow checks.
Scripts that import application TypeScript directly (including
`ownership-receipts-production.cjs`) require `node --import tsx`.
Production checks must use `GREMIO_TEST_BUILD_DIR` pointing at a separate built
copy; never run a build in a directory serving an active test or dev server.
The access-level, system-email, public-workflow and MCP production fixtures use
local synthetic SSO introspection, including the offline refresh token required
by current sessions. No external identity provider is required for those checks.

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

`finance-expired-status-db.test.ts` also requires an isolated
`gremio_workflows_test_*` database. It checks per-source expired columns with real
finance actions and queries: single and position budgets, unchanged actual costs
and application rows, account overrides, exports, leaving the column, clearing
the selection, column deletion and management/source-access permissions.

`board-views.cjs` mounts the actual board with synthetic card data and local
navigation/Server Action doubles. It checks Kanban/list/table/calendar switching,
shared search, persisted view/category preferences, table columns and numeric
amount sorting, status changes, calendar date selection/month navigation,
undated cards, empty results, search navigation to offscreen columns/collapsed
groups/other calendar months, restored collapse preferences and disabled-field handling at 1200 and 390 pixels.
Run with the same `PLAYWRIGHT_MODULE` and `CHROME_PATH` variables above. It does
not use a database or mutate real cards; real action/trigger integration requires
an isolated application environment.

`access-levels-production.cjs` starts the real production build with isolated
PostgreSQL and sealed synthetic owner/reader/group-writer sessions. At desktop
and mobile widths it checks all board views, disabled card editing, attachment
downloads, hidden public mutation tokens, finance plan writes, inventory/loan
controls, settings guards and real grant updates on all three sharing pages.
Use the same environment as `workflows-production.cjs`; optionally set
`GREMIO_TEST_BUILD_DIR` to the separately built checkout/copy. No real files,
Nextcloud connections or OIDC services are used. `access-levels-db.test.ts`
checks direct/group precedence and denied mutations; the separately invoked
`access-levels-migration.test.ts` uses `TEST_ACCESS_MIGRATION_DATABASE_URL`
(an empty `gremio_workflows_upgrade_test_*` database) to verify legacy grant upgrades.

`finance-plan.cjs` mounts the actual confirmation and plan row components with
local save/navigation doubles. It checks cancel/confirm, no editable fields
before confirmation, pending/saving/saved indicators, failed saves with retained
drafts and successful retries at desktop/mobile widths. Run with the existing
`PLAYWRIGHT_MODULE` and `CHROME_PATH` options. `board-views.cjs` additionally
checks table header drag-and-drop, keyboard sorting in column selection, matching body cells, reload persistence and reset.

Office-role checks in `access-levels-db.test.ts` cover existing-read-access
requirements, same-board constraints, allowed/forbidden/stale source moves,
archived cards, unchanged content guards, strict status-only REST patches,
append-only placement, revocation and write-grant precedence.
`access-levels-production.cjs` additionally configures the office role through
the actual settings form and exercises reader status moves and group-writer
precedence on desktop/mobile against the isolated database.

The board-view checks also verify hidden list groups, the bottom restore area,
reload persistence and temporarily revealed search matches without changing preferences.


`system-email-production.cjs` checks real admin SMTP and board/inventory settings, encrypted credential persistence, desktop/mobile layout and mandatory public email validation against a separate production build. Use `GREMIO_TEST_BUILD_DIR`, `PLAYWRIGHT_MODULE` and `CHROME_PATH` as above and an isolated migrated `gremio_workflows_test_*` database. SMTP remains disabled throughout this browser test; no external messages are sent. `tests/system-email-db.test.ts` additionally captures actual SMTP messages on loopback, validates all three receipt/PDF types and checks status triggers, retries, rollback, privacy and management permissions.


`meetings-production.cjs` uses the same isolated PostgreSQL/production-build setup. It exercises real meeting and TOP creation, Berlin dates, card linking, explicit document copies, session-only access, confidential topics, live revocation, PDF download, keyboard drag-and-drop and desktop/mobile layouts. Set `GREMIO_TEST_BUILD_DIR`, `PLAYWRIGHT_MODULE` and `CHROME_PATH`; source documents and screenshots are synthetic temporary files. `meetings-db.test.ts` covers the direct/group access matrix, joint board-management requirement, hidden attachment fields, student-ID exclusion, copy independence, stale revisions, confidential-to-shared confirmation, closed sessions, later-session copies and privacy of actual extracted PDF text.

The meetings browser workflow now creates an area, grants a reader through the actual board-style sharing UI, creates a meeting inside the area using the shared DatePicker, and uploads a document through FileInput. Access and revocation are tested at area level. `meeting-areas-migration.test.ts` requires an empty isolated `gremio_workflows_upgrade_test_*` database via `TEST_MEETING_AREA_MIGRATION_DATABASE_URL`; it proves that equal legacy committee names do not merge audiences and that TOPs/document paths survive.

The meetings workflow also opens a PDF document in the actual in-app viewer and waits for a rendered page canvas, then verifies that an image document triggers a browser download instead of opening a viewer.

The meetings workflow additionally verifies reader-only main TOP suggestions, planner assignment to a main TOP, subtopic creation, 1.1 numbering, sibling keyboard sorting and responsive hierarchy rendering. Database tests cover invalid/cyclic/cross-session/deeper parents, inherited privacy including parent deletion, group copies, structured reordering and actual PDF numbering.

### SSO validity and local deactivation

`tests/browser/sso-production.cjs` runs against the separate production build and an isolated migrated test database with a synthetic HTTP OIDC provider. It verifies introspection caching, rejected SSO sessions, fail-closed outages, the deactivate/reactivate admin UI, permanent rejection of old cookies and closure of an already open protected SSE connection. Run with the same test environment and build-directory settings as above. `meetings-production.cjs` uses `synthetic-sso.cjs` so its session fixtures also pass the real HTTP introspection guard.

Unit/DB checks: `node --import tsx --test tests/sso-session.test.ts tests/user-deactivation-db.test.ts tests/sse-authorization.test.ts`. The fake clock checks the exact five-minute boundary without waiting or adding production bypasses.

An optional real-provider check starts and removes a dedicated Keycloak container with only synthetic credentials: `GREMIO_KEYCLOAK_TEST_IMAGE=<local-image> node --import tsx tests/keycloak-session-check.cjs`. Supply the usual test-only application environment. It verifies the actual `lib/oidc.ts` Refresh-Token introspection against enabled, disabled and deleted users; no existing Keycloak or app data are changed.

`tests/session-lifetime.test.ts` verifies the fixed 14-day cookie deadline, cookie-size fallback and that subsequent profile writes preserve the original expiry. `tests/sso-session.test.ts` covers bound offline tokens beyond five minutes, revocation and the absolute 14-day limit. `tests/keycloak-session-check.cjs` checks offline refresh-token introspection and disabled/deleted users against an isolated Keycloak.

The meetings production workflow also checks the agenda/proposal tabs for readers and writers, mobile layouts for both roles, reader submission in a focused dialog, direct proposal scheduling with persisted state, content-first topic pages and explicit editing dialogs.

`ownership-receipts-production.cjs` runs with the same isolated database and separate production build as the other workflows, using `node --import tsx`. It verifies typed appointments for all board kinds, new-owner management access, self-departure, admin-only removal, last-owner protection, admin logo upload, protected logo preview and branded public/email PDFs. It uses the original CC0 fixture logo and renders synthetic emails without sending. `tests/board-ownership-db.test.ts` also races simultaneous departures and checks inherited inventory-system permissions and API ownership roles.

`app-live-production.cjs` runs against the isolated database and separate production build with synthetic SSO. It verifies live meeting proposals, board/finance/admin views, one stream across client navigation, dirty-form and dialog protection, offline catch-up and revoked area access. The explicit `tests/app-live-notifications-check.cjs` must run alone against a migrated `gremio_workflows_live_test_*` database; it checks commit-only payload-free notifications, rollback, zero-row writes, usage-only token writes and delivery updates.

`meeting-finance-production.cjs` uses a separate production build and an isolated
`gremio_workflows_test_*` database with synthetic SSO. It checks area-level board
and source/target configuration through real UI actions, marking the financial
TOP, source filtering, planning a card as a numbered sub-TOP, automatic status and
meeting-date updates, PDF download, protected titles and live access changes.
Screenshots cover desktop and mobile. Use `GREMIO_TEST_BUILD_DIR`,
`PLAYWRIGHT_MODULE` and `CHROME_PATH` as above. `meeting-finance-db.test.ts`
additionally covers revision rollback, duplicate/foreign cards, read/write
permissions, disabled fields, existing status triggers, preserved budget values,
multiple budget positions, card deletion and PDF link privacy. Set
`GREMIO_FINANCE_PDF_OUTPUT` to an optional temporary PDF path for visual inspection.

`scoped-receipts-production.cjs` checks collapsible per-location and per-survey
receipt branding through real admin actions, separate identities for locations
sharing one board, PNG upload/removal, private preview access, public PDF authors
and embedded logos, global fallback, and desktop/mobile layout. It uses a separate
production build with synthetic SSO and an isolated `gremio_workflows_test_*`
database. SMTP is never enabled and no messages are sent. Use
`GREMIO_TEST_BUILD_DIR`, `PLAYWRIGHT_MODULE` and `CHROME_PATH` as above.
`scoped-receipt-branding.test.ts` also covers admin authorization, invalid images,
retained settings when disabling overrides, empty-name fallback, consistent
PDF/mail branding and friendly Du wording. `GREMIO_RECEIPT_OUTPUT_DIR` optionally
writes synthetic PDFs to an existing temporary directory for visual inspection.

`topic-history-production.cjs` uses two synthetic browser sessions against a
separate production build and isolated `gremio_workflows_test_*` database. It
checks direct private topic creation without a target selector, proposals from
the personal overview, live proposed/scheduled/deferred history, quick status
changes, source retention by status, separate withdrawn/deferred tabs, hiding
completed private masters, the published-minutes closed label and desktop/mobile
layout. `topic-history-db.test.ts` also checks permission revocation, duplicate
active proposals, rollback on conflicting states, mixed parent/child retention,
immutable forwarded records and permission-checked financial re-planning dates.
Use `GREMIO_TEST_BUILD_DIR`, `PLAYWRIGHT_MODULE` and `CHROME_PATH` as above.

The topic-history browser test additionally verifies that deferring a TOP keeps
it on the agenda with a red label, and that it stays in both the agenda and the
deferred tab after transfer. `agenda-deferred.test.ts` checks stable numbering
and deferred children under withdrawn parents. `GREMIO_DEFERRED_PDF_OUTPUT` can
write the synthetic retained-source PDF from the DB history test for visual QA.

The personal history check now asserts four separate chronological events and
timestamps (proposed, scheduled, deferred, proposed for the next meeting), not
only the current state per meeting. The DB history test also checks repeated
states, rollback without activity, treatment and later undo as separate events,
and revocation filtering. `tests/topic-activity-migration.cjs` is an explicit
empty-database upgrade check, using `TEST_ACTIVITY_MIGRATION_DATABASE_URL` with
name prefix `gremio_workflows_upgrade_test_activity`. It verifies marked known
baselines without fabricated history and transactional append-only status events.

The topic-history browser check opens “Vergangene Themen” after treatment and
verifies that the private topic remains available with all six chronological
activities and no new-proposal button, at desktop and mobile widths. The DB test
also checks privacy and the return from past to active after undoing treatment.

The topic-history checks additionally cover withdrawn TOPs retained in agenda and
withdrawn tab, editable status with blocked transfer while withdrawn, a fresh proposal
by the original author, private resolution into past topics and the separate
resolved activity while both session occurrences remain withdrawn. DB coverage
includes ownership, idempotent resolution, active-proposal rejection, direct
withdrawn submission adoption, baseline accuracy and omission of withdrawn
children during a main-TOP transfer.

The withdrawn status can be changed through both quick controls and the full
editor. Reopening a privately resolved occurrence restores its private master
to current topics; prior withdrawal and resolution activities remain recorded.

The topic-history browser flow verifies creation before current/past topics,
initially collapsed active and past items, and hiding/restoring the activity
trail with each item's native details toggle.

`live-refresh.cjs` mounts the actual app refresh coordinator, draft guard, meeting
action form and controlled rename component without a database. It checks quiet
deferral for clean focused fields/dialogs, silent focus catchups, genuine external
changes during drafts, React action reset with disabled fieldsets, filters, saved
controlled inputs and drafts inside collapsed sections. Run with the same
`PLAYWRIGHT_MODULE` and `CHROME_PATH` settings above.

`meeting-visibility.cjs` mounts the real meeting workspace, sortable agenda, status
and transfer controls, creation/proposal dialogs, date/time fields, finance
configuration and uploader with local action doubles. At 1440, 768, 390 and 320
pixels it verifies menu bounds and actual hit testing of the last option, calendar
accessibility in scrollable dialogs, keyboard Escape, reader/writer controls and
long text/file-name wrapping (also at 200% text size). It writes screenshots to the printed temporary
directory. The production meeting suite additionally verifies last-row status
menus and long-name area grants against real pages at the same four widths.

The meeting visibility check also measures adjacent status/action heights and
compact grant form controls, including the enlarged-text layout.

The access-level production workflow also checks hidden historical values,
archived card fields, field-dependent statistics and optional inventory metadata
in complete HTML/client payloads for owners, writers and readers at desktop/mobile
widths. `finance-source-access-db.test.ts` covers inventory coowners, live grants,
revocation and stale ordinary grants on system boards, including finance sources
and board lists. `meeting-document-concurrency-db.test.ts` holds an uncommitted
meeting closure while uploading, then verifies denied writes, revision conflicts
and cleanup of the new file. Both DB tests require an isolated
`gremio_workflows_test_*` database and a test-only upload directory.


`meeting-word-production.cjs` runs with `node --import tsx` and checks real template
upload, all style mappings, original-template download, owner/admin-only PDF and
Word exports (including confidential content), denial for readers/writers and
bearer-only requests, preserved opaque OOXML parts, removal and desktop/mobile
settings. It uses a synthetic alternative template by default; set
`GREMIO_WORD_TEMPLATE_FIXTURE` to a local `.dotx`/`.docx` to verify an official
reference without adding it to the repository. Use `GREMIO_TEST_BUILD_DIR`,
`PLAYWRIGHT_MODULE`, `CHROME_PATH` and the isolated migrated test database as above.
Word fields are refreshed on open; final Microsoft Word pagination is a separate
manual validation. Generated documents and screenshots remain in the printed
local temporary directory.


`meeting-templates-production.cjs` (with `node --import tsx`) covers central
session-area template creation/editing, selection and independent area customization,
automatic default TOP copies on meeting creation, per-meeting edits, the three agenda
sections and their order, and Word output without an additional title/metadata block.
With `GREMIO_WORD_TEMPLATE_FIXTURE`, it also verifies opening topics remain before
the original template's first section break. Use the isolated test DB and separate
build directory described above. Screenshots cover desktop and mobile editors.

`meeting-templates-production.cjs` also covers finance motion placeholders:
visible-field insertion buttons, sample preview, repeated settings saves with
checkbox retention and DOM identity checks, mobile layout, planning and resolved
motion display in the session overview. It verifies the miscellaneous checkbox
survives saving another settings section. Run only with an isolated migrated DB.

`system-email-production.cjs` verifies required location application email versus
optional survey email (including email-free POST), named warnings for missing
routing fields, locked required card fields, editable optional attachments and
repair by saving board fields. SMTP stays disabled; no external mail is sent.
