/**
 * Database Initialization Service
 * =================================
 * Creates, validates, and repairs all Google Sheets tables.
 * Preserves existing data. Adds missing columns. Documents changes.
 *
 * SCHEMA DEFINITION: Each sheet is defined with ordered column headers.
 * The initialization process:
 *   1. Creates missing sheets
 *   2. Sets headers on empty sheets
 *   3. Validates headers on existing sheets
 *   4. Appends missing columns (non-destructive)
 *   5. Seeds required default data
 *   6. Logs all changes to AuditLog
 */

var DatabaseInit = (function() {
  
  /**
   * Complete schema definition for all 25 sheets.
   * Each key is the sheet name; value is an array of column headers.
   */
  var SCHEMA = {
    
    // ── User Management ──
    Users: [
      'user_id', 'email', 'name', 'role', 'status', 'department',
      'created_at', 'last_login', 'created_by'
    ],
    
    Roles: [
      'role_id', 'role_name', 'description', 'permissions', 'status',
      'created_at', 'updated_at'
    ],
    
    // ── CRM ──
    Customers: [
      'customer_id', 'name', 'email', 'phone', 'address', 'city',
      'region', 'country', 'tax_id', 'payment_terms', 'credit_limit',
      'balance', 'status', 'notes', 'created_at', 'updated_at', 'created_by'
    ],
    
    Suppliers: [
      'supplier_id', 'name', 'email', 'phone', 'address', 'city',
      'region', 'country', 'tax_id', 'payment_terms', 'balance',
      'status', 'notes', 'created_at', 'updated_at', 'created_by'
    ],
    
    // ── Inventory ──
    ProductCategories: [
      'category_id', 'name', 'description', 'status',
      'created_at', 'updated_at', 'created_by'
    ],

    Products: [
      'product_id', 'sku', 'name', 'description', 'category', 'category_id',
      'unit', 'cost_price', 'unit_price', 'tax_rate', 'quantity_on_hand',
      'reorder_level', 'reorder_quantity', 'supplier_id', 'location',
      'valuation_method', 'status', 'image_url',
      'created_at', 'updated_at', 'created_by'
    ],

    InventoryTransactions: [
      'transaction_id', 'date', 'product_id', 'product_name', 'type',
      'quantity', 'unit_cost', 'total_cost', 'running_qty',
      'reference_type', 'reference_id', 'location_from', 'location_to',
      'journal_ref', 'notes', 'created_at', 'created_by'
    ],

    InventoryFIFOLayers: [
      'layer_id', 'product_id', 'product_name', 'date',
      'quantity_in', 'quantity_remaining', 'unit_cost',
      'reference_type', 'reference_id', 'created_at'
    ],

    // ── Sales ──
    Quotations: [
      'quotation_id', 'quotation_number', 'date', 'expiry_date', 'customer_id',
      'customer_name', 'subtotal', 'tax_amount', 'discount_amount',
      'total', 'status', 'notes', 'converted_invoice_id',
      'created_at', 'updated_at', 'created_by'
    ],
    
    QuotationItems: [
      'item_id', 'quotation_id', 'product_id', 'product_name', 'description',
      'quantity', 'unit_price', 'discount_percent', 'tax_rate',
      'tax_amount', 'line_total', 'created_at'
    ],
    
    Invoices: [
      'invoice_id', 'invoice_number', 'date', 'due_date', 'customer_id',
      'customer_name', 'subtotal', 'tax_amount', 'discount_amount',
      'total', 'amount_paid', 'balance_due', 'status', 'payment_terms',
      'notes', 'journal_ref', 'created_at', 'updated_at', 'created_by'
    ],
    
    InvoiceItems: [
      'item_id', 'invoice_id', 'product_id', 'product_name', 'description',
      'quantity', 'unit_price', 'discount_percent', 'tax_rate',
      'tax_amount', 'line_total', 'created_at'
    ],
    
    Receipts: [
      'receipt_id', 'receipt_number', 'date', 'customer_id', 'customer_name',
      'invoice_id', 'amount', 'payment_method', 'reference', 'bank_account',
      'notes', 'journal_ref', 'status', 'created_at', 'created_by'
    ],
    
    // ── Purchasing ──
    PurchaseOrders: [
      'po_id', 'po_number', 'date', 'expected_date', 'supplier_id',
      'supplier_name', 'subtotal', 'tax_amount', 'discount_amount',
      'total', 'amount_paid', 'balance_due', 'status', 'payment_terms',
      'notes', 'journal_ref', 'created_at', 'updated_at', 'created_by'
    ],
    
    PurchaseItems: [
      'item_id', 'po_id', 'product_id', 'product_name', 'description',
      'quantity_ordered', 'quantity_received', 'unit_cost', 'discount_percent',
      'tax_rate', 'tax_amount', 'line_total', 'created_at'
    ],
    
    // ── Expenses ──
    Expenses: [
      'expense_id', 'date', 'category', 'account_code', 'description',
      'amount', 'tax_amount', 'net_amount', 'payment_method', 'reference',
      'supplier_id', 'supplier_name', 'receipt_url', 'status',
      'approved_by', 'is_recurring', 'recurrence_period',
      'journal_ref', 'notes', 'created_at', 'updated_at', 'created_by'
    ],
    
    // ── Cash & Bank ──
    Cashbook: [
      'entry_id', 'date', 'type', 'category', 'description', 'reference',
      'debit', 'credit', 'balance', 'payment_method', 'account',
      'journal_ref', 'reconciled', 'reconciled_date',
      'notes', 'created_at', 'created_by'
    ],
    
    BankTransactions: [
      'transaction_id', 'date', 'bank_account', 'type', 'description',
      'reference', 'debit', 'credit', 'balance', 'statement_ref',
      'reconciled', 'reconciled_date', 'cashbook_entry_id',
      'notes', 'created_at', 'created_by'
    ],
    
    // ── Payroll ──
    Employees: [
      'employee_id', 'employee_number', 'first_name', 'last_name',
      'email', 'phone', 'address', 'date_of_birth', 'hire_date',
      'department', 'position', 'employment_type', 'basic_salary',
      'structure_id', 'transport_allowance', 'housing_allowance',
      'other_allowance', 'ssnit_applicable', 'paye_applicable',
      'bank_name', 'bank_account', 'tax_id', 'pension_id', 'status',
      'termination_date', 'created_at', 'updated_at', 'created_by'
    ],

    SalaryStructures: [
      'structure_id', 'name', 'description', 'basic_salary',
      'transport_allowance', 'housing_allowance', 'other_allowance',
      'ssnit_applicable', 'paye_applicable', 'status',
      'created_at', 'updated_at', 'created_by'
    ],

    Payroll: [
      'payroll_id', 'period', 'start_date', 'end_date', 'total_gross',
      'total_deductions', 'total_net', 'total_employer_cost',
      'total_paye', 'total_pension_employee', 'total_pension_employer',
      'employee_count', 'status', 'journal_ref', 'processed_by', 'approved_by',
      'created_at', 'updated_at'
    ],

    PayrollDetails: [
      'detail_id', 'payroll_id', 'employee_id', 'employee_name',
      'basic_salary', 'allowances', 'overtime', 'gross_pay',
      'ssnit_base', 'paye_tax', 'pension_employee', 'pension_employer',
      'other_deductions', 'total_deductions', 'net_pay',
      'payment_method', 'payment_ref', 'created_at'
    ],
    
    // ── Accounting ──
    ChartOfAccounts: [
      'account_code', 'account_name', 'account_type', 'parent_code',
      'description', 'normal_balance', 'is_system', 'is_active',
      'balance', 'created_at', 'updated_at'
    ],
    
    JournalEntries: [
      'journal_id', 'entry_number', 'date', 'description', 'reference_type',
      'reference_id', 'account_code', 'account_name', 'debit', 'credit',
      'status', 'period', 'posted_by', 'approved_by',
      'created_at', 'updated_at'
    ],
    
    GeneralLedger: [
      'ledger_id', 'date', 'account_code', 'account_name', 'journal_id',
      'description', 'debit', 'credit', 'running_balance',
      'period', 'created_at'
    ],

    AccountingPeriods: [
      'period', 'status', 'closed_by', 'closed_at', 'closing_journal_id',
      'net_income', 'reopened_by', 'reopened_at', 'notes',
      'created_at', 'updated_at'
    ],

    // ── Fixed Assets ──
    Assets: [
      'asset_id', 'asset_number', 'name', 'description', 'category',
      'purchase_date', 'cost', 'salvage_value', 'useful_life_years',
      'depreciation_method', 'accumulated_depreciation', 'net_book_value',
      'location', 'assigned_to', 'status', 'disposal_date',
      'disposal_amount', 'journal_ref',
      'created_at', 'updated_at', 'created_by'
    ],
    
    Depreciation: [
      'depreciation_id', 'asset_id', 'asset_name', 'period', 'date',
      'depreciation_amount', 'accumulated_total', 'net_book_value',
      'journal_ref', 'created_at'
    ],
    
    // ── System ──
    AuditLog: [
      'log_id', 'timestamp', 'user_email', 'module', 'action',
      'entity_id', 'details', 'client_info'
    ],
    
    Settings: [
      'key', 'value', 'description', 'updated_at'
    ],
    
    DashboardCache: [
      'cache_key', 'cache_value', 'expires_at', 'updated_at'
    ]
  };
  
  /**
   * Default Chart of Accounts for an SME.
   * Format: [code, name, type, parent, description, normal_balance, is_system, is_active]
   */
  var DEFAULT_COA = [
    // Assets (1xxx)
    ['1000', 'Assets', 'Asset', '', 'All asset accounts', 'Debit', true, true],
    ['1100', 'Cash on Hand', 'Asset', '1000', 'Physical cash', 'Debit', true, true],
    ['1110', 'Petty Cash', 'Asset', '1100', 'Petty cash float', 'Debit', true, true],
    ['1200', 'Bank Accounts', 'Asset', '1000', 'Bank account balances', 'Debit', true, true],
    ['1210', 'Main Bank Account', 'Asset', '1200', 'Primary business bank', 'Debit', true, true],
    ['1220', 'Mobile Money', 'Asset', '1200', 'Mobile money account', 'Debit', true, true],
    ['1300', 'Accounts Receivable', 'Asset', '1000', 'Trade debtors', 'Debit', true, true],
    ['1400', 'Inventory', 'Asset', '1000', 'Stock on hand', 'Debit', true, true],
    ['1500', 'Prepaid Expenses', 'Asset', '1000', 'Advance payments', 'Debit', true, true],
    ['1600', 'Fixed Assets', 'Asset', '1000', 'Property, plant & equipment', 'Debit', true, true],
    ['1610', 'Furniture & Equipment', 'Asset', '1600', 'Office furniture & equipment', 'Debit', true, true],
    ['1620', 'Vehicles', 'Asset', '1600', 'Motor vehicles', 'Debit', true, true],
    ['1630', 'Computer Equipment', 'Asset', '1600', 'IT hardware', 'Debit', true, true],
    ['1690', 'Accumulated Depreciation', 'Asset', '1600', 'Contra-asset for depreciation', 'Credit', true, true],
    
    // Liabilities (2xxx)
    ['2000', 'Liabilities', 'Liability', '', 'All liability accounts', 'Credit', true, true],
    ['2100', 'Accounts Payable', 'Liability', '2000', 'Trade creditors', 'Credit', true, true],
    ['2200', 'Tax Payable', 'Liability', '2000', 'Taxes owed', 'Credit', true, true],
    ['2210', 'VAT Payable', 'Liability', '2200', 'Value-added tax', 'Credit', true, true],
    ['2220', 'PAYE Payable', 'Liability', '2200', 'Pay-as-you-earn tax', 'Credit', true, true],
    ['2230', 'Pension Payable', 'Liability', '2200', 'Employee & employer pension', 'Credit', true, true],
    ['2240', 'Net Salary Payable', 'Liability', '2200', 'Net wages owed to employees', 'Credit', true, true],
    ['2300', 'Accrued Expenses', 'Liability', '2000', 'Expenses incurred but not yet paid', 'Credit', true, true],
    ['2400', 'Short-term Loans', 'Liability', '2000', 'Loans due within 1 year', 'Credit', true, true],
    ['2500', 'Long-term Loans', 'Liability', '2000', 'Loans due after 1 year', 'Credit', true, true],
    
    // Equity (3xxx)
    ['3000', 'Equity', 'Equity', '', 'Owner equity accounts', 'Credit', true, true],
    ['3100', 'Owner Capital', 'Equity', '3000', 'Capital invested by owner', 'Credit', true, true],
    ['3200', 'Retained Earnings', 'Equity', '3000', 'Accumulated profits', 'Credit', true, true],
    ['3300', 'Drawings', 'Equity', '3000', 'Owner withdrawals', 'Debit', true, true],
    
    // Revenue (4xxx)
    ['4000', 'Revenue', 'Revenue', '', 'All income accounts', 'Credit', true, true],
    ['4100', 'Sales Revenue', 'Revenue', '4000', 'Product & service sales', 'Credit', true, true],
    ['4200', 'Service Revenue', 'Revenue', '4000', 'Professional services', 'Credit', true, true],
    ['4300', 'Interest Income', 'Revenue', '4000', 'Bank interest earned', 'Credit', true, true],
    ['4400', 'Other Income', 'Revenue', '4000', 'Miscellaneous income', 'Credit', true, true],
    ['4500', 'Sales Discount', 'Revenue', '4000', 'Discounts given to customers', 'Debit', true, true],
    ['4600', 'Sales Returns', 'Revenue', '4000', 'Goods returned by customers', 'Debit', true, true],
    
    // Cost of Goods Sold (5xxx)
    ['5000', 'Cost of Goods Sold', 'COGS', '', 'Direct costs of sales', 'Debit', true, true],
    ['5100', 'Purchases', 'COGS', '5000', 'Goods purchased for resale', 'Debit', true, true],
    ['5200', 'Direct Labour', 'COGS', '5000', 'Labour directly tied to production', 'Debit', true, true],
    ['5300', 'Freight In', 'COGS', '5000', 'Shipping costs on purchases', 'Debit', true, true],
    
    // Operating Expenses (6xxx)
    ['6000', 'Operating Expenses', 'Expense', '', 'All operating expenses', 'Debit', true, true],
    ['6100', 'Salary & Wages', 'Expense', '6000', 'Employee compensation', 'Debit', true, true],
    ['6110', 'Employer Pension Contribution', 'Expense', '6000', 'SSNIT employer share', 'Debit', true, true],
    ['6200', 'Rent Expense', 'Expense', '6000', 'Office & shop rent', 'Debit', true, true],
    ['6300', 'Utilities', 'Expense', '6000', 'Electricity, water, internet', 'Debit', true, true],
    ['6400', 'Office Supplies', 'Expense', '6000', 'Stationery & supplies', 'Debit', true, true],
    ['6500', 'Transport & Fuel', 'Expense', '6000', 'Travel and fuel costs', 'Debit', true, true],
    ['6600', 'Insurance', 'Expense', '6000', 'Business insurance premiums', 'Debit', true, true],
    ['6700', 'Depreciation Expense', 'Expense', '6000', 'Asset depreciation charges', 'Debit', true, true],
    ['6800', 'Bank Charges', 'Expense', '6000', 'Bank fees & charges', 'Debit', true, true],
    ['6900', 'Repairs & Maintenance', 'Expense', '6000', 'Upkeep costs', 'Debit', true, true],
    ['6950', 'Professional Fees', 'Expense', '6000', 'Legal, audit, consulting', 'Debit', true, true],
    ['6980', 'Inventory Write-off Loss', 'Expense', '6000', 'Damaged or lost inventory', 'Debit', true, true],
    ['6990', 'Miscellaneous Expense', 'Expense', '6000', 'Other operating costs', 'Debit', true, true],

    // Inventory adjustment (contra-COGS for stock corrections)
    ['5400', 'Inventory Adjustments', 'COGS', '5000', 'Stock count adjustments (net impact)', 'Debit', true, true]
  ];
  
  /**
   * Default settings for a fresh installation.
   */
  var DEFAULT_SETTINGS = [
    ['company_name', 'My Company', 'Name of the business'],
    ['currency', 'GHS', 'Default currency code'],
    ['currency_symbol', 'GH₵', 'Currency display symbol'],
    ['default_tax_rate', '15', 'Default tax/VAT rate %'],
    ['tax_name', 'VAT', 'Tax name for invoices'],
    ['fiscal_year_start_month', '1', 'Fiscal year start month (1=Jan)'],
    ['default_payment_terms', '30', 'Default invoice payment terms (days)'],
    ['low_stock_threshold', '10', 'Low stock warning level'],
    ['valuation_method', 'weighted_average', 'Inventory valuation method'],
    ['invoice_prefix', 'INV-', 'Invoice number prefix'],
    ['receipt_prefix', 'REC-', 'Receipt number prefix'],
    ['po_prefix', 'PO-', 'Purchase order number prefix'],
    ['quotation_prefix', 'QUO-', 'Quotation number prefix'],
    ['pension_employee_rate', '5.5', 'Employee SSNIT (Tier 1) contribution % of basic'],
    ['pension_employer_rate', '13', 'Employer SSNIT contribution % of basic'],
    ['ssnit_monthly_cap', '61000', 'Monthly SSNIT insurable earnings ceiling (GHS)'],
    ['paye_bands', '490:0,110:5,130:10,3166.67:17.5,16000:25,30520:30,0:35', 'Monthly PAYE bands width:rate (last width 0 = remainder)'],
    ['depreciation_method', 'straight_line', 'Default depreciation method'],
    ['company_address', '', 'Business address'],
    ['company_phone', '', 'Business phone'],
    ['company_email', '', 'Business email'],
    ['company_tax_id', '', 'Tax identification number']
  ];
  
  /**
   * Default roles.
   */
  var DEFAULT_ROLES = [
    ['R001', 'Administrator', 'Full system access', 'all', 'Active'],
    ['R002', 'Accountant', 'Financial management access', 'accounting,sales,purchasing,expenses,cashbank,payroll,reports', 'Active'],
    ['R003', 'Inventory Officer', 'Inventory and purchasing access', 'inventory,purchasing,reports', 'Active'],
    ['R004', 'Sales Officer', 'Sales and customer access', 'sales,inventory,reports', 'Active'],
    ['R005', 'HR Officer', 'HR and payroll access', 'payroll,reports', 'Active'],
    ['R006', 'Viewer', 'View-only access', 'dashboard,reports', 'Active']
  ];
  
  // ─────────────────────────────────────────
  // MAIN INITIALIZATION
  // ─────────────────────────────────────────
  
  /**
   * Initialize the entire database.
   * Creates missing sheets, validates headers, seeds defaults.
   * @returns {Object} { success, message, details }
   */
  function initialize() {
    var results = {
      created: [],
      validated: [],
      repaired: [],
      seeded: [],
      errors: []
    };
    
    var ss = ConfigService.getSpreadsheet();
    Logger.log('Initializing database in spreadsheet: ' + ss.getId());
    
    // Process each sheet in the schema
    var sheetNames = Object.keys(SCHEMA);
    for (var i = 0; i < sheetNames.length; i++) {
      var sheetName = sheetNames[i];
      var expectedHeaders = SCHEMA[sheetName];
      
      try {
        var sheet = ss.getSheetByName(sheetName);
        
        if (!sheet) {
          // Create the sheet
          sheet = ss.insertSheet(sheetName);
          sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
          _formatHeaderRow(sheet, expectedHeaders.length);
          results.created.push(sheetName);
          Logger.log('Created sheet: ' + sheetName);
          
        } else {
          // Validate and repair headers
          var repairResult = _validateAndRepairHeaders(sheet, sheetName, expectedHeaders);
          if (repairResult.repaired) {
            results.repaired.push(sheetName + ': ' + repairResult.details);
          }
          results.validated.push(sheetName);
        }
        
      } catch (e) {
        results.errors.push(sheetName + ': ' + e.message);
        Logger.log('Error initializing ' + sheetName + ': ' + e.message);
      }
    }
    
    // Seed default data
    _seedDefaults(ss, results);
    
    // Remove the default "Sheet1" if it exists and is empty
    _cleanupDefaultSheet(ss);
    
    // Deduplicate users (cleans up first-run double-registration)
    _deduplicateUsers(ss);

    // Headers may have been repaired/added above — invalidate the per-execution
    // header cache so subsequent reads in this same execution see fresh headers.
    try { Utils.clearHeaderCache(); } catch (e) {}

    // Log the initialization
    AuditService.logSystem('database_init', JSON.stringify(results));
    
    return {
      success: results.errors.length === 0,
      message: 'Database initialization complete. Created: ' + results.created.length + 
               ', Validated: ' + results.validated.length +
               ', Repaired: ' + results.repaired.length +
               ', Errors: ' + results.errors.length,
      details: results
    };
  }
  
  /**
   * Validate headers and add missing columns without destroying data.
   * @param {Sheet} sheet
   * @param {string} sheetName
   * @param {string[]} expectedHeaders
   * @returns {Object} { repaired, details }
   */
  function _validateAndRepairHeaders(sheet, sheetName, expectedHeaders) {
    var result = { repaired: false, details: '' };

    // ── Case 1: Completely empty sheet ────────────────────────
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
      _formatHeaderRow(sheet, expectedHeaders.length);
      result.repaired = true;
      result.details = 'Set headers on empty sheet';
      return result;
    }

    // ── Case 2: Sheet has content — inspect row 1 ─────────────
    var numCols     = Math.max(sheet.getLastColumn(), expectedHeaders.length);
    var firstRow    = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
                          .map(function(h) { return h.toString().trim(); });

    // Detect whether row 1 is a real header row:
    // count how many cells match expected header names
    var matchCount = 0;
    for (var k = 0; k < firstRow.length; k++) {
      if (expectedHeaders.indexOf(firstRow[k]) !== -1) matchCount++;
    }
    var isHeaderRow = matchCount >= Math.ceil(expectedHeaders.length / 2);

    if (!isHeaderRow) {
      // Row 1 is DATA (not headers) — insert a header row at the top
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
      _formatHeaderRow(sheet, expectedHeaders.length);
      result.repaired = true;
      result.details = 'Inserted missing header row (data was in row 1)';
      Logger.log('Repaired ' + sheetName + ': inserted header row above data');
      return result;
    }

    // ── Case 3: Header row exists — add any missing columns ───
    var currentHeaders = firstRow;
    var missingCols = [];
    for (var i = 0; i < expectedHeaders.length; i++) {
      if (currentHeaders.indexOf(expectedHeaders[i]) === -1) {
        missingCols.push(expectedHeaders[i]);
      }
    }

    if (missingCols.length > 0) {
      var startCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, startCol, 1, missingCols.length).setValues([missingCols]);
      _formatHeaderRow(sheet, sheet.getLastColumn());
      result.repaired = true;
      result.details = 'Added columns: ' + missingCols.join(', ');
      Logger.log('Repaired ' + sheetName + ': added ' + missingCols.join(', '));
    }

    return result;
  }
  
  /**
   * Format the header row with bold, background color, and frozen row.
   * @param {Sheet} sheet
   * @param {number} numCols
   */
  function _formatHeaderRow(sheet, numCols) {
    var headerRange = sheet.getRange(1, 1, 1, numCols);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1a73e8');
    headerRange.setFontColor('#ffffff');
    headerRange.setWrap(true);
    sheet.setFrozenRows(1);
  }
  
  /**
   * Seed default data into required sheets.
   * Only seeds if the sheet is empty (beyond headers).
   */
  function _seedDefaults(ss, results) {
    
    // Seed Chart of Accounts
    var coaSheet = ss.getSheetByName('ChartOfAccounts');
    if (coaSheet && coaSheet.getLastRow() <= 1) {
      var coaData = DEFAULT_COA.map(function(row) {
        return row.concat([0, new Date(), new Date()]); // balance, created_at, updated_at
      });
      if (coaData.length > 0) {
        coaSheet.getRange(2, 1, coaData.length, coaData[0].length).setValues(coaData);
        results.seeded.push('ChartOfAccounts (' + coaData.length + ' accounts)');
      }
    }
    
    // Seed Settings
    var settingsSheet = ss.getSheetByName('Settings');
    if (settingsSheet && settingsSheet.getLastRow() <= 1) {
      var settingsData = DEFAULT_SETTINGS.map(function(row) {
        return row.concat([new Date()]); // updated_at
      });
      if (settingsData.length > 0) {
        settingsSheet.getRange(2, 1, settingsData.length, settingsData[0].length).setValues(settingsData);
        results.seeded.push('Settings (' + settingsData.length + ' defaults)');
      }
    }
    
    // Seed Roles
    var rolesSheet = ss.getSheetByName('Roles');
    if (rolesSheet && rolesSheet.getLastRow() <= 1) {
      var rolesData = DEFAULT_ROLES.map(function(row) {
        return row.concat([new Date(), new Date()]); // created_at, updated_at
      });
      if (rolesData.length > 0) {
        rolesSheet.getRange(2, 1, rolesData.length, rolesData[0].length).setValues(rolesData);
        results.seeded.push('Roles (' + rolesData.length + ' roles)');
      }
    }
  }
  
  /**
   * Remove duplicate user rows — keep the first occurrence of each email.
   * Called after init to clean up any double-registration from first-run.
   */
  function _deduplicateUsers(ss) {
    var sheet = ss.getSheetByName('Users');
    if (!sheet || sheet.getLastRow() <= 2) return; // 0-1 data rows, nothing to deduplicate

    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return h.toString().trim(); });
    var emailIdx = headers.indexOf('email');
    if (emailIdx < 0) return;

    var seen     = {};
    var toDelete = [];

    // Walk rows bottom-up so splice-by-index stays valid
    for (var i = data.length - 1; i >= 1; i--) {
      var email = (data[i][emailIdx] || '').toString().trim().toLowerCase();
      if (!email) continue;
      if (seen[email]) {
        toDelete.push(i + 1); // 1-based sheet row
      } else {
        seen[email] = true;
      }
    }

    // Delete duplicate rows (highest row first to preserve indices)
    toDelete.sort(function(a, b) { return b - a; });
    for (var d = 0; d < toDelete.length; d++) {
      sheet.deleteRow(toDelete[d]);
      Logger.log('DatabaseInit: removed duplicate user row ' + toDelete[d]);
    }

    if (toDelete.length > 0) {
      Logger.log('DatabaseInit: deduplicated Users sheet — removed ' + toDelete.length + ' duplicate(s)');
    }
  }

  /**
   * Remove the default "Sheet1" if it's empty and other sheets exist.
   */
  function _cleanupDefaultSheet(ss) {
    try {
      var defaultSheet = ss.getSheetByName('Sheet1');
      if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() <= 1) {
        ss.deleteSheet(defaultSheet);
      }
    } catch (e) {
      // Ignore - Sheet1 may not exist
    }
  }
  
  /**
   * Get the schema definition (for documentation/validation).
   * @returns {Object}
   */
  function getSchema() {
    return SCHEMA;
  }
  
  /**
   * Validate the database integrity.
   * @returns {Object} { valid, issues }
   */
  function validate() {
    var issues = [];
    var ss = ConfigService.getSpreadsheet();
    
    var sheetNames = Object.keys(SCHEMA);
    for (var i = 0; i < sheetNames.length; i++) {
      var name = sheetNames[i];
      var sheet = ss.getSheetByName(name);
      
      if (!sheet) {
        issues.push('Missing sheet: ' + name);
        continue;
      }
      
      var expected = SCHEMA[name];
      if (sheet.getLastRow() === 0) {
        issues.push('Empty sheet (no headers): ' + name);
        continue;
      }
      
      var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
        .map(function(h) { return h.toString().trim(); });
      
      for (var j = 0; j < expected.length; j++) {
        if (actual.indexOf(expected[j]) === -1) {
          issues.push(name + ': missing column "' + expected[j] + '"');
        }
      }
    }
    
    return {
      valid: issues.length === 0,
      issues: issues,
      sheetCount: sheetNames.length
    };
  }
  
  return {
    initialize: initialize,
    getSchema: getSchema,
    validate: validate,
    SCHEMA: SCHEMA
  };
  
})();
