# Bug and security audit since 4.2.0

Audit date: 2026-11-01. Starting checkout: `ef75a69`.

The initial audit below is retained as historical evidence. The additional audit
starting at `3796fd5` is recorded in the follow-up section at the end.

## Scope and method

The scope includes the 4.2.0 release itself and subsequent changes through the
starting checkout, including the existing `88a0a23` audit fixes. The comparison
base is `v4.2.0^` (`8ee3d36`). There were no pre-existing working-tree changes.

The review covered the changed application, component and library code, SQL
migrations, configuration, dependency lockfile and regression suites. Areas of
particular attention were:

- Board, finance and inventory read/write grants, office moves, multiple owners,
  active-account checks, REST scopes and MCP board restrictions.
- Meeting areas, confidential parent/child topics, independent document copies,
  source-card visibility, financial planning, history and closed meetings.
- Attachment organization, archive/ZIP paths, replacement races, instruction
  PDFs, PDF editing and signing, and public-token privacy.
- SSO/OIDC, session revocation, SSE authorization, live refresh, SMTP secrets,
  confirmation queues, public submissions, input bounds and dependency advisories.
- Existing upgrade, database, API/MCP, browser and real-HTTP regression coverage.

Methods combined source review, TypeScript/lint/build checks, reproducing new
findings with regression tests, isolated PostgreSQL integration tests, local
Chrome workflows and current npm advisories. Trivy 0.76.1 ran the secret and
misconfiguration scanners locally with a read-only mount and networking disabled.
The Trivy scan excluded `.git`, `node_modules`, `.next` and upload data.

## Findings and fixes

| ID | Impact | Finding and resulting behavior | Verification |
| --- | --- | --- | --- |
| A01 | High, dependency DoS | Zod 3 remained within the published affected range. Upgraded to Zod 4.6.7, adapted pagination defaults, email error configuration and MCP schema typing; retained early collection bounds. | npm production audit; complete tests; real MCP login/tools; TypeScript and build |
| A02 | Moderate, dependency DoS | WebDAV and TypeScript lint tooling pulled minimatch versions covered by the advisory. Targeted overrides install 11.0.3 for these consumers, whose named-import API is compatible. | npm production audit; actual WebDAV XML listing/glob regression with an in-process fetch double; lint |
| A03 | Medium, authorization | Shared authorization helpers still accepted inactive owners/admins. Finance source resolution could consequently continue using a disabled owner's source permissions. All three resource kinds now deny inactive actors for read, write, management and accessible-resource lists. | `security-audit-db.test.ts`, access-level and deactivation suites |
| A04 | Medium, workflow authorization | Area writers could reopen closed meetings through `saveMeeting`, bypassing the documented management-only reopening rule. The current locked meeting state now determines whether management is required. | A regression first reproduced successful unauthorized reopening, then verified rejection and authorized reopening |
| A05 | Medium, data disclosure to logs | PDF field failures logged both the submitted value and library errors that could repeat private document content. The failure path now emits a generic warning and retains field-level UI feedback. | Synthetic invalid dropdown value was visible in captured logs before the fix and absent afterwards |
| A06 | Medium, authorization race | Role changes trusted the initial admin snapshot even after acquiring administrator locks. A concurrently demoted admin could restore their own role; a blocked actor could promote someone else. The action now validates IDs/roles, locks admins in consistent order and rechecks the live actor inside the transaction. | `admin-role-revocation-db.test.ts`: valid promotion, revoked self-promotion and blocked actor cases |
| A07 | Low, archive reliability | A colliding legacy filename with a very long multibyte extension could exceed the 255-byte filesystem component limit despite truncation. The uniqueness discriminator and extension now share a bounded byte budget. | Reproduced failing length assertion, then verified distinct names of at most 255 bytes; existing folder/cloud-double tests |
| A08 | Test coverage regression | Four production browser scripts used obsolete SSO fixtures; MCP also ignored the isolated build directory and could hang while cleaning up an already exited server. They now use valid local offline-token introspection, honor the build directory and safely wait for child exit. | Actual access-level, SMTP, public workflow and MCP browser/HTTP runs |

The dependency findings refer to the primary advisory records:
[Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
and [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).

## Findings investigated but not confirmed

- Deleting a confidential parent topic already preserves inherited child privacy
  through `preserve_deleted_topic_privacy()` in migration 0075. A new integration
  regression confirms that the surviving child is confidential and unreadable to
  a meeting reader. No duplicate application-level fix was added.
- Trivy reported `DS-0026` (no image-level HEALTHCHECK). The supported Compose
  deployment already defines the equivalent `/api/health` check. This is a
  standalone-image configuration observation, not a demonstrated application flaw.
- Existing PDF rotation/CropBox, hidden-field projection, token isolation, office
  access, optimistic revisions, financial budgets and queue tests did not reveal
  additional confirmed defects during this audit.

## Dependency result and remaining alerts

Initial npm audit: 16 package findings, comprising one high and 15 moderate
entries, arising from two advisories and their dependency chains.

After the fixes, `npm audit --omit=dev --json` reports **zero findings**.
The full audit still reports **13 moderate entries** in the development-only
ESLint dependency chain, all rooted in `minimatch@3.1.5`.

The minimatch advisory's package range includes all versions below 11.0.1, while
its described amplification requires `firstPhasePreProcess()` and
`optimizationLevel >= 2`. Those implementation paths are absent from the installed
3.1.5 source. No production or remotely supplied pattern reaches this development
dependency in the reviewed application. This is a reachability assessment, not
suppression of the advisory or a claim of an entirely clean full audit.

The legacy ESLint consumers require the callable minimatch 3 CommonJS API.
Forcing minimatch 11 globally changes that API and would break lint/build tooling;
the audit's automatic recommendation even downgrades ESLint to 4.0.0. Neither was
applied. The 13 alerts remain visible and require a compatible upstream/toolchain
resolution or corrected advisory range. The production and TypeScript-estree
consumers use the fixed dependency.

## Validation

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed; Next.js reports its existing `next lint` deprecation notice |
| `npm run build` | Passed in a separate temporary copy, repeated after the final application fix |
| Full suite, `node --import tsx --test tests/*.test.ts` on Node 22.23.2 | **137 passed, 0 failed, 0 skipped**; includes three independent empty-database upgrade tests |
| Local component/browser workflows | **6 passed**: board views, finance plan, meeting visibility, live refresh, public workflow components and home dashboard |
| Real production-server browser/HTTP workflows | **11 passed**: access levels, system email, public workflows, meetings, meeting finance, MCP/OAuth, SSO, ownership/receipts, scoped receipts, topic history and app-wide live refresh |
| Dedicated Keycloak integration | Passed with a new temporary container from an existing local image: offline refresh token survives access expiry; disabled and deleted users are rejected |
| Dedicated notification database check | Passed: commit-only notifications, silent rollback/zero-row/usage writes, no business payload |
| Dedicated activity migration check | Passed: known-state baseline, preserved original authors, append-only activity and rollback behavior |
| `npm audit --omit=dev --json` | **0 findings** |
| `npm audit --json` | 13 moderate development-only dependency-chain findings, explained above; no high/critical entries |
| Final Trivy secret/misconfiguration scan | **0 secrets**; one low image HEALTHCHECK observation already covered by Compose |
| `git diff --check` | Passed |

The first SSO browser attempt on the host's Node 24.19.0 exited inside Node's
Undici/net implementation with `setTypeOfService EINVAL`. Repeating it on the
project's Docker/CI Node 22 runtime passed. The initial ownership browser attempt
omitted its documented `--import tsx` argument; the correctly invoked run passed.
Neither initial attempt is counted as a successful check.

The final suite uses fresh dedicated PostgreSQL databases and a temporary upload
directory. Browser checks use a separate production build and locally installed
Chrome/Playwright, without adding project dependencies. The audit PostgreSQL
container and temporary Keycloak were stopped/removed after validation.

## Limits and operational notes

- This is a source and local regression audit, not a proof that every possible
  bug or security vulnerability has been found. Historical secret removal,
  deployed infrastructure, reverse proxies, OS/container-image CVEs and an
  external production penetration test are outside the executed scan.
- All databases and uploads used for validation were created specifically for
  this audit. Real Nextcloud files, normal app data and external email recipients
  were not used. SMTP tests use a local synthetic server or leave delivery off;
  browser identity checks use local synthetic OIDC providers.
- No new production dependency, database schema change, external REST capability,
  push, pull request, publication or deployment is part of these fixes.

## Follow-up audit starting at 3796fd5

Date: 2026-11-01. The working tree was clean at the start. The comparison remains
`v4.2.0^..HEAD`, including 4.2.0 itself. Existing audit fixes were rechecked rather
than assumed correct. Related callers outside the changed hunks were traced when
they participate in the same permission or data flow; the findings below do not
claim that every affected line was first introduced in 4.2.0.

### Additional findings and corrections

| ID | Severity / impact | Reproduction and correction |
| --- | --- | --- |
| F01 | Medium, internal data disclosure | Card history rendered old disabled deadlines/assignees and historical filenames/archive paths. Archive pages also rendered disabled number/applicant fields, and statistics aggregated hidden amounts, priorities, deadlines and assignments. History now shares a conservative projection with REST; archive/statistics apply current field visibility before output. Stored history and values are preserved. The old production build failed the new complete-HTML history assertion; the corrected build passes for owners, writers and readers on desktop/mobile. |
| F02 | Medium, internal data disclosure | Inventory item lists/details sent disabled optional metadata in client props despite hiding the controls. Disabled numbers/condition notes also remained visible in the inventory archive. Server projections now remove optional hidden item metadata before serialization/search, and the archive masks these values. Operational stock/condition/availability and separately authorized loan/defect histories retain their existing behavior. Pure projection tests and real HTTP/browser payload assertions cover the change. |
| F03 | Medium, authorization / missing financial data | Finance source resolution constructed a partial Board without its inventory relation. Inventory coowners/readers could lose valid sources, while stale ordinary board grants could grant source data without inventory permission. Resolution now passes the complete Board to the existing live authorization helper. An initially failing DB regression covers coowners, readers, revocation and denied stale grants. |
| F04 | Medium, authorization | Board enumeration could include system boards through stale ordinary grants or additional ordinary owners even though direct board access correctly denied them. This enumeration also feeds REST/MCP search and task overview queries. System-board candidates now require accessible inventory membership. The DB regression verifies that enumeration and source resolution agree with direct access. |
| F05 | Medium, concurrency / workflow integrity | Document and card-reference mutations did not advance the meeting revision or serialize with closure/deletion. A pending closure could be bypassed by an upload, stale TOP edits remained accepted after document changes, and deletion could miss newly added files during cleanup. These writes now lock the meeting then the TOP, recheck access/open state and advance the common revision. Deletions capture document paths under the same lock and unlink after commit. The regression verifies stale edit rejection, an upload against an uncommitted closure and absence of orphan files. |
| F06 | Low, archive reliability | The outer Nextcloud archive folder still used a character limit that could exceed the 255-byte component limit for Unicode titles. Sanitization now bounds both UTF-8 bytes and character length without splitting Unicode code points. The initially failing regression covers euro signs, emoji and accented text; existing path/collision/cloud-double tests remain green. |
| F07 | Low, standalone container monitoring | Trivy's missing Dockerfile HEALTHCHECK observation from the first audit is resolved. The runtime image now checks its local health route with the configured port, matching the existing Compose timing. The final Trivy configuration scan has no findings. |
| F08 | Low, configuration UI reliability | A component workflow intermittently reproduced a native React action reset reverting saved trigger checkboxes; waiting for success and a further 30 seconds did not restore them. Trigger-column, trigger-assignee and office-role forms now prevent native reset so their current configuration remains visible. The browser regression waits for settled submission and explicitly invokes a native form reset before asserting the retained selection. |

### Review coverage

- Read/write and ownership helpers, inventory system-board inheritance, office
  moves, finance sources, bearer scopes/board restrictions and MCP consent/tools.
- Public application/feedback/inventory submissions, idempotency, required email,
  bounded uploads, token-type isolation and private data in public projections.
- Meeting areas, confidential parent/child TOPs, proposals/history, financial
  planning, references, independent document copies, closure and file cleanup.
- Attachment folders/ZIP/cloud paths, generated instructions, PDF editing,
  signatures, field visibility, archive and statistics output.
- SSO/session expiry and revocation, local deactivation, SSE/live refresh,
  SMTP/outbox privacy, receipt branding, migrations and dependency advisories.

The standard suite covers actual REST/MCP handlers, budget atomicity, grants,
public privacy, PDF behavior and three empty-database upgrades. Real production
workflows use a separate temporary build, synthetic accounts, local OIDC and
temporary uploads. No normal application database, real Nextcloud files or
external email recipients were used.

### Follow-up validation

- Final full suite on Node 22.23.2: **142 passed, 0 failed, 0 skipped**, including
  the three independently empty upgrade databases. The upload cleanup assertion
  was additionally rerun against the isolated database.
- TypeScript, lint, production build in a separate temporary copy and
  `git diff --check`: passed. The existing Next lint deprecation notice remains.
- Production-server browser/HTTP workflows: **11 passed** (access levels,
  meetings, meeting finance, topic history, app live refresh, SMTP settings,
  public workflows, MCP/OAuth, SSO, ownership/receipts and scoped receipts).
- Component/browser workflows: **6 passed** (board views, finance plan, meeting
  visibility, live refresh, public/budget workflows and home dashboard), including
  the trigger-reset regression after its correction.
- `npm audit --omit=dev --json`: **0 findings**. Full audit: **13 moderate
  development-only entries**, all from the previously documented minimatch
  advisory. No dependency changes or advisory suppression were applied.
- Trivy 0.76.1 secret/configuration scans run locally, read-only and without
  networking, using its embedded configuration checks. Current source excludes
  Git internals, dependencies, build output, local uploads and DB data. The
  committed patch history from 4.2.0 onward is scanned separately for secrets.
  Final results: **0 secrets and 0 configuration findings**.

The minimatch advisory was checked against the current primary
[GitHub advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249). Its broad
affected range still includes the development-only CommonJS 3.1.5 consumer;
the described optimization code path is absent there. Upgrading that consumer
to the incompatible minimatch 11 API remains unsafe without an upstream/tooling
change. These alerts remain explicitly open; this report does not call the full
dependency tree vulnerability-free.

No new production dependency, schema migration, external API endpoint, commit,
push, publication or deployment was made. External deployed infrastructure,
container OS CVEs and a production penetration test are outside these local
checks. The optional real-Keycloak and dedicated notification/activity checks
from the first audit were not repeated; their relevant standard/HTTP regressions
were rerun. A source audit and passing tests cannot prove absence of every bug.
