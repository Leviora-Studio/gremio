# Bug and security audit from 95d1719

Date: 2026-11-01. Reviewed `95d17196e79f1862397db8cfcdb163f0fbc340c3`
**inclusively** through `5f34f95` (`95d1719^..5f34f95`): three commits,
80 changed files. The working tree was clean before the audit.

## Confirmed findings and fixes

All eight findings below are fixed in the working tree. Regression checks were
also run against the original code: the five new Word checks failed there,
along with the concurrency and PDF-result checks.

| ID | Priority | Finding and impact | Fix and regression evidence |
| --- | --- | --- | --- |
| A1 | P2 | Area settings acquired the area before its meetings; finance planning acquired a meeting before the area. Concurrent saves could deadlock and abort a legitimate transaction. | `touchMeeting` and existing-meeting edits acquire the area first. The new `meeting-area-concurrency-db.test.ts` holds the area lock while invoking real finance planning and meeting edits, verifies a friendly revision conflict without partial TOP creation, then verifies a successful retry. |
| A2 | P2, security | DOCX/DOTX validation checked archive integrity, DTDs and conventional macro filenames, but allowed DDE/external-data fields, external templates/images and embedded active objects to survive into exports. The server did not execute these instructions; the exposure concerned recipients opening or updating the exported file in Word. | Upload and export now reject these fields, HTML imports, active/embedded Office parts and external resource relationships. XML is checked using package content types as well as extensions. Renamed objects are checked through relationship/content types. Safe web/mail/telephone hyperlinks and embedded images remain supported. Unit tests cover split field instructions, renamed objects/XML parts and unsafe relationships; the real browser upload test verifies rejection without storing the template. |
| A3 | P2 | Empty meeting metadata skipped recognized content controls, retaining old sample locations or dates. Single-quoted `fullDate` attributes also retained stale dates. | Recognized controls are updated even for empty values; cached dates are replaced or removed. Unknown manual controls remain intact. Regression tests check blank and populated dates/locations. |
| A4 | P2 | Empty self-closing text nodes in metadata controls did not receive meeting values. | Text replacement expands these nodes while retaining their qualified names. The regression inspects the control itself, independently of ordinary text placeholders elsewhere in the document. |
| A5 | P2 | XML-forbidden Unicode characters could enter generated Word text. XML well-formedness checks did not reliably detect the resulting invalid document content. | Output escaping now permits only XML 1.0 characters, including valid supplementary Unicode. The regression checks forbidden noncharacters/lone surrogates and preservation of emoji. |
| A6 | P2 | When reordering template sections, inherited header/footer references could be inserted after a self-closing `sectPr`, outside their required parent. | Section properties are expanded before inherited references are inserted. A synthetic multi-section template verifies correct ownership of every retained header reference. |
| A7 | P2 | The reviewed PDF export path omitted stored TOP outcomes/notes, although the Word export included them. | PDFs now include the same recorded outcomes/notes. The DB export test verifies their presence in actual extracted PDF text. This was a pre-existing inconsistency in a modified path, rather than a newly introduced omission. |
| A8 | P2, privacy | Next.js's global header rule replaced the documented `no-referrer` policy on session-bound meeting exports/templates/documents with `strict-origin-when-cross-origin`. This was confirmed through actual HTTP responses. | Later, route-specific configuration rules preserve `no-referrer`. Browser assertions cover successful and denied authenticated exports as well as unauthenticated file requests. |

Canonical documentation was updated. The README migration limit was corrected
from `0091` to `0092`; the browser README's obsolete automatic Word-field-refresh
statement was corrected. The finance browser fixture's positional save-button
selector was replaced with a selector scoped to the finance form: the new agenda
settings form had shifted the button indices. No production dependency or database migration was
added, and no bearer/public/MCP API was expanded.

## Review coverage

- Meeting sections, independent/shared numbering, inherited child sections,
  ordering, fixed miscellaneous TOPs, transfers, defaults and central templates.
- Session-bound template downloads and Word/PDF exports; owner/admin versus
  writer/reader access; confidential TOPs and inherited confidentiality.
- Live board and field permissions in finance titles, details, links and motion
  placeholders; planning, revisions, rollback and preserved budget values.
- Word ZIP size/decompression limits, CRC/path validation, XML/DTD handling,
  metadata, styles, numbering, section properties and active content.
- Optional feedback email, mandatory application/inventory email, receipt
  queuing, routing requirements and field configuration locks.
- Schema/migration consistency, internal/public API separation, dependency
  advisories and a local offline secret scan.

## Verification

Tests use Node 22.23.2, synthetic data, a dedicated ephemeral PostgreSQL 16
container and a temporary upload directory. Builds use a separate project copy;
the development `.next` and ordinary application/Nextcloud data are untouched.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed; existing Next 15 deprecation notice only |
| `npm test` | 168 tests: 163 passed, 5 conditional skips, no failures |
| Three skipped upgrade suites, each rerun on its own empty isolated database | All 3 passed; 166 distinct test cases verified in total |
| Two official-DOTX-specific tests | Not run: `GREMIO_WORD_TEMPLATE_FIXTURE` was not supplied; synthetic templates cover the corrected section/metadata paths |
| `npm run build` in separate copy | Passed |
| `git diff --check` | Passed |
| Browser: meeting visibility | Passed at 1440/768/390/320 px, including menus, sorting controls, forms and reader/writer views |
| Browser: meeting templates | Passed: central/area defaults, independent copies, repeated settings saves, finance placeholders and mobile layout |
| Browser: Word exports | Passed: actual active-template rejection, upload/configuration/download/removal, owner/admin rights, reader/writer denials, confidential data and bearer-only denials |
| Browser: meeting workflows | Passed: real area sharing, creation, hierarchy, keyboard sorting, file copies/viewer/downloads, live revocation and actual document privacy headers |
| Browser: financial planning | Passed after correcting the stale test selector: configuration, source filtering, TOP creation, atomic card status/date changes, private projections, live access updates, PDF and mobile layout |
| Browser: public/system-email workflow | Passed: required application versus optional survey email, routing/field requirements and desktop/mobile UI; SMTP remained disabled |
| `npm audit --omit=dev --json` | No known production dependency vulnerabilities reported |
| Trivy 0.76.1 offline secret scan | No findings; build/dependency/upload directories and environment files excluded |

The explicit exclusions in the secret scan avoid scanning local credentials and
generated or third-party material; no secret values or source code were sent to
an external scanner. The npm scan queried public package/version metadata.

## Remaining dependency warning and limits

The full npm audit reports **13 moderate entries derived from one advisory**,
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
They concern the development-only ESLint dependency tree's `minimatch@3.1.5`.
The advisory's broad affected range includes versions below 11.0.1, while its
technical description concerns `firstPhasePreProcess` at `optimizationLevel >= 2`.
The installed legacy implementation has neither that function nor that option;
no application-controlled attack path through it was found. Production users of
minimatch are already overridden to >=11.0.1 (installed: 11.0.3).

The scanner warning remains visible. It was not hidden with an ignore rule or
an incompatible forced major upgrade: legacy ESLint plugins call minimatch as a
CommonJS function, whereas version 11 exposes a different API. Clearing the
metadata warning requires a compatible lint-toolchain migration or an upstream
legacy advisory/fix update. This is a remaining scanner result, not a claim that
the full npm audit is clean.

The Word checks are a bounded content policy, not a general malware scanner.
Microsoft Word pagination, final rendering and the absent official reference
template still require separate validation. No production instance, real OIDC
provider or real Nextcloud archive was exercised, and no deployment was made.
