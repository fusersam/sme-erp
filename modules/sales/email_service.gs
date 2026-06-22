/**
 * Email Service
 * ===============
 * Sends invoices and receipts via email with PDF attachments.
 * Uses Google Apps Script MailApp for delivery.
 */

var EmailService = (function() {

  /**
   * Send an invoice by email with PDF attachment.
   *
   * @param {Object} data
   * @param {string} data.invoice_id
   * @param {string} [data.to]       - Override recipient email
   * @param {string} [data.subject]  - Override subject
   * @param {string} [data.message]  - Override body message
   * @returns {Object} { success, message }
   */
  function sendInvoice(data) {
    var invoice = InvoiceService.get({ id: data.invoice_id });
    if (!invoice) throw new Error('Invoice not found');

    // Get customer email
    var customer = Utils.findRow('Customers', 'customer_id', invoice.customer_id);
    var recipientEmail = data.to || (customer ? customer.email : '');

    if (!recipientEmail) {
      throw new Error('No email address found for this customer. Please provide a recipient email.');
    }

    if (!Validators.isValidEmail(recipientEmail)) {
      throw new Error('Invalid email address: ' + recipientEmail);
    }

    // Generate PDF
    var pdfResult = PdfService.generateInvoicePdf(data.invoice_id);
    var pdfFile = DriveApp.getFileById(pdfResult.fileId);
    var pdfBlob = pdfFile.getBlob();

    var settings = ConfigService.getAllSettings();
    var company = settings.company_name || 'My Company';
    var sym = settings.currency_symbol || 'GH₵';

    // Compose email
    var subject = data.subject || 'Invoice ' + invoice.invoice_number + ' from ' + company;
    var body = data.message || _buildInvoiceEmailBody(invoice, company, sym);

    try {
      MailApp.sendEmail({
        to: recipientEmail,
        subject: subject,
        htmlBody: body,
        attachments: [pdfBlob],
        name: company
      });
    } catch (e) {
      throw new Error('Failed to send email: ' + e.message);
    }

    // Update invoice status to Sent if still Draft
    if (invoice.status === 'Draft') {
      InvoiceService.send({ id: data.invoice_id });
    }

    AuditService.log('invoices', 'emailed', {
      invoiceId: data.invoice_id,
      number: invoice.invoice_number,
      to: recipientEmail
    }, data.invoice_id);

    return {
      success: true,
      message: 'Invoice emailed to ' + recipientEmail
    };
  }

  /**
   * Send a receipt by email with PDF attachment.
   *
   * @param {Object} data
   * @param {string} data.receipt_id
   * @param {string} [data.to]
   * @returns {Object} { success, message }
   */
  function sendReceipt(data) {
    var receipt = ReceiptService.get({ id: data.receipt_id });
    if (!receipt) throw new Error('Receipt not found');

    var customer = Utils.findRow('Customers', 'customer_id', receipt.customer_id);
    var recipientEmail = data.to || (customer ? customer.email : '');

    if (!recipientEmail) {
      throw new Error('No email address found for this customer.');
    }

    var pdfResult = PdfService.generateReceiptPdf(data.receipt_id);
    var pdfFile = DriveApp.getFileById(pdfResult.fileId);
    var pdfBlob = pdfFile.getBlob();

    var settings = ConfigService.getAllSettings();
    var company = settings.company_name || 'My Company';
    var sym = settings.currency_symbol || 'GH₵';
    var amount = Utils.toFloat(receipt.amount, 0);

    var subject = 'Payment Receipt ' + receipt.receipt_number + ' from ' + company;
    var body = _buildReceiptEmailBody(receipt, company, sym);

    try {
      MailApp.sendEmail({
        to: recipientEmail,
        subject: subject,
        htmlBody: body,
        attachments: [pdfBlob],
        name: company
      });
    } catch (e) {
      throw new Error('Failed to send receipt email: ' + e.message);
    }

    AuditService.log('receipts', 'emailed', {
      receiptId: data.receipt_id,
      number: receipt.receipt_number,
      to: recipientEmail
    }, data.receipt_id);

    return {
      success: true,
      message: 'Receipt emailed to ' + recipientEmail
    };
  }

  /**
   * Build the invoice email HTML body.
   * @private
   */
  function _buildInvoiceEmailBody(invoice, company, sym) {
    var fmtMoney = function(amt) {
      var n = parseFloat(amt) || 0;
      return sym + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };
    var dueDate = invoice.due_date ? new Date(invoice.due_date) : new Date();
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var dueDateStr = dueDate.getDate() + ' ' + months[dueDate.getMonth()] + ' ' + dueDate.getFullYear();

    return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">' +
      '<div style="background:#1a73e8;padding:20px 30px;border-radius:8px 8px 0 0;">' +
        '<h1 style="color:#fff;margin:0;font-size:20px;">' + _esc(company) + '</h1>' +
      '</div>' +
      '<div style="padding:30px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">' +
        '<p>Dear ' + _esc(invoice.customer_name) + ',</p>' +
        '<p>Please find attached invoice <strong>' + _esc(invoice.invoice_number) + '</strong> ' +
           'for <strong>' + fmtMoney(invoice.total) + '</strong>.</p>' +
        '<div style="background:#f8f9fa;padding:15px 20px;border-radius:6px;margin:20px 0;">' +
          '<table style="width:100%;font-size:14px;">' +
            '<tr><td style="padding:4px 0;color:#666;">Invoice #</td><td style="text-align:right;font-weight:600;">' + _esc(invoice.invoice_number) + '</td></tr>' +
            '<tr><td style="padding:4px 0;color:#666;">Amount Due</td><td style="text-align:right;font-weight:600;color:#1a73e8;">' + fmtMoney(invoice.balance_due || invoice.total) + '</td></tr>' +
            '<tr><td style="padding:4px 0;color:#666;">Due Date</td><td style="text-align:right;font-weight:600;">' + dueDateStr + '</td></tr>' +
          '</table>' +
        '</div>' +
        '<p>Payment terms: ' + (invoice.payment_terms || 30) + ' days.</p>' +
        '<p>If you have any questions, please do not hesitate to contact us.</p>' +
        '<p>Thank you for your business.</p>' +
        '<p style="margin-top:25px;">Kind regards,<br><strong>' + _esc(company) + '</strong></p>' +
      '</div>' +
      '<div style="text-align:center;padding:15px;font-size:11px;color:#999;">' +
        '<p>This is an automated message from ' + _esc(company) + '.</p>' +
      '</div>' +
    '</div>';
  }

  /**
   * Build the receipt email HTML body.
   * @private
   */
  function _buildReceiptEmailBody(receipt, company, sym) {
    var fmtMoney = function(amt) {
      var n = parseFloat(amt) || 0;
      return sym + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };

    return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">' +
      '<div style="background:#34a853;padding:20px 30px;border-radius:8px 8px 0 0;">' +
        '<h1 style="color:#fff;margin:0;font-size:20px;">' + _esc(company) + '</h1>' +
      '</div>' +
      '<div style="padding:30px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">' +
        '<p>Dear ' + _esc(receipt.customer_name) + ',</p>' +
        '<p>Thank you for your payment. This confirms receipt of <strong>' + fmtMoney(receipt.amount) + '</strong>.</p>' +
        '<div style="background:#e6f4ea;padding:15px 20px;border-radius:6px;margin:20px 0;text-align:center;">' +
          '<div style="font-size:11px;color:#666;text-transform:uppercase;">Amount Received</div>' +
          '<div style="font-size:28px;font-weight:700;color:#34a853;">' + fmtMoney(receipt.amount) + '</div>' +
        '</div>' +
        '<p>Receipt #: <strong>' + _esc(receipt.receipt_number) + '</strong></p>' +
        '<p>Payment method: ' + _esc(receipt.payment_method) + '</p>' +
        '<p>Your receipt PDF is attached for your records.</p>' +
        '<p style="margin-top:25px;">Kind regards,<br><strong>' + _esc(company) + '</strong></p>' +
      '</div>' +
    '</div>';
  }

  /**
   * HTML-escape.
   * @private
   */
  function _esc(str) {
    if (!str) return '';
    return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return {
    sendInvoice: sendInvoice,
    sendReceipt: sendReceipt
  };

})();
