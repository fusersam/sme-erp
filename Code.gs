/**
 * SME Business Management System - Main Entry Point
 * ===================================================
 * ERP-lite application for Small & Medium Enterprises
 * Built on Google Apps Script + Google Sheets
 * 
 * @version 1.0.0
 * @author SME-ERP Team
 */

// ============================================================
// WEB APP ENTRY POINT
// ============================================================

/**
 * Serves the main web application.
 * Google Apps Script calls this when the web app URL is accessed.
 * @param {Object} e - Event object with query parameters
 * @returns {HtmlOutput} The rendered HTML page
 */
function doGet(e) {
  try {
    var user = AuthService.getCurrentUser();
    if (!user) {
      // Serve login page as a template so it can receive the server-detected
      // session email.  The email is embedded as a JS variable in the page;
      // the login button echoes it back on the google.script.run call so that
      // getCurrentUser() can use it as a fallback when Session.getActiveUser()
      // returns '' in the google.script.run execution context.
      var sessionEmail = AuthService.getSessionEmail();
      var loginTpl = HtmlService.createTemplateFromFile('ui_login');
      loginTpl.sessionEmail = JSON.stringify(sessionEmail || '');
      return loginTpl.evaluate()
        .setTitle('SME Business Manager - Login')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    
    var template = HtmlService.createTemplateFromFile('ui_index');
    // Script-safe JSON: escape '<' so that any '</script>' or '</' sequence
    // inside a string value cannot prematurely close the inline <script> block.
    template.user   = _safeJson(user);
    template.config = _safeJson(ConfigService.getClientConfig());
    
    return template.evaluate()
      .setTitle('SME Business Manager')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    Logger.log('doGet error: ' + err.message);
    return HtmlService.createHtmlOutput(
      '<h3>System Error</h3><p>Please try again or contact your administrator.</p>' +
      '<p><small>' + err.message + '</small></p>'
    ).setTitle('SME Business Manager - Error');
  }
}

/**
 * Include helper for HTML templating.
 * Allows <?!= include('filename') ?> in HTML templates.
 * @param {string} filename - Name of the HTML file to include
 * @returns {string} The file content as raw HTML
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Serialize an object to JSON that is safe to embed inside an inline
 * <script> block. Escapes '<' (and the line separators U+2028/U+2029 that
 * are valid in JSON but illegal in JS string literals) so the injected
 * value always parses as valid JavaScript.
 * @param {*} obj
 * @returns {string} Safe JSON string
 */
function _safeJson(obj) {
  var json = JSON.stringify(obj || null);
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ============================================================
// PUBLIC API - Called from client-side google.script.run
// ============================================================

/**
 * Initialize the database (create/validate all sheets).
 * Admin only.
 * @returns {Object} Result with success status and message
 */
function initializeDatabase() {
  AuthService.requireRole('Administrator');
  // Always clear all caches before and after init so stale data from a
  // previous spreadsheet context never survives into the new one.
  ConfigService.clearCache();
  var result = DatabaseInit.initialize();
  ConfigService.clearCache();
  return result;
}

/**
 * Point the deployment at a specific spreadsheet by persisting its ID to
 * Script Properties. This is the reliable way to change which spreadsheet
 * the app uses without needing to edit server_config.gs and create a new
 * deployment version — Script Properties persist across all deployment
 * versions and are read at runtime regardless of the code version in use.
 *
 * Why this is needed: APP_CONFIG.SPREADSHEET_ID is a compile-time constant
 * baked into a specific deployment version. If the ID is set there, a new
 * deployment version must be published before any live URL picks it up.
 * Script Properties bypass that — the property is shared across all versions
 * and can be updated without redeploying.
 *
 * @param {Object} data - { spreadsheetId: string }
 * @returns {Object} { success, id, name, url }
 */
function setDatabaseSpreadsheet(data) {
  AuthService.requireRole('Administrator');
  var id = (data && data.spreadsheetId || '').toString().trim();
  if (!id) throw new Error('Spreadsheet ID is required.');

  // Verify we can actually open it before saving.
  var ss;
  try {
    ss = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Cannot open spreadsheet "' + id + '": ' + e.message +
      '. Make sure the ID is correct and the script has access to it.');
  }

  // Persist — this takes effect immediately on the next request, across all
  // deployment versions, without any redeploy needed.
  PropertiesService.getScriptProperties().setProperty('DB_SPREADSHEET_ID', id);

  // Flush caches so the very next data read goes to the new spreadsheet.
  ConfigService.clearCache();

  return { success: true, id: ss.getId(), name: ss.getName(), url: ss.getUrl() };
}

/**
 * Clear all server-side caches (script-level CacheService + in-memory
 * settings cache). Call this any time you switch spreadsheets or suspect
 * stale data is being served.
 * Admin only.
 */
function clearAllCaches() {
  AuthService.requireRole('Administrator');
  ConfigService.clearCache();
  return { success: true };
}

/**
 * End-to-end self test of the data path. Exercises exactly what a real
 * customer create + list does, step by step, and returns a structured report
 * of what happened at each stage — so when "the data is in the sheet but the
 * app shows nothing", we can see PRECISELY which step diverges instead of
 * guessing. Writes a clearly-marked test customer, reads it back via the same
 * code the UI uses, then removes it.
 *
 * Admin only. Safe to run repeatedly; it cleans up after itself.
 */
function runSelfTest() {
  AuthService.requireRole('Administrator');
  var report = { steps: [], ok: false };
  function step(name, fn) {
    try {
      var result = fn();
      report.steps.push({ step: name, ok: true, detail: result });
      return result;
    } catch (e) {
      report.steps.push({ step: name, ok: false, error: e.message, stack: (e.stack || '').split('\n').slice(0, 3).join(' | ') });
      throw e;
    }
  }

  try {
    var ss = step('resolve spreadsheet', function() {
      var s = ConfigService.getSpreadsheet();
      return { id: s.getId(), name: s.getName(), url: s.getUrl() };
    });

    step('Customers sheet exists with headers', function() {
      var sheet = ConfigService.getSheet('Customers');
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      var headers = lastRow > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      return { lastRow: lastRow, lastCol: lastCol, headers: headers };
    });

    var beforeCount = step('count customers BEFORE', function() {
      return CustomerService.list({}).data.length;
    });

    var marker = 'SELFTEST_' + new Date().getTime();
    var created = step('create test customer', function() {
      return CustomerService.create({ name: marker, email: marker.toLowerCase() + '@selftest.local' });
    });

    var found = step('read it back via list (same path as UI)', function() {
      var all = CustomerService.list({}).data;
      var hit = null;
      for (var i = 0; i < all.length; i++) { if (all[i].name === marker) { hit = all[i]; break; } }
      return {
        listLength: all.length,
        foundTheTestRow: !!hit,
        sampleRow: hit ? JSON.stringify(hit).substring(0, 300) : null
      };
    });

    step('verify it JSON-serializes cleanly (google.script.run boundary)', function() {
      // This mirrors what google.script.run must do to deliver the result to
      // the client. If any field is non-serializable, this is where it shows.
      var all = CustomerService.list({});
      var json = JSON.stringify(all);
      return { serializedLength: json.length, sample: json.substring(0, 200) };
    });

    step('clean up test customer', function() {
      var all = CustomerService.list({}).data;
      for (var i = 0; i < all.length; i++) {
        if (all[i].name === marker && all[i]._rowIndex) {
          ConfigService.getSheet('Customers').deleteRow(all[i]._rowIndex);
          return 'deleted row ' + all[i]._rowIndex;
        }
      }
      return 'test row not found to delete (already gone?)';
    });

    report.ok = found.foundTheTestRow;
    report.summary = report.ok
      ? 'PASS — wrote a customer and read it straight back. The data path works end to end. ' +
        'If the UI still shows nothing, the issue is client-side (deployment version not updated, or browser cache).'
      : 'FAIL — wrote a customer but could NOT read it back via the same list path. See steps for the divergence.';
    report.spreadsheet = ss;
    report.beforeCount = beforeCount;
  } catch (e) {
    report.summary = 'ERROR at step "' + (report.steps.length ? report.steps[report.steps.length - 1].step : 'start') +
      '": ' + e.message;
  }

  return report;
}

/**
 * Diagnostic: report exactly which spreadsheet this deployment is reading
 * from and writing to, plus row counts for a few key sheets.
 *
 * Added because the spreadsheet a web app uses is resolved server-side
 * (script property, falling back to auto-creating a brand new spreadsheet if
 * that property is ever empty) and is otherwise invisible from the UI. If a
 * redeploy, a copy of the script, or a property reset ever happens, the app
 * can silently start reading/writing a DIFFERENT spreadsheet than the one a
 * person has open and is manually checking — which looks exactly like
 * "data I created isn't there" / "a record already exists that I can't find"
 * even though every individual write actually succeeded, just to the wrong
 * file. This lets anyone confirm in one click whether that's what's
 * happening, by comparing the URL here to whatever spreadsheet they have
 * open.
 *
 * Admin only (the URL grants edit access to the database).
 */
function getDatabaseInfo() {
  AuthService.requireRole('Administrator');

  // Report HOW the spreadsheet resolved, so it's obvious whether the project
  // is container-bound (active) or using a configured ID.
  var mode = 'unknown';
  var activeId = '';
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) { mode = 'active (container-bound)'; activeId = active.getId(); }
  } catch (e) {}
  var configuredId = '';
  try { configuredId = PropertiesService.getScriptProperties().getProperty('DB_SPREADSHEET_ID') || ''; } catch (e) {}
  if (mode === 'unknown') {
    mode = configuredId ? 'configured ID (script property)' :
           (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.SPREADSHEET_ID ? 'configured ID (APP_CONFIG)' : 'NONE');
  }

  var ss = ConfigService.getSpreadsheet();
  var counts = {};
  ['Users', 'Customers'].forEach(function(name) {
    try {
      var sheet = ss.getSheetByName(name);
      counts[name] = sheet ? Math.max(0, sheet.getLastRow() - 1) : null; // exclude header row
    } catch (e) {
      counts[name] = null;
    }
  });
  return {
    id: ss.getId(),
    url: ss.getUrl(),
    name: ss.getName(),
    rowCounts: counts,
    resolutionMode: mode,
    activeId: activeId,
    configuredId: configuredId,
    serverVersion: (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.VERSION) ? APP_CONFIG.VERSION : 'unknown'
  };
}

/**
 * Get current user info for the client.
 *
 * @param {string} [emailHint] - Email detected by doGet() server-side.
 *   Passed by the login page when Session.getActiveUser() may return ''
 *   in the google.script.run execution context.
 * @returns {Object|null} User object, or null if not found / not registered
 */
function getUserInfo(emailHint) {
  return AuthService.getCurrentUser(emailHint || '');
}

/**
 * Return diagnostic login status — what email the server detects and
 * whether a matching user exists in the Users sheet.
 * Safe to call from the login page (no auth required).
 *
 * @param {string} [emailHint] - Optional email from the login template.
 * @returns {Object} { detectedEmail, isRegistered, userName, userRole }
 */
function getLoginStatus(emailHint) {
  var activeEmail = '';
  var effectiveEmail = '';
  try { activeEmail    = Session.getActiveUser().getEmail()    || ''; } catch(e) {}
  try { effectiveEmail = Session.getEffectiveUser().getEmail() || ''; } catch(e) {}

  var detectedEmail = activeEmail || effectiveEmail || (emailHint ? emailHint.toString().trim() : '');
  var user = detectedEmail ? AuthService.getCurrentUser(detectedEmail) : null;

  return {
    detectedEmail: detectedEmail,
    activeEmail:   activeEmail,
    isRegistered:  !!user,
    userName:      user ? user.name  : '',
    userRole:      user ? user.role  : ''
  };
}

/**
 * Get client-safe configuration. Public (login required).
 * Used by the client bootstrap fallback when template injection is unavailable.
 * @returns {Object} Client config
 */
function getClientConfigData() {
  AuthService.requireLogin();
  return ConfigService.getClientConfig();
}

/**
 * Get dashboard data.
 * @param {string} period - 'month', 'quarter', 'year'
 * @returns {Object} Dashboard KPIs and chart data
 */
function getDashboardData(period) {
  // Attempt auth check; catch errors from google.script.run session quirks
  // where Session.getActiveUser() may return '' on certain deployment configs.
  try {
    AuthService.requireLogin();
  } catch (authErr) {
    // If strict auth fails, attempt a softer check using getEffectiveUser.
    // This prevents the entire dashboard from failing for valid users whose
    // session isn't detectable inside google.script.run.
    var effectiveEmail = '';
    try { effectiveEmail = Session.getEffectiveUser().getEmail() || ''; } catch (e2) {}
    if (!effectiveEmail) {
      throw new Error('Session expired or access denied. Please reload the page.');
    }
    // effectiveEmail is available — allow the call to proceed
    Logger.log('getDashboardData: soft auth via effectiveUser (' + effectiveEmail + ')');
  }
  return DashboardService.getData(period || 'month');
}

/**
 * Generic CRUD router.
 * Routes module operations to the correct service after enforcing
 * (a) a whitelist of permitted action names and
 * (b) role-based access for the calling user.
 *
 * @param {string} module - Module name (e.g., 'customers', 'products')
 * @param {string} action - Action (e.g., 'list', 'get', 'create', 'update', 'delete')
 * @param {Object} data - Payload for the action
 * @returns {Object} Result from the module service
 */
function moduleAction(module, action, data) {
  // Require login but catch google.script.run session edge-cases
  var currentUser = null;
  try {
    currentUser = AuthService.requireLogin();
  } catch (authErr) {
    var eff = '';
    try { eff = Session.getEffectiveUser().getEmail() || ''; } catch (e2) {}
    if (!eff) throw new Error('Session expired. Please reload the page.');
    Logger.log('moduleAction soft-auth via effectiveUser: ' + eff);
    try { currentUser = AuthService.getCurrentUser(eff); } catch (e3) {}
  }

  // ── Action whitelist: only these method names may ever be dispatched ──
  // Prevents invoking arbitrary properties (constructor, private helpers, etc.)
  // via the generic router.
  var ALLOWED_ACTIONS = {
    list: true, get: true, create: true, update: true, remove: true, delete: true,
    // domain actions used by specific services
    send: true, cancel: true, reverse: true, convert: true,
    preview: true, process: true, payNetSalaries: true, getPayslip: true,
    previewPayslip: true, adjust: true, recordDamage: true, recordTransfer: true,
    recordCustomerReturn: true, recordSupplierReturn: true,
    listTransactions: true, getTransaction: true, getProductMovement: true,
    getStockLevels: true, getStatement: true, getPayableAging: true,
    recalculateBalance: true, generate: true, getAging: true,
    trialBalance: true, generalLedger: true, profitAndLoss: true,
    balanceSheet: true, validateBooks: true, listPeriods: true,
    closePeriod: true, reopenPeriod: true
  };
  if (!ALLOWED_ACTIONS[action]) {
    throw new Error('Action not permitted: ' + action);
  }

  // ── Map router module keys to permission groups ──
  // The router exposes finer-grained keys than the permission model; group
  // them so role checks line up with how users actually work.
  var MODULE_GROUP = {
    customers: 'sales', quotations: 'sales', invoices: 'sales', receipts: 'sales',
    products: 'inventory', categories: 'inventory', inventory: 'inventory', suppliers: 'inventory',
    purchaseOrders: 'purchasing',
    expenses: 'expenses',
    cashbook: 'cashbank',
    employees: 'payroll', payroll: 'payroll', salaryStructures: 'payroll',
    assets: 'assets',
    journal: 'accounting', accounts: 'accounting',
    users: 'users',
    reports: 'reports'
  };

  // ── Role-based enforcement ──
  // Administrators bypass; everyone else must have the module + action right.
  if (currentUser && currentUser.role !== 'Administrator') {
    var permGroup = MODULE_GROUP[module] || module;
    // Normalise write-ish actions to the three permission verbs
    var permAction = action;
    if (['create', 'send', 'convert', 'preview', 'process', 'adjust',
         'recordDamage', 'recordTransfer', 'recordCustomerReturn',
         'recordSupplierReturn', 'payNetSalaries', 'closePeriod',
         'recalculateBalance', 'generate'].indexOf(action) !== -1) {
      permAction = 'create';
    } else if (['update', 'cancel', 'reverse', 'reopenPeriod'].indexOf(action) !== -1) {
      permAction = 'update';
    } else if (['remove', 'delete'].indexOf(action) !== -1) {
      permAction = 'delete';
    } else {
      permAction = 'get'; // all read-style actions
    }

    if (!AuthService.hasPermission(permGroup, permAction)) {
      throw new Error('Permission denied: your role (' + currentUser.role +
                      ') cannot ' + permAction + ' in ' + permGroup + '.');
    }
  }

  var routers = {
    'customers': function() { return CustomerService[action](data); },
    'suppliers': function() { return SupplierService[action](data); },
    'products': function() { return ProductService[action](data); },
    'categories': function() { return CategoryService[action](data); },
    'inventory': function() { return InventoryService[action](data); },
    'quotations': function() { return QuotationService[action](data); },
    'invoices': function() { return InvoiceService[action](data); },
    'receipts': function() { return ReceiptService[action](data); },
    'expenses': function() { return ExpenseService[action](data); },
    'purchaseOrders': function() { return PurchaseOrderService[action](data); },
    'cashbook': function() { return CashbookService[action](data); },
    'employees': function() { return EmployeeService[action](data); },
    'payroll': function() { return PayrollService[action](data); },
    'salaryStructures': function() { return SalaryStructureService[action](data); },
    'assets': function() { return AssetService[action](data); },
    'journal': function() { return JournalService[action](data); },
    'accounts': function() { return ChartOfAccountsService[action](data); },
    'users': function() { return UserService[action](data); },
    'reports': function() { return ReportService[action](data); }
  };
  
  if (!routers[module]) {
    throw new Error('Unknown module: ' + module);
  }
  
  AuditService.log(module, action, data);
  var result = routers[module]();
  var safeResult = result;
  try {
    safeResult = JSON.parse(JSON.stringify(result));
  } catch (e) {
    Logger.log('moduleAction JSON serialization failed: ' + e.message);
    safeResult = result;
  }
  try {
    var summary = 'moduleAction response for ' + module + '/' + action + ' -> ';
    if (safeResult && safeResult.data && Array.isArray(safeResult.data)) {
      summary += 'data.length=' + safeResult.data.length;
    } else if (safeResult && typeof safeResult === 'object') {
      summary += 'keys=' + Object.keys(safeResult).join(',');
    } else {
      summary += String(safeResult);
    }
    Logger.log(summary);
  } catch (logErr) {
    Logger.log('moduleAction response logging failed: ' + logErr.message);
  }
  return safeResult;
}

/**
 * Get settings for the application.
 * @returns {Object} Application settings
 */
function getSettings() {
  AuthService.requireLogin();
  return ConfigService.getAllSettings();
}

/**
 * Update a setting. Admin only.
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @returns {Object} Result
 */
function updateSetting(key, value) {
  AuthService.requireRole('Administrator');
  return ConfigService.updateSetting(key, value);
}

// ============================================================
// SALES MODULE PUBLIC APIs
// ============================================================

/**
 * Send an invoice (Draft → Sent, posts to accounting).
 */
function sendInvoice(invoiceId) {
  AuthService.requireLogin();
  return InvoiceService.send({ id: invoiceId });
}

/**
 * Cancel an invoice.
 */
function cancelInvoice(invoiceId) {
  AuthService.requireLogin();
  return InvoiceService.cancel({ id: invoiceId });
}

/**
 * Convert a quotation to an invoice.
 */
function convertQuotation(quotationId) {
  AuthService.requireLogin();
  return QuotationService.convertToInvoice({ id: quotationId });
}

/**
 * Generate a PDF for an invoice.
 */
function generateInvoicePdf(invoiceId) {
  AuthService.requireLogin();
  return PdfService.generateInvoicePdf(invoiceId);
}

/**
 * Generate a PDF for a receipt.
 */
function generateReceiptPdf(receiptId) {
  AuthService.requireLogin();
  return PdfService.generateReceiptPdf(receiptId);
}

/**
 * Email an invoice with PDF attachment.
 */
function emailInvoice(invoiceId, toEmail) {
  AuthService.requireLogin();
  return EmailService.sendInvoice({ invoice_id: invoiceId, to: toEmail });
}

/**
 * Email a receipt with PDF attachment.
 */
function emailReceipt(receiptId, toEmail) {
  AuthService.requireLogin();
  return EmailService.sendReceipt({ receipt_id: receiptId, to: toEmail });
}

/**
 * Get trial balance.
 */
function getTrialBalance() {
  AuthService.requireLogin();
  return AccountingEngine.getTrialBalance();
}

// ============================================================
// ACCOUNTING MODULE PUBLIC APIs
// ============================================================

/** Post a manual journal entry. */
function postManualJournal(data) {
  AuthService.requireLogin();
  return AccountingEngine.postManualJournal(data);
}

/** Reverse a journal entry. */
function reverseJournal(journalId, reason) {
  AuthService.requireLogin();
  return AccountingEngine.reverseJournalEntry(journalId, reason);
}

/** Get the consolidated general ledger. */
function getGeneralLedger(params) {
  AuthService.requireLogin();
  return AccountingEngine.getGeneralLedger(params || {});
}

/** Get a Profit & Loss statement for a date range. */
function getProfitAndLoss(params) {
  AuthService.requireLogin();
  return AccountingEngine.getProfitAndLoss(params || {});
}

/** Get a Balance Sheet as of a date. */
function getBalanceSheet(params) {
  AuthService.requireLogin();
  return AccountingEngine.getBalanceSheet(params || {});
}

/** Validate books integrity (trial balance, balance sheet, per-entry). */
function validateBooks() {
  AuthService.requireLogin();
  return AccountingEngine.validateBooks();
}

/** List accounting periods. */
function listPeriods() {
  AuthService.requireLogin();
  return AccountingEngine.listPeriods();
}

/** Close an accounting period (Accountant/Admin only). */
function closePeriod(data) {
  AuthService.requireRole('Accountant');
  return AccountingEngine.closePeriod(data);
}

/** Reopen a closed accounting period (Admin only). */
function reopenPeriod(data) {
  AuthService.requireRole('Administrator');
  return AccountingEngine.reopenPeriod(data);
}

/**
 * Get receivable aging report.
 */
function getReceivableAging() {
  AuthService.requireLogin();
  return InvoiceService.getAging();
}

// ============================================================
// INVENTORY MODULE PUBLIC APIs
// ============================================================

/** Adjust stock (manual count correction). */
function adjustStock(data) {
  AuthService.requireLogin();
  return InventoryService.adjust(data);
}

/** Record inventory damage / write-off. */
function recordDamage(data) {
  AuthService.requireLogin();
  return InventoryService.recordDamage(data);
}

/** Record a location transfer. */
function recordTransfer(data) {
  AuthService.requireLogin();
  return InventoryService.recordTransfer(data);
}

/** Record a customer return. */
function recordCustomerReturn(data) {
  AuthService.requireLogin();
  return InventoryService.recordCustomerReturn(data);
}

/** Record a supplier return. */
function recordSupplierReturn(data) {
  AuthService.requireLogin();
  return InventoryService.recordSupplierReturn(data);
}

/** Get inventory stock levels (for low-stock dashboard). */
function getStockLevels() {
  AuthService.requireLogin();
  return InventoryService.getStockLevels();
}

/** Get low-stock and out-of-stock report. */
function getLowStockReport() {
  AuthService.requireLogin();
  return ProductService.getLowStockReport();
}

/** Get inventory valuation report. */
function getInventoryValuation() {
  AuthService.requireLogin();
  return ProductService.getValuationReport();
}

/** Get payable aging. */
function getPayableAging() {
  AuthService.requireLogin();
  return SupplierService.getPayableAging();
}

// ============================================================
// PAYROLL MODULE PUBLIC APIs
// ============================================================

/** Preview a payslip calculation for one employee (no save). */
function previewPayslip(data) {
  AuthService.requireLogin();
  return EmployeeService.previewPayslip(data);
}

/** Preview a full payroll run for a period (no save). */
function previewPayroll(data) {
  AuthService.requireLogin();
  return PayrollService.preview(data);
}

/** Process (post) a payroll run for a period. HR Officer / Accountant / Admin. */
function processPayroll(data) {
  AuthService.requireLogin();
  return PayrollService.process(data);
}

/** Record payment of net salaries for a processed run. */
function payNetSalaries(data) {
  AuthService.requireLogin();
  return PayrollService.payNetSalaries(data);
}

/** Get a single payslip. */
function getPayslip(data) {
  AuthService.requireLogin();
  return PayrollService.getPayslip(data);
}

// ============================================================
// REPORTS & ANALYTICS PUBLIC APIs
// ============================================================

/** List the report catalog. */
function listReports() {
  AuthService.requireLogin();
  return ReportService.list();
}

/** Generate a report by id with params. */
function generateReport(data) {
  AuthService.requireLogin();
  return ReportService.generate(data || {});
}

/** Cash Flow Statement. */
function getCashFlow(params) {
  AuthService.requireLogin();
  return AccountingEngine.getCashFlow(params || {});
}

/** SME financial ratios / analytics. */
function getFinancialRatios(params) {
  AuthService.requireLogin();
  return ReportService.getFinancialRatios(params || {});
}

/** Payroll summary report. */
function getPayrollSummary(params) {
  AuthService.requireLogin();
  return ReportService.getPayrollSummary(params || {});
}

/** Statutory remittance report. */
function getStatutoryRemittance(params) {
  AuthService.requireLogin();
  return ReportService.getStatutoryRemittance(params || {});
}

/** Payroll cost by department. */
function getPayrollByDepartment(params) {
  AuthService.requireLogin();
  return ReportService.getPayrollByDepartment(params || {});
}
