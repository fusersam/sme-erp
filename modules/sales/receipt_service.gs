/**
 * Receipt Service
 * =================
 * Customer payment receipts with invoice allocation.
 * Auto-posts to accounting: Dr Cash/Bank, Cr Accounts Receivable.
 * Updates invoice paid amounts and statuses.
 *
 * Statuses: Completed, Reversed
 */

var ReceiptService = (function() {

  /**
   * List receipts with optional filters.
   */
  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'date'; data.order = 'desc'; }
    return Utils.sheetToObjects('Receipts', data);
  }

  /**
   * Get a single receipt.
   */
  function get(data) {
    var receipt = Utils.findRow('Receipts', 'receipt_id', data.id || data.receipt_id);
    if (!receipt) throw new Error('Receipt not found');
    return receipt;
  }

  /**
   * Create a receipt: allocate payment against an invoice and post to accounting.
   *
   * @param {Object} data
   * @param {string} data.customer_id
   * @param {string} data.invoice_id    - Invoice to allocate payment against
   * @param {number} data.amount        - Payment amount
   * @param {string} data.payment_method - Cash, Bank Transfer, Mobile Money, Cheque, Card
   * @param {string} data.date
   * @param {string} [data.reference]   - Transaction reference
   * @param {string} [data.bank_account]
   * @param {string} [data.notes]
   */
  function create(data) {
    data = Validators.sanitizeObject(data);

    // Validate
    var v = Validators.required(data, ['customer_id', 'invoice_id', 'amount', 'payment_method', 'date']);
    if (!v.valid) throw new Error(v.errors.join(', '));

    var amount = Utils.toFloat(data.amount, 0);
    if (amount <= 0) throw new Error('Payment amount must be positive.');

    // Look up customer
    var customer = Utils.findRow('Customers', 'customer_id', data.customer_id);
    if (!customer) throw new Error('Customer not found');

    // Look up invoice
    var invoice = Utils.findRow('Invoices', 'invoice_id', data.invoice_id);
    if (!invoice) throw new Error('Invoice not found');

    if (invoice.status === 'Draft') {
      throw new Error('Cannot receive payment against a draft invoice. Send it first.');
    }
    if (invoice.status === 'Cancelled') {
      throw new Error('Cannot receive payment against a cancelled invoice.');
    }
    if (invoice.status === 'Paid') {
      throw new Error('This invoice is already fully paid.');
    }

    // Validate customer matches invoice
    if (invoice.customer_id !== data.customer_id) {
      throw new Error('Invoice does not belong to this customer.');
    }

    // Check overpayment
    var balanceDue = Utils.toFloat(invoice.balance_due, 0);
    if (amount > Utils.round2(balanceDue + 0.01)) { // small tolerance for rounding
      throw new Error(
        'Payment amount (' + amount.toFixed(2) + ') exceeds invoice balance (' +
        balanceDue.toFixed(2) + ').'
      );
    }

    // Cap at balance due
    if (amount > balanceDue) {
      amount = balanceDue;
    }

    var settings = ConfigService.getAllSettings();
    var prefix = settings.receipt_prefix || 'REC-';

    // Create receipt
    var receiptId = Utilities.getUuid();
    var receiptNumber = Utils.generateDocNumber('Receipts', 'receipt_number', prefix, 5);
    var receiptDate = new Date(data.date);

    var receipt = {
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      date: receiptDate,
      customer_id: customer.customer_id,
      customer_name: customer.name,
      invoice_id: data.invoice_id,
      amount: Utils.round2(amount),
      payment_method: data.payment_method,
      reference: data.reference || '',
      bank_account: data.bank_account || '',
      notes: data.notes || '',
      journal_ref: '',
      status: 'Completed',
      created_at: new Date(),
      created_by: Utils.currentUserEmail()
    };

    Utils.appendRow('Receipts', receipt);

    // Post to accounting engine
    var journalResult = AccountingEngine.postReceipt({
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      customer_name: customer.name,
      amount: amount,
      payment_method: data.payment_method,
      date: receiptDate
    });

    // Update receipt with journal ref
    var receiptRow = Utils.findRow('Receipts', 'receipt_id', receiptId);
    if (receiptRow) {
      Utils.updateRow('Receipts', receiptRow._rowIndex, {
        journal_ref: journalResult.entryNumber
      });
    }

    // Update invoice amounts and status
    var newAmountPaid = Utils.round2(Utils.toFloat(invoice.amount_paid, 0) + amount);
    var newBalanceDue = Utils.round2(Utils.toFloat(invoice.total, 0) - newAmountPaid);
    var newStatus;

    if (newBalanceDue <= 0.005) {
      newStatus = 'Paid';
      newBalanceDue = 0;
    } else {
      newStatus = 'Partial';
    }

    Utils.updateRow('Invoices', invoice._rowIndex, {
      amount_paid: newAmountPaid,
      balance_due: newBalanceDue,
      status: newStatus,
      updated_at: new Date()
    });

    // Record in cashbook
    _recordCashbook(receipt, journalResult.entryNumber);

    // Recalculate customer balance
    CustomerService.recalculateBalance(data.customer_id);

    AuditService.log('receipts', 'created', {
      number: receiptNumber,
      customer: customer.name,
      amount: amount,
      invoice: invoice.invoice_number,
      invoiceStatus: newStatus,
      journalRef: journalResult.entryNumber
    }, receiptId);

    return {
      success: true,
      id: receiptId,
      number: receiptNumber,
      amount: Utils.round2(amount),
      invoiceStatus: newStatus,
      journalRef: journalResult.entryNumber
    };
  }

  /**
   * Reverse a receipt. Reverses the journal entry, restores invoice balance.
   */
  function reverse(data) {
    var id = data.id || data.receipt_id;
    var receipt = Utils.findRow('Receipts', 'receipt_id', id);
    if (!receipt) throw new Error('Receipt not found');

    if (receipt.status === 'Reversed') {
      throw new Error('Receipt has already been reversed.');
    }

    // Reverse journal entry
    if (receipt.journal_ref) {
      try {
        var journals = Utils.sheetToObjects('JournalEntries', {
          filters: { reference_id: id }
        }).data;
        if (journals.length > 0) {
          AccountingEngine.reverseJournalEntry(journals[0].journal_id, 'Receipt reversed');
        }
      } catch (e) {
        Logger.log('Error reversing receipt journal: ' + e.message);
      }
    }

    // Restore invoice balance
    var invoice = Utils.findRow('Invoices', 'invoice_id', receipt.invoice_id);
    if (invoice) {
      var amount = Utils.toFloat(receipt.amount, 0);
      var newAmountPaid = Utils.round2(Utils.toFloat(invoice.amount_paid, 0) - amount);
      var newBalanceDue = Utils.round2(Utils.toFloat(invoice.total, 0) - newAmountPaid);
      var newStatus = newAmountPaid <= 0 ? 'Sent' : 'Partial';

      // Check if overdue
      if (newStatus === 'Sent' && new Date(invoice.due_date) < new Date()) {
        newStatus = 'Overdue';
      }

      Utils.updateRow('Invoices', invoice._rowIndex, {
        amount_paid: Math.max(0, newAmountPaid),
        balance_due: newBalanceDue,
        status: newStatus,
        updated_at: new Date()
      });
    }

    // Mark receipt as reversed
    Utils.updateRow('Receipts', receipt._rowIndex, {
      status: 'Reversed'
    });

    // Recalculate customer balance
    CustomerService.recalculateBalance(receipt.customer_id);

    AuditService.log('receipts', 'reversed', {
      number: receipt.receipt_number,
      amount: receipt.amount
    }, id);

    return { success: true };
  }

  /**
   * Record a cashbook entry for the receipt.
   * @private
   */
  function _recordCashbook(receipt, journalRef) {
    try {
      Utils.appendRow('Cashbook', {
        entry_id: Utilities.getUuid(),
        date: receipt.date,
        type: 'Receipt',
        category: 'Customer Payment',
        description: 'Receipt ' + receipt.receipt_number + ' from ' + receipt.customer_name,
        reference: receipt.reference || receipt.receipt_number,
        debit: receipt.amount,
        credit: 0,
        balance: 0, // Running balance calculated separately
        payment_method: receipt.payment_method,
        account: receipt.bank_account || receipt.payment_method,
        journal_ref: journalRef,
        reconciled: false,
        reconciled_date: '',
        notes: receipt.notes || '',
        created_at: new Date(),
        created_by: Utils.currentUserEmail()
      });
    } catch (e) {
      Logger.log('Error recording cashbook entry: ' + e.message);
    }
  }

  /**
   * Update — only notes can be updated on a completed receipt.
   */
  function update(data) {
    var id = data.id || data.receipt_id;
    var existing = Utils.findRow('Receipts', 'receipt_id', id);
    if (!existing) throw new Error('Receipt not found');

    // Only allow notes update
    if (data.notes !== undefined) {
      Utils.updateRow('Receipts', existing._rowIndex, {
        notes: Validators.sanitize(data.notes)
      });
    }
    return { success: true };
  }

  return {
    list: list,
    get: get,
    create: create,
    update: update,
    reverse: reverse,
    delete: reverse
  };

})();
