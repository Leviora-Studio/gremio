# Typed confirmation audit

All current in-app dialogs requiring a typed word were traced from the rendered
component to the session-bound Server Action and, where applicable, shared service.
The actual input is checked before mutation. Existing authorization, revision,
last-owner and last-admin checks remain required independently of the word.

## Deletions

`DeleteConfirm` submits its input and `deleteConfirmationError` checks `LÖSCHEN`
(trimmed, case-insensitive, matching the existing UI). Missing, non-string and
wrong values fail. These actions previously relied on client-side word checks:

| Dialog | Server Action |
| --- | --- |
| Board settings | `deleteBoardConfirmedAction` |
| Admin board list | `deleteBoardAdminConfirmedAction` |
| Inventory settings | `deleteInventoryBoardConfirmedAction` |
| Finance settings | No deletion action or control; admin panel only |
| Admin finance list | `deleteFinanceBoardAdminAction` |
| Cashbooks (admin only) | `trashCashbookAction` |
| Groups | `deleteGroupAction` |
| Accounts | `deleteAccountAction` |
| Priorities | `deletePriorityAction` |
| Locations / financial application form locations | `deleteLocationAction` |
| Feedback areas | `deleteFeedbackAreaAction` |
| Board templates | `deleteTemplateAction` |
| Finance templates | `deleteFinanceTemplateAction` |
| Meeting area templates | `deleteMeetingTemplateAction` |
| Meetings | `confirmedDeleteMeetingAction` |
| Personal topics / meeting agenda topics | `confirmedDeleteTopicAction` |

Legacy exported form actions `deleteBoardAction`, `deleteBoardAdminAction`,
`deleteMeetingAction` and `deleteTopicAction` now require the `confirmation` form
field too. A former `confirmDelete` checkbox alone cannot bypass the word.
Meeting template deletion still requires the current revision.

Tracking-board deletion already checked trimmed, case-sensitive `LÖSCHEN` in
`deactivateLoanTrackingAction`; its `ConfirmButton` submits the actual input.

## Other typed dialogs

| Dialog | Word | Server enforcement | Audit result |
| --- | --- | --- | --- |
| Promote to admin | `ADMIN` | `setRoleAction` → `roleConfirmationError` | Added |
| Promote user to template manager | `TEMPLATE` | Same, using current locked target role | Added |
| Revoke admin / template manager role | `ENTZIEHEN` | Same; admin → template manager requires revocation word | Added |
| Appoint / remove owner, board / finance / inventory | `ERNENNEN` / `ENTZIEHEN` | `changeOwnerAction` → `changeOwnership` | Already checked; hardened non-string handling |
| Activate / deactivate either public application module | `BESTÄTIGEN` / `DEAKTIVIEREN` | `changeApplicationModuleAction` → `setApplicationModule` | Already checked |
| Correct a locked application's allocations | `BESTÄTIGEN` | `writeBudgetPlan` | Already checked, including REST/MCP use of the shared writer |
| Correct a posted cashbook entry | `BESTÄTIGEN` | `correctCashbookAction` → `correctCashbookEntry` | Already checked |
| Emergency marking of an instruction | `MARKIEREN` | `markCashbookInstructionIncorrectAction` → `markCashbookInstructionIncorrect` | Already checked |

Role and owner words are trimmed and case-sensitive, matching their UI. Module,
allocation, cashbook-correction and emergency words require exact matches.
Click-only / checkbox-only confirmations are outside this inventory and keep
their existing behavior. No external API or MCP capability was added or removed.
Cashbook operations remain session-only. A confirmation word is an intent check,
not a secret or an alternative to authentication and authorization.

## Regression coverage

- `typed-confirmations-db.test.ts`: direct calls to all 15 typed deletion handlers,
  personal and meeting-bound topics, and four legacy aliases (20 fixture cases);
  missing, wrong and non-string words leave target records unchanged; correct
  words move to the 30-day recycle bin while preserving rows and files. Role changes also reject words for other transitions and use the
  live role to determine the expected word.
- `admin-role-revocation-db.test.ts`: valid words still cannot bypass live
  revocation or deactivation of the acting admin.
- `board-ownership-db.test.ts`, `application-form-modules-db.test.ts`,
  `budget-plan-corrections-db.test.ts`, `cashbook-db.test.ts`,
  `loan-tracking-deletion-db.test.ts`: existing typed families reject wrong or
  missing words and exercise successful, authorized operations.
- `tests/browser/access-levels-production.cjs`: desktop/mobile real Server Actions
  for role changes, group deletion, personal-topic deletion and tracking deletion;
  checks disabled buttons, actual input transport and persisted outcomes.

All mutation tests use synthetic users/data, an isolated migrated PostgreSQL
database and temporary file storage. No normal local app files or Nextcloud
archives are used.


## Recycle-bin lifecycle

All listed typed deletions, including tracking boards and cashbooks, now call the shared soft-delete service. Application boards, financial overviews and cashbooks additionally require a live admin role and expose deletion only in the admin panel. Other existing permissions remain required. Click-only deletions are unchanged.

Admin-only `restoreTrashAction` and `purgeTrashAction` require the actual typed `WIEDERHERSTELLEN` / `ENDGÜLTIG` (trimmed, case-sensitive). Both actions recheck the active admin in the same transaction as the mutation. Restore is rejected after 720 hours or on parent/link conflicts. Final deletion uses a resource-scoped immutable-data exception, then durable post-commit file cleanup. The daily 03:00 Europe/Berlin sweep uses the same purge service and cannot prematurely remove a nonexpired trashed entry. `recycle-bin-db.test.ts` verifies words, rights, visibility, exact restoration, immutable whole-resource purge and expiry; `recycle-bin-migration.test.ts` verifies upgrade preservation. `recycle-bin-production.cjs` covers real session actions and responsive admin dialogs.


Board file recycle-bin actions `restoreFileAction` / `purgeFileAction` require the actual trimmed, case-sensitive `WIEDERHERSTELLEN` / `ENDGÜLTIG` server-side, current board write rights, matching board identity and visible attachment kind. Read access, delegated management without write access, a forged board ID or a confirmation word alone cannot mutate files. Frozen cards reject restore. Ordinary file removal keeps its existing click confirmation but now stages a 30-day file recycle-bin entry.


Board (including application-board), finance and cashbook deletion additionally requires the exact current full resource name after `LÖSCHEN`. The actual name input is passed by `DeleteConfirm` and checked inside `moveToTrash` while the current resource row is locked, after live authorization. Missing, non-string, wrong, case-changed, whitespace-modified and stale names are rejected. The final modal button stays disabled until the name matches and reopening resets the input. Legacy board form actions read `boardName` instead of supplying the expected name themselves.

Application boards, financial overviews and cashbooks have no settings deletion controls, including for admins. `deleteFinanceBoardAction` is removed. The general board settings deletion action/legacy alias rejects application boards even for admins. The admin actions require an active admin; the shared lifecycle also enforces admin-only deletion of all three resource kinds. Normal board owners retain deletion through settings with both typed stages. Inventory tracking removal retains its separate inventory-owner flow. Restore and permanent purge retain their existing confirmation words.


Inventory and meeting-area settings deletion additionally requires the exact current full name after `LÖSCHEN`. `deleteInventoryBoardConfirmedAction` passes the actual `inventoryName`; `deleteMeetingAreaAction` passes `areaName`. The shared lifecycle checks both inputs under the resource lock after live owner/admin authorization. Inventory coowners retain rights; delegated management/read/write grants do not permit deletion. Meeting areas and descendants use the existing 30-day bin; admin restore/purge retain their words and permissions.


## Extended content and admin confirmations

- Individual card deletion and autosaved-card discard require actual `LÖSCHEN`
  and use the shared 30-day board bin. REST requires strict JSON confirmation;
  MCP requires the same explicit argument. Card-bin restore/purge require
  `WIEDERHERSTELLEN` / `ENDGÜLTIG` and live scoped board write rights.
- Inventory item, loan, inventory-file and meeting-document deletions require
  `LÖSCHEN`, including all legacy form aliases; these remain immediate deletions.
- `setUserActiveAction` requires `DEAKTIVIEREN` / `REAKTIVIEREN` independently of
  last-admin/self/live-role protections. Profile certificate/image removal checks
  `ENTFERNEN` before clearing any stored value or removing a file.
- Admin inventory publication/hiding and overview inclusion/exclusion check
  `ÖFFENTLICH` / `VERBERGEN` and `EINBEZIEHEN` / `AUSSCHLIESSEN`; both current and
  legacy actions require the actual word, with live-admin checks under lock.
- Groups and named templates require the current exact name after `LÖSCHEN`,
  checked under the shared lifecycle row lock. Removing Word/PDF templates also
  requires the current filename and deletion word with the existing settings
  guards and revisions; there is no implicit expected-name submission.

Coverage: `card-trash-db.test.ts`, `extended-confirmations-db.test.ts`,
`card-trash-migration.test.ts`, and `typed-deletions-production.cjs`.
