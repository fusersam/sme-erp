# Architecture Documentation

## SME Business Manager — System Architecture

### 1. Overview

The SME Business Manager is an ERP-lite web application built entirely on the Google Workspace platform. It uses Google Apps Script as the server runtime, Google Sheets as the relational database, Google Drive for file storage, and Google Account authentication for user identity.

The application follows a Single-Page Application (SPA) pattern served through Apps Script's `HtmlService`. All business logic runs server-side in `.gs` files; the browser receives a templated HTML shell that communicates with the server via `google.script.run` asynchronous RPC calls.

### 2. Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Google Apps Script (V8 engine) |
| Database | Google Sheets (structured as 31 relational tables) |
| File Storage | Google Drive |
| Authentication | Google Account via `Session.getActiveUser()` |
| Frontend Framework | Bootstrap 5.3 (CDN) |
| Charts | Chart.js 4.x (CDN) |
| Data Tables | DataTables.js (CDN, planned Phase 2+) |
| PDF Generation | Apps Script HTML-to-PDF via `HtmlService` + Google Drive |
| Email | `MailApp` with HTML body + PDF attachment |

### 3. Architectural Layers

```
┌─────────────────────────────────────────────────────┐
│                   BROWSER (CLIENT)                  │
│  ┌───────────┐  ┌───────────┐  ┌────────────────┐  │
│  │ ui_index   │  │ styles    │  │ app.js (SPA)   │  │
│  │ ui_login   │  │ (CSS)     │  │ Chart.js       │  │
│  └─────┬─────┘  └───────────┘  └───────┬────────┘  │
│        │         google.script.run       │           │
└────────┼─────────────────────────────────┼───────────┘
         │              ▼                  │
┌────────┼─────────────────────────────────┼───────────┐
│        │        APPS SCRIPT SERVER       │           │
│  ┌─────▼─────────────────────────────────▼────────┐  │
│  │                Code.gs (Entry Point)            │  │
│  │  doGet() · include() · moduleAction() · APIs    │  │
│  └─────┬──────────────────────────────────┬───────┘  │
│        │                                  │          │
│  ┌─────▼──────┐  ┌───────────────┐  ┌────▼───────┐  │
│  │  server/    │  │   modules/    │  │  server/   │  │
│  │  auth.gs    │  │  dashboard/   │  │  config.gs │  │
│  │  audit.gs   │  │  accounting/  │  │  utils.gs  │  │
│  │  perms.gs   │  │  inventory/   │  │  valid.gs  │  │
│  │  db_init.gs │  │  sales/ ...   │  │            │  │
│  └─────┬──────┘  └───────┬───────┘  └────┬───────┘  │
│        │                 │               │           │
│        └─────────────────┼───────────────┘           │
│                          ▼                           │
│  ┌─────────────────────────────────────────────────┐ │
│  │           GOOGLE SHEETS (DATABASE)              │ │
│  │  25 sheets · Headers as schema · Row-per-record │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 4. File Organisation

Google Apps Script does not support subdirectories inside a project. The logical folder structure in this repository maps to flat filenames in the Apps Script editor:

| Repository Path | Apps Script Filename |
|----------------|---------------------|
| `Code.gs` | `Code` |
| `server/config.gs` | `server_config` |
| `server/auth.gs` | `server_auth` |
| `server/utilities.gs` | `server_utilities` |
| `server/validators.gs` | `server_validators` |
| `server/audit.gs` | `server_audit` |
| `server/permissions.gs` | `server_permissions` |
| `server/database_init.gs` | `server_database_init` |
| `modules/dashboard/dashboard.gs` | `modules_dashboard` |
| `modules/accounting/accounting_engine.gs` | `modules_accounting_engine` |
| `modules/sales/customer_service.gs` | `modules_sales_customer` |
| `modules/sales/invoice_service.gs` | `modules_sales_invoice` |
| `modules/sales/receipt_service.gs` | `modules_sales_receipt` |
| `modules/sales/quotation_service.gs` | `modules_sales_quotation` |
| `modules/sales/pdf_service.gs` | `modules_sales_pdf` |
| `modules/sales/email_service.gs` | `modules_sales_email` |
| `modules/inventory/inventory_service.gs` | `modules_inventory_service` |
| `modules/inventory/supplier_service.gs` | `modules_inventory_supplier` |
| `modules/payroll/tax_engine.gs` | `modules_payroll_tax_engine` |
| `modules/payroll/employee_service.gs` | `modules_payroll_employee` |
| `modules/payroll/payroll_service.gs` | `modules_payroll_service` |
| `modules/reports/report_service.gs` | `modules_reports_service` |
| `modules/service_stubs.gs` | `modules_service_stubs` |
| `ui/ui_index.html` | `ui_index` |
| `ui/ui_login.html` | `ui_login` |
| `ui/css/styles.html` | `css_styles` |
| `ui/js/app.html` | `js_app` |

### 5. Authentication & Authorisation

**Authentication** uses Google's built-in identity layer. `Session.getActiveUser().getEmail()` returns the logged-in user's email. No passwords are stored or managed.

**Authorisation** is role-based (RBAC). Six roles are defined, each with a permissions bitmap:

| Role | Modules Accessible |
|------|--------------------|
| Administrator | All modules, all actions |
| Accountant | Accounting, Sales, Purchasing, Expenses, Cash & Bank, Payroll, Reports |
| Inventory Officer | Inventory, Purchasing, Reports |
| Sales Officer | Sales, Inventory (read), Reports |
| HR Officer | Payroll, Reports |
| Viewer | Dashboard, Reports (read-only) |

The `AuthService` checks permissions on every `google.script.run` call. The `PermissionsService` controls sidebar navigation visibility on the client.

### 6. Data Flow Patterns

**Read path (list/get)**:
1. Client calls `google.script.run.moduleAction('customers', 'list', {})`.
2. `Code.gs` routes to `CustomerService.list()`.
3. Service calls `Utils.sheetToObjects('Customers', filters)`.
4. Utility reads the sheet, converts rows to objects, applies filters/sort/pagination.
5. Result returned as JSON to the client callback.

**Write path (create/update)**:
1. Client calls `moduleAction('invoices', 'create', invoiceData)`.
2. Router verifies auth, logs audit, calls `InvoiceService.create()`.
3. Service validates input via `Validators`, generates IDs/numbers.
4. Service writes to primary sheet (Invoices) and detail sheet (InvoiceItems).
5. Service calls `AccountingEngine.postInvoice()` to create journal entries.
6. Accounting engine writes to JournalEntries and GeneralLedger.
7. Result returned to client.

**Dashboard path**:
1. Client calls `getDashboardData('month')`.
2. `DashboardService` checks `DashboardCache` for unexpired data.
3. On cache miss: aggregates KPIs from Invoices, Expenses, Cashbook, Products, Employees sheets.
4. Builds chart datasets (6-month trends, status breakdowns).
5. Caches result in DashboardCache with TTL.
6. Returns structured JSON to client for Chart.js rendering.

### 7. Accounting Engine Design

The accounting engine enforces double-entry bookkeeping. Every financial transaction produces balanced journal entries (total debits = total credits).

**Automatic posting rules**:

| Business Event | Debit Account | Credit Account |
|---------------|---------------|----------------|
| Sales Invoice | 1300 Accounts Receivable | 4100 Sales Revenue + 2210 VAT Payable |
| Customer Receipt | 1100/1210 Cash/Bank | 1300 Accounts Receivable |
| Purchase Order (received) | 1400 Inventory / 6xxx Expense | 2100 Accounts Payable |
| Supplier Payment | 2100 Accounts Payable | 1100/1210 Cash/Bank |
| Expense | 6xxx Expense Account | 1100/1210 Cash/Bank |
| Payroll | 6100 Salaries + 6110 Employer Pension | 2220 PAYE + 2230 Pension + 1210 Bank |
| Depreciation | 6700 Depreciation Expense | 1690 Accumulated Depreciation |
| Asset Purchase | 16xx Fixed Asset | 1100/1210 Cash/Bank |

### 8. Caching Strategy

| Cache Type | Mechanism | TTL |
|-----------|-----------|-----|
| Spreadsheet handle | In-memory (`CacheService` or module-level variable) | Script execution lifetime |
| Settings | In-memory object within `ConfigService` | Script execution lifetime |
| Dashboard data | `DashboardCache` sheet | 5 minutes |
| Client-side | JavaScript variables in SPA | Page session |

### 9. Error Handling

- Server functions return `{ success: boolean, data?, error?, message? }` objects.
- `AuthService.requireLogin()` and `requireRole()` throw errors caught by the router.
- Client-side: `google.script.run.withFailureHandler()` catches server errors and displays toasts.
- All errors logged via `AuditService.logError()`.

### 10. Security Considerations

- No raw SQL; all data access through Apps Script's Spreadsheet API.
- HTML output sanitised via `Validators.sanitize()` (strips tags).
- RBAC enforced server-side on every call (client-side nav hiding is cosmetic only).
- No secrets stored in code; OAuth handled by Google infrastructure.
- `XFrameOptionsMode.ALLOWALL` required for Apps Script web apps served in iframe.

### 11. Scalability Limits

Google Sheets imposes hard limits that bound the system:

| Constraint | Limit |
|-----------|-------|
| Cells per spreadsheet | 10,000,000 |
| Sheets per spreadsheet | 200 |
| Rows per sheet | ~1,000,000 (practical limit ~50,000 for performance) |
| Apps Script execution time | 6 minutes per call |
| Daily triggers | 90 minutes total |
| `UrlFetch` calls | 20,000/day |
| Email sends | 100/day (consumer), 1,500/day (Workspace) |

**Mitigation strategies**: pagination on all list operations, dashboard caching, batch writes, archival of old data to separate spreadsheets (planned).

### 12. Module Dependency Graph

```
Code.gs (entry)
  ├── AuthService (server/auth.gs)
  │     └── ConfigService (server/config.gs)
  ├── ConfigService
  ├── AuditService (server/audit.gs)
  ├── PermissionsService (server/permissions.gs)
  ├── DatabaseInit (server/database_init.gs)
  ├── DashboardService (modules/dashboard/)
  │
  ├── AccountingEngine (modules/accounting/)
  │     ├── Utils, AuditService
  │     ├── Posting rules: postInvoice, postReceipt, postCOGS,
  │     │   postStockAdjustment, postInventoryDamage, postCustomerReturn,
  │     │   postSupplierReturn, postOpeningStock
  │     ├── Reporting: getTrialBalance, getGeneralLedger, getProfitAndLoss,
  │     │   getBalanceSheet, validateBooks
  │     ├── Manual journals: postManualJournal, reverseJournalEntry
  │     └── Period mgmt: listPeriods, closePeriod, reopenPeriod
  │         (createJournalEntry enforces a period lock for closed periods)
  │
  ├── ─── SALES MODULE ───────────────────────────────────────
  ├── CustomerService  → Utils, Validators, AuditService
  ├── InvoiceService   → AccountingEngine, CustomerService, InventoryService
  ├── ReceiptService   → AccountingEngine, CustomerService
  ├── QuotationService → InvoiceService
  ├── PdfService       → InvoiceService, ReceiptService, DriveApp
  ├── EmailService     → PdfService, MailApp, ConfigService
  │
  ├── ─── INVENTORY MODULE ───────────────────────────────────
  ├── CategoryService  → Utils, Validators, AuditService
  ├── ProductService   → Utils, Validators, AuditService, InventoryService
  ├── InventoryService → AccountingEngine (COGS / adjustment / damage /
  │                       return / opening stock postings)
  ├── SupplierService  → Utils, Validators, AuditService
  │
  ├── ─── PAYROLL MODULE ─────────────────────────────────────
  ├── TaxEngine        → ConfigService (SSNIT + PAYE from Settings)
  ├── EmployeeService  → Utils, Validators, AuditService, TaxEngine
  ├── SalaryStructureService → Utils, Validators, AuditService
  ├── PayrollService   → TaxEngine, AccountingEngine (payroll journal +
  │                       net-salary payment)
  │
  ├── ─── REPORTS MODULE ─────────────────────────────────────
  ├── ReportService    → AccountingEngine (P&L, BS, cash flow, TB, GL),
  │                       InvoiceService (AR aging), SupplierService (AP
  │                       aging), ProductService (inventory), Payroll sheets
  │                       (payroll reports). Adds financial-ratio analytics.
  │                       Orchestrates; does not duplicate balance logic.
  │
  └── *Stub Services (modules/service_stubs.gs)
        ExpenseService, PurchaseOrderService, CashbookService,
        AssetService — read-only until Phase 4b/5b
```
