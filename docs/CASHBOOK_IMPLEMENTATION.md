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
