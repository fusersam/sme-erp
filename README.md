# SME Business Manager

**ERP-lite Web Application for Small & Medium Enterprises**

Built on Google Apps Script + Google Sheets | Version 1.0.0

---

## Overview

A comprehensive business management system providing:
- Double-entry accounting engine
- Invoicing, receipts, and payment tracking
- Inventory management with FIFO/weighted average valuation
- Purchase order management
- Expense tracking and approval
- Cash and bank reconciliation
- Payroll processing
- Fixed asset management and depreciation
- Executive dashboards with KPIs and charts
- Financial statements (P&L, Balance Sheet, Cash Flow)
- Role-based access control with audit trails

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Google Apps Script (V8 runtime) |
| Frontend | HTML5, CSS3, JavaScript, Bootstrap 5, Chart.js |
| Database | Google Sheets (25 structured sheets) |
| Storage | Google Drive |
| Auth | Google Account via Apps Script Session |

## Quick Setup

### 1. Create Apps Script Project
1. Go to [script.google.com](https://script.google.com)
2. Create a new project named "SME Business Manager"
3. Copy all `.gs` files into the script editor (server-side)
4. Copy all `.html` files into the script editor (they appear as HTML files)

### 2. File Mapping (Apps Script doesn't support folders)

Use these filenames in the Apps Script editor:

| Local File | Apps Script Filename |
|-----------|---------------------|
| `Code.gs` | `Code` |
| `server/config.gs` | `Config` |
| `server/auth.gs` | `Auth` |
| `server/utilities.gs` | `Utilities` |
| `server/validators.gs` | `Validators` |
| `server/audit.gs` | `Audit` |
| `server/permissions.gs` | `Permissions` |
| `server/database_init.gs` | `DatabaseInit` |
| `modules/dashboard/dashboard.gs` | `Dashboard` |
| `modules/service_stubs.gs` | `ServiceStubs` |
| `ui/ui_index.html` | `ui_index` |
| `ui/ui_login.html` | `ui_login` |
| `ui/css/styles.html` | `ui/css/styles` |
| `ui/js/app.html` | `ui/js/app` |

### 3. Configure
1. Open `appsscript.json` via Project Settings > Show manifest
2. Replace content with provided `appsscript.json`

### 4. Deploy
1. Click **Deploy > New Deployment**
2. Select **Web app**
3. Execute as: **User accessing the web app**
4. Who has access: **Anyone within your organization** (or specific users)
5. Click **Deploy** and authorize

### 5. Initialize Database
1. Open the deployed web app URL
2. The first user is auto-registered as Administrator
3. Click the user menu > **Initialize Database**
4. This creates all 25 sheets with headers and default data

## Project Structure

```
/
├── appsscript.json          # Manifest with scopes and config
├── Code.gs                  # Main entry point (doGet, API)
├── server/
│   ├── config.gs            # Configuration management
│   ├── auth.gs              # Authentication & RBAC
│   ├── utilities.gs         # Shared helper functions
│   ├── validators.gs        # Input validation
│   ├── audit.gs             # Audit trail logging
│   ├── permissions.gs       # UI permission control
│   └── database_init.gs     # Database schema & initialization
├── modules/
│   ├── dashboard/dashboard.gs  # Dashboard KPIs & charts
│   └── service_stubs.gs       # Stub services for future modules
├── ui/
│   ├── ui_index.html        # Main SPA template
│   ├── ui_login.html        # Login page
│   ├── css/styles.html      # Master stylesheet
│   └── js/app.html          # Client-side application JS
└── docs/
    ├── architecture.md      # System architecture
    ├── database-schema.md   # Database design
    ├── deployment.md        # Deployment guide
    └── workflows.md         # Business workflows
```

## Roles & Permissions

| Role | Access |
|------|--------|
| Administrator | Full system access |
| Accountant | Finance, Sales, Purchasing, Expenses, Payroll, Reports |
| Inventory Officer | Inventory, Purchasing, Reports |
| Sales Officer | Sales, Customers, Inventory, Reports |
| HR Officer | Payroll, Employees, Reports |
| Viewer | Dashboard, Reports (read-only) |

## Development Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Foundation: Auth, Config, DB Init, Dashboard Shell | ✅ Complete |
| 2 | Accounting Engine + Sales/Invoicing + PDF + Email | ✅ Complete |
| 3 | Inventory Module (Products, FIFO/WA, Adjustments, Suppliers) | ✅ Complete |
| 4 | Payroll + Employee Management (PAYE, SSNIT, payslips, journals) | ✅ Complete |
| 5 | Reports & Analytics (statements, aging, payroll reports, SME ratios) | ✅ Complete |
| 5b | Fixed Assets + Depreciation | 🔲 Planned |
| 6 | Advanced Features & Polish | 🔲 Planned |

## Phase 5 Files (Apps Script editor names)

| Create as | Source |
|-----------|--------|
| `modules_reports_service` | `modules/reports/report_service.gs` |

## Phase 4 Files (Apps Script editor names)

| Create as | Source |
|-----------|--------|
| `modules_payroll_tax_engine` | `modules/payroll/tax_engine.gs` |
| `modules_payroll_employee` | `modules/payroll/employee_service.gs` |
| `modules_payroll_service` | `modules/payroll/payroll_service.gs` |

## Phase 3 Files (Apps Script editor names)

| Create as | Source |
|-----------|--------|
| `modules_inventory_service` | `modules/inventory/inventory_service.gs` |
| `modules_inventory_supplier` | `modules/inventory/supplier_service.gs` |

## Phase 2 Files (Apps Script editor names)

| Create as | Source |
|-----------|--------|
| `modules_accounting_engine` | `modules/accounting/accounting_engine.gs` |
| `modules_sales_customer` | `modules/sales/customer_service.gs` |
| `modules_sales_invoice` | `modules/sales/invoice_service.gs` |
| `modules_sales_receipt` | `modules/sales/receipt_service.gs` |
| `modules_sales_quotation` | `modules/sales/quotation_service.gs` |
| `modules_sales_pdf` | `modules/sales/pdf_service.gs` |
| `modules_sales_email` | `modules/sales/email_service.gs` |

## License

Proprietary - Internal Use Only
