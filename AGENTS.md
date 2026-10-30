# Working on Gremio

## Read before changing code

- Inspect `git status --short`; preserve existing user changes. Do not commit,
  push, publish or deploy unless explicitly requested.
- `CLAUDE.md` is the canonical functional/architecture reference; `README.md`
  covers setup and operations. `lib/db/schema.ts` is authoritative for the DB.
- `docs/API.md` and `docs/PUBLIC_API.md` define the two separate REST contracts.
  `docs/API_PARITY_AUDIT.md` records the post-v2.7.7 compatibility audit.
- `IMPLEMENTATION_PLAN.md` is historical, not current implementation guidance.

## Implementation rules

- Reuse existing libraries, components, authorization and validation helpers.
  Ask before adding a production dependency.
- Board, finance and inventory grants have read or write access. Any matching
  direct/group write grant wins; owner/admin retain full permissions. Readers
  cannot mutate content, comments, attachments or loans. The optional office
  role adds only configured source-to-target status moves for an existing reader;
  any direct/group write grant still wins. Writers may edit/delete
  content and every enabled card field, including number and trigger dates.
  Settings and sharing still require owner/admin. Finance writers can edit plans.
  API token scope and board restrictions can only narrow the user's live permissions; hidden fields must not leak.
- Keep the external API scope unchanged unless explicitly asked to expand it.
  Session-bound editor/file endpoints and Server Actions are not bearer APIs.
- Use the shared budget writer for position changes. Preserve hidden values,
  check revisions, and write positions plus totals atomically. Never treat a
  comma-joined display title as an accounting allocation key.
- Avoid network/file operations while holding DB locks. Do not mutate real
  Nextcloud files or normal local app data during automated tests.
- Preserve public status-token privacy. Never expose internal notes, accounts,
  budget positions, student ID documents or credentials via public APIs.

## Documentation and verification

- Update affected canonical docs with behavioral changes. OpenAPI sources are
  `lib/openapi-v1.ts` and `lib/openapi-public.ts`; generate both checked-in YAML
  documents with `npm run openapi:yaml`, never edit YAML by hand.
- Run `npx tsc --noEmit`, `npm run lint`, relevant tests and `git diff --check`.
  `npm test` needs a complete local environment and an isolated, migrated
  PostgreSQL database via `DATABASE_URL`. Some suites fail rather than skip
  when the DB is absent. Never point tests at production or ordinary dev data.
- Build with `npm run build` when appropriate. Do not share `.next` between an
  active dev server and a build; use a separate checkout/copy for validation.
- Browser/real HTTP workflow checks are documented in `tests/browser/README.md`.
  Clearly report skipped checks and environment failures; do not present them
  as successful validation.
