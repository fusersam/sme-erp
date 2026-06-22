# Accounting Engine — Test Scenarios

This document provides manual test scenarios to verify the double-entry
accounting engine, plus notes on the automated integrity simulation.

All amounts are in GHS. Account codes referenced:

| Code | Account | Type | Normal |
|------|---------|------|--------|
| 1100 | Cash on Hand | Asset | Debit |
| 1210 | Main Bank Account | Asset | Debit |
| 1300 | Accounts Receivable | Asset | Debit |
| 1400 | Inventory | Asset | Debit |
| 2100 | Accounts Payable | Liability | Credit |
| 2210 | VAT Payable | Liability | Credit |
| 3200 | Retained Earnings | Equity | Credit |
| 4100 | Sales Revenue | Revenue | Credit |
| 4600 | Sales Returns | Revenue | Debit (contra) |
| 5000 | Cost of Goods Sold | COGS | Debit |
| 5400 | Inventory Adjustments | COGS | Debit |
| 6xxx | Operating Expenses | Expense | Debit |
| 6980 | Inventory Write-off Loss | Expense | Debit |

---

## Automated integrity simulation

`tests/accounting_integrity_sim.js` is a self-contained Node simulation of
the engine's posting, trial-balance, balance-sheet, and period-close logic.
It runs five scenarios with 14 assertions covering trial-balance balance,
balance-sheet balance (including contra accounts), period close, period lock,
and unbalanced-entry rejection.

Run it with:

```
node tests/accounting_integrity_sim.js
```

Expected: every line prefixed with `✓`, ending in `=== ALL SCENARIOS COMPLETE ===`.

> The simulation originally surfaced a real defect: contra-revenue
> (Sales Returns) was being added to income instead of subtracted, which
> unbalanced the Balance Sheet. The fix is in `getProfitAndLoss`,
> `getBalanceSheet`, and `closePeriod`.

---

## Manual scenario 1 — Sales invoice posts correctly

**Setup**: one product with stock on hand, one customer.

**Steps**:
1. Create and send an invoice for GHS 1,150 (subtotal 1,000 + VAT 150).
2. Open Accounting → Journal Entries.

**Expected journal** (Invoice Sent):
```
Dr Accounts Receivable (1300)   1,150
   Cr Sales Revenue (4100)              1,000
   Cr VAT Payable (2210)                  150
```
Plus the automatic COGS entry from the inventory module:
```
Dr Cost of Goods Sold (5000)      <cost>
   Cr Inventory (1400)                  <cost>
```

**Verify**: Trial Balance still shows the **Balanced** badge.

---

## Manual scenario 2 — Customer receipt clears the receivable

**Steps**:
1. From the invoice above, record a receipt of GHS 1,150 by Bank Transfer.
2. Open Accounting → Journal Entries.

**Expected journal**:
```
Dr Main Bank Account (1210)     1,150
   Cr Accounts Receivable (1300)        1,150
```

**Verify**: Account 1300 balance returns to its pre-invoice value;
Trial Balance still **Balanced**.

---

## Manual scenario 3 — Manual journal entry, balanced gate

**Steps**:
1. Accounting → Journal Entries → **New Journal Entry**.
2. Date today, description "Office rent accrual".
3. Line 1: Rent Expense (6200) debit 500.
4. Observe the **Post** button is disabled and the indicator reads "Out by 500.00".
5. Line 2: Accounts Payable (2100) credit 500.
6. Indicator now reads **Balanced**; Post becomes enabled.
7. Post.

**Expected**: entry `JE-xxxxxx` appears in the list; Trial Balance **Balanced**.

**Negative test**: try to post with only one line, or with debits ≠ credits —
the engine rejects it (the UI blocks before sending, and the server also
validates).

---

## Manual scenario 4 — Contra account (sales return)

**Steps**:
1. Record a customer return of goods (cost 120, selling price 230).

**Expected journals**:
```
Dr Inventory (1400)              120          (stock restored)
   Cr Cost of Goods Sold (5000)         120
Dr Sales Returns (4600)          230          (revenue reversed)
   Cr Accounts Receivable (1300)        230
```

**Verify**:
- Trial Balance **Balanced**.
- In the **Profit & Loss**, Sales Returns reduces total revenue (it does not
  add to it). Net profit falls by 230 from the sale reversal but rises by 120
  from the COGS reversal.
- **Balance Sheet** still shows the **Balanced** badge.

---

## Manual scenario 5 — General Ledger opening/closing balances

**Steps**:
1. Accounting → General Ledger.
2. Set the date range to the current month and Apply.

**Verify**:
- Each account card shows an **Opening** balance (sum of all activity before
  the range) and a **Closing** balance (opening + in-range movement).
- For an account with no prior activity, Opening = 0.
- The line entries within the card sum to the in-range movement.

---

## Manual scenario 6 — Financial statements balance

**Steps**:
1. Accounting → Financial Statements.
2. Set period start to the start of the year, end to today. Generate.

**Verify**:
- **Profit & Loss** shows Revenue, COGS (→ Gross Profit), Expenses (→ Net
  Profit), with gross and net margin percentages.
- **Balance Sheet** shows Assets, Liabilities, Equity. Current-period earnings
  appear as a line in Equity until the period is closed.
- The Balance Sheet header shows the **Balanced** badge (Assets = Liabilities
  + Equity).

---

## Manual scenario 7 — Period close and lock

**Steps**:
1. Accounting → Periods.
2. Select the current month and **Close Period**, confirm.

**Expected**:
- A toast reports the period closed with its net income.
- A closing journal appears in Journal Entries that zeroes the P&L accounts
  and moves the net to Retained Earnings (3200).
- The period appears in the history table as **Closed**.

**Lock test**:
3. Try to send a new invoice dated within the closed month, or post a manual
   journal dated within it.

**Expected**: the operation is rejected with a message that the period is
closed.

**Open-period control**:
4. Post an entry dated in the *next* (open) month — it succeeds.

---

## Manual scenario 8 — Period reopen (Admin)

**Steps** (as an Administrator):
1. Accounting → Periods → **Reopen** on the closed period.
2. Enter a reason and confirm.

**Expected**:
- The closing journal is reversed (a REVERSAL entry appears).
- The period status returns to **Open**.
- Backdated postings into that month are accepted again.
- Trial Balance and Balance Sheet remain **Balanced** throughout.

---

## Manual scenario 9 — Validate Books

**Steps**:
1. Accounting → Trial Balance → **Validate Books**.

**Expected**: a modal listing three checks, each with a green tick:
- Trial Balance (Debits = Credits)
- Balance Sheet (Assets = Liabilities + Equity)
- Journal Entries internally balanced

If any check fails, the modal shows the failing check in red with the
discrepancy amount — a quick way to spot a data-entry or import problem.
