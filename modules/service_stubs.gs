/**
 * Module Service Stubs
 * =====================
 * Minimal implementations for modules NOT YET fully implemented.
 * Phase 2 replaced: CustomerService, InvoiceService, ReceiptService,
 *   QuotationService, JournalService, ChartOfAccountsService.
 * Phase 3 replaced: ProductService, SupplierService, CategoryService,
 *   InventoryService.
 * Phase 4 replaced: EmployeeService, PayrollService, SalaryStructureService.
 * Phase 5 replaced: ReportService.
 *
 * These remaining stubs ensure the application is deployable.
 */

// ── User Service (functional since Phase 1) ──
var UserService = (function() {
  function list(data) {
    return Utils.sheetToObjects('Users', data || {});
  }
  function get(data) {
    return Utils.findRow('Users', 'user_id', data.id);
  }
  function create(data) {
    AuthService.requireRole('Administrator');
    data = Validators.sanitizeObject(data);
    var v = Validators.required(data, ['email', 'name', 'role']);
    if (!v.valid) throw new Error(v.errors.join(', '));
    data.user_id = Utilities.getUuid();
    data.status = data.status || 'Active';
    data.created_at = new Date();
    data.created_by = Utils.currentUserEmail();
    Utils.appendRow('Users', data);
    return { success: true, id: data.user_id };
  }
  function update(data) {
    AuthService.requireRole('Administrator');
    var existing = Utils.findRow('Users', 'user_id', data.id || data.user_id);
    if (!existing) throw new Error('User not found');
    data.updated_at = new Date();
    Utils.updateRow('Users', existing._rowIndex, Validators.sanitizeObject(data));
    return { success: true };
  }
  return { list: list, get: get, create: create, update: update };
})();

// ── Expense Service (stub → Phase 3) ──
var ExpenseService = (function() {
  function list(data) { return Utils.sheetToObjects('Expenses', data || {}); }
  function get(data) { return Utils.findRow('Expenses', 'expense_id', data.id); }
  function create(data) { throw new Error('Expense module coming in Phase 4.'); }
  function update(data) { throw new Error('Expense module coming in Phase 4.'); }
  return { list: list, get: get, create: create, update: update };
})();

// ── Purchase Order Service (stub → Phase 3) ──
var PurchaseOrderService = (function() {
  function list(data) { return Utils.sheetToObjects('PurchaseOrders', data || {}); }
  function get(data) { return Utils.findRow('PurchaseOrders', 'po_id', data.id); }
  function create(data) { throw new Error('Purchase module coming in Phase 4.'); }
  function update(data) { throw new Error('Purchase module coming in Phase 4.'); }
  return { list: list, get: get, create: create, update: update };
})();

// ── Cashbook Service (stub → Phase 3) ──
var CashbookService = (function() {
  function list(data) { return Utils.sheetToObjects('Cashbook', data || {}); }
  function get(data) { return Utils.findRow('Cashbook', 'entry_id', data.id); }
  function create(data) { throw new Error('Cashbook module coming in Phase 4.'); }
  function update(data) { throw new Error('Cashbook module coming in Phase 4.'); }
  return { list: list, get: get, create: create, update: update };
})();

// ── Asset Service (stub → Phase 5) ──
var AssetService = (function() {
  function list(data) { return Utils.sheetToObjects('Assets', data || {}); }
  function get(data) { return Utils.findRow('Assets', 'asset_id', data.id); }
  function create(data) { throw new Error('Asset module coming in Phase 5.'); }
  function update(data) { throw new Error('Asset module coming in Phase 5.'); }
  return { list: list, get: get, create: create, update: update };
})();

// ── Report Service: now implemented in modules/reports/report_service.gs ──
