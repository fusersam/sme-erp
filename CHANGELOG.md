## [1.5.2-alpha] - 2026-06-21

### Audit follow-up: low-risk recommendations + test-file fix

#### Fixed
- **SyntaxError on load** (`Identifier 'round2' has already been declared`):
  caused by a `tests/*.js` Node simulation being added to the Apps Script
  project, where its top-level helpers collided with `server/utilities.gs`.
  Each `tests/*.js` is now wrapped in a Node-only guard so it is inert if ever
  loaded outside Node, and `deployment.md` warns not to add `tests/` to the
  project. (Remedy in a live project: delete the test file from the editor.)

#### Implemented (recommendations C, D, E from the audit — no functional change)
- **C — `getSheet` no longer creates headerless sheets.** When creating a known
  schema sheet at runtime, `ConfigService.getSheet` now seeds the canonical
  header row from `DatabaseInit.getSchema()` (guarded; never throws). Closes the
  root cause of the earlier headerless-sheet incident.
- **D — consolidated `_user()` helpers.** New `Utils.currentUserEmail()` is the
  single source of truth (active → effective → `'system'`). Four per-module
  helpers delegate to it and nine inline session calls in `created_by`/
  `updated_by` now use it, gaining the `getEffectiveUser` fallback.
- **E — GL-vs-CoA reconciliation.** `validateBooks()` gained a fourth check that
  recomputes each account balance from the General Ledger and flags drift from
  the stored Chart-of-Accounts balance. Read-only; surfaces via the existing
  Validate Books button.

Recommendations A (transactional rollback) and B (unified soft-delete sentinel)
remain open by design — they change behaviour and need their own test plans.

---

## [1.5.1-alpha] - 2026-06-21

### Senior Architect Audit — Hardening (no functional change)

A full-codebase review across bugs, security, performance, technical debt,
refactoring, and accounting consistency. Full write-up in
`docs/architecture-audit.md`.

#### Fixed
- **Security (critical)**: `moduleAction` now enforces role-based access
  server-side — an action whitelist plus a module-group permission check via
  `AuthService.hasPermission`. Previously any authenticated user could call any
  action on any module (the role model was only used for UI menu visibility).
- **Accounting (latent bug)**: `_postToLedger` no longer loses a line's effect
  when two lines in one entry hit the same account; balance changes accumulate
  per account and each account is written once.
- **Performance**: CoA loaded once per posting (was N+1 full-sheet reads);
  `updateRow` writes changed cells in one `setValues()` (was one `setValue()`
  per field); journal-line and GL writes are batch-appended; `getHeaders` is
  cached per execution (cleared after DB init).
- **Concurrency**: `createJournalEntry` serialises posting with
  `LockService.getScriptLock`.
- **Robustness**: `generateId` uses a `Utilities.getUuid()`-derived suffix
  instead of `Math.random()`, removing the collision risk under load.

#### Recommended (documented, not implemented — would change behaviour)
Transactional rollback for multi-step financial operations; a unified
soft-delete sentinel; `getSheet` no longer auto-creating headerless sheets;
consolidating duplicated `_user()` helpers; periodic GL-vs-CoA balance
reconciliation. See the audit document.

#### Verification
New `tests/postledger_refactor_test.js` proves the same-account-twice fix and
unchanged normal posting. All three integrity simulations still pass.

---

## [1.5.0-alpha] - 2026-06-21

### Phase 5: Reporting & Analytics Module

#### New Engine Function (`modules/accounting/accounting_engine.gs`)
- **`getCashFlow(params)`** — Cash Flow Statement (indirect method).
  - **Operating** = net income ± changes in working-capital accounts (receivables, inventory, payables, tax/pension/wage liabilities).
  - **Investing** = change in fixed-asset accounts (1500–1599).
  - **Financing** = change in equity (excluding retained earnings) and long-term debt (2500–2599).
  - The net change is reconciled against the actual movement in cash/bank accounts (1100–1299); the result carries a `reconciled` flag and `difference`, so the statement is self-checking.

#### New Module (`modules/reports/report_service.gs`)
- **`ReportService`** — single catalog + dispatcher (`list`, `generate`) for all reports. Statement-level reports delegate to existing engine/service primitives (one source of truth) instead of duplicating logic.
- **Payroll reports** (new):
  - `getPayrollSummary` — totals across payroll runs in a period.
  - `getStatutoryRemittance` — PAYE owed to GRA and SSNIT (employee + employer) per period.
  - `getPayrollByDepartment` — payroll cost grouped by department (joins PayrollDetails to Employees).
- **`getFinancialRatios`** (new) — SME ratio analysis from the balance sheet, P&L, and cash flow:
  - **Liquidity**: current ratio, quick ratio.
  - **Profitability**: gross margin, net margin, return on assets.
  - **Efficiency**: inventory turnover, receivable days, payable days, asset turnover.
  - **Cash flow**: operating cash flow, free cash flow, burn rate, cash runway.
  - All ratios use safe division (return `null` rather than dividing by zero).

#### Reports Delivered
Profit & Loss, Balance Sheet, Cash Flow Statement, Trial Balance, General Ledger, Accounts Receivable Aging, Accounts Payable Aging, Inventory Valuation, Low Stock, Payroll Summary, Statutory Remittance, Payroll by Department, and Financial Ratios.

#### Public APIs (`Code.gs`)
- `listReports`, `generateReport`, `getCashFlow`, `getFinancialRatios`, `getPayrollSummary`, `getStatutoryRemittance`, `getPayrollByDepartment`. ReportService stub removed.

#### UI (`ui/js/app.html`, `ui/css/styles.html`, `ui/ui_index.html`)
- **Reports page** — grouped report catalog (Financial / Receivables / Payables / Inventory / Payroll / Analytics) with a date-range filter and dynamic rendering for all 13 reports.
- **Analytics dashboard** — ratio KPI cards, a profitability-margins bar chart, an efficiency (days) bar chart, and the full ratios table.
- New **Analytics & Ratios** nav item under Insights; report-card grid styling.

#### Verification
`tests/reports_integrity_sim.js` — 6 assertions proving the cash flow indirect method reconciles to the actual cash movement (6,000 = 6,000) and that the ratios compute correctly with safe division. The accounting and payroll simulations remain green.

---

## [1.4.0-alpha] - 2026-06-20

### Phase 4: Payroll Module

#### New Files (`modules/payroll/`)
- **`tax_engine.gs`** — `TaxEngine`: Ghana statutory calculations.
  - **SSNIT**: 5.5% employee (Tier 1) and 13% employer of basic salary, capped at the monthly insurable-earnings ceiling.
  - **PAYE**: progressive bands applied to chargeable income (gross less employee SSNIT, per GRA rules). The 2026 monthly GRA schedule is seeded as the default.
  - All rates, the SSNIT cap, and the PAYE bands are read from Settings, so they can be updated when GRA/SSNIT figures change without code edits.
  - `calculatePayslip()` returns the full breakdown including PAYE band detail, employee/employer SSNIT, net pay, and total employer cost.
- **`employee_service.gs`** — `EmployeeService` (full CRUD, terminate, `previewPayslip`) and `SalaryStructureService` (reusable pay templates applied as defaults when creating an employee).
- **`payroll_service.gs`** — `PayrollService`:
  - `preview(period)` calculates every active employee for the month without saving.
  - `process(period)` persists the Payroll header and one PayrollDetails payslip per employee, then posts the consolidated payroll journal.
  - `payNetSalaries(payroll_id, method)` clears Net Salary Payable to Cash/Bank.

#### Payroll Journal (balanced)
| Side | Account | Amount |
|------|---------|--------|
| Dr | Salary & Wages (6100) | total gross |
| Dr | Employer Pension Contribution (6110) | total employer SSNIT |
| Cr | PAYE Payable (2220) | total PAYE |
| Cr | Pension Payable (2230) | employee + employer SSNIT |
| Cr | Net Salary Payable (2240) | total net pay |
| Cr | Accrued Expenses (2300) | other deductions (if any) |

#### Schema (`server/database_init.gs`)
- **Employees** extended: `employment_type`, `structure_id`, `transport_allowance`, `housing_allowance`, `other_allowance`, `ssnit_applicable`, `paye_applicable`.
- New **SalaryStructures** sheet.
- **Payroll** extended: `total_paye`, `total_pension_employee`, `total_pension_employer`, `employee_count`.
- **PayrollDetails** extended: `ssnit_base`.
- New COA account **2240 Net Salary Payable**.
- New settings: `ssnit_monthly_cap` (61000), `paye_bands` (monthly GRA schedule as `width:rate` pairs).

#### Public APIs (`Code.gs`)
- `previewPayslip`, `previewPayroll`, `processPayroll`, `payNetSalaries`, `getPayslip`; `salaryStructures` module route.

#### UI (`ui/js/app.html`)
- **Payroll Hub** with KPIs and sub-module cards.
- **Employees** — searchable list, detail view with live payslip preview, create/edit modal (salary structure picker, allowance fields, SSNIT/PAYE toggles, bank & statutory IDs).
- **Salary Structures** — CRUD for reusable pay templates.
- **Payroll Runs** — period preview (per-employee table with totals), process-and-post with confirmation, run detail showing all payslips, and a pay-net-salaries action.

#### Verification
`tests/payroll_integrity_sim.js` — 12 assertions covering SSNIT (including the cap), progressive PAYE bands, the full payslip calculation, and that the payroll journal balances (Dr 6,589 = Cr 6,589 in the sample). The accounting integrity simulation remains green.

---

## [1.3.0-alpha] - 2026-06-20

### Accounting Engine — General Ledger, Financial Statements, Period Closing

#### New Database Sheet
- **AccountingPeriods** — tracks period status and closing metadata: `period` (yyyy-MM), `status` (Open/Closed), `closed_by`, `closed_at`, `closing_journal_id`, `net_income`, `reopened_by`, `reopened_at`, `notes`.

#### Engine (`modules/accounting/accounting_engine.gs`)
- **`getGeneralLedger(params)`** — consolidated GL grouped by account, returning per-account opening balance, in-range debit/credit movement, closing balance, and the line entries. Supports `{ start, end, accountCode }` filtering.
- **`getProfitAndLoss(params)`** — P&L statement computed from the GL for a date range. Returns revenue/COGS/expense line items, totals, gross profit, net profit, gross & net margins. Correctly handles contra-revenue (e.g. Sales Returns) and contra-expense accounts.
- **`getBalanceSheet(params)`** — Balance Sheet as of a date. Returns Assets / Liabilities / Equity sections with current-period earnings shown in equity until closed. Reports a `balanced` flag and the difference.
- **`validateBooks()`** — three integrity checks: trial balance (debits = credits), balance sheet (A = L + E), and per-entry balance (every journal internally balanced).
- **`postManualJournal(data)`** — UI-facing manual journal entry with Chart of Accounts name resolution and audit logging.
- **Period management** — `listPeriods()`, `closePeriod(params)`, `reopenPeriod(params)`. Closing posts a journal that zeroes every P&L account (handling normal and contra accounts) and transfers net income to Retained Earnings (3200), then locks the period. Reopening reverses the closing entry and unlocks.
- **Period lock** — `createJournalEntry` now rejects postings dated within a closed period unless the internal `_allowClosedPeriod` flag is set (used only by the closing entry itself).

#### Public APIs (`Code.gs`)
- `postManualJournal`, `reverseJournal`, `getGeneralLedger`, `getProfitAndLoss`, `getBalanceSheet`, `validateBooks`, `listPeriods`, `closePeriod` (Accountant+), `reopenPeriod` (Administrator only).

#### UI (`ui/js/app.html`)
Accounting module expanded from 3 to 6 tabs:
- **Trial Balance** — with a "Validate Books" action.
- **Chart of Accounts** — searchable, with a create-account modal.
- **Journal Entries** — searchable list plus a manual-entry modal with live debit/credit totals and a balanced/unbalanced indicator that gates the Post button.
- **General Ledger** — date-range filter, per-account opening and closing balances.
- **Financial Statements** — P&L and Balance Sheet side by side with a balanced badge.
- **Periods** — close/reopen with confirmation modals and a period-history table.

#### Auto-posting confirmed
Invoices, Receipts, and all six inventory events (COGS, stock adjustment, damage, customer return, supplier return, opening stock) post journals automatically. Remaining modules (Expenses, Purchasing, Payroll, Assets) are Phase 4/5 stubs.

#### Integrity verification
A Node simulation of the engine exercises five scenarios — full sales cycle, expenses/adjustments/returns, period close, period lock, and unbalanced-entry rejection — with 14 assertions, all passing. The simulation caught a real contra-account defect (Sales Returns being added to rather than subtracted from income) that would have unbalanced the financial statements; the fix is part of this release.

---

## [1.2.0-alpha] - 2026-06-18

### Phase 3: Inventory Module

#### New Files
- **`modules/inventory/inventory_service.gs`** (700 lines): Three cooperating services:
  - `CategoryService` — CRUD for ProductCategories sheet; duplicate name prevention; reference guard on delete.
  - `ProductService` (full replacement of Phase 1 stub) — CRUD with SKU uniqueness, opening stock auto-posting, FIFO layer seeding on create, valuation method per product, reorder level tracking, low-stock and valuation reports.
  - `InventoryService` — Core movement engine with 9 transaction types (Purchase, Sale, Adjustment In/Out, Damage, Transfer, Customer Return, Supplier Return, Opening Stock). FIFO cost layer management (per-batch tracking in InventoryFIFOLayers sheet). Weighted-average cost recalculation on every purchase. COGS resolution that selects the correct method per product. Full `adjust()`, `recordDamage()`, `recordTransfer()`, `recordCustomerReturn()`, `recordSupplierReturn()`, `recordPurchase()`, `recordOpeningStock()`, `recordSale()`. Stock level query and product movement report.
- **`modules/inventory/supplier_service.gs`** (210 lines): Full SupplierService replacing Phase 1 stub. Duplicate name check, email validation, outstanding-order guard on deactivation, balance recalculation from purchase orders, supplier statement, payable aging report (current/30/60/90/90+ day buckets).

#### Modified Files
- **`server/database_init.gs`**: Added `ProductCategories` schema (7 columns), enhanced `InventoryTransactions` schema (added `running_qty`, `journal_ref`), added `InventoryFIFOLayers` schema (10 columns). Added COA accounts `5400 Inventory Adjustments` and `6980 Inventory Write-off Loss`.
- **`server/validators.gs`**: Added `validateStockAdjustment`, `validateTransfer`, `validateReturn`, `validateCategory`.
- **`modules/accounting/accounting_engine.gs`**: Added 6 new posting methods: `postCOGS` (Dr COGS / Cr Inventory on sales), `postStockAdjustment` (Dr/Cr Inventory vs 5400 Adjustments), `postInventoryDamage` (Dr 6980 Write-off Loss / Cr Inventory), `postCustomerReturn` (Dr Inventory + Dr Sales Returns / Cr COGS + Cr A/R), `postSupplierReturn` (Dr A/P / Cr Inventory), `postOpeningStock` (Dr Inventory / Cr Retained Earnings). All exposed in public API.
- **`modules/sales/invoice_service.gs`**: `_deductInventory` now delegates to `InventoryService.recordSale()` (gains FIFO/WA valuation and COGS posting). `_restoreInventory` now delegates to `InventoryService.recordCustomerReturn()`.
- **`modules/service_stubs.gs`**: Removed ProductService and SupplierService stubs (replaced by full implementations). Updated header.
- **`Code.gs`**: Added `categories` and `inventory` to module router. Added 8 new public APIs: `adjustStock`, `recordDamage`, `recordTransfer`, `recordCustomerReturn`, `recordSupplierReturn`, `getStockLevels`, `getLowStockReport`, `getInventoryValuation`, `getPayableAging`.
- **`ui/js/app.html`** (857 → 1,394 lines): Added full inventory UI: Inventory Hub (with live KPI summary and 6 sub-module cards), Products list (with stock status colour coding, valuation badge, sortable table), Product detail (stock level progress bar, quick action buttons: Adjust/Damage/Transfer), Stock Adjustment modal (count/add/remove modes), Damage Write-off modal, Location Transfer modal, Categories CRUD, Inventory Transactions log (filterable by type), Low Stock Report (two-panel: out-of-stock/low-stock with reorder quantities), Inventory Valuation Report (grouped by category, totals), Suppliers list/detail, Supplier create/edit modal.
- **`ui/css/styles.html`** (559 → 716 lines): Added stock-level progress bars, product cards, transaction type icons, valuation badges, reorder-row layout, inventory hub card grid, qty-positive/negative colour helpers, extended badge-status variants for all 9 transaction types.

#### Accounting Integration (new in this phase)
| Event | Debit | Credit |
|-------|-------|--------|
| Invoice Send (COGS) | 5000 COGS | 1400 Inventory |
| Stock Adjustment (positive) | 1400 Inventory | 5400 Inventory Adjustments |
| Stock Adjustment (negative) | 5400 Inventory Adjustments | 1400 Inventory |
| Damage/Write-off | 6980 Write-off Loss | 1400 Inventory |
| Customer Return (inventory) | 1400 Inventory | 5000 COGS |
| Customer Return (revenue) | 4600 Sales Returns | 1300 A/R |
| Supplier Return | 2100 A/P | 1400 Inventory |
| Opening Stock | 1400 Inventory | 3200 Retained Earnings |

---

# Changelog

All notable changes to the SME Business Manager project follow this format.

## [1.0.0-alpha] - 2026-06-17

### Phase 1: Foundation

#### Added
- **Project scaffold**: `appsscript.json` manifest (Africa/Accra timezone, V8 runtime, required OAuth scopes).
- **Main entry point** (`Code.gs`): `doGet()` web-app handler, `include()` HTML templating, `moduleAction()` CRUD router for 15 modules, public APIs for dashboard, settings, and database initialisation.
- **Authentication & RBAC** (`server/auth.gs`): Google session-based auth via `Session.getActiveUser()`, auto-registers first user as Administrator, six predefined roles (Administrator, Accountant, Inventory Officer, Sales Officer, HR Officer, Viewer), `requireLogin()`, `requireRole()`, and `hasPermission()` guards.
- **Configuration management** (`server/config.gs`): `APP_CONFIG` constants, `ConfigService` with spreadsheet handle caching, settings CRUD (read/write to Settings sheet), in-memory cache, and `getClientConfig()` for safe frontend delivery.
- **Core utilities** (`server/utilities.gs`): UUID and sequential document-number generators, date/currency formatters (GHS), `sheetToObjects()` with filtering, sorting, and pagination, generic `appendRow`/`updateRow`/`findRow`/`deleteRow`, fiscal-year and date-range helpers.
- **Validation framework** (`server/validators.gs`): Required-field checks, email/number/date validators, HTML sanitisation, and business-rule validators for customers, invoices, journal entries (double-entry balance check), and products.
- **Permissions service** (`server/permissions.gs`): `NAV_PERMISSIONS` matrix per role, `getVisibleModules()`, `canCreate`/`canEdit`/`canDelete` checks, `getClientPermissions()`.
- **Audit logging** (`server/audit.gs`): `AuditService` logging user actions, system events, and errors to the AuditLog sheet with automatic detail truncation.
- **Database initialisation** (`server/database_init.gs`): Full schema for 25 sheets, non-destructive initialise (create missing sheets, validate/repair headers, append missing columns), seed data for Chart of Accounts (~50 Ghana-tailored accounts), 19 default settings, and 6 default roles.
- **Dashboard** (`modules/dashboard/dashboard.gs`): `DashboardService.getData()` returning financial KPIs (revenue, expenses, gross/net profit, margins, cash position, AR, AP), inventory KPIs, payroll KPIs, chart data (6-month trend, invoice-status doughnut, top expense categories), low-stock/overdue-invoice alerts, and result caching.
- **Module service stubs** (`modules/service_stubs.gs`): Working `list`/`get` and phased `create`/`update`/`delete` stubs for all 15 services (Users, Customers, Suppliers, Products, Invoices, Receipts, Expenses, PurchaseOrders, Cashbook, Employees, Payroll, Assets, JournalEntries, ChartOfAccounts, Reports).
- **Login UI** (`ui/ui_login.html`): Branded login page with feature highlights and Google sign-in button.
- **SPA shell** (`ui/ui_index.html`): Main application layout with sidebar navigation (grouped: Main, Finance, Operations, Insights, System), top header with user menu, content area, toast container, and loading overlay. Server-side templated with user/config data.
- **Stylesheet** (`ui/css/styles.html`): CSS custom properties, sidebar, header, KPI cards, charts, tables, badges, buttons, loading/empty states, and responsive breakpoints with mobile sidebar toggle.
- **Client application** (`ui/js/app.html`): SPA routing, dashboard rendering with Chart.js (bar, doughnut, horizontal-bar), period selector, alerts panel, settings form, user management table, database init trigger, toast notifications, currency/date formatters.
- **Documentation**: README.md (setup guide, file-mapping, roadmap), CHANGELOG.md, and full docs/ directory (architecture, database schema, deployment, workflows).

### Database Schema (25 sheets)
Users, Roles, Customers, Suppliers, Products, InventoryTransactions, Invoices, InvoiceItems, Receipts, PurchaseOrders, PurchaseItems, Expenses, Cashbook, BankTransactions, Employees, Payroll, PayrollDetails, ChartOfAccounts, JournalEntries, GeneralLedger, Assets, Depreciation, AuditLog, Settings, DashboardCache.

---

## [1.1.0-alpha] - 2026-06-18

### Phase 2: Accounting Engine + Sales Module

#### Added
- **Accounting Engine** (`modules/accounting/accounting_engine.gs`): Full double-entry bookkeeping engine with journal entry creation, validation (debits = credits), General Ledger posting with running balances, Chart of Accounts balance updates, pre-built posting rules for sales invoices and customer receipts, journal reversal, trial balance generation, account ledger queries, and CoA CRUD (with system-account protection).
- **Customer Service** (`modules/sales/customer_service.gs`): Full CRUD with duplicate-name prevention, balance tracking (recalculated from unpaid invoices), customer statement (all invoices + receipts), soft-delete with outstanding-invoice guard, recent invoices on detail view.
- **Invoice Service** (`modules/sales/invoice_service.gs`): Complete lifecycle management (Draft → Sent → Partial → Paid → Overdue → Cancelled). Line-item calculation with per-item tax/discount. Auto-posts to accounting engine on send (Dr A/R, Cr Revenue, Cr VAT). Deducts inventory and records InventoryTransactions. Cancellation reverses journal entries and restores inventory. Payment allocation via receipts. Overdue detection. Receivable aging report (current, 30/60/90/90+ day buckets).
- **Receipt Service** (`modules/sales/receipt_service.gs`): Customer payment recording with invoice allocation. Auto-posts to accounting (Dr Cash/Bank, Cr A/R). Updates invoice paid/balance/status. Cashbook entry creation. Receipt reversal with full undo of all effects.
- **Quotation Service** (`modules/sales/quotation_service.gs`): Quotation CRUD with line items and expiry dates. Status lifecycle (Draft → Sent → Accepted → Converted → Expired → Cancelled). Convert-to-invoice with one click (copies all line items to new invoice).
- **PDF Service** (`modules/sales/pdf_service.gs`): Professional invoice PDF generation (company header, bill-to, line items table, totals with discount/tax breakdown, status badge, notes, footer). Receipt PDF (centred card layout with green amount highlight). Saved to Google Drive folder "SME Business Manager Documents".
- **Email Service** (`modules/sales/email_service.gs`): Invoice emailing with PDF attachment (branded HTML body with summary table, company colours). Receipt emailing with PDF attachment. Auto-sends to customer email with override option. Triggers invoice send if still Draft.
- **Database schema**: Added Quotations and QuotationItems sheets (now 27 sheets). Added `quotation_prefix` to default settings.
- **Code.gs**: Added dedicated public APIs: `sendInvoice`, `cancelInvoice`, `convertQuotation`, `generateInvoicePdf`, `generateReceiptPdf`, `emailInvoice`, `emailReceipt`, `getTrialBalance`, `getReceivableAging`. Added `quotations` to module router.
- **ChartOfAccountsService / JournalService**: Real implementations replacing stubs, backed by AccountingEngine (CoA CRUD, journal listing, journal creation, reversal, trial balance).

#### Changed
- **Service stubs**: Removed CustomerService, InvoiceService, ReceiptService, QuotationService, ChartOfAccountsService, JournalService stubs (replaced by real implementations). Updated header comment.
- **Client app** (`ui/js/app.html`): Expanded from 642 to 858 lines. Added complete UI for Sales Hub, Customers (list + detail + create/edit modal), Invoices (list + detail with line items + create modal with product dropdowns + send/cancel/PDF/email actions + receive-payment button), Receipts (list + create modal with customer→invoice cascading selects), Quotations (list + create modal with line items + convert-to-invoice), Accounting (tabbed: Trial Balance, Chart of Accounts, Journal Entries). Added modal helper system, table search filter, line-item management.
- **CSS** (`ui/css/styles.html`): Added detail-header, action-btn-group, detail-meta, module-toolbar, search-box, line-items-table, and additional badge-status variants (accepted, converted, expired, cancelled, completed).

#### Accounting Integration Map
| Business Event | Auto-Posted Journal Entries |
|---------------|----------------------------|
| Invoice Sent | Dr 1300 A/R (total), Cr 4100 Revenue (subtotal), Cr 2210 VAT (tax), Dr 4500 Discount (if any) |
| Receipt Created | Dr 1100/1210/1220 Cash/Bank (amount), Cr 1300 A/R (amount) |
| Invoice Cancelled | Reversal of original journal (mirror entry), inventory restored |
| Receipt Reversed | Reversal of receipt journal, invoice balance restored |

---

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Foundation (Auth, Config, DB Init, Dashboard, Audit) | ✅ Complete |
| 2 | Accounting Engine + Sales & Invoicing | ✅ Complete |
| 3 | Purchasing, Expenses, Cash & Bank | Pending |
| 4 | Payroll & Employee Management | Pending |
| 5 | Fixed Assets, Reports & Analytics | Pending |
| 6 | Advanced Features & Polish | Pending |
