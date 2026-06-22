# User Guide

## SME Business Manager — Getting Started

### Logging In

1. Open the application URL provided by your administrator.
2. The system detects your Google account automatically.
3. If you are a registered user, you are taken directly to the Dashboard.
4. If you see a "User not registered" message, contact your administrator to add your email to the system.

### Navigation

The sidebar on the left organises the application into groups:

- **Main**: Dashboard (home screen with KPIs and charts)
- **Finance**: Accounting, Invoices, Receipts, Expenses, Cash & Bank
- **Operations**: Inventory, Purchasing, Payroll, Assets
- **Insights**: Reports
- **System**: Settings, Users (Administrator only)

On mobile devices, tap the menu icon (☰) in the top-left corner to toggle the sidebar.

### Dashboard

The dashboard provides an at-a-glance view of your business:

- **KPI Cards**: Revenue, Expenses, Net Profit, Cash Position, Bank Balance, Accounts Receivable, Accounts Payable, Inventory Value
- **Charts**: Revenue vs Expenses trend, Invoice status breakdown, Top expense categories
- **Alerts**: Low stock warnings, Overdue invoices

Use the period selector (This Month / This Quarter / This Year) to change the reporting timeframe.

### Settings (Administrator)

Navigate to **System → Settings** to configure:

- Company name, address, phone, email
- Currency and tax settings
- Invoice/Receipt/PO number prefixes
- Default payment terms
- Inventory valuation method
- Pension contribution rates
- Low stock threshold

Click **Initialize Database** (first time only) to create all required sheets with default data.

### Roles and Permissions

Your role determines what you can see and do:

| Role | Can Access |
|------|-----------|
| Administrator | Everything |
| Accountant | Accounting, Sales, Purchasing, Expenses, Cash & Bank, Payroll, Reports |
| Inventory Officer | Inventory, Purchasing, Reports |
| Sales Officer | Sales, Customers, Inventory (view), Reports |
| HR Officer | Payroll, Employee management, Reports |
| Viewer | Dashboard and Reports (read-only) |

### Common Tasks

#### Creating an Invoice (Phase 2+)
1. Navigate to **Finance → Invoices**.
2. Click **New Invoice**.
3. Select a customer, add line items, set payment terms.
4. Save as Draft or Send immediately.

#### Recording an Expense (Phase 3+)
1. Navigate to **Finance → Expenses**.
2. Click **New Expense**.
3. Enter date, category, amount, payment method.
4. Attach a receipt image if available.
5. Submit for approval.

#### Running Payroll (Phase 4+)
1. Navigate to **Operations → Payroll**.
2. Click **New Payroll Run**.
3. Select the pay period.
4. Review calculated amounts for each employee.
5. Approve and process.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + /` | Focus search (future) |
| `Esc` | Close modal / sidebar on mobile |

### Getting Help

- Check the **AuditLog** sheet for system activity records.
- Review **Apps Script Executions** for error details (administrators).
- Contact your system administrator for access issues.
