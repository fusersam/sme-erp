/**
 * Customer Service
 * =================
 * Full CRUD for customer management with balance tracking.
 * Replaces the Phase 1 stub.
 */

var CustomerService = (function() {

  /**
   * List customers with optional filters and pagination.
   */
  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'name'; data.order = 'asc'; }
    return Utils.sheetToObjects('Customers', data);
  }

  /**
   * Get a single customer by ID.
   */
  function get(data) {
    var customer = Utils.findRow('Customers', 'customer_id', data.id || data.customer_id);
    if (!customer) throw new Error('Customer not found');

    // Attach recent invoices
    var invoiceResult = Utils.sheetToObjects('Invoices', {
      filters: { customer_id: customer.customer_id },
      sort: 'date',
      order: 'desc',
      limit: 10
    });
    customer.recentInvoices = invoiceResult.data;
    return customer;
  }

  /**
   * Create a new customer.
   */
  function create(data) {
    data = Validators.sanitizeObject(data);
    var v = Validators.validateCustomer(data);
    if (!v.valid) throw new Error(v.errors.join(', '));

    // Check for duplicate name
    var existing = Utils.findRow('Customers', 'name', data.name);
    if (existing && existing.status !== 'Deleted') {
      // Include the existing record's ID so this is directly verifiable —
      // if that ID can't be found anywhere in the spreadsheet someone has
      // open, the deployed app is very likely connected to a DIFFERENT
      // spreadsheet than the one being checked manually (see Database Info
      // in the menu, which shows exactly which spreadsheet is live).
      throw new Error('A customer named "' + data.name + '" already exists ' +
        '(ID: ' + existing.customer_id + '). If you can\'t find that ID anywhere ' +
        'in your spreadsheet, check "Database Info" in the menu — the app may be ' +
        'connected to a different spreadsheet than the one you have open.');
    }

    var settings = ConfigService.getAllSettings();

    data.customer_id = Utils.generateId('CUS');
    data.status = 'Active';
    data.balance = 0;
    data.country = data.country || 'Ghana';
    data.payment_terms = data.payment_terms || settings.default_payment_terms || 30;
    data.credit_limit = Utils.toFloat(data.credit_limit, 0);
    data.created_at = new Date();
    data.updated_at = new Date();
    data.created_by = Utils.currentUserEmail();

    Utils.appendRow('Customers', data);
    AuditService.log('customers', 'created', { name: data.name }, data.customer_id);

    return { success: true, id: data.customer_id, name: data.name };
  }

  /**
   * Update an existing customer.
   */
  function update(data) {
    var id = data.id || data.customer_id;
    var existing = Utils.findRow('Customers', 'customer_id', id);
    if (!existing) throw new Error('Customer not found');

    // Do not allow overwriting the balance via update
    delete data.balance;

    data.updated_at = new Date();
    Utils.updateRow('Customers', existing._rowIndex, Validators.sanitizeObject(data));
    AuditService.log('customers', 'updated', { id: id }, id);
    return { success: true };
  }

  /**
   * Soft-delete a customer.
   */
  function remove(data) {
    var id = data.id || data.customer_id;
    var existing = Utils.findRow('Customers', 'customer_id', id);
    if (!existing) throw new Error('Customer not found');

    // Prevent deletion if there are outstanding invoices
    var invoices = Utils.sheetToObjects('Invoices', {
      filters: { customer_id: id }
    }).data;
    var hasOutstanding = invoices.some(function(inv) {
      return inv.status !== 'Paid' && inv.status !== 'Cancelled' && inv.status !== 'Draft';
    });
    if (hasOutstanding) {
      throw new Error('Cannot delete customer with outstanding invoices.');
    }

    Utils.updateRow('Customers', existing._rowIndex, {
      status: 'Inactive',
      updated_at: new Date()
    });
    AuditService.log('customers', 'deleted', { id: id }, id);
    return { success: true };
  }

  /**
   * Recalculate and update a customer's balance.
   * Balance = sum of all unpaid/partially-paid invoice balances.
   * @param {string} customerId
   */
  function recalculateBalance(customerId) {
    var invoices = Utils.sheetToObjects('Invoices', {
      filters: { customer_id: customerId }
    }).data;

    var balance = 0;
    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      if (inv.status !== 'Cancelled' && inv.status !== 'Draft') {
        balance += Utils.toFloat(inv.balance_due, 0);
      }
    }

    var customer = Utils.findRow('Customers', 'customer_id', customerId);
    if (customer) {
      Utils.updateRow('Customers', customer._rowIndex, {
        balance: Utils.round2(balance),
        updated_at: new Date()
      });
    }
    return Utils.round2(balance);
  }

  /**
   * Get customer statement (all invoices and receipts).
   */
  function getStatement(data) {
    var id = data.id || data.customer_id;
    var customer = Utils.findRow('Customers', 'customer_id', id);
    if (!customer) throw new Error('Customer not found');

    var invoices = Utils.sheetToObjects('Invoices', {
      filters: { customer_id: id },
      sort: 'date', order: 'asc'
    }).data;

    var receipts = Utils.sheetToObjects('Receipts', {
      filters: { customer_id: id },
      sort: 'date', order: 'asc'
    }).data;

    return {
      customer: customer,
      invoices: invoices,
      receipts: receipts,
      balance: Utils.toFloat(customer.balance, 0)
    };
  }

  return {
    list: list,
    get: get,
    create: create,
    update: update,
    remove: remove,
    delete: remove,
    recalculateBalance: recalculateBalance,
    getStatement: getStatement
  };

})();
