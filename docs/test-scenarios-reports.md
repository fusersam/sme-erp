# Reporting & Analytics — Test Scenarios

Manual test scenarios for the reporting and analytics module, plus notes on
the automated simulation. All amounts in GHS.

The module produces these reports:

| Group | Report |
|-------|--------|
| Financial | Profit & Loss, Balance Sheet, Cash Flow Statement, Trial Balance, General Ledger |
| Receivables | Accounts Receivable Aging |
| Payables | Accounts Payable Aging |
| Inventory | Inventory Valuation, Low Stock |
| Payroll | Payroll Summary, Statutory Remittance, Payroll by Department |
| Analytics | Financial Ratios |

---

## Automated simulation

`tests/reports_integrity_sim.js` verifies the cash flow indirect method
reconciles to the actual cash movement and the ratios compute correctly. Run:

```
node tests/reports_integrity_sim.js
```

Expected: every line prefixed with `✓`, ending in
`=== ALL REPORT SCENARIOS COMPLETE ===`.

---

## Manual scenario 1 — Report catalog

1. Open **Reports** from the sidebar (under Insights).

**Expected**: a date-range filter at the top and report cards grouped by
Financial, Receivables, Payables, Inventory, Payroll, and Analytics.

---

## Manual scenario 2 — Profit & Loss

1. Set Period Start to the start of the year and End to today.
2. Click **Profit & Loss Statement**.

**Expected**: revenue, COGS (→ gross profit), expenses (→ net profit), with
gross and net margin percentages in the header. The figures match the
Financial Statements tab in Accounting for the same range.

---

## Manual scenario 3 — Cash Flow Statement

1. Click **Cash Flow Statement** with a date range covering some activity.

**Expected**: three sections — Operating, Investing, Financing — each with a
subtotal, then Net Change in Cash. The header shows a **Reconciled** badge
when the net change equals the actual cash/bank movement for the period.
If it shows a difference instead, that signals a posting that bypassed the
cash accounts and is worth investigating.

**Check**: the Net Change in Cash should equal the change in the bank/cash
account balances between the start and end dates.

---

## Manual scenario 4 — Balance Sheet & Trial Balance

1. Click **Balance Sheet** (uses the End date as "as of").
2. Confirm the **Balanced** badge (Assets = Liabilities + Equity).
3. Click **Trial Balance** and confirm its **Balanced** badge.

---

## Manual scenario 5 — General Ledger

1. Click **General Ledger** with a date range.

**Expected**: one card per active account showing opening balance, the line
entries in the range, and the closing balance.

---

## Manual scenario 6 — AR and AP Aging

1. Click **Accounts Receivable Aging**.

**Expected**: a bucket summary (Current / 1–30 / 31–60 / 61–90 / 90+) with a
total, then a detail table of outstanding invoices with days overdue.

2. Click **Accounts Payable Aging** — same layout for outstanding purchase
orders by supplier.

---

## Manual scenario 7 — Inventory reports

1. Click **Inventory Valuation** — every product with quantity, unit cost,
   and stock value, plus a grand total.
2. Click **Low Stock Report** — out-of-stock (red) and low-stock (amber) items
   with their reorder levels.

---

## Manual scenario 8 — Payroll reports

(Requires at least one processed payroll run — see the payroll test scenarios.)

1. Click **Payroll Summary** — one row per run in the range with gross, PAYE,
   SSNIT, and net, plus totals.
2. Click **Statutory Remittance** — PAYE owed to GRA and SSNIT (employee +
   employer) per period, with totals. This is what must be remitted.
3. Click **Payroll Cost by Department** — gross/PAYE/net grouped by the
   employees' departments.

---

## Manual scenario 9 — Financial Ratios

1. Click **Financial Ratios**.

**Expected**: four panels.
- **Liquidity**: current ratio, quick ratio.
- **Profitability**: gross margin, net margin, return on assets.
- **Efficiency**: inventory turnover, receivable days, payable days, asset turnover.
- **Cash Flow**: operating cash flow, free cash flow, burn rate, cash runway.

Ratios that would divide by zero (e.g. quick ratio with no current
liabilities) show **n/a** rather than an error or infinity.

---

## Manual scenario 10 — Analytics dashboard

1. Open **Analytics & Ratios** from the sidebar.

**Expected**:
- KPI cards for current ratio, net margin, ROA, and cash runway.
- A **Profitability Margins** bar chart (gross / net / ROA).
- An **Efficiency** horizontal bar chart (receivable days / payable days).
- The full ratios table below.

2. Change the date range and click **Refresh** — all cards, charts, and the
   table update for the new period.

---

## Cross-check: reports agree with the ledger

The reporting module never computes balances independently — every financial
statement is derived from the General Ledger through the accounting engine.
So if **Validate Books** (Accounting → Trial Balance) passes, the P&L,
Balance Sheet, Cash Flow, and ratios are all built on balanced data. Running
Validate Books first is the quickest integrity gate before trusting any
report.
