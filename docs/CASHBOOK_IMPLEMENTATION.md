# Cashbook implementation work plan

## Ordered milestones

1. Application board locking and dedicated receipts.
   - Configurable lock columns and a separate completed-payment column.
   - Internal pending move, public status retained until explicit irreversible lock.
   - Database-enforced frozen card content; only column moves and receipt uploads remain.
   - Dedicated receipt UI with existing sequential receipt naming.
2. Cashbook access and configuration.
   - Admin-only creation; direct/group read/write grants; navigation gated by access or office assignment.
   - Speaker and finance officer selected from current writers; one office assignee.
   - Independent business-expense numbering, multiple application sources, PDF template mapping and purpose preview.
3. Draft and signature workflow.
   - Searchable application selection or business expense, immutable receipt snapshots.
   - Required payment fields, role-aware place/date, generated view/sign-only PDFs.
   - Regeneration invalidates earlier signatures; first signer submits frozen draft to distinct second signer.
   - Mandatory-comment return reopens draft; activity records every transition and assignment.
4. Immutable ledger and office workflow.
   - Second signer alone authorizes; atomic append to ledger and authorization timestamp.
   - Office-only limited queue, ZIP download, reversible completion marker independent of ledger.
   - One-time booking date; append-only corrections with reason, before/after and typed confirmation.
   - Fixed columns with per-user visibility/order/sorting; linked correction chains.
5. Finance and card projections.
   - Ledger actual costs; source-specific account filters.
   - Planned amount per title before completion, ledger values after completion.
   - Application rows show paid and maximum outstanding per title.
   - Board readers see associated posted booking summaries; ledger links still require cashbook access.

## Invariants

- Use Gremio Select, DatePicker, FileInput, ConfirmDialog, PDF viewer and existing visual conventions.
- Preserve existing accounting data, public token privacy, API scope and unrelated user changes.
- No file/network operations under database locks. Concurrent operations check revisions.
- No production dependencies without approval. No commit, push or local deployment for this new scope unless requested.
- Validate migrations and workflows against isolated databases and temporary files only.

## Confirmed decisions

- Corrections post directly after double confirmation, without repeating signatures.
- Choose missing second signer from current writers when submitting.
- Outgoing payments only.

## Implementation status

All five milestones are implemented. Canonical behavior and upgrade details are
recorded in `CLAUDE.md`; the REST contracts remain scoped to their existing APIs.
Validation uses disposable PostgreSQL databases, synthetic identities/certificates
and a separate production build. The production browser fixture covers both
signatures, irreversible source-card locks, receipt numbering, office-only access,
one-time booking dates and append-only corrections. Existing values are checked
by the migration regression. No deployment or commit was made for this new scope.

## Signature and office refinements

- The second signer supplies their own place/date before signing. A retained
  incremental PDF preparation permits preview and preserves the first signature.
- The configured counterpart is preselected, with an explicit override to another
  live writer in the submission dialog. Self/read-only targets remain forbidden.
- Corrections stay in the immutable ledger and correction chain, but never create
  an office task or appear in office queues. Existing entry data needs no migration.

## Emergency instruction warning

Migration 0097 adds optional, immutable flag metadata without changing existing
entries. Writers can flag a posted, open original instruction once using the exact
confirmation MARKIEREN and an optional office note. Red textual warnings appear
in queues, the ledger and entry details. Revision locking prevents races with
office completion. Values/files/signatures and accounting totals remain intact.
No API or MCP functions are introduced.

Migration 0098 adds immutable resolution time/person metadata. Writers and the
currently assigned office user can resolve an existing warning through an In-App
confirmation. Active red warnings disappear from queues, the ledger and details;
the initial flag and resolution remain in the append-only activity log. Readers
without the office role cannot resolve warnings. Accounting values, files and
office completion are unchanged. No bearer API or MCP tool is added.
Activity comparisons only show fields present in the event’s update, so unchanged
fields are not displayed as if they had been cleared.

Activity display distinguishes patches with known before/after values from newly
recorded values. Missing patch keys stay omitted; empty-equivalent values do not
produce changes, while explicit clearing remains visible. After-only events use
an Angabe/Wert table without implying that the previous value was empty. Office
completion uses meaningful labels. Historical records are rendered with these
rules without changing their stored content.

## Planning accounts and unified signing

Signature place/date are collected immediately before each signature. Signieren
prepares the current file and opens the In-App viewer directly; bookkeeping editors
and details omit those fields. Legacy payment JSON stays intact. New signature
metadata is attached to retained PDF versions. The second signer still appends an
incremental revision so the first signature remains cryptographically valid.
Correction links display ledger booking numbers.

Migration 0099 retains all existing board finance fields and enriches planning
rows with their original card/default account. New boards omit legacy account, budget-title and
approved-amount fields. Planning account switches require confirmation. Frozen
plans can only be revised via a reasoned append-only correction with two dialogs
and typed BESTÄTIGEN, using the same secured writer for UI/REST/MCP. All other card
fields remain frozen. Finance merges configured sources with every linked ledger
application once and calculates maximum outstanding amounts per budget title.

## Read-only exports

The ledger offers Excel/PDF exports to readers, writers and managers. An office
assignment without a read grant cannot export the whole ledger. Both download
routes require a current browser session; bearer tokens and MCP cannot use them.
Exporting performs no writes to entries, activities or archived files.

Excel always includes all posted originals and corrections and all eleven ledger
columns. Drafts/submitted instructions are outside the ledger. Every download
uses a fresh discarded 32-character random password, SHA-512 salted sheet and
workbook-structure protection, and locked cells. The ZIP is readable without an
opening password. Excel AutoFilter is enabled. Sorting locked cells is unsupported
by Excel, so users choose up to three sort criteria in the Gremio dialog before
exporting. Sheet protection prevents ordinary edits, not technical tampering with
the underlying file.

PDF uses the shared In-App selection dialog: text search, typed amount/date/text
filters, sorting and selected columns. Every page repeats scope, creation time,
filter/sort description, row counts and headers. Long data wraps across pages.
Finance views share the same controls, preserve their current authorization
projection and export every row/column to Excel. Filtered or sorted PDFs omit
structural/total rows and explain that omission, avoiding stale totals.

`tests/export.test.ts` covers selection validation, complete hierarchical sorting,
protection XML, fresh verifiers, numeric money/dates and PDF scope/wrapping. The
cashbook production fixture tests real downloads, grants and revocation,
office-only and bearer denial, unchanged entries, mobile dialogs, and all five
finance export views. Native Excel was additionally checked with synthetic data:
the file opens without a password, edits are blocked, and AutoFilter works.

PDF presentation uses fixed A4 portrait/landscape or A3 landscape paper, a
structured export-scope panel, repeated headers, alternating row shading, aligned
amounts and a page footer. Normal rows stay together. Long prose in narrow cells
is printed in full directly beneath its own entry; oversized rows have labeled
continuations. IBAN grouping is display-only. No values or export permissions
change. Pure export tests verify page dimensions, complete text and row grouping.
