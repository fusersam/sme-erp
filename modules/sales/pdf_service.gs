/**
 * PDF Service
 * =============
 * Generates PDF documents from invoices, receipts, and quotations.
 * Uses Google Apps Script HtmlService to render HTML → PDF via Blob.
 *
 * PDFs are saved to a designated Google Drive folder.
 */

var PdfService = (function() {

  /**
   * Generate an invoice PDF.
   * @param {string} invoiceId
   * @returns {Object} { success, fileId, fileUrl, fileName }
   */
  function generateInvoicePdf(invoiceId) {
    var invoice = InvoiceService.get({ id: invoiceId });
    if (!invoice) throw new Error('Invoice not found');

    var settings = ConfigService.getAllSettings();
    var html = _buildInvoiceHtml(invoice, settings);

    // Create the PDF blob
    var blob = HtmlService.createHtmlOutput(html)
      .getBlob()
      .setName(invoice.invoice_number + '.pdf')
      .getAs('application/pdf');

    // Save to Drive
    var folder = _getDocumentFolder();
    var file = folder.createFile(blob);
    file.setDescription('Invoice ' + invoice.invoice_number + ' for ' + invoice.customer_name);

    AuditService.log('invoices', 'pdf_generated', {
      invoiceId: invoiceId,
      number: invoice.invoice_number,
      fileId: file.getId()
    }, invoiceId);

    return {
      success: true,
      fileId: file.getId(),
      fileUrl: file.getUrl(),
      fileName: file.getName()
    };
  }

  /**
   * Generate a receipt PDF.
   * @param {string} receiptId
   * @returns {Object} { success, fileId, fileUrl, fileName }
   */
  function generateReceiptPdf(receiptId) {
    var receipt = ReceiptService.get({ id: receiptId });
    if (!receipt) throw new Error('Receipt not found');

    var settings = ConfigService.getAllSettings();
    var html = _buildReceiptHtml(receipt, settings);

    var blob = HtmlService.createHtmlOutput(html)
      .getBlob()
      .setName(receipt.receipt_number + '.pdf')
      .getAs('application/pdf');

    var folder = _getDocumentFolder();
    var file = folder.createFile(blob);

    return {
      success: true,
      fileId: file.getId(),
      fileUrl: file.getUrl(),
      fileName: file.getName()
    };
  }

  /**
   * Get or create the documents folder in Google Drive.
   * @private
   */
  function _getDocumentFolder() {
    var folderName = 'SME Business Manager Documents';
    var folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) {
      return folders.next();
    }
    return DriveApp.createFolder(folderName);
  }

  /**
   * Format a date for display.
   * @private
   */
  function _fmtDate(d) {
    if (!d) return '';
    var date = new Date(d);
    if (isNaN(date.getTime())) return '';
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
  }

  /**
   * Format a number as currency.
   * @private
   */
  function _fmtMoney(amount, symbol) {
    var num = parseFloat(amount) || 0;
    return (symbol || '') + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Build the invoice HTML for PDF rendering.
   * @private
   */
  function _buildInvoiceHtml(invoice, settings) {
    var sym = settings.currency_symbol || 'GH₵';
    var company = settings.company_name || 'My Company';
    var address = settings.company_address || '';
    var phone = settings.company_phone || '';
    var email = settings.company_email || '';
    var taxName = settings.tax_name || 'VAT';

    var itemsHtml = '';
    var items = invoice.items || [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      itemsHtml +=
        '<tr>' +
          '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + (i + 1) + '</td>' +
          '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' +
            _esc(item.product_name || item.description || '') +
            (item.description && item.product_name ? '<br><small style="color:#666;">' + _esc(item.description) + '</small>' : '') +
          '</td>' +
          '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">' + Utils.toFloat(item.quantity, 0) + '</td>' +
          '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">' + _fmtMoney(item.unit_price, sym) + '</td>' +
          '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">' +
            (Utils.toFloat(item.discount_percent, 0) > 0 ? item.discount_percent + '%' : '-') +
          '</td>' +
          '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">' + _fmtMoney(item.line_total, sym) + '</td>' +
        '</tr>';
    }

    var statusColor = {
      'Draft': '#888', 'Sent': '#1a73e8', 'Partial': '#f9a825',
      'Paid': '#34a853', 'Overdue': '#ea4335', 'Cancelled': '#888'
    };

    return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<style>' +
        'body{font-family:Helvetica,Arial,sans-serif;color:#333;margin:0;padding:40px;font-size:12px;}' +
        '.header{display:flex;justify-content:space-between;margin-bottom:40px;}' +
        '.company{font-size:11px;color:#555;line-height:1.6;}' +
        '.company h1{font-size:20px;color:#1a1a2e;margin:0 0 8px 0;}' +
        '.invoice-title{text-align:right;}' +
        '.invoice-title h2{font-size:28px;color:#1a73e8;margin:0 0 8px 0;text-transform:uppercase;}' +
        '.meta-grid{display:flex;justify-content:space-between;margin-bottom:30px;}' +
        '.meta-box{width:48%;}' +
        '.meta-box h4{font-size:11px;text-transform:uppercase;color:#888;margin:0 0 6px 0;letter-spacing:0.5px;}' +
        '.meta-box p{margin:2px 0;line-height:1.5;}' +
        'table{width:100%;border-collapse:collapse;margin-bottom:20px;}' +
        'th{background:#f8f9fa;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;' +
           'color:#555;border-bottom:2px solid #ddd;letter-spacing:0.3px;}' +
        '.totals{width:300px;margin-left:auto;}' +
        '.totals tr td{padding:6px 12px;font-size:12px;}' +
        '.totals tr td:last-child{text-align:right;font-weight:600;}' +
        '.totals .grand-total td{font-size:16px;font-weight:700;border-top:2px solid #1a73e8;padding-top:10px;color:#1a73e8;}' +
        '.status-badge{display:inline-block;padding:4px 16px;border-radius:4px;color:#fff;font-weight:700;font-size:11px;}' +
        '.notes{margin-top:30px;padding:15px;background:#f8f9fa;border-radius:6px;font-size:11px;color:#555;}' +
        '.footer{margin-top:40px;text-align:center;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:15px;}' +
      '</style></head><body>' +

      '<div class="header">' +
        '<div class="company">' +
          '<h1>' + _esc(company) + '</h1>' +
          (address ? '<p>' + _esc(address) + '</p>' : '') +
          (phone ? '<p>Tel: ' + _esc(phone) + '</p>' : '') +
          (email ? '<p>' + _esc(email) + '</p>' : '') +
          (settings.company_tax_id ? '<p>TIN: ' + _esc(settings.company_tax_id) + '</p>' : '') +
        '</div>' +
        '<div class="invoice-title">' +
          '<h2>Invoice</h2>' +
          '<p style="font-size:16px;font-weight:700;">' + _esc(invoice.invoice_number) + '</p>' +
          '<span class="status-badge" style="background:' + (statusColor[invoice.status] || '#888') + ';">' +
            _esc(invoice.status) +
          '</span>' +
        '</div>' +
      '</div>' +

      '<div class="meta-grid">' +
        '<div class="meta-box">' +
          '<h4>Bill To</h4>' +
          '<p style="font-weight:600;font-size:14px;">' + _esc(invoice.customer_name) + '</p>' +
        '</div>' +
        '<div class="meta-box" style="text-align:right;">' +
          '<h4>Invoice Details</h4>' +
          '<p><strong>Date:</strong> ' + _fmtDate(invoice.date) + '</p>' +
          '<p><strong>Due Date:</strong> ' + _fmtDate(invoice.due_date) + '</p>' +
          '<p><strong>Terms:</strong> ' + invoice.payment_terms + ' days</p>' +
        '</div>' +
      '</div>' +

      '<table>' +
        '<thead><tr>' +
          '<th style="width:40px;">#</th>' +
          '<th>Item</th>' +
          '<th style="text-align:right;width:60px;">Qty</th>' +
          '<th style="text-align:right;width:100px;">Price</th>' +
          '<th style="text-align:right;width:70px;">Disc.</th>' +
          '<th style="text-align:right;width:120px;">Amount</th>' +
        '</tr></thead>' +
        '<tbody>' + itemsHtml + '</tbody>' +
      '</table>' +

      '<table class="totals">' +
        '<tr><td>Subtotal</td><td>' + _fmtMoney(invoice.subtotal, sym) + '</td></tr>' +
        (Utils.toFloat(invoice.discount_amount, 0) > 0 ?
          '<tr><td>Discount</td><td>-' + _fmtMoney(invoice.discount_amount, sym) + '</td></tr>' : '') +
        '<tr><td>' + _esc(taxName) + '</td><td>' + _fmtMoney(invoice.tax_amount, sym) + '</td></tr>' +
        '<tr class="grand-total"><td>Total</td><td>' + _fmtMoney(invoice.total, sym) + '</td></tr>' +
        (Utils.toFloat(invoice.amount_paid, 0) > 0 ?
          '<tr><td>Paid</td><td>-' + _fmtMoney(invoice.amount_paid, sym) + '</td></tr>' +
          '<tr style="font-weight:700;"><td>Balance Due</td><td>' + _fmtMoney(invoice.balance_due, sym) + '</td></tr>'
          : '') +
      '</table>' +

      (invoice.notes ? '<div class="notes"><strong>Notes:</strong> ' + _esc(invoice.notes) + '</div>' : '') +

      '<div class="footer">' +
        '<p>Thank you for your business.</p>' +
        '<p>' + _esc(company) + '</p>' +
      '</div>' +

    '</body></html>';
  }

  /**
   * Build receipt HTML for PDF rendering.
   * @private
   */
  function _buildReceiptHtml(receipt, settings) {
    var sym = settings.currency_symbol || 'GH₵';
    var company = settings.company_name || 'My Company';

    return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<style>' +
        'body{font-family:Helvetica,Arial,sans-serif;color:#333;margin:0;padding:40px;font-size:12px;}' +
        '.receipt-box{max-width:500px;margin:0 auto;border:1px solid #ddd;padding:30px;border-radius:8px;}' +
        'h1{text-align:center;color:#1a73e8;font-size:22px;margin:0 0 5px 0;}' +
        'h3{text-align:center;color:#888;font-size:12px;margin:0 0 25px 0;text-transform:uppercase;letter-spacing:1px;}' +
        '.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0;}' +
        '.row .label{color:#666;}' +
        '.row .value{font-weight:600;}' +
        '.amount-row{margin-top:20px;text-align:center;padding:15px;background:#e6f4ea;border-radius:8px;}' +
        '.amount-row .label{font-size:11px;color:#666;text-transform:uppercase;}' +
        '.amount-row .value{font-size:28px;font-weight:700;color:#34a853;}' +
        '.footer{margin-top:25px;text-align:center;font-size:10px;color:#999;}' +
      '</style></head><body>' +
      '<div class="receipt-box">' +
        '<h1>' + _esc(company) + '</h1>' +
        '<h3>Payment Receipt</h3>' +
        '<div class="row"><span class="label">Receipt #</span><span class="value">' + _esc(receipt.receipt_number) + '</span></div>' +
        '<div class="row"><span class="label">Date</span><span class="value">' + _fmtDate(receipt.date) + '</span></div>' +
        '<div class="row"><span class="label">Received From</span><span class="value">' + _esc(receipt.customer_name) + '</span></div>' +
        '<div class="row"><span class="label">Payment Method</span><span class="value">' + _esc(receipt.payment_method) + '</span></div>' +
        (receipt.reference ? '<div class="row"><span class="label">Reference</span><span class="value">' + _esc(receipt.reference) + '</span></div>' : '') +
        '<div class="amount-row"><div class="label">Amount Received</div><div class="value">' + _fmtMoney(receipt.amount, sym) + '</div></div>' +
        '<div class="footer"><p>Thank you for your payment.</p></div>' +
      '</div>' +
    '</body></html>';
  }

  /**
   * HTML-escape a string for PDF rendering.
   * @private
   */
  function _esc(str) {
    if (!str) return '';
    return str.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    generateInvoicePdf: generateInvoicePdf,
    generateReceiptPdf: generateReceiptPdf
  };

})();
