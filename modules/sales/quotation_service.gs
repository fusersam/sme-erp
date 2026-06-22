/**
 * Quotation Service
 * ==================
 * Manages sales quotations with line items.
 * Quotations do NOT post to accounting — they are converted to invoices.
 *
 * Statuses: Draft → Sent → Accepted → Converted → Expired → Cancelled
 */

var QuotationService = (function() {

  /**
   * List quotations.
   */
  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'date'; data.order = 'desc'; }
    return Utils.sheetToObjects('Quotations', data);
  }

  /**
   * Get a single quotation with its line items.
   */
  function get(data) {
    var quote = Utils.findRow('Quotations', 'quotation_id', data.id || data.quotation_id);
    if (!quote) throw new Error('Quotation not found');

    var items = Utils.sheetToObjects('QuotationItems', {
      filters: { quotation_id: quote.quotation_id }
    }).data;

    quote.items = items;
    return quote;
  }

  /**
   * Create a quotation with line items.
   */
  function create(data) {
    data = Validators.sanitizeObject(data);

    var v = Validators.required(data, ['customer_id', 'date']);
    if (!v.valid) throw new Error(v.errors.join(', '));

    var items = data.items || [];
    if (items.length === 0) throw new Error('Quotation must have at least one item.');

    // Look up customer
    var customer = Utils.findRow('Customers', 'customer_id', data.customer_id);
    if (!customer) throw new Error('Customer not found');

    var settings = ConfigService.getAllSettings();
    var taxRate = Utils.toFloat(settings.default_tax_rate || APP_CONFIG.DEFAULT_TAX_RATE, 0);

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
        quotation_id: '', // set after header insert
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

    var total = Utils.round2(subtotal + totalTax);

    // Create header
    var quotePrefix = settings.quotation_prefix || 'QUO-';
    var quotationId = Utilities.getUuid();
    var quotationNumber = Utils.generateDocNumber('Quotations', 'quotation_number', quotePrefix, 5);
    var expiryDate = new Date(data.date);
    expiryDate.setDate(expiryDate.getDate() + (Utils.toFloat(data.validity_days, 30)));

    var header = {
      quotation_id: quotationId,
      quotation_number: quotationNumber,
      date: new Date(data.date),
      expiry_date: expiryDate,
      customer_id: customer.customer_id,
      customer_name: customer.name,
      subtotal: Utils.round2(subtotal),
      tax_amount: Utils.round2(totalTax),
      discount_amount: Utils.round2(totalDiscount),
      total: total,
      status: 'Draft',
      notes: data.notes || '',
      created_at: new Date(),
      updated_at: new Date(),
      created_by: Utils.currentUserEmail()
    };

    Utils.appendRow('Quotations', header);

    // Write items
    for (var j = 0; j < processedItems.length; j++) {
      processedItems[j].quotation_id = quotationId;
      Utils.appendRow('QuotationItems', processedItems[j]);
    }

    AuditService.log('quotations', 'created', {
      number: quotationNumber, customer: customer.name, total: total
    }, quotationId);

    return {
      success: true,
      id: quotationId,
      number: quotationNumber,
      total: total
    };
  }

  /**
   * Update quotation status or details (only if Draft).
   */
  function update(data) {
    var id = data.id || data.quotation_id;
    var existing = Utils.findRow('Quotations', 'quotation_id', id);
    if (!existing) throw new Error('Quotation not found');

    // Allow status transitions
    if (data.status) {
      var validTransitions = {
        'Draft': ['Sent', 'Cancelled'],
        'Sent': ['Accepted', 'Expired', 'Cancelled'],
        'Accepted': ['Converted', 'Cancelled']
      };
      var allowed = validTransitions[existing.status] || [];
      if (allowed.indexOf(data.status) === -1 && existing.status !== data.status) {
        throw new Error('Cannot change status from ' + existing.status + ' to ' + data.status);
      }
    }

    data.updated_at = new Date();
    Utils.updateRow('Quotations', existing._rowIndex, Validators.sanitizeObject(data));
    AuditService.log('quotations', 'updated', { id: id, status: data.status }, id);
    return { success: true };
  }

  /**
   * Convert a quotation to an invoice.
   * Creates a new invoice with the same items and marks quotation as Converted.
   */
  function convertToInvoice(data) {
    var id = data.id || data.quotation_id;
    var quote = get({ id: id });

    if (quote.status === 'Converted') {
      throw new Error('Quotation has already been converted.');
    }
    if (quote.status === 'Cancelled' || quote.status === 'Expired') {
      throw new Error('Cannot convert a ' + quote.status.toLowerCase() + ' quotation.');
    }

    // Build invoice data from quotation
    var invoiceData = {
      customer_id: quote.customer_id,
      date: new Date(),
      notes: 'Converted from ' + quote.quotation_number + '. ' + (quote.notes || ''),
      items: quote.items.map(function(item) {
        return {
          product_id: item.product_id,
          product_name: item.product_name,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percent: item.discount_percent,
          tax_rate: item.tax_rate
        };
      })
    };

    // Create the invoice via InvoiceService
    var result = InvoiceService.create(invoiceData);

    // Mark quotation as converted
    update({
      id: id,
      status: 'Converted',
      converted_invoice_id: result.id
    });

    AuditService.log('quotations', 'converted', {
      quotationId: id,
      invoiceId: result.id,
      invoiceNumber: result.number
    }, id);

    return {
      success: true,
      invoiceId: result.id,
      invoiceNumber: result.number
    };
  }

  /**
   * Delete (cancel) a quotation.
   */
  function remove(data) {
    return update({ id: data.id || data.quotation_id, status: 'Cancelled' });
  }

  return {
    list: list,
    get: get,
    create: create,
    update: update,
    delete: remove,
    remove: remove,
    convertToInvoice: convertToInvoice
  };

})();
