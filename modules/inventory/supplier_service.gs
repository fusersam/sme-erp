/**
 * Supplier Service
 * =================
 * Full CRUD for supplier management with balance tracking,
 * contact history, and payable aging.
 *
 * Replaces the Phase 1 stub in service_stubs.gs.
 */

var SupplierService = (function() {

  // ─────────────────────────────────────────
  // CORE CRUD
  // ─────────────────────────────────────────

  /**
   * List suppliers with optional filters and pagination.
   * @param {Object} data - { filters, sort, order, limit, offset }
   */
  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'name'; data.order = 'asc'; }
    return Utils.sheetToObjects('Suppliers', data);
  }

  /**
   * Get a single supplier with outstanding purchase orders.
   * @param {Object} data - { id }
   */
  function get(data) {
    var id = data.id || data.supplier_id;
    var supplier = Utils.findRow('Suppliers', 'supplier_id', id);
    if (!supplier) throw new Error('Supplier not found');

    // Attach recent purchase orders
    var poResult = Utils.sheetToObjects('PurchaseOrders', {
      filters: { supplier_id: id },
      sort: 'date',
      order: 'desc',
      limit: 10
    });
    supplier.recentOrders = poResult.data;

    return supplier;
  }

  /**
   * Create a new supplier.
   * @param {Object} data - { name (required), email, phone, address, payment_terms, ... }
   */
  function create(data) {
    data = Validators.sanitizeObject(data);
    var v = Validators.required(data, ['name']);
    if (!v.valid) throw new Error(v.errors.join(', '));

    if (data.email && !Validators.isValidEmail(data.email)) {
      throw new Error('Invalid email format');
    }

    // Duplicate name check
    var existing = Utils.findRow('Suppliers', 'name', data.name);
    if (existing && existing.status !== 'Inactive') {
      throw new Error('A supplier with this name already exists.');
    }

    var settings = ConfigService.getAllSettings();

    data.supplier_id  = Utils.generateId('SUP');
    data.status       = 'Active';
    data.balance      = 0;
    data.country      = data.country || 'Ghana';
    data.payment_terms = data.payment_terms || settings.default_payment_terms || 30;
    data.created_at   = new Date();
    data.updated_at   = new Date();
    data.created_by   = Utils.currentUserEmail();

    Utils.appendRow('Suppliers', data);
    AuditService.log('suppliers', 'created', { name: data.name }, data.supplier_id);

    return { success: true, id: data.supplier_id, name: data.name };
  }

  /**
   * Update an existing supplier.
   * @param {Object} data - { id, ...fields }
   */
  function update(data) {
    var id = data.id || data.supplier_id;
    var existing = Utils.findRow('Suppliers', 'supplier_id', id);
    if (!existing) throw new Error('Supplier not found');

    if (data.email && !Validators.isValidEmail(data.email)) {
      throw new Error('Invalid email format');
    }

    // Do not allow overwriting the balance via update
    delete data.balance;

    data.updated_at = new Date();
    Utils.updateRow('Suppliers', existing._rowIndex, Validators.sanitizeObject(data));
    AuditService.log('suppliers', 'updated', { id: id }, id);
    return { success: true };
  }

  /**
   * Soft-delete a supplier.
   */
  function remove(data) {
    var id = data.id || data.supplier_id;
    var existing = Utils.findRow('Suppliers', 'supplier_id', id);
    if (!existing) throw new Error('Supplier not found');

    // Prevent deletion if there are outstanding purchase orders
    var orders = Utils.sheetToObjects('PurchaseOrders', {
      filters: { supplier_id: id }
    }).data;

    var hasOutstanding = orders.some(function(po) {
      return po.status !== 'Closed' && po.status !== 'Cancelled';
    });
    if (hasOutstanding) {
      throw new Error('Cannot deactivate supplier with open purchase orders.');
    }

    Utils.updateRow('Suppliers', existing._rowIndex, {
      status: 'Inactive',
      updated_at: new Date()
    });
    AuditService.log('suppliers', 'deactivated', { id: id }, id);
    return { success: true };
  }

  // ─────────────────────────────────────────
  // BALANCE & REPORTING
  // ─────────────────────────────────────────

  /**
   * Recalculate and update a supplier's balance.
   * Balance = sum of all open purchase order balances.
   * @param {string} supplierId
   * @returns {number} New balance
   */
  function recalculateBalance(supplierId) {
    var orders = Utils.sheetToObjects('PurchaseOrders', {
      filters: { supplier_id: supplierId }
    }).data;

    var balance = 0;
    for (var i = 0; i < orders.length; i++) {
      var po = orders[i];
      if (po.status !== 'Cancelled' && po.status !== 'Draft') {
        balance += Utils.toFloat(po.balance_due, 0);
      }
    }

    var supplier = Utils.findRow('Suppliers', 'supplier_id', supplierId);
    if (supplier) {
      Utils.updateRow('Suppliers', supplier._rowIndex, {
        balance: Utils.round2(balance),
        updated_at: new Date()
      });
    }
    return Utils.round2(balance);
  }

  /**
   * Get supplier statement (all purchase orders and payments).
   * @param {Object} data - { id }
   */
  function getStatement(data) {
    var id = data.id || data.supplier_id;
    var supplier = Utils.findRow('Suppliers', 'supplier_id', id);
    if (!supplier) throw new Error('Supplier not found');

    var orders = Utils.sheetToObjects('PurchaseOrders', {
      filters: { supplier_id: id },
      sort: 'date', order: 'asc'
    }).data;

    return {
      supplier: supplier,
      orders: orders,
      balance: Utils.toFloat(supplier.balance, 0)
    };
  }

  /**
   * Get payable aging analysis across all suppliers.
   * @returns {Object} Aging buckets: current, 30, 60, 90, 90+
   */
  function getPayableAging() {
    var orders = Utils.sheetToObjects('PurchaseOrders', {}).data;
    var today = new Date();

    var aging = {
      current: [],
      days30:  [],
      days60:  [],
      days90:  [],
      over90:  [],
      totals: { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 }
    };

    orders.forEach(function(po) {
      var balance = Utils.toFloat(po.balance_due, 0);
      if (balance <= 0 || po.status === 'Cancelled' || po.status === 'Draft' || po.status === 'Closed') return;

      var dueDate    = new Date(po.expected_date || po.date);
      var daysPast   = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

      var entry = {
        po_number:     po.po_number,
        supplier_name: po.supplier_name,
        date:          po.date,
        due_date:      po.expected_date,
        total:         po.total,
        balance_due:   balance,
        days_overdue:  Math.max(0, daysPast)
      };

      if (daysPast <= 0)       { aging.current.push(entry); aging.totals.current += balance; }
      else if (daysPast <= 30) { aging.days30.push(entry);  aging.totals.days30  += balance; }
      else if (daysPast <= 60) { aging.days60.push(entry);  aging.totals.days60  += balance; }
      else if (daysPast <= 90) { aging.days90.push(entry);  aging.totals.days90  += balance; }
      else                      { aging.over90.push(entry);  aging.totals.over90  += balance; }
      aging.totals.total += balance;
    });

    for (var key in aging.totals) {
      aging.totals[key] = Utils.round2(aging.totals[key]);
    }

    return aging;
  }

  return {
    list:                list,
    get:                 get,
    create:              create,
    update:              update,
    remove:              remove,
    delete:              remove,
    recalculateBalance:  recalculateBalance,
    getStatement:        getStatement,
    getPayableAging:     getPayableAging
  };

})();
