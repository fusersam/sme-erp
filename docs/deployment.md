# Deployment Guide

## SME Business Manager — Setup & Deployment

### Prerequisites

- Google Account (personal Gmail or Google Workspace)
- Google Sheets access
- Google Apps Script access (script.google.com)

---

### Step 1: Create the Google Sheets Database

1. Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it: **SME Business Manager DB** (or any preferred name).
3. Copy the spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```
4. Keep this ID — you will need it in Step 3.

---

### Step 2: Create the Apps Script Project

1. Go to [Google Apps Script](https://script.google.com).
2. Click **New Project**.
3. Name the project: **SME Business Manager**.

---

### Step 3: Configure the Spreadsheet ID

1. Open the file `server/config.gs` (named `server_config` in the Apps Script editor).
2. Find the `SPREADSHEET_ID` constant inside `APP_CONFIG`:
   ```javascript
   SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
   ```
3. Replace `YOUR_SPREADSHEET_ID_HERE` with the ID you copied in Step 1.

---

### Step 4: Create All Project Files

Google Apps Script uses a flat file structure. Create each file in the Apps Script editor using the naming convention below.

#### Script Files (.gs)

Click **+** → **Script** for each:


> ⚠️ **Critical naming rule**: Google Apps Script does **not** support real subdirectories.
> Every file in the editor must use the exact flat name in the table below — no slashes.
> The repository uses directory paths for organisation only; those paths **are not** the
> editor filenames. The `include()` helper and `createHtmlOutputFromFile()` both look up
> files by their editor name, not by repository path.

| Create as | Paste content from |
|-----------|--------------------|
| `Code` | `Code.gs` (already exists, replace content) |
| `server_config` | `server/config.gs` |
| `server_auth` | `server/auth.gs` |
| `server_utilities` | `server/utilities.gs` |
| `server_validators` | `server/validators.gs` |
| `server_audit` | `server/audit.gs` |
| `server_permissions` | `server/permissions.gs` |
| `server_database_init` | `server/database_init.gs` |
| `modules_dashboard` | `modules/dashboard/dashboard.gs` |
| `modules_accounting_engine` | `modules/accounting/accounting_engine.gs` |
| `modules_sales_customer` | `modules/sales/customer_service.gs` |
| `modules_sales_invoice` | `modules/sales/invoice_service.gs` |
| `modules_sales_receipt` | `modules/sales/receipt_service.gs` |
| `modules_sales_quotation` | `modules/sales/quotation_service.gs` |
| `modules_sales_pdf` | `modules/sales/pdf_service.gs` |
| `modules_sales_email` | `modules/sales/email_service.gs` |
| `modules_inventory_service` | `modules/inventory/inventory_service.gs` |
| `modules_inventory_supplier` | `modules/inventory/supplier_service.gs` |
| `modules_payroll_tax_engine` | `modules/payroll/tax_engine.gs` |
| `modules_payroll_employee` | `modules/payroll/employee_service.gs` |
| `modules_payroll_service` | `modules/payroll/payroll_service.gs` |
| `modules_reports_service` | `modules/reports/report_service.gs` |
| `modules_service_stubs` | `modules/service_stubs.gs` |

> 🚫 **Do NOT add the `tests/` folder to the Apps Script project.**
> The files under `tests/` (`*_sim.js`, `*_test.js`) are standalone **Node.js**
> simulations used during development to verify engine logic. They are not part
> of the deployed app. Apps Script concatenates every file into one global
> scope, so a test file's top-level helpers (`round2`, `toFloat`, …) collide
> with `server_utilities` and throw:
> `SyntaxError: Identifier 'round2' has already been declared`.
> If you ever see that error, a test file was added to the editor — delete it
> from the project (it does not affect the repository). The test files now also
> carry a Node-only guard, so even an accidental import stays inert, but they
> still should not be in the project.

#### HTML Files (.html)

Click **+** → **HTML** for each:


> ⚠️ **Critical naming rule**: Google Apps Script does **not** support real subdirectories.
> Every file in the editor must use the exact flat name in the table below — no slashes.
> The repository uses directory paths for organisation only; those paths **are not** the
> editor filenames. The `include()` helper and `createHtmlOutputFromFile()` both look up
> files by their editor name, not by repository path.

| Create as | Paste content from |
|-----------|--------------------|
| `ui_login` | `ui/ui_login.html` |
| `ui_index` | `ui/ui_index.html` |
| `css_styles` | `ui/css/styles.html` |
| `js_app` | `ui/js/app.html` |

#### Manifest

1. In the Apps Script editor, click the gear icon (⚙ Project Settings).
2. Check **Show "appsscript.json" manifest file in editor**.
3. Open `appsscript.json` and replace its content with the provided manifest.

---

### Step 5: Deploy as Web Application

1. In the Apps Script editor, click **Deploy** → **New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Configure:
   - **Description**: `SME Business Manager v1.0`
   - **Execute as**: `Me` (your account)
   - **Who has access**: `Anyone with a Google Account` (or restrict to your domain for Workspace)
4. Click **Deploy**.
5. Copy the **Web app URL** — this is your application URL.
6. Click the URL to open the app.

---

### Step 6: Initial Setup

1. Open the web app URL in your browser.
2. You will see the login screen. The app detects your Google identity automatically.
3. As the first user, you are auto-registered as **Administrator**.
4. Navigate to **System → Settings** in the sidebar.
5. Click **Initialize Database** to create all 25 sheets with headers, seed data, and default accounts.
6. Update your company settings (name, address, currency, tax rates, etc.).

---

### Step 7: Add Users

1. Go to the **Users** sheet in Google Sheets directly (or use the System module once Phase 2 is complete).
2. Add rows for each user:
   - `user_id`: Any unique string
   - `email`: Their Google account email
   - `name`: Display name
   - `role`: One of: `Administrator`, `Accountant`, `Inventory Officer`, `Sales Officer`, `HR Officer`, `Viewer`
   - `status`: `Active`
   - `created_at`: Current date
   - `created_by`: Your email
3. Share the spreadsheet with each user (Viewer access is sufficient; the app reads/writes via the deployer's permissions since it executes as "Me").

---

### Updating the Application

After making code changes:

1. Click **Deploy** → **Manage deployments**.
2. Click the pencil icon on the active deployment.
3. Change **Version** to **New version**.
4. Click **Deploy**.

The URL remains the same; users will get the updated version on their next page load.

---

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Authorization required" popup | Normal on first run. Review and accept the permissions. |
| "This app isn't verified" warning | Click "Advanced" → "Go to SME Business Manager (unsafe)". This appears for personal accounts; Workspace admins can pre-approve. |
| Blank screen after login | Check browser console (F12). Ensure all HTML files are created with exact names. |
| "Spreadsheet not found" error | Verify the `SPREADSHEET_ID` in `server/config.gs` matches your spreadsheet. |
| Slow loading | First load after deployment takes 5-10 seconds (cold start). Subsequent loads are faster. |
| "User not registered" | Add the user's email to the Users sheet with `Active` status. |
| Data not saving | Ensure the spreadsheet is not open in edit mode by too many concurrent users. Check Apps Script execution logs. |

---

### Viewing Logs

1. In the Apps Script editor, click **Executions** in the left sidebar.
2. Each function call is logged with status, duration, and any errors.
3. Click an execution to see `Logger.log` output.
4. The `AuditLog` sheet in the spreadsheet also records all user and system actions.

---

### Security Notes

- The web app executes as the deployer's account. All spreadsheet reads/writes use the deployer's permissions.
- Users are authenticated via Google but do not need edit access to the spreadsheet.
- Share the spreadsheet as **Viewer** with users; the app handles all writes.
- RBAC is enforced server-side; client-side navigation hiding is cosmetic.
- Consider restricting "Who has access" to your Google Workspace domain in production.

---

### Backup

- Google Sheets has built-in version history (File → Version history).
- For additional safety, set up a time-driven trigger to copy the spreadsheet weekly:
  ```javascript
  function weeklyBackup() {
    var ss = SpreadsheetApp.openById('YOUR_SPREADSHEET_ID');
    var backup = ss.copy('SME Backup - ' + new Date().toISOString().slice(0,10));
    backup.moveTo(DriveApp.getFolderById('YOUR_BACKUP_FOLDER_ID'));
  }
  ```
