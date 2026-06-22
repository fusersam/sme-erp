# Business Workflows

## SME Business Manager — Operational Workflows

### 1. Sales Cycle (Order-to-Cash)

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Customer │───>│ Quotation│───>│ Invoice  │───>│ Receipt  │───>│ Reconcile│
│ Created  │    │ (Draft)  │    │ (Sent)   │    │ (Paid)   │    │ (Bank)   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                                     │               │
                                     ▼               ▼
                              ┌──────────────┐ ┌──────────────┐
                              │ Dr: A/R 1300 │ │ Dr: Bank 1210│
                              │ Cr: Rev 4100 │ │ Cr: A/R 1300 │
                              │ Cr: VAT 2210 │ └──────────────┘
                              └──────────────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │ Inventory    │
                              │ Qty reduced  │
                              │ COGS posted  │
                              └──────────────┘
```

**Steps**:
1. **Create Customer**: Add customer with contact details and payment terms.
2. **Create Quotation** (optional): Draft quote for customer review. Not posted to accounts.
3. **Create Invoice**: Convert quote or create directly. Status = `Draft`.
4. **Send Invoice**: Status changes to `Sent`. Accounting entries posted automatically:
   - Dr Accounts Receivable (1300) for the total amount
   - Cr Sales Revenue (4100) for the subtotal
   - Cr VAT Payable (2210) for the tax amount
   - Inventory reduced and COGS (5000) posted for product items
5. **Receive Payment**: Create receipt allocated against the invoice.
   - Dr Cash/Bank (1100/1210)
   - Cr Accounts Receivable (1300)
   - Invoice status updates: `Partial` or `Paid` based on balance.
6. **Bank Reconciliation**: Match receipt to bank statement entry.

**Overdue Handling**: A daily/manual check flags invoices past due_date with status = `Overdue`. Dashboard alerts surface these.

---

### 2. Purchasing Cycle (Procure-to-Pay)

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Supplier │───>│ Purchase │───>│ Goods    │───>│ Supplier │───>│ Payment  │
│ Created  │    │ Order    │    │ Received │    │ Bill     │    │ Made     │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                                     │               │               │
                                     ▼               ▼               ▼
                              ┌──────────┐    ┌──────────┐    ┌──────────┐
                              │ Inventory│    │ Dr: Inv  │    │ Dr: A/P  │
                              │ Qty added│    │    1400  │    │    2100  │
                              └──────────┘    │ Cr: A/P  │    │ Cr: Bank │
                                              │    2100  │    │    1210  │
                                              └──────────┘    └──────────┘
```

**Steps**:
1. **Create Supplier**: Add supplier with contact and payment terms.
2. **Create Purchase Order**: List items, quantities, and costs. Status = `Draft`.
3. **Send PO**: Status = `Sent`. No accounting entries yet.
4. **Receive Goods**: Record goods received against PO. Partial receipts supported.
   - Inventory `quantity_on_hand` increased.
   - InventoryTransaction recorded (type = `Purchase`).
5. **Record Supplier Bill**: When goods are fully received, status = `Received`. Accounting entries:
   - Dr Inventory (1400) or Expense (6xxx) for the amount
   - Cr Accounts Payable (2100)
6. **Make Payment**: Record payment to supplier.
   - Dr Accounts Payable (2100)
   - Cr Cash/Bank (1100/1210)
   - PO status = `Closed`.

---

### 3. Expense Management

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Record   │───>│ Submit   │───>│ Approve  │───>│ Pay /    │
│ Expense  │    │ (Pending)│    │ (Approved│    │ Journal  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                      │
                                                      ▼
                                               ┌──────────────┐
                                               │ Dr: Expense  │
                                               │    6xxx      │
                                               │ Cr: Cash/Bank│
                                               │    1100/1210 │
                                               └──────────────┘
```

**Steps**:
1. **Record Expense**: Enter date, category, amount, payment method. Attach receipt (Google Drive link).
2. **Submit for Approval**: Status = `Pending`. (Optional workflow; small teams may skip.)
3. **Approve**: Authorised user approves. Status = `Approved`.
4. **Post**: Accounting entries created:
   - Dr Expense Account (6xxx, mapped by category)
   - Cr Cash or Bank (1100/1210)
   - Cashbook entry created.

**Recurring Expenses**: Marked with `is_recurring = true` and `recurrence_period`. System can auto-generate at period start.

---

### 4. Payroll Processing

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Employee │──>│ Preview  │──>│ Process  │──>│ Pay Net  │   │ (Period  │
│ Setup    │   │ (Draft)  │   │ & Post   │   │ Salaries │   │  Close)  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
                                    │                  │
                                    ▼                  ▼
                  ┌───────────────────────────┐  ┌──────────────────────┐
                  │ Dr: Salaries (6100) gross │  │ Dr: Net Sal Pay 2240 │
                  │ Dr: Emp Pension (6110)    │  │ Cr: Bank/Cash 1210   │
                  │ Cr: PAYE Payable (2220)   │  └──────────────────────┘
                  │ Cr: Pension Payable (2230)│
                  │ Cr: Net Salary Pay (2240) │
                  └───────────────────────────┘
```

**Statutory calculation (Ghana)**:
- **SSNIT** — employee 5.5% and employer 13% of **basic salary** (not
  allowances), capped at the monthly insurable-earnings ceiling
  (`ssnit_monthly_cap`, default GHS 61,000).
- **PAYE** — progressive bands applied to **chargeable income** = gross pay
  less the employee SSNIT contribution (SSNIT is deducted before PAYE, per
  GRA rules). Bands are configurable via the `paye_bands` setting; the
  default is the 2026 monthly GRA schedule.
- **Net pay** = gross − employee SSNIT − PAYE − other deductions.
- All rates/bands/cap live in Settings, so changes to GRA/SSNIT figures
  need no code edits.

**Steps**:
1. **Employee Setup** — add the employee with basic salary, allowances
   (transport / housing / other), SSNIT and PAYE toggles, bank details, TIN
   and SSNIT number. A Salary Structure can be applied as a template.
2. **Preview** — Payroll Runs → pick a period (`yyyy-MM`) → **Preview**.
   The system calculates every active employee and shows gross, SSNIT, PAYE,
   and net per employee plus run totals. Nothing is saved.
3. **Process & Post** — **Process** persists the Payroll header and one
   PayrollDetails payslip per employee, then posts the payroll journal:
   ```
   Dr Salary & Wages (6100)               total gross
   Dr Employer Pension Contribution (6110) total employer SSNIT
      Cr PAYE Payable (2220)               total PAYE
      Cr Pension Payable (2230)            employee + employer SSNIT
      Cr Net Salary Payable (2240)         total net pay
      Cr Accrued Expenses (2300)           other deductions (if any)
   ```
   The debits (cost to company) equal the credits (statutory liabilities +
   wages owed), so the journal is always balanced.
4. **Pay Net Salaries** — from the run detail, post the disbursement:
   ```
   Dr Net Salary Payable (2240)   total net
      Cr Bank / Cash (1210/1100)        total net
   ```
   This clears the wages-owed liability. The PAYE Payable and Pension Payable
   liabilities remain until remitted to GRA and SSNIT.
5. **Statutory remittance** (manual journal until automated) — when PAYE and
   SSNIT are paid over:
   ```
   Dr PAYE Payable (2220) / Pension Payable (2230)
      Cr Bank (1210)
   ```

**Duplicate guard**: a period already `Processed` cannot be processed again.

---

### 5. Inventory Management

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│ Product  │───>│ Stock In │───>│ Stock Out│
│ Created  │    │ (PO/Adj) │    │ (Sale/Adj│
└──────────┘    └──────────┘    └──────────┘
                     │               │
                     ▼               ▼
              ┌──────────────────────────────┐
              │     InventoryTransactions     │
              │  Type: Purchase/Sale/Adjust/  │
              │  Return/Transfer/Damage       │
              └──────────────────────────────┘
                           │
                           ▼
              ┌──────────────────────────────┐
              │   quantity_on_hand updated   │
              │   Alerts: Low / Negative     │
              └──────────────────────────────┘
```

**Transaction types**:
- **Purchase**: Goods received from PO. Qty increases.
- **Sale**: Invoice line items. Qty decreases.
- **Adjustment**: Manual stock count corrections.
- **Return (Customer)**: Returned goods. Qty increases.
- **Return (Supplier)**: Returned to supplier. Qty decreases.
- **Transfer**: Between locations.
- **Damage**: Write-off damaged goods.

**Valuation**: Configurable per product — FIFO or Weighted Average.

**Alerts**: Products with `quantity_on_hand <= reorder_level` appear on dashboard alerts.

---

### 6. Fixed Asset Lifecycle

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Purchase │───>│ Register │───>│ Monthly  │───>│ Dispose  │
│ Asset    │    │ in Assets│    │ Deprec.  │    │ or Write │
└──────────┘    └──────────┘    └──────────┘    │ Off      │
     │                              │           └──────────┘
     ▼                              ▼                │
┌──────────┐              ┌──────────────┐           ▼
│Dr: Asset │              │Dr: Dep Exp   │    ┌──────────────┐
│   16xx   │              │    6700      │    │Dr: Accum Dep │
│Cr: Bank  │              │Cr: Accum Dep │    │Dr: Cash(sale)│
│   1210   │              │    1690      │    │Cr: Asset     │
└──────────┘              └──────────────┘    │Cr/Dr: Gain/  │
                                              │  Loss on     │
                                              │  Disposal    │
                                              └──────────────┘
```

**Steps**:
1. **Purchase**: Record asset with cost, useful life, salvage value, depreciation method.
2. **Register**: Create asset record. Journal entry: Dr Fixed Asset, Cr Cash/Bank.
3. **Monthly Depreciation**: Calculate depreciation charge.
   - Straight-line: (Cost - Salvage) / Useful Life / 12
   - Reducing balance: NBV × Rate / 12
   - Journal: Dr Depreciation Expense (6700), Cr Accumulated Depreciation (1690).
4. **Disposal**: Remove asset from active register.
   - Clear accumulated depreciation against asset cost.
   - Record sale proceeds (if any).
   - Recognise gain or loss on disposal.

---

### 7. Period-End Closing

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Enter &  │───>│ Validate │───>│ Generate │───>│ Close    │
│ Post all │    │ Books    │    │ Reports  │    │ Period   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

**Monthly close (implemented)**:
1. Ensure all transactions for the period are entered and posted.
2. Accounting → **Validate Books** confirms three integrity checks pass:
   - Trial balance: total debits = total credits
   - Balance sheet: Assets = Liabilities + Equity
   - Every journal entry is internally balanced
3. Generate the **Profit & Loss** and **Balance Sheet** (Financial Statements tab).
4. Accounting → **Periods → Close Period**. This:
   - Computes the period P&L from the General Ledger.
   - Posts a closing journal that zeroes every Revenue, COGS, and Expense
     account by reversing its actual net debit/credit movement (this works
     for both normal and contra accounts such as Sales Returns).
   - Transfers the net result to Retained Earnings (3200): a profit is
     credited, a loss is debited.
   - Marks the period `Closed` in the `AccountingPeriods` sheet.

**Period lock**: once a period is closed, `createJournalEntry` rejects any
entry dated within it. This blocks backdated postings from every module
(invoices, receipts, inventory events, manual journals).

**Reopening (Admin only)**: Periods → Reopen reverses the closing journal
and sets the period back to `Open`, allowing corrections. A reason is
required and recorded for the audit trail.

**Closing journal example** — month with GHS 1,000 revenue, GHS 600 COGS,
GHS 300 expenses (net profit GHS 100):

```
Dr Sales Revenue (4100)        1,000
   Cr Cost of Goods Sold (5000)         600
   Cr Operating Expenses (6xxx)         300
   Cr Retained Earnings (3200)          100
```

After posting, all P&L accounts read zero and the profit has moved
permanently into equity.

---

### 8. Manual Journal Entry

```
Accountant ──> New Journal Entry ──> Add lines ──> Balanced? ──> Post
                                          │             │
                                          │             └─ No → Post disabled
                                          └─ live Dr/Cr totals shown
```

**Steps**:
1. Accounting → **Journal Entries → New Journal Entry**.
2. Set date and description.
3. Add at least two lines, each selecting a Chart of Accounts entry and a
   debit *or* credit amount.
4. The modal shows running debit and credit totals; the **Post** button is
   enabled only when debits equal credits and at least one amount is non-zero.
5. Posting routes through `AccountingEngine.postManualJournal`, which writes
   to `JournalEntries`, posts to the `GeneralLedger`, updates Chart of
   Accounts balances, and logs to the audit trail.

Manual entries cannot be edited after posting — use **reversal** (a mirror
entry) to correct a mistake, preserving the full audit trail.

---

### 9. Bank Reconciliation

```
┌──────────────┐         ┌──────────────┐
│  Cashbook    │         │ Bank         │
│  Entries     │◄───────►│ Statement    │
│ (Internal)   │  Match  │ (Imported)   │
└──────────────┘         └──────────────┘
        │                        │
        ▼                        ▼
┌────────────────────────────────────────┐
│         Reconciliation Screen          │
│  Matched items    │  Unmatched items   │
│  (Reconciled)     │  (Outstanding)     │
└────────────────────────────────────────┘
```

**Steps**:
1. Enter bank statement transactions (or import from CSV in future).
2. Match each bank transaction to a cashbook entry by reference/amount/date.
3. Mark matched pairs as `reconciled = true`.
4. Investigate and resolve unmatched items (timing differences, errors, bank charges).
5. Ensure closing bank balance agrees with cashbook balance.

---

### 10. Inventory Lifecycle

#### 9a. Product Setup

```
New Product Created → Opening Qty > 0?
                         │ Yes
                         ▼
                  ┌─────────────────────┐
                  │ Opening Stock Entry  │
                  │ Dr: Inventory  1400  │
                  │ Cr: Ret. Earn. 3200  │
                  └──────────┬──────────┘
                             │
                             ▼
                  FIFO Layer Created (qty, cost, date)
                  Weighted Avg cost_price set on product
```

#### 9b. Stock Received (Purchase)

```
Purchase Confirmed
      │
      ▼
InventoryService.recordPurchase()
      │
      ├── Valuation = FIFO?   → Add new cost layer to InventoryFIFOLayers
      │
      └── Valuation = WA?     → Recalculate weighted average cost_price
                                 new_avg = (old_qty × old_avg + new_qty × new_cost)
                                           ─────────────────────────────────────────
                                                     old_qty + new_qty
      ↓
InventoryTransactions row written (type: 'Purchase')
```

#### 9c. Stock Sold (Invoice → FIFO/WA COGS)

```
Invoice.send() called
      │
      ├── AccountingEngine.postInvoice()
      │     Dr A/R (1300)    Cr Revenue (4100)    Cr VAT (2210)
      │
      └── For each product line item:
            InventoryService.recordSale()
                  │
                  ├── FIFO: _consumeFIFOLayers(productId, qty)
                  │         Oldest batches consumed first
                  │         avgUnitCost = totalCostConsumed / qty
                  │
                  └── WA:   unitCost = product.cost_price (current avg)
                  │
                  ▼
            AccountingEngine.postCOGS()
                  Dr COGS (5000)   Cr Inventory (1400)
```

#### 9d. Stock Adjustment

```
User enters physical count or variance
      │
      ▼
InventoryService.adjust(params)
      │
      ├── Variance > 0  → Adjustment In
      │     Dr Inventory (1400)
      │     Cr Inventory Adjustments (5400)
      │
      └── Variance < 0  → Adjustment Out
            Dr Inventory Adjustments (5400)
            Cr Inventory (1400)

FIFO layers updated if applicable
InventoryTransactions row written
```

#### 9e. Damage / Write-off

```
Goods found damaged or spoiled
      │
      ▼
InventoryService.recordDamage(params)
      │
      ├── FIFO layers consumed (oldest first)
      ├── Dr Inventory Write-off Loss (6980)
      │   Cr Inventory (1400)
      └── InventoryTransactions row: type = 'Damage'
```

#### 9f. Location Transfer

```
Stock moved between warehouses / locations
      │
      ▼
InventoryService.recordTransfer(params)
      │
      ├── No accounting entry (location change only)
      ├── Product.location updated if matches source
      └── InventoryTransactions row: type = 'Transfer' (qty = 0)
```

#### 9g. Customer Return

```
Customer returns goods
      │
      ▼
InventoryService.recordCustomerReturn(params)
      │
      ├── Inventory restored: Dr Inventory (1400)  Cr COGS (5000)
      ├── Revenue reversed:   Dr Sales Returns (4600)  Cr A/R (1300)
      ├── FIFO layer added back (at original cost)
      └── InventoryTransactions row: type = 'Customer Return'
```

#### 9h. Supplier Return

```
Goods returned to supplier
      │
      ▼
InventoryService.recordSupplierReturn(params)
      │
      ├── Dr Accounts Payable (2100)  Cr Inventory (1400)
      ├── FIFO layers consumed
      └── InventoryTransactions row: type = 'Supplier Return'
```

---

### 11. Reporting & Analytics

```
            ┌──────────────────────────────────────────┐
            │            General Ledger                │
            │   (single source of truth, balanced)     │
            └────────────────────┬─────────────────────┘
                                 │
          ┌──────────────┬───────┴───────┬──────────────┐
          ▼              ▼               ▼              ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
    │   P&L    │   │ Balance  │   │  Cash    │   │  Trial   │
    │          │   │  Sheet   │   │  Flow    │   │ Balance  │
    └──────────┘   └──────────┘   └──────────┘   └──────────┘
                                 │
                          ┌──────┴───────┐
                          ▼              ▼
                  ┌──────────────┐  ┌──────────────┐
                  │  Financial   │  │  Operational │
                  │   Ratios     │  │   Reports    │
                  │ (analytics)  │  │ (aging, inv, │
                  └──────────────┘  │  payroll)    │
                                    └──────────────┘
```

**Principle**: every financial statement derives from the General Ledger via
the accounting engine. The reporting module orchestrates these primitives and
adds analytics; it never recomputes balances independently. If **Validate
Books** passes, all reports rest on balanced data.

**Reports**:
- **Financial statements** — P&L, Balance Sheet, Cash Flow (indirect method,
  self-reconciling against actual cash movement), Trial Balance, General Ledger.
- **Aging** — Accounts Receivable (from open invoices) and Accounts Payable
  (from open purchase orders), bucketed Current / 1–30 / 31–60 / 61–90 / 90+.
- **Inventory** — valuation (qty × cost, by product) and low-stock.
- **Payroll** — summary across runs, statutory remittance (PAYE to GRA + SSNIT),
  and cost by department.

**SME financial ratios**:
- **Liquidity** — current ratio, quick ratio.
- **Profitability** — gross margin, net margin, return on assets.
- **Efficiency** — inventory turnover, receivable days, payable days, asset turnover.
- **Cash flow** — operating cash flow, free cash flow, burn rate, cash runway.

All ratios use safe division: a denominator of zero yields `n/a`, never an
error or infinity.

**Analytics dashboard**: ratio KPI cards plus profitability-margin and
efficiency charts, refreshable over any date range.
