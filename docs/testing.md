# Running the Tests

All automated tests are **Node.js simulations** that verify the engine logic
(accounting, payroll, reporting, and the audit refactor). They run outside
Google Apps Script — they do **not** require a deployed app or a spreadsheet.

> ⚠️ These files live in `tests/` and must **never** be added to the Apps Script
> project. They are guarded so they stay inert if imported there, but they are
> development tools only.

## Run everything

```
node tests/run_all.js
```

This runs every suite and prints a single pass/fail summary. Exit code is `0`
only if all suites pass — suitable for CI.

Expected output:

```
✅ PASS  accounting_integrity_sim.js   (12 assertions)
✅ PASS  payroll_integrity_sim.js      (12 assertions)
✅ PASS  postledger_refactor_test.js   (10 assertions)
✅ PASS  reports_integrity_sim.js      (6 assertions)

 Suites: 4 passed, 0 failed   ·   40 assertions total
```

## Run one suite

```
node tests/accounting_integrity_sim.js
node tests/payroll_integrity_sim.js
node tests/reports_integrity_sim.js
node tests/postledger_refactor_test.js
```

## What each suite covers

| Suite | Verifies |
|-------|----------|
| `accounting_integrity_sim.js` | Full sales cycle, expenses/adjustments/returns, period close, period lock, unbalanced-entry rejection — trial balance and balance sheet stay balanced (incl. contra accounts). |
| `payroll_integrity_sim.js` | SSNIT (with the insurable-earnings cap), progressive PAYE bands, full payslip math, and that the payroll journal balances (Dr = Cr). |
| `reports_integrity_sim.js` | Cash flow indirect method reconciles to actual cash movement; financial ratios compute with safe division (no divide-by-zero). |
| `postledger_refactor_test.js` | The audit refactor of `_postToLedger`: same-account-twice chaining (the latent bug fix), unchanged normal posting, and UUID-based ID uniqueness. |

## Relationship to the open recommendations

The suite above covers everything currently implemented. The two open audit
recommendations are **not** part of this suite and do not need to pass before
you run it:

- **A — transactional rollback** for multi-step operations (`invoice.send`).
- **B — unified soft-delete sentinel.**

Both change behaviour, so each should be implemented **together with its own new
tests** (failure-injection tests for A; filter/exclusion tests for B). They are
described in `docs/architecture-audit.md`. When you build them, add their tests
to `tests/` and `run_all.js` will pick them up automatically.

## In-app manual testing

For end-to-end testing in the deployed app, see the scenario docs:
`docs/test-scenarios-accounting.md`, `docs/test-scenarios-payroll.md`, and
`docs/test-scenarios-reports.md`.
