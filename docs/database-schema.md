# Database Schema Documentation

## SME Business Manager — Google Sheets Database

### Overview

The database consists of 31 Google Sheets tabs within a single spreadsheet. Each sheet functions as a relational table with row 1 as headers and data starting from row 2. The `DatabaseInit` service creates, validates, and repairs all sheets non-destructively.

### Conventions

- **Primary keys**: `{entity}_id` columns use UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
- **Document numbers**: Human-readable sequential numbers (e.g., `INV-000001`) stored alongside UUIDs.
- **Timestamps**: `created_at`, `updated_at` use JavaScript `Date` objects (stored as Sheets date values).
- **Status fields**: Enumerated strings (`Active`, `Inactive`, `Draft`, `Paid`, etc.).
- **Foreign keys**: Referenced by ID columns (e.g., `customer_id` in Invoices references Customers).
- **Currency**: All monetary values stored as plain numbers; currency formatting applied at display.

---

### 1. Users

Stores registered application users.

| Column | Type | Description |
|--------|------|-------------|
| user_id | UUID | Primary key |
| email | String | Google account email (unique) |
| name | String | Display name |
| role | String | Role name (FK to Roles.role_name) |
| status | Enum | `Active`, `Inactive`, `Suspended` |
| department | String | Optional department |
| created_at | Date | Registration timestamp |
| last_login | Date | Last successful access |
| created_by | String | Email of registering admin |

**Seed behaviour**: First user auto-registered as Administrator on initial login.

---

### 2. Roles

Defines available system roles.

| Column | Type | Description |
|--------|------|-------------|
| role_id | String | e.g., `R001` |
| role_name | String | Unique role label |
| description | String | Human-readable purpose |
| permissions | String | Comma-separated module names or `all` |
| status | Enum | `Active`, `Inactive` |
| created_at | Date | |
| updated_at | Date | |

**Seeded roles**: Administrator, Accountant, Inventory Officer, Sales Officer, HR Officer, Viewer.

---

### 3. Customers

| Column | Type | Description |
|--------|------|-------------|
| customer_id | UUID | Primary key |
| name | String | Business or individual name |
| email | String | Contact email |
| phone | String | Contact phone |
| address | String | Street address |
| city | String | City |
| region | String | State/region |
| country | String | Country (default: Ghana) |
| tax_id | String | Tax identification number |
| payment_terms | Number | Days (default from Settings) |
| credit_limit | Number | Maximum credit allowed |
| balance | Number | Current outstanding balance |
| status | Enum | `Active`, `Inactive` |
| notes | String | Free text |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | User email |

---

### 4. Suppliers

| Column | Type | Description |
|--------|------|-------------|
| supplier_id | UUID | Primary key |
| name | String | Supplier business name |
| email | String | |
| phone | String | |
| address | String | |
| city | String | |
| region | String | |
| country | String | |
| tax_id | String | |
| payment_terms | Number | Days |
| balance | Number | Amount owed to supplier |
| status | Enum | `Active`, `Inactive` |
| notes | String | |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 5. Products

| Column | Type | Description |
|--------|------|-------------|
| product_id | UUID | Primary key |
| sku | String | Stock-keeping unit (unique) |
| name | String | Product name |
| description | String | |
| category | String | Product category |
| unit | String | e.g., `pcs`, `kg`, `litres` |
| cost_price | Number | Purchase cost per unit |
| unit_price | Number | Selling price per unit |
| tax_rate | Number | Tax percentage |
| quantity_on_hand | Number | Current stock level |
| reorder_level | Number | Low-stock threshold |
| reorder_quantity | Number | Suggested reorder qty |
| supplier_id | UUID | Default supplier (FK) |
| location | String | Warehouse/shelf location |
| valuation_method | Enum | `fifo`, `weighted_average` |
| status | Enum | `Active`, `Inactive`, `Discontinued` |
| image_url | String | Google Drive image link |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 6. InventoryTransactions

Records every stock movement.

| Column | Type | Description |
|--------|------|-------------|
| transaction_id | UUID | Primary key |
| date | Date | Transaction date |
| product_id | UUID | FK to Products |
| product_name | String | Denormalised for reporting |
| type | Enum | `Purchase`, `Sale`, `Adjustment`, `Return`, `Transfer`, `Damage` |
| quantity | Number | Positive = in, negative = out |
| unit_cost | Number | Cost per unit at time of transaction |
| total_cost | Number | quantity × unit_cost |
| reference_type | String | Source document type (e.g., `Invoice`, `PO`) |
| reference_id | UUID | Source document ID |
| location_from | String | For transfers |
| location_to | String | For transfers |
| notes | String | |
| created_at | Date | |
| created_by | String | |

---

### 7. Quotations

Sales quotations (no accounting impact until converted to invoice).

| Column | Type | Description |
|--------|------|-------------|
| quotation_id | UUID | Primary key |
| quotation_number | String | Sequential (e.g., `QUO-00001`) |
| date | Date | Quotation date |
| expiry_date | Date | Validity expiry |
| customer_id | UUID | FK to Customers |
| customer_name | String | Denormalised |
| subtotal | Number | |
| tax_amount | Number | |
| discount_amount | Number | |
| total | Number | |
| status | Enum | `Draft`, `Sent`, `Accepted`, `Converted`, `Expired`, `Cancelled` |
| notes | String | |
| converted_invoice_id | UUID | FK to Invoices (set on conversion) |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 8. QuotationItems

Line items for quotations.

| Column | Type | Description |
|--------|------|-------------|
| item_id | UUID | Primary key |
| quotation_id | UUID | FK to Quotations |
| product_id | UUID | FK to Products |
| product_name | String | |
| description | String | |
| quantity | Number | |
| unit_price | Number | |
| discount_percent | Number | |
| tax_rate | Number | |
| tax_amount | Number | |
| line_total | Number | |
| created_at | Date | |

---

### 7. ProductCategories

Product taxonomy / grouping.

| Column | Type | Description |
|--------|------|-------------|
| category_id | String | Primary key (e.g., `CATxxxxxxxx`) |
| name | String | Category name (unique) |
| description | String | |
| status | Enum | `Active`, `Inactive` |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 8. InventoryFIFOLayers

Per-batch FIFO cost layers for inventory valuation.
One row per purchase/stock-in event. Consumed oldest-first on outflows.

| Column | Type | Description |
|--------|------|-------------|
| layer_id | UUID | Primary key |
| product_id | String | FK to Products |
| product_name | String | Denormalised |
| date | Date | Receipt date (determines FIFO order) |
| quantity_in | Number | Units in this batch |
| quantity_remaining | Number | Unconsumed units (decrements on outflow) |
| unit_cost | Number | Cost per unit in this batch |
| reference_type | String | e.g., `Purchase`, `Opening Stock`, `Adjustment` |
| reference_id | String | FK to source document |
| created_at | Date | |

---

### 9. Invoices

Sales invoice headers.

| Column | Type | Description |
|--------|------|-------------|
| invoice_id | UUID | Primary key |
| invoice_number | String | Sequential (e.g., `INV-000001`) |
| date | Date | Invoice date |
| due_date | Date | Payment due date |
| customer_id | UUID | FK to Customers |
| customer_name | String | Denormalised |
| subtotal | Number | Sum of line totals before tax |
| tax_amount | Number | Total tax |
| discount_amount | Number | Total discount |
| total | Number | subtotal + tax - discount |
| amount_paid | Number | Cumulative payments received |
| balance_due | Number | total - amount_paid |
| status | Enum | `Draft`, `Sent`, `Partial`, `Paid`, `Overdue`, `Cancelled` |
| payment_terms | Number | Days |
| notes | String | |
| journal_ref | String | Journal entry number |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 10. InvoiceItems

Line items for each invoice.

| Column | Type | Description |
|--------|------|-------------|
| item_id | UUID | Primary key |
| invoice_id | UUID | FK to Invoices |
| product_id | UUID | FK to Products |
| product_name | String | |
| description | String | |
| quantity | Number | |
| unit_price | Number | |
| discount_percent | Number | |
| tax_rate | Number | |
| tax_amount | Number | |
| line_total | Number | (qty × price) - discount + tax |
| created_at | Date | |

---

### 11. Receipts

Customer payments against invoices.

| Column | Type | Description |
|--------|------|-------------|
| receipt_id | UUID | Primary key |
| receipt_number | String | Sequential (e.g., `REC-000001`) |
| date | Date | |
| customer_id | UUID | FK |
| customer_name | String | |
| invoice_id | UUID | FK to allocated invoice |
| amount | Number | Payment amount |
| payment_method | Enum | `Cash`, `Bank Transfer`, `Mobile Money`, `Cheque`, `Card` |
| reference | String | Transaction reference |
| bank_account | String | Receiving bank account |
| notes | String | |
| journal_ref | String | |
| status | Enum | `Completed`, `Reversed` |
| created_at | Date | |
| created_by | String | |

---

### 12. PurchaseOrders

| Column | Type | Description |
|--------|------|-------------|
| po_id | UUID | Primary key |
| po_number | String | Sequential (e.g., `PO-000001`) |
| date | Date | |
| expected_date | Date | Expected delivery |
| supplier_id | UUID | FK |
| supplier_name | String | |
| subtotal | Number | |
| tax_amount | Number | |
| discount_amount | Number | |
| total | Number | |
| amount_paid | Number | |
| balance_due | Number | |
| status | Enum | `Draft`, `Sent`, `Partial`, `Received`, `Closed`, `Cancelled` |
| payment_terms | Number | |
| notes | String | |
| journal_ref | String | |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 13. PurchaseItems

| Column | Type | Description |
|--------|------|-------------|
| item_id | UUID | Primary key |
| po_id | UUID | FK |
| product_id | UUID | FK |
| product_name | String | |
| description | String | |
| quantity_ordered | Number | |
| quantity_received | Number | |
| unit_cost | Number | |
| discount_percent | Number | |
| tax_rate | Number | |
| tax_amount | Number | |
| line_total | Number | |
| created_at | Date | |

---

### 14. Expenses

| Column | Type | Description |
|--------|------|-------------|
| expense_id | UUID | Primary key |
| date | Date | |
| category | String | Expense category |
| account_code | String | FK to ChartOfAccounts |
| description | String | |
| amount | Number | Gross amount |
| tax_amount | Number | |
| net_amount | Number | |
| payment_method | Enum | `Cash`, `Bank Transfer`, `Mobile Money`, `Cheque`, `Card` |
| reference | String | |
| supplier_id | UUID | Optional FK |
| supplier_name | String | |
| receipt_url | String | Google Drive attachment link |
| status | Enum | `Draft`, `Pending`, `Approved`, `Rejected`, `Paid` |
| approved_by | String | Approver email |
| is_recurring | Boolean | |
| recurrence_period | String | `Weekly`, `Monthly`, `Quarterly`, `Yearly` |
| journal_ref | String | |
| notes | String | |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 15. Cashbook

| Column | Type | Description |
|--------|------|-------------|
| entry_id | UUID | Primary key |
| date | Date | |
| type | Enum | `Receipt`, `Payment`, `Transfer` |
| category | String | |
| description | String | |
| reference | String | |
| debit | Number | Money in |
| credit | Number | Money out |
| balance | Number | Running balance |
| payment_method | String | |
| account | String | Cash/bank account name |
| journal_ref | String | |
| reconciled | Boolean | |
| reconciled_date | Date | |
| notes | String | |
| created_at | Date | |
| created_by | String | |

---

### 16. BankTransactions

Bank statement entries for reconciliation.

| Column | Type | Description |
|--------|------|-------------|
| transaction_id | UUID | Primary key |
| date | Date | |
| bank_account | String | Account name |
| type | Enum | `Deposit`, `Withdrawal`, `Transfer`, `Fee`, `Interest` |
| description | String | |
| reference | String | |
| debit | Number | |
| credit | Number | |
| balance | Number | Statement balance |
| statement_ref | String | Statement number |
| reconciled | Boolean | |
| reconciled_date | Date | |
| cashbook_entry_id | UUID | Matched cashbook entry |
| notes | String | |
| created_at | Date | |
| created_by | String | |

---

### 17. Employees

| Column | Type | Description |
|--------|------|-------------|
| employee_id | UUID | Primary key |
| employee_number | String | Sequential (e.g., `EMP-0001`) |
| first_name | String | |
| last_name | String | |
| email | String | Unique |
| phone | String | |
| address | String | |
| date_of_birth | Date | |
| hire_date | Date | |
| department | String | |
| position | String | Job title |
| employment_type | Enum | `Full-time`, `Part-time`, `Contract` |
| basic_salary | Number | Monthly basic pay |
| structure_id | UUID | FK to SalaryStructures (optional template) |
| transport_allowance | Number | Monthly transport allowance |
| housing_allowance | Number | Monthly housing allowance |
| other_allowance | Number | Other monthly allowance |
| ssnit_applicable | Boolean | Whether SSNIT is deducted (default true) |
| paye_applicable | Boolean | Whether PAYE is deducted (default true) |
| bank_name | String | |
| bank_account | String | |
| tax_id | String | TIN |
| pension_id | String | SSNIT number |
| status | Enum | `Active`, `On Leave`, `Terminated` |
| termination_date | Date | |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 18. SalaryStructures

Reusable pay templates. When an employee is created with a `structure_id`, the structure's amounts are copied as defaults (the employee record then holds its own values, so later edits to the structure do not retroactively change existing employees).

| Column | Type | Description |
|--------|------|-------------|
| structure_id | UUID | Primary key (e.g., `SALxxxxxxxx`) |
| name | String | e.g., "Junior Officer Grade 1" |
| description | String | |
| basic_salary | Number | |
| transport_allowance | Number | |
| housing_allowance | Number | |
| other_allowance | Number | |
| ssnit_applicable | Boolean | |
| paye_applicable | Boolean | |
| status | Enum | `Active`, `Inactive` |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 19. Payroll

Monthly payroll run header.

| Column | Type | Description |
|--------|------|-------------|
| payroll_id | UUID | Primary key |
| period | String | e.g., `2026-06` |
| start_date | Date | First day of period |
| end_date | Date | Last day of period |
| total_gross | Number | Sum of gross pay |
| total_deductions | Number | Sum of all deductions |
| total_net | Number | Sum of net pay |
| total_employer_cost | Number | Gross + employer SSNIT |
| total_paye | Number | Sum of PAYE tax |
| total_pension_employee | Number | Sum of employee SSNIT |
| total_pension_employer | Number | Sum of employer SSNIT |
| employee_count | Number | Employees in this run |
| status | Enum | `Draft`, `Processed`, `Approved`, `Paid` |
| journal_ref | String | Payroll journal entry number |
| processed_by | String | |
| approved_by | String | |
| created_at | Date | |
| updated_at | Date | |

---

### 20. PayrollDetails

Per-employee payslip for each payroll run.

| Column | Type | Description |
|--------|------|-------------|
| detail_id | UUID | Primary key |
| payroll_id | UUID | FK to Payroll |
| employee_id | UUID | FK to Employees |
| employee_name | String | Denormalised |
| basic_salary | Number | |
| allowances | Number | transport + housing + other |
| overtime | Number | |
| gross_pay | Number | basic + allowances + overtime |
| ssnit_base | Number | Basic salary used for SSNIT (capped) |
| paye_tax | Number | PAYE income tax |
| pension_employee | Number | Employee SSNIT (5.5%) |
| pension_employer | Number | Employer SSNIT (13%) |
| other_deductions | Number | |
| total_deductions | Number | SSNIT employee + PAYE + other |
| net_pay | Number | gross − total deductions |
| payment_method | String | `Bank Transfer`, `Cash` |
| payment_ref | String | |
| created_at | Date | |

---

### 20. ChartOfAccounts

| Column | Type | Description |
|--------|------|-------------|
| account_code | String | Primary key (e.g., `1300`) |
| account_name | String | |
| account_type | Enum | `Asset`, `Liability`, `Equity`, `Revenue`, `COGS`, `Expense` |
| parent_code | String | Hierarchical parent |
| description | String | |
| normal_balance | Enum | `Debit`, `Credit` |
| is_system | Boolean | Protected from deletion |
| is_active | Boolean | |
| balance | Number | Current balance |
| created_at | Date | |
| updated_at | Date | |

**Seeded**: ~50 accounts following the numbering scheme: Assets 1xxx, Liabilities 2xxx, Equity 3xxx, Revenue 4xxx, COGS 5xxx, Operating Expenses 6xxx.

---

### 21. JournalEntries

Individual debit/credit lines. Multiple rows per journal entry share the same `journal_id`.

| Column | Type | Description |
|--------|------|-------------|
| journal_id | UUID | Groups all lines of one entry |
| entry_number | String | Sequential (e.g., `JE-000001`) |
| date | Date | |
| description | String | |
| reference_type | String | Source module (e.g., `Invoice`, `Receipt`) |
| reference_id | UUID | Source document ID |
| account_code | String | FK to ChartOfAccounts |
| account_name | String | |
| debit | Number | |
| credit | Number | |
| status | Enum | `Draft`, `Posted`, `Reversed` |
| period | String | Fiscal period (e.g., `2026-06`) |
| posted_by | String | |
| approved_by | String | |
| created_at | Date | |
| updated_at | Date | |

**Invariant**: For any `journal_id`, `SUM(debit) = SUM(credit)`.

---

### 22. GeneralLedger

Posted ledger entries with running balances per account.

| Column | Type | Description |
|--------|------|-------------|
| ledger_id | UUID | Primary key |
| date | Date | |
| account_code | String | FK |
| account_name | String | |
| journal_id | UUID | FK to JournalEntries |
| description | String | |
| debit | Number | |
| credit | Number | |
| running_balance | Number | Account balance after this entry |
| period | String | |
| created_at | Date | |

---

### 23. AccountingPeriods

Tracks the open/closed status of each accounting period and the metadata of its closing entry. Used to enforce period locks and to support period reopening.

| Column | Type | Description |
|--------|------|-------------|
| period | String | Primary key, format `yyyy-MM` |
| status | Enum | `Open`, `Closed` |
| closed_by | String | Email of user who closed the period |
| closed_at | Date | Timestamp of closing |
| closing_journal_id | UUID | FK to the closing JournalEntries entry |
| net_income | Number | Net income transferred to Retained Earnings |
| reopened_by | String | Email of user who reopened (if applicable) |
| reopened_at | Date | Timestamp of reopening |
| notes | String | Free-text notes |
| created_at | Date | |
| updated_at | Date | |

**Period lock**: `AccountingEngine.createJournalEntry` rejects any entry dated within a period whose status is `Closed`. Closing a period posts a journal that zeroes all Revenue, COGS, and Expense accounts (handling contra accounts correctly) and credits/debits the net to Retained Earnings (`3200`). Reopening reverses that closing journal and sets the status back to `Open`.

---

### 23. Assets

Fixed asset register.

| Column | Type | Description |
|--------|------|-------------|
| asset_id | UUID | Primary key |
| asset_number | String | Sequential |
| name | String | |
| description | String | |
| category | String | e.g., `Furniture`, `Vehicle`, `IT Equipment` |
| purchase_date | Date | |
| cost | Number | Original purchase cost |
| salvage_value | Number | Estimated residual value |
| useful_life_years | Number | |
| depreciation_method | Enum | `straight_line`, `reducing_balance` |
| accumulated_depreciation | Number | |
| net_book_value | Number | cost - accumulated_depreciation |
| location | String | |
| assigned_to | String | |
| status | Enum | `Active`, `Disposed`, `Written Off` |
| disposal_date | Date | |
| disposal_amount | Number | Sale proceeds |
| journal_ref | String | |
| created_at | Date | |
| updated_at | Date | |
| created_by | String | |

---

### 24. Depreciation

Monthly depreciation schedule entries.

| Column | Type | Description |
|--------|------|-------------|
| depreciation_id | UUID | Primary key |
| asset_id | UUID | FK |
| asset_name | String | |
| period | String | e.g., `2026-06` |
| date | Date | |
| depreciation_amount | Number | Monthly charge |
| accumulated_total | Number | Running total |
| net_book_value | Number | After this charge |
| journal_ref | String | |
| created_at | Date | |

---

### 25. AuditLog

| Column | Type | Description |
|--------|------|-------------|
| log_id | UUID | Primary key |
| timestamp | Date | |
| user_email | String | `SYSTEM` for automated entries |
| module | String | |
| action | String | |
| entity_id | String | ID of affected record |
| details | String | JSON or text (truncated to 1000 chars) |
| client_info | String | Reserved for future use |

---

### 26. Settings

Key-value configuration store.

| Column | Type | Description |
|--------|------|-------------|
| key | String | Primary key (unique) |
| value | String | Setting value |
| description | String | |
| updated_at | Date | |

**Seeded keys** (19): company_name, currency, currency_symbol, default_tax_rate, tax_name, fiscal_year_start_month, default_payment_terms, low_stock_threshold, valuation_method, invoice_prefix, receipt_prefix, po_prefix, pension_employee_rate, pension_employer_rate, depreciation_method, company_address, company_phone, company_email, company_tax_id.

---

### 27. DashboardCache

Short-lived cache for expensive dashboard computations.

| Column | Type | Description |
|--------|------|-------------|
| cache_key | String | Primary key |
| cache_value | String | JSON-encoded data |
| expires_at | Date | Expiry timestamp |
| updated_at | Date | |

---

### Entity Relationship Summary

```
ProductCategories ──< Products
Suppliers ──< Products (supplier_id)
Products ──< InventoryTransactions
Products ──< InventoryFIFOLayers (FIFO cost layers)
Customers ──< Quotations ──< QuotationItems >── Products
Customers ──< Invoices ──< InvoiceItems >── Products
Customers ──< Receipts ──> Invoices
Quotations ──> Invoices (converted_invoice_id)
Suppliers ──< PurchaseOrders ──< PurchaseItems >── Products
Suppliers ──< Expenses
SalaryStructures ──< Employees (structure_id, optional template)
Employees ──< PayrollDetails >── Payroll
ChartOfAccounts ──< JournalEntries
ChartOfAccounts ──< GeneralLedger ──> JournalEntries
Assets ──< Depreciation
Users ──> Roles
```

### Data Integrity Rules

1. All monetary amounts stored as numbers with 2 decimal precision (enforced at write time).
2. Journal entries must balance: `SUM(debit) = SUM(credit)` per `journal_id`.
3. Invoice `balance_due` = `total` - `amount_paid` (recalculated on receipt allocation).
4. Product `quantity_on_hand` updated atomically with each `InventoryTransaction`.
5. Customer `balance` = sum of all unpaid invoice balances.
6. Supplier `balance` = sum of all unpaid PO balances.
7. Soft deletes preferred (status = `Inactive`/`Cancelled`) over row removal.
8. `AuditLog` is append-only; rows are never modified or deleted.
