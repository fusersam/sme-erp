/**
 * Employee & Salary Structure Services
 * =====================================
 * Full CRUD for employee records and reusable salary structures.
 * Replaces the Phase 1 EmployeeService stub.
 */

// ╔═══════════════════════════════════════════════════════╗
// ║              SALARY STRUCTURE SERVICE                 ║
// ╚═══════════════════════════════════════════════════════╝

var SalaryStructureService = (function() {

  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'name'; data.order = 'asc'; }
    return Utils.sheetToObjects('SalaryStructures', data);
  }

  function get(data) {
    var id = data.id || data.structure_id;
    var s = Utils.findRow('SalaryStructures', 'structure_id', id);
    if (!s) throw new Error('Salary structure not found');
    return s;
  }

  function create(data) {
    data = Validators.sanitizeObject(data);
    var v = Validators.required(data, ['name', 'basic_salary']);
    if (!v.valid) throw new Error(v.errors.join(', '));

    data.structure_id        = Utils.generateId('SAL');
    data.basic_salary        = Utils.toFloat(data.basic_salary, 0);
    data.transport_allowance = Utils.toFloat(data.transport_allowance, 0);
    data.housing_allowance   = Utils.toFloat(data.housing_allowance, 0);
    data.other_allowance     = Utils.toFloat(data.other_allowance, 0);
    data.ssnit_applicable    = data.ssnit_applicable !== false;
    data.paye_applicable     = data.paye_applicable !== false;
    data.status              = 'Active';
    data.created_at          = new Date();
    data.updated_at          = new Date();
    data.created_by          = _user();

    Utils.appendRow('SalaryStructures', data);
    AuditService.log('payroll', 'structure_created', { name: data.name }, data.structure_id);
    return { success: true, id: data.structure_id, name: data.name };
  }

  function update(data) {
    var id = data.id || data.structure_id;
    var existing = Utils.findRow('SalaryStructures', 'structure_id', id);
    if (!existing) throw new Error('Salary structure not found');
    data.updated_at = new Date();
    Utils.updateRow('SalaryStructures', existing._rowIndex, Validators.sanitizeObject(data));
    AuditService.log('payroll', 'structure_updated', { id: id }, id);
    return { success: true };
  }

  function remove(data) {
    var id = data.id || data.structure_id;
    var existing = Utils.findRow('SalaryStructures', 'structure_id', id);
    if (!existing) throw new Error('Salary structure not found');
    Utils.updateRow('SalaryStructures', existing._rowIndex, {
      status: 'Inactive', updated_at: new Date()
    });
    return { success: true };
  }

  function _user() {
    return Utils.currentUserEmail();
  }

  return { list: list, get: get, create: create, update: update, remove: remove, delete: remove };

})();

// ╔═══════════════════════════════════════════════════════╗
// ║                  EMPLOYEE SERVICE                    ║
// ╚═══════════════════════════════════════════════════════╝

var EmployeeService = (function() {

  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'first_name'; data.order = 'asc'; }
    return Utils.sheetToObjects('Employees', data);
  }

  function get(data) {
    var id = data.id || data.employee_id;
    var emp = Utils.findRow('Employees', 'employee_id', id);
    if (!emp) throw new Error('Employee not found');

    // Attach recent payslips
    var payslips = Utils.sheetToObjects('PayrollDetails', {
      filters: { employee_id: id },
      sort: 'created_at', order: 'desc', limit: 12
    });
    emp.payslips = payslips.data;
    return emp;
  }

  function create(data) {
    data = Validators.sanitizeObject(data);
    var v = Validators.validateEmployee(data);
    if (!v.valid) throw new Error(v.errors.join(', '));

    if (data.email) {
      var dup = Utils.findRow('Employees', 'email', data.email);
      if (dup) throw new Error('An employee with this email already exists.');
    }

    // If a salary structure is chosen, copy its values as defaults
    if (data.structure_id) {
      try {
        var struct = Utils.findRow('SalaryStructures', 'structure_id', data.structure_id);
        if (struct) {
          if (data.basic_salary === undefined || data.basic_salary === '') data.basic_salary = struct.basic_salary;
          if (data.transport_allowance === undefined) data.transport_allowance = struct.transport_allowance;
          if (data.housing_allowance === undefined) data.housing_allowance = struct.housing_allowance;
          if (data.other_allowance === undefined) data.other_allowance = struct.other_allowance;
        }
      } catch (e) { /* ignore */ }
    }

    data.employee_id         = Utils.generateId('EMP');
    data.employee_number     = data.employee_number || Utils.generateDocNumber('Employees', 'employee_number', 'EMP-', 4);
    data.basic_salary        = Utils.toFloat(data.basic_salary, 0);
    data.transport_allowance = Utils.toFloat(data.transport_allowance, 0);
    data.housing_allowance   = Utils.toFloat(data.housing_allowance, 0);
    data.other_allowance     = Utils.toFloat(data.other_allowance, 0);
    data.ssnit_applicable    = data.ssnit_applicable !== false && data.ssnit_applicable !== 'false';
    data.paye_applicable     = data.paye_applicable !== false && data.paye_applicable !== 'false';
    data.employment_type     = data.employment_type || 'Full-time';
    data.status              = 'Active';
    data.created_at          = new Date();
    data.updated_at          = new Date();
    data.created_by          = _user();

    Utils.appendRow('Employees', data);
    AuditService.log('payroll', 'employee_created', {
      name: data.first_name + ' ' + data.last_name
    }, data.employee_id);

    return { success: true, id: data.employee_id, number: data.employee_number };
  }

  function update(data) {
    var id = data.id || data.employee_id;
    var existing = Utils.findRow('Employees', 'employee_id', id);
    if (!existing) throw new Error('Employee not found');

    if (data.email && data.email !== existing.email) {
      var dup = Utils.findRow('Employees', 'email', data.email);
      if (dup && dup.employee_id !== id) throw new Error('Email already in use.');
    }

    if (data.basic_salary !== undefined) data.basic_salary = Utils.toFloat(data.basic_salary, 0);
    data.updated_at = new Date();
    Utils.updateRow('Employees', existing._rowIndex, Validators.sanitizeObject(data));
    AuditService.log('payroll', 'employee_updated', { id: id }, id);
    return { success: true };
  }

  function remove(data) {
    var id = data.id || data.employee_id;
    var existing = Utils.findRow('Employees', 'employee_id', id);
    if (!existing) throw new Error('Employee not found');
    Utils.updateRow('Employees', existing._rowIndex, {
      status: 'Terminated',
      termination_date: data.termination_date || new Date(),
      updated_at: new Date()
    });
    AuditService.log('payroll', 'employee_terminated', { id: id }, id);
    return { success: true };
  }

  /**
   * Preview the payslip calculation for an employee without saving.
   * @param {Object} data - { id, overtime, other_deductions }
   */
  function previewPayslip(data) {
    var emp = Utils.findRow('Employees', 'employee_id', data.id || data.employee_id);
    if (!emp) throw new Error('Employee not found');
    var calc = TaxEngine.calculatePayslip(emp, {
      overtime: data.overtime, other_deductions: data.other_deductions
    });
    calc.employee_name = emp.first_name + ' ' + emp.last_name;
    return calc;
  }

  function _user() {
    return Utils.currentUserEmail();
  }

  return {
    list:           list,
    get:            get,
    create:         create,
    update:         update,
    remove:         remove,
    delete:         remove,
    previewPayslip: previewPayslip
  };

})();
