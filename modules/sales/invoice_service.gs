/**
 * Invoice Service
 * =================
 * Full invoice lifecycle management.
 * Creates invoices with line items, deducts inventory,
 * and auto-posts to the accounting engine.
 *
 * Statuses: Draft → Sent → Partial → Paid → Overdue → Cancelled
 */

var InvoiceService = (function() {

  /**
   * List invoices with optional filters.
   */
  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'date'; data.order = 'desc'; }
    return Utils.sheetToObjects('Invoices', data);
  }

  /**
   * Get a single invoice with its line items.
   */
  function get(data) {
    var invoice = Utils.findRow('Invoices', 'invoice_id', data.id || data.invoice_id);
    if (!invoice) throw new Error('Invoice not found');

    var items = Utils.sheetToObjects('InvoiceItems', {
      filters: { invoice_id: invoice.invoice_id }
    }).data;

    invoice.items = items;

    // Attach receipts
    var receipts = Utils.sheetToObjects('Receipts', {
      filters: { invoice_id: invoice.invoice_id }
    }).data;
    invoice.receipts = receipts;

    return invoice;
  }

  /**
   * Create a new invoice with line items.
   *
   * @param {Object} data
   * @param {string} data.customer_id
   * @param {string} data.date
   * @param {Object[]} data.items - Array of line item objects
   * @param {string} [data.notes]
   * @param {boolean} [data.send] - If true, post to accounting immediately (status = Sent)
   */
  function create(data) {
    data = Validators.sanitizeObject(data);

    // Validate
    var v = Validators.validateInvoice(data);
    if (!v.valid) throw new Error(v.errors.join(', '));

    var items = data.items || [];
    if (items.length === 0) throw new Error('Invoice must have at least one line item.');

    // Look up customer
    var customer = Utils.findRow('Customers', 'customer_id', data.customer_id);
    if (!customer) throw new Error('Customer not found: ' + data.customer_id);

    var settings = ConfigService.getAllSettings();
    var taxRate = Utils.toFloat(settings.default_tax_rate || APP_CONFIG.DEFAULT_TAX_RATE, 0);
    var paymentTerms = Utils.toFloat(data.payment_terms || customer.payment_terms || settings.default_payment_terms || 30, 30);

    // Calculate line items
    var subtotal = 0;
    var totalTax = 0;
    var totalDiscount = 0;
    var processedItems = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var qty = Utils.toFloat(item.quantity, 0);
      var price = Utils.toFloat(item.unit_price, 0);
      var discPct = Utils.toFloat(item.discount_percent, 0);
      var itemTaxRate = Utils.toFloat(item.tax_rate, taxRate);

      if (qty <= 0) throw new Error('Item ' + (i + 1) + ': quantity must be positive.');
      if (price < 0) throw new Error('Item ' + (i + 1) + ': unit price cannot be negative.');

      // If product_id provided but no price, look up from Products
      if (item.product_id && price === 0) {
        var product = Utils.findRow('Products', 'product_id', item.product_id);
        if (product) {
          price = Utils.toFloat(product.unit_price, 0);
          if (!item.product_name) item.product_name = product.name;
        }
      }

      var lineGross = Utils.round2(qty * price);
      var lineDiscount = Utils.round2(lineGross * discPct / 100);
      var lineNet = Utils.round2(lineGross - lineDiscount);
      var lineTax = Utils.round2(lineNet * itemTaxRate / 100);
      var lineTotal = Utils.round2(lineNet + lineTax);

      subtotal += lineNet;
      totalTax += lineTax;
      totalDiscount += lineDiscount;

      processedItems.push({
        item_id: Utilities.getUuid(),
        invoice_id: '', // set after header
        product_id: item.product_id || '',
        product_name: item.product_name || '',
        description: item.description || '',
        quantity: qty,
        unit_price: price,
        discount_percent: discPct,
        tax_rate: itemTaxRate,
        tax_amount: lineTax,
        line_total: lineTotal,
        created_at: new Date()
      });
    }

    subtotal = Utils.round2(subtotal);
    totalTax = Utils.round2(totalTax);
    totalDiscount = Utils.round2(totalDiscount);
    var total = Utils.round2(subtotal + totalTax);

    // Generate header
    var invoiceId = Utilities.getUuid();
    var prefix = settings.invoice_prefix || APP_CONFIG.INVOICE_PREFIX || 'INV-';
    var invoiceNumber = Utils.generateDocNumber('Invoices', 'invoice_number', prefix, 5);
    var invoiceDate = new Date(data.date);
    var dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + paymentTerms);

    var initialStatus = data.send ? 'Sent' : 'Draft';

    var header = {
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      date: invoiceDate,
      due_date: dueDate,
      customer_id: customer.customer_id,
      customer_name: customer.name,
      subtotal: subtotal,
      tax_amount: totalTax,
      discount_amount: totalDiscount,
      total: total,
      amount_paid: 0,
      balance_due: total,
      status: initialStatus,
      payment_terms: paymentTerms,
      notes: data.notes || '',
      journal_ref: '',
      created_at: new Date(),
      updated_at: new Date(),
      created_by: Utils.currentUserEmail()
    };

    Utils.appendRow('Invoices', header);

    // Write items
    for (var j = 0; j < processedItems.length; j++) {
      processedItems[j].invoice_id = invoiceId;
      Utils.appendRow('InvoiceItems', processedItems[j]);
    }

    // If sending immediately, post to accounting and deduct inventory
    if (initialStatus === 'Sent') {
      _postAndDeductInventory(header, processedItems);
    }

    AuditService.log('invoices', 'created', {
      number: invoiceNumber,
      customer: customer.name,
      total: total,
      status: initialStatus
    }, invoiceId);

    return {
      success: true,
      id: invoiceId,
      number: invoiceNumber,
      total: total,
      status: initialStatus
    };
  }

  /**
   * Update an invoice. Limited fields can be changed based on status.
   */
  function update(data) {
    var id = data.id || data.invoice_id;
    var existing = Utils.findRow('Invoices', 'invoice_id', id);
    if (!existing) throw new Error('Invoice not found');

    // Status transition handling
    if (data.status && data.status !== existing.status) {
      _handleStatusChange(existing, data.status);
    }

    // Only drafts can have items/amounts edited
    if (existing.status !== 'Draft' && existing.status !== data.status) {
      // Allow only notes and status update for non-draft
      var allowed = { status: true, notes: true, id: true, invoice_id: true };
      for (var key in data) {
        if (!allowed[key]) delete data[key];
      }
    }

    data.updated_at = new Date();
    Utils.updateRow('Invoices', existing._rowIndex, Validators.sanitizeObject(data));

    AuditService.log('invoices', 'updated', { id: id, status: data.status }, id);
    return { success: true };
  }

  /**
   * Send a draft invoice: changes status to Sent, posts to accounting.
   */
  function send(data) {
    var id = data.id || data.invoice_id;
    var invoice = get({ id: id });

    if (invoice.status !== 'Draft') {
      throw new Error('Only draft invoices can be sent. Current status: ' + invoice.status);
    }

    // Post to accounting and deduct inventory
    var journalResult = _postAndDeductInventory(invoice, invoice.items);

    // Update status and journal ref
    var existing = Utils.findRow('Invoices', 'invoice_id', id);
    Utils.updateRow('Invoices', existing._rowIndex, {
      status: 'Sent',
      journal_ref: journalResult.entryNumber,
      updated_at: new Date()
    });

    AuditService.log('invoices', 'sent', {
      number: invoice.invoice_number,
      journalRef: journalResult.entryNumber
    }, id);

    return {
      success: true,
      status: 'Sent',
      journalRef: journalResult.entryNumber
    };
  }

  /**
   * Cancel an invoice. Reverses accounting entries if posted.
   */
  function cancel(data) {
    var id = data.id || data.invoice_id;
    var invoice = Utils.findRow('Invoices', 'invoice_id', id);
    if (!invoice) throw new Error('Invoice not found');

    if (invoice.status === 'Cancelled') throw new Error('Invoice is already cancelled.');
    if (invoice.status === 'Paid') throw new Error('Cannot cancel a fully paid invoice.');

    // Reverse journal entry if posted
    if (invoice.journal_ref) {
      try {
        // Find the journal by entry_number to get the journal_id
        var journals = Utils.sheetToObjects('JournalEntries', {
          filters: { reference_id: id }
        }).data;
        if (journals.length > 0) {
          AccountingEngine.reverseJournalEntry(journals[0].journal_id, 'Invoice cancelled');
        }
      } catch (e) {
        Logger.log('Error reversing journal for invoice ' + id + ': ' + e.message);
      }
    }

    // Restore inventory
    _restoreInventory(id);

    // Update invoice
    Utils.updateRow('Invoices', invoice._rowIndex, {
      status: 'Cancelled',
      updated_at: new Date()
    });

    // Recalculate customer balance
    CustomerService.recalculateBalance(invoice.customer_id);

    AuditService.log('invoices', 'cancelled', { number: invoice.invoice_number }, id);
    return { success: true };
  }

  /**
   * Handle status transitions.
   * @private
   */
  function _handleStatusChange(existing, newStatus) {
    var validTransitions = {
      'Draft': ['Sent', 'Cancelled'],
      'Sent': ['Partial', 'Paid', 'Overdue', 'Cancelled'],
      'Partial': ['Paid', 'Overdue', 'Cancelled'],
      'Overdue': ['Partial', 'Paid', 'Cancelled']
    };
    var allowed = validTransitions[existing.status] || [];
    if (allowed.indexOf(newStatus) === -1) {
      throw new Error('Cannot change invoice from ' + existing.status + ' to ' + newStatus);
    }
  }

  /**
   * Post invoice to accounting engine and deduct inventory.
   * @private
   */
  function _postAndDeductInventory(invoice, items) {
    // Post accounting entries
    var journalResult = AccountingEngine.postInvoice({
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      customer_name: invoice.customer_name,
      subtotal: invoice.subtotal,
      tax_amount: invoice.tax_amount,
      discount_amount: invoice.discount_amount,
      total: invoice.total,
      date: invoice.date
    });

    // Update journal ref on invoice
    var inv = Utils.findRow('Invoices', 'invoice_id', invoice.invoice_id);
    if (inv) {
      Utils.updateRow('Invoices', inv._rowIndex, {
        journal_ref: journalResult.entryNumber
      });
    }

    // Deduct inventory for product items
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.product_id) {
        _deductInventory(item, invoice.invoice_id, invoice.invoice_number, invoice.date);
      }
    }

    // Update customer balance
    CustomerService.recalculateBalance(invoice.customer_id);

    return journalResult;
  }

  /**
   * Deduct inventory for a line item via InventoryService.
   * Handles FIFO/WA valuation and posts COGS to accounting.
   * @private
   */
  function _deductInventory(item, invoiceId, invoiceNumber, invoiceDate) {
    try {
      if (!item.product_id) return;
      var qty = Utils.toFloat(item.quantity, 0);
      if (qty <= 0) return;

      InventoryService.recordSale({
        product_id:     item.product_id,
        quantity:       qty,
        reference_type: 'Invoice',
        reference_id:   invoiceId,
        invoice_number: invoiceNumber,
        date:           invoiceDate || new Date()
      });
    } catch (e) {
      Logger.log('Inventory deduction error for product ' + item.product_id + ': ' + e.message);
    }
  }

  /**
   * Restore inventory when an invoice is cancelled via InventoryService.
   * Reverses FIFO layers and posts COGS reversal.
   * @private
   */
  function _restoreInventory(invoiceId) {
    try {
      var items = Utils.sheetToObjects('InvoiceItems', {
        filters: { invoice_id: invoiceId }
      }).data;

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item.product_id) continue;
        var product = Utils.findRow('Products', 'product_id', item.product_id);
        if (!product) continue;

        InventoryService.recordCustomerReturn({
          product_id:    item.product_id,
          quantity:      Utils.toFloat(item.quantity, 0),
          unit_cost:     Utils.toFloat(product.cost_price, 0),
          sale_price:    0,     // No A/R reversal — handled by invoice cancellation
          return_type:   'Customer Return',
          reference_id:  invoiceId,
          notes:         'Stock restored — invoice cancelled',
          date:          new Date()
        });
      }
    } catch (e) {
      Logger.log('Error restoring inventory for invoice ' + invoiceId + ': ' + e.message);
    }
  }

  /**
   * Check and mark overdue invoices.
   * Can be called via a time-driven trigger.
   */
  function markOverdue() {
    var today = new Date();
    var invoices = Utils.sheetToObjects('Invoices', {}).data;
    var count = 0;

    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      if ((inv.status === 'Sent' || inv.status === 'Partial') && inv.due_date) {
        var dueDate = new Date(inv.due_date);
        if (dueDate < today) {
          Utils.updateRow('Invoices', inv._rowIndex, {
            status: 'Overdue',
            updated_at: new Date()
          });
          count++;
        }
      }
    }

    return { success: true, markedOverdue: count };
  }

  /**
   * Get invoice aging report.
   */
  function getAging(data) {
    var invoices = Utils.sheetToObjects('Invoices', {}).data;
    var today = new Date();

    var aging = {
      current: [],    // Not yet due
      days30: [],     // 1-30 days overdue
      days60: [],     // 31-60 days
      days90: [],     // 61-90 days
      over90: [],     // 90+ days
      totals: { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 }
    };

    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      var balance = Utils.toFloat(inv.balance_due, 0);
      if (balance <= 0 || inv.status === 'Cancelled' || inv.status === 'Draft' || inv.status === 'Paid') continue;

      var dueDate = new Date(inv.due_date);
      var daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

      var entry = {
        invoice_number: inv.invoice_number,
        customer_name: inv.customer_name,
        date: inv.date,
        due_date: inv.due_date,
        total: inv.total,
        balance_due: balance,
        days_overdue: Math.max(0, daysOverdue)
      };

      if (daysOverdue <= 0) {
        aging.current.push(entry);
        aging.totals.current += balance;
      } else if (daysOverdue <= 30) {
        aging.days30.push(entry);
        aging.totals.days30 += balance;
      } else if (daysOverdue <= 60) {
        aging.days60.push(entry);
        aging.totals.days60 += balance;
      } else if (daysOverdue <= 90) {
        aging.days90.push(entry);
        aging.totals.days90 += balance;
      } else {
        aging.over90.push(entry);
        aging.totals.over90 += balance;
      }
      aging.totals.total += balance;
    }

    // Round totals
    for (var key in aging.totals) {
      aging.totals[key] = Utils.round2(aging.totals[key]);
    }

    return aging;
  }

  return {
    list: list,
    get: get,
    create: create,
    update: update,
    send: send,
    cancel: cancel,
    delete: cancel,
    remove: cancel,
    markOverdue: markOverdue,
    getAging: getAging
  };

})();
