/**
 * Accounting Engine
 * ==================
 * Core double-entry bookkeeping engine.
 * All financial transactions flow through this module to ensure
 * balanced journal entries and accurate ledger postings.
 *
 * Responsibilities:
 *   - Create and validate journal entries (debits = credits)
 *   - Post entries to the General Ledger with running balances
 *   - Update Chart of Accounts balances
 *   - Provide pre-built posting rules for operational modules
 *   - Support journal reversal
 *   - Generate trial balance
 */

var AccountingEngine = (function() {

  // ─────────────────────────────────────────
  // JOURNAL ENTRY CREATION
  // ─────────────────────────────────────────

  /**
   * Create and post a journal entry.
   *
   * @param {Object} params
   * @param {string} params.date          - Entry date
   * @param {string} params.description   - Human-readable description
   * @param {string} params.referenceType - Source module ('Invoice', 'Receipt', 'Expense', etc.)
   * @param {string} params.referenceId   - Source document ID
   * @param {Array}  params.lines         - Array of { accountCode, accountName, debit, credit }
   * @param {string} [params.status]      - Default 'Posted'
   * @returns {Object} { success, journalId, entryNumber }
   */
  function createJournalEntry(params) {
    // Validate
    var totalDebit = 0;
    var totalCredit = 0;

    if (!params.lines || params.lines.length < 2) {
      throw new Error('Journal entry must have at least two lines.');
    }

    for (var i = 0; i < params.lines.length; i++) {
      var line = params.lines[i];
      if (!line.accountCode) {
        throw new Error('Line ' + (i + 1) + ': account code is required.');
      }
      var dr = Utils.toFloat(line.debit, 0);
      var cr = Utils.toFloat(line.credit, 0);
      if (dr === 0 && cr === 0) {
        throw new Error('Line ' + (i + 1) + ': debit or credit must be non-zero.');
      }
      if (dr !== 0 && cr !== 0) {
        throw new Error('Line ' + (i + 1) + ': cannot have both debit and credit.');
      }
      totalDebit += dr;
      totalCredit += cr;
    }

    if (Utils.round2(totalDebit) !== Utils.round2(totalCredit)) {
      throw new Error(
        'Entry does not balance. Debits: ' + totalDebit.toFixed(2) +
        ', Credits: ' + totalCredit.toFixed(2)
      );
    }

    // Generate IDs
    var journalId = Utilities.getUuid();
    var entryNumber = Utils.generateDocNumber('JournalEntries', 'entry_number', 'JE-', 6);
    var entryDate = params.date ? new Date(params.date) : new Date();
    var period = Utilities.formatDate(entryDate, Session.getScriptTimeZone(), 'yyyy-MM');
    var status = params.status || 'Posted';
    var now = new Date();
    var userEmail = Utils.currentUserEmail();

    // Period-lock check: block posting into a closed period
    // (unless this is itself a closing/system entry)
    if (!params._allowClosedPeriod && _isPeriodClosed(period)) {
      throw new Error('Accounting period ' + period + ' is closed. Reopen it before posting.');
    }

    // Serialize posting so concurrent journal entries cannot interleave their
    // ledger writes and corrupt running balances / CoA balances.
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
    } catch (lockErr) {
      throw new Error('System busy posting another entry. Please retry.');
    }

    try {
      // Write journal lines (batched into one sheet operation)
      var jeRows = params.lines.map(function(ln) {
        return {
          journal_id: journalId,
          entry_number: entryNumber,
          date: entryDate,
          description: params.description || '',
          reference_type: params.referenceType || '',
          reference_id: params.referenceId || '',
          account_code: ln.accountCode,
          account_name: ln.accountName || '',
          debit: Utils.toFloat(ln.debit, 0),
          credit: Utils.toFloat(ln.credit, 0),
          status: status,
          period: period,
          posted_by: userEmail,
          approved_by: '',
          created_at: now,
          updated_at: now
        };
      });
      _appendRows('JournalEntries', jeRows);

      // Post to General Ledger and update CoA balances
      if (status === 'Posted') {
        _postToLedger(journalId, entryNumber, entryDate, params.description, params.lines, period);
      }
    } finally {
      lock.releaseLock();
    }

    AuditService.log('accounting', 'journal_posted', {
      journalId: journalId,
      entryNumber: entryNumber,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      totalDebit: totalDebit
    }, entryNumber);

    return {
      success: true,
      journalId: journalId,
      entryNumber: entryNumber
    };
  }

  /**
   * Post journal lines to the General Ledger and update CoA balances.
   * @private
   */
  function _postToLedger(journalId, entryNumber, entryDate, description, lines, period) {
    var now = new Date();

    // Load the Chart of Accounts ONCE (was: one full-sheet findRow per line).
    var coaResult = Utils.sheetToObjects('ChartOfAccounts', {});
    var coaByCode = {};
    coaResult.data.forEach(function(a) { coaByCode[a.account_code] = a; });

    // Accumulate balance changes per account so that multiple lines hitting
    // the same account in one entry chain correctly, and so each affected
    // account is written back exactly once.
    var newBalances = {}; // account_code -> { account, balance }

    var glRows = [];

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var dr = Utils.toFloat(ln.debit, 0);
      var cr = Utils.toFloat(ln.credit, 0);

      var account = coaByCode[ln.accountCode] || null;

      // Use the running figure if this account was already touched in this entry
      var currentBalance;
      if (newBalances[ln.accountCode]) {
        currentBalance = newBalances[ln.accountCode].balance;
      } else {
        currentBalance = account ? Utils.toFloat(account.balance, 0) : 0;
      }
      var normalBalance = account ? account.normal_balance : 'Debit';

      var newBalance;
      if (normalBalance === 'Debit') {
        newBalance = Utils.round2(currentBalance + dr - cr);
      } else {
        newBalance = Utils.round2(currentBalance + cr - dr);
      }

      glRows.push({
        ledger_id: Utilities.getUuid(),
        date: entryDate,
        account_code: ln.accountCode,
        account_name: ln.accountName || '',
        journal_id: journalId,
        description: description || '',
        debit: dr,
        credit: cr,
        running_balance: newBalance,
        period: period,
        created_at: now
      });

      if (account) {
        newBalances[ln.accountCode] = { account: account, balance: newBalance };
      }
    }

    // Batch-append all GL rows in one operation.
    _appendRows('GeneralLedger', glRows);

    // Write back each affected CoA balance once.
    for (var code in newBalances) {
      var entry = newBalances[code];
      Utils.updateRow('ChartOfAccounts', entry.account._rowIndex, {
        balance: entry.balance,
        updated_at: now
      });
    }
  }

  /**
   * Append multiple rows to a sheet in a single setValues() call.
   * Falls back to Utils.appendRow for a single row.
   * @private
   */
  function _appendRows(sheetName, objs) {
    if (!objs || objs.length === 0) return;
    if (objs.length === 1) { Utils.appendRow(sheetName, objs[0]); return; }

    var sheet = ConfigService.getSheet(sheetName);
    var headers = Utils.getHeaders(sheetName);
    var matrix = objs.map(function(obj) {
      return headers.map(function(h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
    });
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, matrix.length, headers.length).setValues(matrix);
  }

  // ─────────────────────────────────────────
  // REVERSAL
  // ─────────────────────────────────────────

  /**
   * Reverse a journal entry by creating a mirror entry.
   * @param {string} journalId - Original journal ID
   * @param {string} reason    - Reason for reversal
   * @returns {Object} { success, reversalJournalId, reversalEntryNumber }
   */
  function reverseJournalEntry(journalId, reason) {
    var result = Utils.sheetToObjects('JournalEntries', {
      filters: { journal_id: journalId }
    });
    var originalLines = result.data;

    if (originalLines.length === 0) {
      throw new Error('Journal entry not found: ' + journalId);
    }

    // Check it hasn't already been reversed
    if (originalLines[0].status === 'Reversed') {
      throw new Error('Journal entry already reversed.');
    }

    // Build reversal lines (swap debit/credit)
    var reversalLines = originalLines.map(function(ln) {
      return {
        accountCode: ln.account_code,
        accountName: ln.account_name,
        debit: Utils.toFloat(ln.credit, 0),
        credit: Utils.toFloat(ln.debit, 0)
      };
    });

    // Create reversal entry
    var reversal = createJournalEntry({
      date: new Date(),
      description: 'REVERSAL: ' + (originalLines[0].description || '') + (reason ? ' - ' + reason : ''),
      referenceType: 'Reversal',
      referenceId: journalId,
      lines: reversalLines,
      status: 'Posted'
    });

    // Mark original as reversed
    for (var i = 0; i < originalLines.length; i++) {
      Utils.updateRow('JournalEntries', originalLines[i]._rowIndex, {
        status: 'Reversed',
        updated_at: new Date()
      });
    }

    return {
      success: true,
      reversalJournalId: reversal.journalId,
      reversalEntryNumber: reversal.entryNumber
    };
  }

  // ─────────────────────────────────────────
  // PRE-BUILT POSTING RULES
  // ─────────────────────────────────────────

  /**
   * Post a sales invoice.
   * Dr Accounts Receivable (1300)  — total
   * Cr Sales Revenue (4100)        — subtotal
   * Cr VAT Payable (2210)          — tax
   *
   * @param {Object} invoice - { invoice_id, invoice_number, customer_name, subtotal, tax_amount, total, date }
   * @returns {Object} Journal result
   */
  function postInvoice(invoice) {
    var lines = [];

    // Dr Accounts Receivable
    lines.push({
      accountCode: '1300',
      accountName: 'Accounts Receivable',
      debit: Utils.round2(Utils.toFloat(invoice.total, 0)),
      credit: 0
    });

    // Cr Sales Revenue
    lines.push({
      accountCode: '4100',
      accountName: 'Sales Revenue',
      debit: 0,
      credit: Utils.round2(Utils.toFloat(invoice.subtotal, 0))
    });

    // Cr VAT Payable (only if tax > 0)
    var tax = Utils.round2(Utils.toFloat(invoice.tax_amount, 0));
    if (tax > 0) {
      lines.push({
        accountCode: '2210',
        accountName: 'VAT Payable',
        debit: 0,
        credit: tax
      });
    }

    // Handle discount if present
    var discount = Utils.round2(Utils.toFloat(invoice.discount_amount, 0));
    if (discount > 0) {
      lines.push({
        accountCode: '4500',
        accountName: 'Sales Discount',
        debit: discount,
        credit: 0
      });
      // Adjust AR down by discount (already reflected in total)
    }

    return createJournalEntry({
      date: invoice.date,
      description: 'Sales Invoice ' + (invoice.invoice_number || '') + ' - ' + (invoice.customer_name || ''),
      referenceType: 'Invoice',
      referenceId: invoice.invoice_id,
      lines: lines
    });
  }

  /**
   * Post a customer receipt.
   * Dr Cash/Bank (1100/1210/1220)  — amount
   * Cr Accounts Receivable (1300)  — amount
   *
   * @param {Object} receipt - { receipt_id, receipt_number, customer_name, amount, payment_method, date }
   * @returns {Object} Journal result
   */
  function postReceipt(receipt) {
    var cashAccount = _getPaymentAccount(receipt.payment_method);

    return createJournalEntry({
      date: receipt.date,
      description: 'Receipt ' + (receipt.receipt_number || '') + ' from ' + (receipt.customer_name || ''),
      referenceType: 'Receipt',
      referenceId: receipt.receipt_id,
      lines: [
        {
          accountCode: cashAccount.code,
          accountName: cashAccount.name,
          debit: Utils.round2(Utils.toFloat(receipt.amount, 0)),
          credit: 0
        },
        {
          accountCode: '1300',
          accountName: 'Accounts Receivable',
          debit: 0,
          credit: Utils.round2(Utils.toFloat(receipt.amount, 0))
        }
      ]
    });
  }

  /**
   * Map payment methods to cash/bank accounts.
   * @private
   */
  function _getPaymentAccount(method) {
    var map = {
      'Cash': { code: '1100', name: 'Cash on Hand' },
      'Bank Transfer': { code: '1210', name: 'Main Bank Account' },
      'Mobile Money': { code: '1220', name: 'Mobile Money' },
      'Cheque': { code: '1210', name: 'Main Bank Account' },
      'Card': { code: '1210', name: 'Main Bank Account' }
    };
    return map[method] || { code: '1100', name: 'Cash on Hand' };
  }

  // ─────────────────────────────────────────
  // INVENTORY POSTING RULES
  // ─────────────────────────────────────────

  /**
   * Post Cost of Goods Sold when inventory is consumed by a sale.
   * Dr Cost of Goods Sold (5000)  — cost value
   * Cr Inventory (1400)           — cost value
   *
   * @param {Object} params - { product_name, cost_value, reference_id, reference_type, date }
   * @returns {Object} Journal result
   */
  function postCOGS(params) {
    var value = Utils.round2(Math.abs(Utils.toFloat(params.cost_value, 0)));
    if (value === 0) return { success: true, skipped: true };

    return createJournalEntry({
      date: params.date,
      description: 'COGS: ' + (params.product_name || ''),
      referenceType: params.reference_type || 'COGS',
      referenceId: params.reference_id,
      lines: [
        { accountCode: '5000', accountName: 'Cost of Goods Sold', debit: value, credit: 0 },
        { accountCode: '1400', accountName: 'Inventory',           debit: 0,     credit: value }
      ]
    });
  }

  /**
   * Post a stock adjustment.
   * Positive adjustment → Dr Inventory (1400), Cr Inventory Adjustments (5400)
   * Negative adjustment → Dr Inventory Adjustments (5400), Cr Inventory (1400)
   *
   * @param {Object} params - { product_name, quantity, adjustment_value, reference_id, date }
   *   adjustment_value: signed (positive = stock in, negative = stock out)
   */
  function postStockAdjustment(params) {
    var value = Utils.round2(Math.abs(Utils.toFloat(params.adjustment_value, 0)));
    if (value === 0) return { success: true, skipped: true };

    var isPositive = Utils.toFloat(params.adjustment_value, 0) >= 0;
    var qtyStr = (isPositive ? '+' : '-') + Math.abs(Utils.toFloat(params.quantity, 0));

    return createJournalEntry({
      date: params.date,
      description: 'Stock Adjustment: ' + (params.product_name || '') + ' (' + qtyStr + ' units)',
      referenceType: 'StockAdjustment',
      referenceId: params.reference_id,
      lines: isPositive
        ? [
            { accountCode: '1400', accountName: 'Inventory',              debit: value, credit: 0     },
            { accountCode: '5400', accountName: 'Inventory Adjustments',  debit: 0,     credit: value }
          ]
        : [
            { accountCode: '5400', accountName: 'Inventory Adjustments',  debit: value, credit: 0     },
            { accountCode: '1400', accountName: 'Inventory',              debit: 0,     credit: value }
          ]
    });
  }

  /**
   * Post an inventory damage / write-off.
   * Dr Inventory Write-off Loss (6980)  — cost value
   * Cr Inventory (1400)                 — cost value
   *
   * @param {Object} params - { product_name, damage_value, reference_id, date }
   */
  function postInventoryDamage(params) {
    var value = Utils.round2(Math.abs(Utils.toFloat(params.damage_value, 0)));
    if (value === 0) return { success: true, skipped: true };

    return createJournalEntry({
      date: params.date,
      description: 'Inventory Write-off: ' + (params.product_name || ''),
      referenceType: 'InventoryDamage',
      referenceId: params.reference_id,
      lines: [
        { accountCode: '6980', accountName: 'Inventory Write-off Loss', debit: value, credit: 0     },
        { accountCode: '1400', accountName: 'Inventory',                debit: 0,     credit: value }
      ]
    });
  }

  /**
   * Post a customer return (goods received back from customer).
   * Revenue side:  Dr Sales Returns (4600), Cr Accounts Receivable (1300)
   * Inventory side: Dr Inventory (1400), Cr Cost of Goods Sold (5000)
   *
   * @param {Object} params
   *   cost_value  — cost of returned goods
   *   sale_value  — selling price of returned goods (for A/R reversal)
   *   product_name, quantity, reference_id, date
   */
  function postCustomerReturn(params) {
    var costValue = Utils.round2(Math.abs(Utils.toFloat(params.cost_value, 0)));
    var saleValue = Utils.round2(Math.abs(Utils.toFloat(params.sale_value, 0)));
    var lines = [];

    // Inventory restoration
    if (costValue > 0) {
      lines.push({ accountCode: '1400', accountName: 'Inventory',              debit: costValue, credit: 0         });
      lines.push({ accountCode: '5000', accountName: 'Cost of Goods Sold',     debit: 0,         credit: costValue });
    }

    // Revenue reversal
    if (saleValue > 0) {
      lines.push({ accountCode: '4600', accountName: 'Sales Returns',          debit: saleValue, credit: 0         });
      lines.push({ accountCode: '1300', accountName: 'Accounts Receivable',    debit: 0,         credit: saleValue });
    }

    if (lines.length === 0) return { success: true, skipped: true };

    return createJournalEntry({
      date: params.date,
      description: 'Customer Return: ' + (params.product_name || '') + ' x' + (params.quantity || ''),
      referenceType: 'CustomerReturn',
      referenceId: params.reference_id,
      lines: lines
    });
  }

  /**
   * Post a supplier return (goods returned to supplier).
   * Dr Accounts Payable (2100)  — cost value
   * Cr Inventory (1400)         — cost value
   *
   * @param {Object} params - { product_name, quantity, cost_value, reference_id, date }
   */
  function postSupplierReturn(params) {
    var value = Utils.round2(Math.abs(Utils.toFloat(params.cost_value, 0)));
    if (value === 0) return { success: true, skipped: true };

    return createJournalEntry({
      date: params.date,
      description: 'Supplier Return: ' + (params.product_name || '') + ' x' + (params.quantity || ''),
      referenceType: 'SupplierReturn',
      referenceId: params.reference_id,
      lines: [
        { accountCode: '2100', accountName: 'Accounts Payable', debit: value, credit: 0     },
        { accountCode: '1400', accountName: 'Inventory',         debit: 0,     credit: value }
      ]
    });
  }

  /**
   * Post opening / initial stock value.
   * Dr Inventory (1400)        — opening value
   * Cr Retained Earnings (3200) — contra (equity injection)
   *
   * @param {Object} params - { product_name, value, reference_id, date }
   */
  function postOpeningStock(params) {
    var value = Utils.round2(Math.abs(Utils.toFloat(params.value, 0)));
    if (value === 0) return { success: true, skipped: true };

    return createJournalEntry({
      date: params.date,
      description: 'Opening Stock: ' + (params.product_name || ''),
      referenceType: 'OpeningStock',
      referenceId: params.reference_id,
      lines: [
        { accountCode: '1400', accountName: 'Inventory',          debit: value, credit: 0     },
        { accountCode: '3200', accountName: 'Retained Earnings',  debit: 0,     credit: value }
      ]
    });
  }

  // ─────────────────────────────────────────
  // REPORTING HELPERS
  // ─────────────────────────────────────────

  /**
   * Get account balance from the Chart of Accounts.
   * @param {string} accountCode
   * @returns {number}
   */
  function getAccountBalance(accountCode) {
    var account = Utils.findRow('ChartOfAccounts', 'account_code', accountCode);
    return account ? Utils.toFloat(account.balance, 0) : 0;
  }

  /**
   * Generate a trial balance.
   * @param {string} [asOfDate] - Optional date (defaults to now)
   * @returns {Object} { accounts: [], totalDebits, totalCredits, balanced }
   */
  function getTrialBalance(asOfDate) {
    var result = Utils.sheetToObjects('ChartOfAccounts', {
      filters: { is_active: true },
      sort: 'account_code',
      order: 'asc'
    });
    var accounts = result.data;

    var totalDebits = 0;
    var totalCredits = 0;
    var trialBalance = [];

    for (var i = 0; i < accounts.length; i++) {
      var acc = accounts[i];
      var bal = Utils.toFloat(acc.balance, 0);
      if (bal === 0) continue; // skip zero-balance accounts

      var debitBal = 0;
      var creditBal = 0;

      if (acc.normal_balance === 'Debit') {
        if (bal >= 0) { debitBal = bal; } else { creditBal = Math.abs(bal); }
      } else {
        if (bal >= 0) { creditBal = bal; } else { debitBal = Math.abs(bal); }
      }

      totalDebits += debitBal;
      totalCredits += creditBal;

      trialBalance.push({
        accountCode: acc.account_code,
        accountName: acc.account_name,
        accountType: acc.account_type,
        debit: Utils.round2(debitBal),
        credit: Utils.round2(creditBal)
      });
    }

    return {
      accounts: trialBalance,
      totalDebits: Utils.round2(totalDebits),
      totalCredits: Utils.round2(totalCredits),
      balanced: Utils.round2(totalDebits) === Utils.round2(totalCredits),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Get ledger entries for a specific account.
   * @param {string} accountCode
   * @param {Object} [dateRange] - { start, end }
   * @returns {Object[]}
   */
  function getAccountLedger(accountCode, dateRange) {
    var result = Utils.sheetToObjects('GeneralLedger', {
      filters: { account_code: accountCode },
      sort: 'date',
      order: 'asc'
    });
    var entries = result.data;

    if (dateRange) {
      var start = new Date(dateRange.start);
      var end = new Date(dateRange.end);
      entries = entries.filter(function(e) {
        var d = new Date(e.date);
        return d >= start && d <= end;
      });
    }

    return entries;
  }

  // ─────────────────────────────────────────
  // CHART OF ACCOUNTS SERVICE
  // ─────────────────────────────────────────

  /**
   * List all accounts.
   */
  function listAccounts(data) {
    return Utils.sheetToObjects('ChartOfAccounts', data || { sort: 'account_code', order: 'asc' });
  }

  /**
   * Get a single account by code.
   */
  function getAccount(data) {
    return Utils.findRow('ChartOfAccounts', 'account_code', data.id || data.code);
  }

  /**
   * Create a new account.
   */
  function createAccount(data) {
    data = Validators.sanitizeObject(data);
    var v = Validators.required(data, ['account_code', 'account_name', 'account_type']);
    if (!v.valid) throw new Error(v.errors.join(', '));

    // Check for duplicate code
    var existing = Utils.findRow('ChartOfAccounts', 'account_code', data.account_code);
    if (existing) throw new Error('Account code already exists: ' + data.account_code);

    data.normal_balance = data.normal_balance || _inferNormalBalance(data.account_type);
    data.is_system = false;
    data.is_active = true;
    data.balance = 0;
    data.created_at = new Date();
    data.updated_at = new Date();

    Utils.appendRow('ChartOfAccounts', data);
    AuditService.log('accounting', 'account_created', data, data.account_code);
    return { success: true, code: data.account_code };
  }

  /**
   * Update an existing account.
   */
  function updateAccount(data) {
    var existing = Utils.findRow('ChartOfAccounts', 'account_code', data.account_code || data.id);
    if (!existing) throw new Error('Account not found');
    if (existing.is_system === true) {
      // Only allow updating description and name on system accounts
      var allowed = { account_name: true, description: true };
      for (var key in data) {
        if (!allowed[key] && key !== 'account_code' && key !== 'id') {
          delete data[key];
        }
      }
    }
    data.updated_at = new Date();
    Utils.updateRow('ChartOfAccounts', existing._rowIndex, Validators.sanitizeObject(data));
    return { success: true };
  }

  /**
   * Infer normal balance from account type.
   * @private
   */
  function _inferNormalBalance(accountType) {
    var debitTypes = { 'Asset': true, 'Expense': true, 'COGS': true };
    return debitTypes[accountType] ? 'Debit' : 'Credit';
  }

  // ─────────────────────────────────────────
  // GENERAL LEDGER (consolidated)
  // ─────────────────────────────────────────

  /**
   * Get a consolidated general ledger grouped by account, with opening
   * and closing balances per account for a date range.
   *
   * @param {Object} [params] - { start, end, accountCode }
   * @returns {Object} { accounts: [ { code, name, type, opening, debits, credits, closing, entries:[] } ], range }
   */
  function getGeneralLedger(params) {
    params = params || {};
    var start = params.start ? new Date(params.start) : null;
    var end   = params.end ? new Date(params.end) : null;
    if (end) end.setHours(23, 59, 59, 999);

    var glResult = Utils.sheetToObjects('GeneralLedger', {
      sort: 'date', order: 'asc'
    });
    var rows = glResult.data;

    // Optional single-account filter
    if (params.accountCode) {
      rows = rows.filter(function(r) { return r.account_code === params.accountCode; });
    }

    // Load CoA for type + normal balance
    var coa = {};
    Utils.sheetToObjects('ChartOfAccounts', {}).data.forEach(function(a) {
      coa[a.account_code] = a;
    });

    var byAccount = {};

    rows.forEach(function(r) {
      var code = r.account_code;
      if (!byAccount[code]) {
        byAccount[code] = {
          code:     code,
          name:     r.account_name || (coa[code] ? coa[code].account_name : ''),
          type:     coa[code] ? coa[code].account_type : '',
          normal:   coa[code] ? coa[code].normal_balance : 'Debit',
          opening:  0,
          debits:   0,
          credits:  0,
          closing:  0,
          entries:  []
        };
      }
      var acc = byAccount[code];
      var dr  = Utils.toFloat(r.debit, 0);
      var cr  = Utils.toFloat(r.credit, 0);
      var d   = new Date(r.date);

      var signed = (acc.normal === 'Debit') ? (dr - cr) : (cr - dr);

      // Before the range → contributes to opening balance
      if (start && d < start) {
        acc.opening = Utils.round2(acc.opening + signed);
        return;
      }
      // After the range → ignore
      if (end && d > end) return;

      // Within range
      acc.debits  = Utils.round2(acc.debits + dr);
      acc.credits = Utils.round2(acc.credits + cr);
      acc.entries.push({
        date:        r.date,
        journal_id:  r.journal_id,
        description: r.description,
        debit:       dr,
        credit:      cr
      });
    });

    // Compute closing balances
    var accounts = [];
    var totalDr = 0, totalCr = 0;
    for (var code in byAccount) {
      var a = byAccount[code];
      var net = (a.normal === 'Debit') ? (a.debits - a.credits) : (a.credits - a.debits);
      a.closing = Utils.round2(a.opening + net);
      totalDr += a.debits;
      totalCr += a.credits;
      accounts.push(a);
    }

    accounts.sort(function(x, y) { return x.code < y.code ? -1 : 1; });

    return {
      accounts:     accounts,
      totalDebits:  Utils.round2(totalDr),
      totalCredits: Utils.round2(totalCr),
      range:        { start: params.start || null, end: params.end || null },
      generatedAt:  new Date().toISOString()
    };
  }

  // ─────────────────────────────────────────
  // PERIOD MANAGEMENT
  // ─────────────────────────────────────────

  /**
   * Check whether a period (yyyy-MM) is closed.
   * @private
   */
  function _isPeriodClosed(period) {
    var row = Utils.findRow('AccountingPeriods', 'period', period);
    return !!(row && row.status === 'Closed');
  }

  /**
   * List all accounting periods with their status.
   */
  function listPeriods() {
    var result = Utils.sheetToObjects('AccountingPeriods', {
      sort: 'period', order: 'desc'
    });
    return result.data;
  }

  /**
   * Close an accounting period.
   *
   * Posts a closing journal entry that transfers the net of all Revenue,
   * COGS, and Expense account balances into Retained Earnings (3200),
   * then marks the period as Closed and locks further postings.
   *
   * @param {Object} params - { period: 'yyyy-MM', notes }
   * @returns {Object} { success, period, netIncome, closingJournalId }
   */
  function closePeriod(params) {
    var period = params.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      throw new Error('Invalid period. Expected format yyyy-MM.');
    }
    if (_isPeriodClosed(period)) {
      throw new Error('Period ' + period + ' is already closed.');
    }

    // Compute P&L for the period from the GL
    var bounds = _periodBounds(period);
    var pl = getProfitAndLoss({ start: bounds.start, end: bounds.end });

    // Build closing entry: zero out each P&L account by posting the opposite
    // of its in-period net movement. This works for normal AND contra accounts
    // because we reverse whatever net debit/credit the account actually carries.
    var glForClose = getGeneralLedger({ start: bounds.start, end: bounds.end });
    var lines = [];
    var reAmount = 0; // net income: positive = profit (credit to RE)

    glForClose.accounts.forEach(function(a) {
      if (['Revenue', 'COGS', 'Expense'].indexOf(a.type) === -1) return;
      var net = Utils.round2(a.debits - a.credits); // positive = net debit balance
      if (net === 0) return;

      if (net > 0) {
        // Account carries a net debit → credit it to close
        lines.push({ accountCode: a.code, accountName: a.name, debit: 0, credit: net });
      } else {
        // Account carries a net credit → debit it to close
        lines.push({ accountCode: a.code, accountName: a.name, debit: Math.abs(net), credit: 0 });
      }

      // Net income contribution:
      //   Revenue (credit-natural) increases income by its net credit (= -net)
      //   COGS/Expense (debit-natural) decrease income by their net debit (= net)
      if (a.type === 'Revenue') {
        reAmount += Utils.round2(-net);
      } else {
        reAmount -= Utils.round2(net);
      }
    });
    reAmount = Utils.round2(reAmount);

    var closingJournalId = '';
    if (lines.length > 0) {
      // Balancing line to Retained Earnings
      if (reAmount >= 0) {
        // Net profit → credit Retained Earnings
        lines.push({ accountCode: '3200', accountName: 'Retained Earnings', debit: 0, credit: Utils.round2(reAmount) });
      } else {
        // Net loss → debit Retained Earnings
        lines.push({ accountCode: '3200', accountName: 'Retained Earnings', debit: Utils.round2(Math.abs(reAmount)), credit: 0 });
      }

      var closing = createJournalEntry({
        date:          bounds.end,
        description:   'Period close ' + period + ' — transfer net income to Retained Earnings',
        referenceType: 'PeriodClose',
        referenceId:   period,
        lines:         lines,
        _allowClosedPeriod: true
      });
      closingJournalId = closing.journalId;
    }

    // Record / update the period as closed
    var now = new Date();
    var user = _user();
    var existing = Utils.findRow('AccountingPeriods', 'period', period);
    var record = {
      period:             period,
      status:             'Closed',
      closed_by:          user,
      closed_at:          now,
      closing_journal_id: closingJournalId,
      net_income:         Utils.round2(reAmount),
      notes:              params.notes || '',
      updated_at:         now
    };

    if (existing) {
      Utils.updateRow('AccountingPeriods', existing._rowIndex, record);
    } else {
      record.created_at = now;
      Utils.appendRow('AccountingPeriods', record);
    }

    AuditService.log('accounting', 'period_closed', {
      period: period, netIncome: reAmount, journalId: closingJournalId
    }, period);

    return {
      success:          true,
      period:           period,
      netIncome:        Utils.round2(reAmount),
      closingJournalId: closingJournalId
    };
  }

  /**
   * Reopen a closed period.
   * Reverses the closing journal entry and unlocks the period.
   *
   * @param {Object} params - { period, reason }
   * @returns {Object} { success, period }
   */
  function reopenPeriod(params) {
    var period = params.period;
    var record = Utils.findRow('AccountingPeriods', 'period', period);
    if (!record) throw new Error('Period ' + period + ' has no close record.');
    if (record.status !== 'Closed') throw new Error('Period ' + period + ' is not closed.');

    // Reverse the closing journal entry if one exists
    if (record.closing_journal_id) {
      try {
        reverseJournalEntry(record.closing_journal_id, 'Period ' + period + ' reopened');
      } catch (e) {
        Logger.log('reopenPeriod: could not reverse closing JE: ' + e.message);
      }
    }

    var now = new Date();
    Utils.updateRow('AccountingPeriods', record._rowIndex, {
      status:       'Open',
      reopened_by:  _user(),
      reopened_at:  now,
      notes:        (record.notes || '') + ' | Reopened: ' + (params.reason || ''),
      updated_at:   now
    });

    AuditService.log('accounting', 'period_reopened', {
      period: period, reason: params.reason
    }, period);

    return { success: true, period: period };
  }

  /**
   * Get the first and last calendar day of a yyyy-MM period.
   * @private
   */
  function _periodBounds(period) {
    var parts = period.split('-');
    var year  = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10); // 1-12
    var start = new Date(year, month - 1, 1, 0, 0, 0);
    var end   = new Date(year, month, 0, 23, 59, 59); // day 0 of next month = last day
    return { start: start, end: end };
  }

  // ─────────────────────────────────────────
  // FINANCIAL STATEMENTS
  // ─────────────────────────────────────────

  /**
   * Generate a Profit & Loss statement for a date range, computed from the GL.
   *
   * @param {Object} params - { start, end }
   * @returns {Object} P&L with revenue, cogs, expenses, grossProfit, netProfit
   */
  function getProfitAndLoss(params) {
    var gl = getGeneralLedger({ start: params.start, end: params.end });

    var revenue = [], cogs = [], expenses = [];
    var totalRevenue = 0, totalCogs = 0, totalExpenses = 0;
    var rawAccounts = [];

    gl.accounts.forEach(function(a) {
      // Raw debit/credit movement within the range
      var net = Utils.round2(a.debits - a.credits); // positive = net debit

      if (a.type === 'Revenue') {
        // Revenue is naturally a credit. Contribution to revenue = net credits
        // = -(net debit). A normal credit account yields a positive figure;
        // a contra-revenue account (e.g. Sales Returns, normal Debit) yields
        // a negative figure that correctly reduces total revenue.
        var rev = Utils.round2(-net);
        if (rev === 0) return;
        revenue.push({ code: a.code, name: a.name, amount: rev });
        totalRevenue += rev;
        rawAccounts.push({ code: a.code, name: a.name, group: 'Revenue', amount: rev });

      } else if (a.type === 'COGS') {
        // COGS is naturally a debit. Contribution = net debit.
        var cg = net;
        if (cg === 0) return;
        cogs.push({ code: a.code, name: a.name, amount: cg });
        totalCogs += cg;
        rawAccounts.push({ code: a.code, name: a.name, group: 'COGS', amount: cg });

      } else if (a.type === 'Expense') {
        // Expense is naturally a debit. Contribution = net debit.
        var ex = net;
        if (ex === 0) return;
        expenses.push({ code: a.code, name: a.name, amount: ex });
        totalExpenses += ex;
        rawAccounts.push({ code: a.code, name: a.name, group: 'Expense', amount: ex });
      }
    });

    var grossProfit = Utils.round2(totalRevenue - totalCogs);
    var netProfit   = Utils.round2(grossProfit - totalExpenses);

    return {
      revenue:       revenue,
      cogs:          cogs,
      expenses:      expenses,
      totalRevenue:  Utils.round2(totalRevenue),
      totalCogs:     Utils.round2(totalCogs),
      totalExpenses: Utils.round2(totalExpenses),
      grossProfit:   grossProfit,
      netProfit:     netProfit,
      grossMargin:   totalRevenue !== 0 ? Utils.round2(grossProfit / totalRevenue * 100) : 0,
      netMargin:     totalRevenue !== 0 ? Utils.round2(netProfit / totalRevenue * 100) : 0,
      range:         { start: params.start || null, end: params.end || null },
      _rawAccounts:  rawAccounts,
      generatedAt:   new Date().toISOString()
    };
  }

  /**
   * Generate a Balance Sheet as of a given date, computed from the GL.
   * Validates that Assets = Liabilities + Equity (+ current-period net income).
   *
   * @param {Object} params - { asOf }
   * @returns {Object} Balance sheet with assets, liabilities, equity sections
   */
  function getBalanceSheet(params) {
    params = params || {};
    var asOf = params.asOf ? new Date(params.asOf) : new Date();
    asOf.setHours(23, 59, 59, 999);

    // Closing balances as of asOf (opening from start of time → asOf)
    var gl = getGeneralLedger({ end: Utilities.formatDate(asOf, Session.getScriptTimeZone(), 'yyyy-MM-dd') });

    var assets = [], liabilities = [], equity = [];
    var totalAssets = 0, totalLiabilities = 0, totalEquity = 0;
    var netIncomeToDate = 0; // revenue - cogs - expenses (not yet closed to RE)

    gl.accounts.forEach(function(a) {
      var bal = Utils.round2(a.closing);
      if (bal === 0) return;

      if (a.type === 'Asset') {
        assets.push({ code: a.code, name: a.name, amount: bal });
        totalAssets += bal;
      } else if (a.type === 'Liability') {
        liabilities.push({ code: a.code, name: a.name, amount: bal });
        totalLiabilities += bal;
      } else if (a.type === 'Equity') {
        equity.push({ code: a.code, name: a.name, amount: bal });
        totalEquity += bal;
      } else if (a.type === 'Revenue') {
        // Revenue raises income; contra-revenue (normal Debit, e.g. Sales
        // Returns) lowers it. `bal` is already normal-balance-signed, so a
        // credit-normal revenue account contributes +bal and a debit-normal
        // contra account contributes -bal.
        netIncomeToDate += (a.normal === 'Credit') ? bal : -bal;
      } else if (a.type === 'COGS' || a.type === 'Expense') {
        // Expenses lower income; a contra-expense (normal Credit) raises it.
        netIncomeToDate -= (a.normal === 'Debit') ? bal : -bal;
      }
    });

    netIncomeToDate = Utils.round2(netIncomeToDate);

    // Current-period earnings appear in equity until closed
    if (netIncomeToDate !== 0) {
      equity.push({ code: '3900', name: 'Current Period Earnings', amount: netIncomeToDate });
      totalEquity += netIncomeToDate;
    }

    totalAssets      = Utils.round2(totalAssets);
    totalLiabilities = Utils.round2(totalLiabilities);
    totalEquity      = Utils.round2(totalEquity);

    var totalLiabEquity = Utils.round2(totalLiabilities + totalEquity);
    var balanced = Utils.round2(totalAssets) === totalLiabEquity;

    return {
      assets:           assets,
      liabilities:      liabilities,
      equity:           equity,
      totalAssets:      totalAssets,
      totalLiabilities: totalLiabilities,
      totalEquity:      totalEquity,
      totalLiabilitiesAndEquity: totalLiabEquity,
      netIncomeToDate:  netIncomeToDate,
      balanced:         balanced,
      difference:       Utils.round2(totalAssets - totalLiabEquity),
      asOf:             Utilities.formatDate(asOf, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      generatedAt:      new Date().toISOString()
    };
  }

  /**
   * Generate a Cash Flow Statement (indirect method) for a date range.
   *
   * Operating  = net income +/- changes in working-capital accounts
   *              (receivables, inventory, payables, tax/pension/wage liabilities)
   * Investing  = change in fixed-asset accounts (1500-1599)
   * Financing  = change in equity (excl. current earnings) and long-term debt
   *
   * The net change in cash is reconciled against the actual movement in the
   * cash/bank asset accounts (1100-1299) so the statement is self-checking.
   *
   * @param {Object} params - { start, end }
   * @returns {Object} cash flow statement with reconciliation
   */
  function getCashFlow(params) {
    params = params || {};
    var startStr = params.start ? Utilities.formatDate(new Date(params.start), Session.getScriptTimeZone(), 'yyyy-MM-dd') : null;
    var endStr   = params.end ? Utilities.formatDate(new Date(params.end), Session.getScriptTimeZone(), 'yyyy-MM-dd') : null;

    // Movement within the range for every account
    var gl = getGeneralLedger({ start: startStr, end: endStr });

    // Net income for the period (P&L) drives operating activities
    var pl = getProfitAndLoss({ start: startStr, end: endStr });
    var netIncome = pl.netProfit;

    // Helper: signed movement = change in the account's natural balance
    function movementOf(acc) {
      return (acc.normal === 'Debit') ? Utils.round2(acc.debits - acc.credits)
                                      : Utils.round2(acc.credits - acc.debits);
    }

    var operating = [{ label: 'Net income', amount: netIncome }];
    var investing = [];
    var financing = [];

    var cashAccountsMovement = 0; // actual cash/bank delta (1100-1299)

    gl.accounts.forEach(function(a) {
      var code = parseInt(a.code, 10);
      var move = movementOf(a);
      if (move === 0) return;

      // Cash & bank accounts — track separately for reconciliation
      if (code >= 1100 && code <= 1299) {
        cashAccountsMovement += move;
        return;
      }

      // Working-capital asset increases USE cash (negative); decreases provide cash
      if (a.type === 'Asset') {
        if (code >= 1500 && code <= 1599) {
          // Fixed assets → investing. Increase = cash outflow.
          investing.push({ label: a.name, amount: Utils.round2(-move) });
        } else {
          // Current assets (receivables, inventory, prepayments) → operating
          operating.push({ label: 'Change in ' + a.name, amount: Utils.round2(-move) });
        }
      } else if (a.type === 'Liability') {
        // Liability increase PROVIDES cash (positive)
        if (code >= 2500 && code <= 2599) {
          // Long-term debt → financing
          financing.push({ label: a.name, amount: Utils.round2(move) });
        } else {
          // Payables, tax/pension/wage liabilities → operating
          operating.push({ label: 'Change in ' + a.name, amount: Utils.round2(move) });
        }
      } else if (a.type === 'Equity') {
        // Equity injections/drawings → financing (exclude retained-earnings
        // movement that simply reflects net income already in operating)
        if (a.code !== '3200') {
          financing.push({ label: a.name, amount: Utils.round2(move) });
        }
      }
      // Revenue/COGS/Expense movements are already captured via net income
    });

    function sum(rows) {
      return Utils.round2(rows.reduce(function(s, r) { return s + r.amount; }, 0));
    }

    var operatingTotal = sum(operating);
    var investingTotal = sum(investing);
    var financingTotal = sum(financing);
    var netChange      = Utils.round2(operatingTotal + investingTotal + financingTotal);
    cashAccountsMovement = Utils.round2(cashAccountsMovement);

    return {
      operating:        operating,
      investing:        investing,
      financing:        financing,
      operatingTotal:   operatingTotal,
      investingTotal:   investingTotal,
      financingTotal:   financingTotal,
      netChange:        netChange,
      actualCashChange: cashAccountsMovement,
      reconciled:       Utils.round2(netChange - cashAccountsMovement) === 0,
      difference:       Utils.round2(netChange - cashAccountsMovement),
      range:            { start: startStr, end: endStr },
      generatedAt:      new Date().toISOString()
    };
  }
  function validateBooks() {
    var checks = [];

    // 1. Trial balance
    var tb = getTrialBalance();
    checks.push({
      name:    'Trial Balance (Debits = Credits)',
      passed:  tb.balanced,
      detail:  'Debits ' + tb.totalDebits.toFixed(2) + ' vs Credits ' + tb.totalCredits.toFixed(2)
    });

    // 2. Balance sheet
    var bs = getBalanceSheet({});
    checks.push({
      name:    'Balance Sheet (Assets = Liabilities + Equity)',
      passed:  bs.balanced,
      detail:  'Assets ' + bs.totalAssets.toFixed(2) + ' vs L+E ' + bs.totalLiabilitiesAndEquity.toFixed(2) +
               (bs.balanced ? '' : ' (diff ' + bs.difference.toFixed(2) + ')')
    });

    // 3. Per-entry balance
    var jeResult = Utils.sheetToObjects('JournalEntries', {});
    var byJournal = {};
    jeResult.data.forEach(function(ln) {
      if (ln.status === 'Reversed') return;
      var jid = ln.journal_id;
      if (!byJournal[jid]) byJournal[jid] = { dr: 0, cr: 0 };
      byJournal[jid].dr += Utils.toFloat(ln.debit, 0);
      byJournal[jid].cr += Utils.toFloat(ln.credit, 0);
    });
    var unbalanced = [];
    for (var jid in byJournal) {
      if (Utils.round2(byJournal[jid].dr) !== Utils.round2(byJournal[jid].cr)) {
        unbalanced.push(jid);
      }
    }
    checks.push({
      name:    'Journal Entries internally balanced',
      passed:  unbalanced.length === 0,
      detail:  unbalanced.length === 0 ? 'All entries balanced' : unbalanced.length + ' unbalanced entries'
    });

    // 4. GL-vs-CoA reconciliation — recompute each account's balance from the
    //    General Ledger and compare it to the stored Chart-of-Accounts balance.
    //    Catches any drift from an incremental-update bug before it spreads.
    var glRecon = _reconcileGLtoCoA();
    checks.push({
      name:    'Account balances match the General Ledger',
      passed:  glRecon.drifted.length === 0,
      detail:  glRecon.drifted.length === 0
                 ? 'All ' + glRecon.checked + ' accounts reconcile to the GL'
                 : glRecon.drifted.length + ' account(s) drifted: ' +
                   glRecon.drifted.slice(0, 5).map(function(d) {
                     return d.code + ' (CoA ' + d.coa.toFixed(2) + ' vs GL ' + d.gl.toFixed(2) + ')';
                   }).join(', ') + (glRecon.drifted.length > 5 ? ' …' : '')
    });

    var allPassed = checks.every(function(c) { return c.passed; });

    return {
      valid:       allPassed,
      checks:      checks,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Recompute every account balance from the General Ledger and compare to the
   * stored Chart-of-Accounts balance. Read-only; reports drift, fixes nothing.
   * @private
   * @returns {Object} { checked, drifted: [ {code, coa, gl} ] }
   */
  function _reconcileGLtoCoA() {
    // Sum GL debits/credits per account
    var gl = Utils.sheetToObjects('GeneralLedger', {}).data;
    var glByAccount = {};
    gl.forEach(function(r) {
      var code = r.account_code;
      if (!glByAccount[code]) glByAccount[code] = { dr: 0, cr: 0 };
      glByAccount[code].dr += Utils.toFloat(r.debit, 0);
      glByAccount[code].cr += Utils.toFloat(r.credit, 0);
    });

    var coa = Utils.sheetToObjects('ChartOfAccounts', {}).data;
    var drifted = [];
    var checked = 0;

    coa.forEach(function(a) {
      checked++;
      var movement = glByAccount[a.account_code] || { dr: 0, cr: 0 };
      var glBalance = (a.normal_balance === 'Debit')
        ? Utils.round2(movement.dr - movement.cr)
        : Utils.round2(movement.cr - movement.dr);
      var coaBalance = Utils.round2(Utils.toFloat(a.balance, 0));
      if (glBalance !== coaBalance) {
        drifted.push({ code: a.account_code, coa: coaBalance, gl: glBalance });
      }
    });

    return { checked: checked, drifted: drifted };
  }

  /**
   * Post a manual journal entry from the UI.
   * Thin wrapper around createJournalEntry with validation + audit context.
   *
   * @param {Object} data - { date, description, lines: [{accountCode, debit, credit}] }
   */
  function postManualJournal(data) {
    if (!data.lines || data.lines.length < 2) {
      throw new Error('A journal entry needs at least two lines.');
    }
    // Resolve account names from CoA for any missing names
    data.lines.forEach(function(ln) {
      if (!ln.accountName && ln.accountCode) {
        var acc = Utils.findRow('ChartOfAccounts', 'account_code', ln.accountCode);
        ln.accountName = acc ? acc.account_name : '';
      }
    });

    var result = createJournalEntry({
      date:          data.date,
      description:   data.description || 'Manual journal entry',
      referenceType: 'Manual',
      referenceId:   data.reference_id || '',
      lines:         data.lines
    });

    AuditService.log('accounting', 'manual_journal_posted', {
      entryNumber: result.entryNumber, description: data.description
    }, result.entryNumber);

    return result;
  }

  /**
   * Current user email helper.
   * @private
   */
  function _user() {
    return Utils.currentUserEmail();
  }

  // ─────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────

  return {
    // Core
    createJournalEntry: createJournalEntry,
    reverseJournalEntry: reverseJournalEntry,

    // Pre-built postings — Sales
    postInvoice: postInvoice,
    postReceipt: postReceipt,

    // Pre-built postings — Inventory
    postCOGS: postCOGS,
    postStockAdjustment: postStockAdjustment,
    postInventoryDamage: postInventoryDamage,
    postCustomerReturn: postCustomerReturn,
    postSupplierReturn: postSupplierReturn,
    postOpeningStock: postOpeningStock,

    // Reporting
    getAccountBalance: getAccountBalance,
    getTrialBalance: getTrialBalance,
    getAccountLedger: getAccountLedger,
    getGeneralLedger: getGeneralLedger,
    getProfitAndLoss: getProfitAndLoss,
    getBalanceSheet: getBalanceSheet,
    getCashFlow: getCashFlow,
    validateBooks: validateBooks,

    // Manual journals
    postManualJournal: postManualJournal,

    // Period management
    listPeriods: listPeriods,
    closePeriod: closePeriod,
    reopenPeriod: reopenPeriod,

    // CoA management
    listAccounts: listAccounts,
    getAccount: getAccount,
    createAccount: createAccount,
    updateAccount: updateAccount
  };

})();

// ─────────────────────────────────────────
// Replace stubs with real implementations
// ─────────────────────────────────────────

var ChartOfAccountsService = {
  list: function(data) { return AccountingEngine.listAccounts(data); },
  get: function(data) { return AccountingEngine.getAccount(data); },
  create: function(data) { return AccountingEngine.createAccount(data); },
  update: function(data) { return AccountingEngine.updateAccount(data); }
};

var JournalService = {
  list: function(data) { return Utils.sheetToObjects('JournalEntries', data || { sort: 'date', order: 'desc' }); },
  get: function(data) {
    // Return all lines of a journal entry
    var result = Utils.sheetToObjects('JournalEntries', { filters: { journal_id: data.id } });
    return result.data;
  },
  create: function(data) { return AccountingEngine.postManualJournal(data); },
  update: function(data) { throw new Error('Journal entries cannot be edited. Use reversal instead.'); },
  reverse: function(data) { return AccountingEngine.reverseJournalEntry(data.id, data.reason); },
  trialBalance: function(data) { return AccountingEngine.getTrialBalance(data ? data.asOfDate : null); },
  generalLedger: function(data) { return AccountingEngine.getGeneralLedger(data || {}); },
  profitAndLoss: function(data) { return AccountingEngine.getProfitAndLoss(data || {}); },
  balanceSheet: function(data) { return AccountingEngine.getBalanceSheet(data || {}); },
  validateBooks: function() { return AccountingEngine.validateBooks(); },
  listPeriods: function() { return AccountingEngine.listPeriods(); },
  closePeriod: function(data) { return AccountingEngine.closePeriod(data); },
  reopenPeriod: function(data) { return AccountingEngine.reopenPeriod(data); }
};
