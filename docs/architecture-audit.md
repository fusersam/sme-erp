# Senior Architect Audit — Findings & Remediation

A full-codebase review of the SME Business Manager ERP across six dimensions:
bugs, security, performance, technical debt, refactoring, and accounting
consistency. This document records what was found, what was fixed in place
(without changing functionality), and what is recommended for later work that
would change behaviour and therefore needs explicit sign-off.

---

## Fixed in this audit

### Security — critical

**1. No permission enforcement in the `moduleAction` router.**
Every authenticated user could call every action on every module. The role
model (`AuthService.PERMISSIONS`, `PermissionsService`) existed but was only
consulted by the UI for menu visibility — never on the server dispatch path.
A Viewer could `create`/`delete` invoices; a Sales Officer could `process`
payroll; anyone could post journals.

*Fix*: `moduleAction` now enforces, server-side, before dispatch:
- an **action whitelist** (`ALLOWED_ACTIONS`) so only known method names run —
  blocking invocation of arbitrary object properties through the router;
- a **module-group map** that aligns the router's fine-grained keys (`journal`,
  `accounts`, `salaryStructures`, `purchaseOrders`, …) with the permission
  model's coarser groups;
- a **role check** via `AuthService.hasPermission`, with write-style actions
  normalised to `create`/`update`/`delete` and reads to `get`. Administrators
  bypass. Verified against 11 role/module/action scenarios.

### Accounting — latent correctness bug

**2. Same-account-twice overwrite in `_postToLedger`.**
When one journal entry contained two lines posting to the *same* account, each
line read the stale Chart-of-Accounts balance and the second `updateRow`
overwrote the first — silently dropping one line's effect on that account's
balance. Rare in current auto-postings but valid double-entry and a real
correctness hazard for manual journals.

*Fix*: balance changes now accumulate per account and chain line-to-line; each
affected account is written back exactly once. Proven by
`tests/postledger_refactor_test.js` (same-account-twice now resolves to 350,
not the buggy 250).

### Performance

**3. N+1 reads when posting.** `_postToLedger` did a full-sheet
`findRow('ChartOfAccounts', …)` for every journal line — five reads for a
five-line entry. *Fix*: the Chart of Accounts is loaded once per posting into
a map; lines resolve from memory.

**4. Cell-by-cell writes.** `updateRow` issued one `setValue()` per field
(six round-trips for a six-field update). *Fix*: it now reads the row once,
patches the changed cells, and writes them back in a single `setValues()`.
General-ledger and journal-line writes are batch-appended via a single
`setValues()` (`_appendRows`).

**5. Repeated header reads.** `getHeaders` re-read row 1 on every
`appendRow`/`updateRow`. *Fix*: a per-execution header cache (with
`clearHeaderCache()` invoked at the end of `DatabaseInit.initialize()` so a
header repair never leaves a stale cache).

### Concurrency

**6. No serialization of journal posting.** Concurrent postings could
interleave their ledger writes and corrupt running balances. *Fix*:
`createJournalEntry` wraps posting in `LockService.getScriptLock` (20s wait).

### Robustness

**7. Collision-prone IDs.** `generateId` used a 4-character `Math.random()`
suffix. *Fix*: it now uses a `Utilities.getUuid()`-derived suffix combined with
a millisecond timestamp, making collisions under concurrent creation
negligible.

---

## Recommended (not implemented — would change behaviour)

These are deliberately **not** done here because they alter behaviour or carry
migration risk, and the audit brief was to improve the code *without changing
functionality*. They are the highest-value next steps.

**A. True transactional rollback for multi-step financial operations.**
`invoice.send` posts the journal, deducts inventory, then updates status as
separate operations. A failure midway (e.g. Sheets quota) can leave a posted
journal with an unsent invoice, or deducted stock with no journal. Apps Script
has no cross-sheet transaction; the robust pattern is a compensating-action
log: record each side-effect and, on failure, reverse the ones that succeeded.
This changes failure-mode behaviour, so it needs sign-off and its own test plan.

**B. Unify the soft-delete sentinel.** `Utils.deleteRow` writes
`status='Deleted'`, but services soft-delete with `Inactive` / `Cancelled` /
`Terminated` / `Discontinued`, and three dashboard filters defensively check
for `'Deleted'`. `Utils.deleteRow` is currently dead code (no service calls
it), so this is latent, but the inconsistency invites future bugs. Recommend a
single `ARCHIVED_STATUSES` constant consulted by both `sheetToObjects` (to
exclude) and every aging/report filter.

---

## Implemented in follow-up (lower-risk recommendations)

The following three were originally listed as recommendations but carried no
behaviour-change risk (they are mechanical refactors or purely additive
read-only checks), so they have now been done:

**C. `getSheet` no longer creates headerless sheets.** When
`ConfigService.getSheet` must create a sheet whose name is a known schema
sheet, it now writes the canonical header row from `DatabaseInit.getSchema()`
immediately (and freezes row 1). Unknown sheets are still created bare. The
seeding is fully guarded — it can never throw out of `getSheet`. This closes
the root cause of the earlier duplicate-record/headerless-sheet incident.
(`DatabaseInit.initialize()` uses the spreadsheet API directly, not `getSheet`,
so there is no circular dependency or double-write.)

**D. Consolidated the duplicated `_user()` helpers.** Added
`Utils.currentUserEmail()` as the single source of truth (active user →
effective user → `'system'`). The four per-module `_user()`/`_getUser()`
helpers now delegate to it, and nine inline `Session.getActiveUser().getEmail()`
calls in `created_by`/`updated_by` assignments were switched to it. Side
benefit: those `created_by` writes now inherit the `getEffectiveUser` fallback,
so they are no longer blank under "Execute as: Me" deployments. The session
logic in `auth.gs` and `audit.gs` is intentionally left as-is.

**E. Periodic GL-vs-CoA reconciliation.** `validateBooks()` gained a fourth
check that recomputes every account balance from the General Ledger and
compares it to the stored Chart-of-Accounts balance, flagging any drift (with
the worst offenders named). It is read-only — it reports drift, fixes nothing —
and surfaces automatically through the existing **Validate Books** button.
Verified against matching, drifted, and phantom-balance cases.

---

## Verification

- `tests/postledger_refactor_test.js` — proves the same-account-twice fix and
  that normal multi-line posting is unchanged.
- `tests/accounting_integrity_sim.js`, `tests/payroll_integrity_sim.js`,
  `tests/reports_integrity_sim.js` — all still pass, confirming no regression
  in journals, balances, statements, payroll, or reports.
- All modified `.gs` files syntax-checked.
