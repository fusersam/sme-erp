/**
 * Payroll Service
 * ===============
 * Processes monthly payroll runs:
 *   - Calculates gross, SSNIT, PAYE, and net for every active employee
 *   - Writes a Payroll header + one PayrollDetails row (payslip) per employee
 *   - Posts the consolidated payroll journal to the accounting engine
 *   - Supports preview (draft) and processing (post)
 *
 * Payroll journal (per run):
 *   Dr Salary & Wages (6100)             total gross
 *   Dr Employer Pension Contribution (6110)  total employer SSNIT
 *      Cr PAYE Payable (2220)               total PAYE
 *      Cr Pension Payable (2230)            employee + employer SSNIT
 *      Cr Net Salary Payable (2240)         total net pay
 *      Cr Other Deductions ... (2300)       total other deductions (if any)
 *
 * This keeps the books balanced: the debits (cost to company) equal the
 * credits (liabilities to GRA, SSNIT, and employees).
 */

var PayrollService = (function() {

  // ─────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────

  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'period'; data.order = 'desc'; }
    return Utils.sheetToObjects('Payroll', data);
  }

  function get(data) {
    var id = data.id || data.payroll_id;
    var run = Utils.findRow('Payroll', 'payroll_id', id);
    if (!run) throw new Error('Payroll run not found');

    var details = Utils.sheetToObjects('PayrollDetails', {
      filters: { payroll_id: id },
      sort: 'employee_name', order: 'asc'
    });
    run.details = details.data;
    return run;
  }

  /**
   * Get a single payslip (PayrollDetails row).
   */
  function getPayslip(data) {
    var detail = Utils.findRow('PayrollDetails', 'detail_id', data.id || data.detail_id);
    if (!detail) throw new Error('Payslip not found');
    return detail;
  }

  // ─────────────────────────────────────────
  // PREVIEW (DRAFT)
  // ─────────────────────────────────────────

  /**
   * Preview a payroll run for a period without saving.
   * Calculates every active employee and returns the totals + per-employee lines.
   *
   * @param {Object} data - { period: 'yyyy-MM' }
   * @returns {Object} { period, lines: [...], totals: {...} }
   */
  function preview(data) {
    var period = data.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      throw new Error('Invalid period. Expected yyyy-MM.');
    }

    var employees = Utils.sheetToObjects('Employees', {
      filters: { status: 'Active' }
    }).data;

    var lines = [];
    var totals = _emptyTotals();

    employees.forEach(function(emp) {
      var calc = TaxEngine.calculatePayslip(emp, {});
      calc.employee_id   = emp.employee_id;
      calc.employee_name = emp.first_name + ' ' + emp.last_name;
      calc.payment_method = emp.bank_name ? 'Bank Transfer' : 'Cash';
      lines.push(calc);
      _accumulate(totals, calc);
    });

    return { period: period, lines: lines, totals: _round(totals), employeeCount: lines.length };
  }

  // ─────────────────────────────────────────
  // PROCESS (POST)
  // ─────────────────────────────────────────

  /**
   * Process a payroll run: persist the header, payslips, and post the journal.
   *
   * @param {Object} data - { period: 'yyyy-MM' }
   * @returns {Object} { success, payrollId, journalRef, totals }
   */
  function process(data) {
    var period = data.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      throw new Error('Invalid period. Expected yyyy-MM.');
    }

    // Prevent duplicate processing for the same period
    var existing = Utils.findRow('Payroll', 'period', period);
    if (existing && existing.status === 'Processed') {
      throw new Error('Payroll for ' + period + ' has already been processed.');
    }

    var prev = preview({ period: period });
    if (prev.lines.length === 0) {
      throw new Error('No active employees to process.');
    }

    var bounds = _periodBounds(period);
    var payrollId = Utils.generateId('PAY');
    var now = new Date();
    var totals = prev.totals;

    // ── Write Payroll header ──
    Utils.appendRow('Payroll', {
      payroll_id:             payrollId,
      period:                 period,
      start_date:             bounds.start,
      end_date:               bounds.end,
      total_gross:            totals.gross_pay,
      total_deductions:       totals.total_deductions,
      total_net:              totals.net_pay,
      total_employer_cost:    totals.employer_cost,
      total_paye:             totals.paye_tax,
      total_pension_employee: totals.pension_employee,
      total_pension_employer: totals.pension_employer,
      employee_count:         prev.lines.length,
      status:                 'Draft',
      journal_ref:            '',
      processed_by:           _user(),
      approved_by:            '',
      created_at:             now,
      updated_at:             now
    });

    // ── Write PayrollDetails (payslips) ──
    prev.lines.forEach(function(ln) {
      Utils.appendRow('PayrollDetails', {
        detail_id:        Utils.generateId('PSL'),
        payroll_id:       payrollId,
        employee_id:      ln.employee_id,
        employee_name:    ln.employee_name,
        basic_salary:     ln.basic_salary,
        allowances:       ln.allowances,
        overtime:         ln.overtime,
        gross_pay:        ln.gross_pay,
        ssnit_base:       ln.ssnit_base,
        paye_tax:         ln.paye_tax,
        pension_employee: ln.pension_employee,
        pension_employer: ln.pension_employer,
        other_deductions: ln.other_deductions,
        total_deductions: ln.total_deductions,
        net_pay:          ln.net_pay,
        payment_method:   ln.payment_method,
        payment_ref:      '',
        created_at:       now
      });
    });

    // ── Post the payroll journal ──
    var journalRef = _postPayrollJournal(period, totals, bounds.end, payrollId);

    // ── Update header to Processed ──
    var headerRow = Utils.findRow('Payroll', 'payroll_id', payrollId);
    if (headerRow) {
      Utils.updateRow('Payroll', headerRow._rowIndex, {
        status: 'Processed',
        journal_ref: journalRef,
        updated_at: new Date()
      });
    }

    AuditService.log('payroll', 'payroll_processed', {
      period: period, gross: totals.gross_pay, net: totals.net_pay, employees: prev.lines.length
    }, payrollId);

    return {
      success:    true,
      payrollId:  payrollId,
      journalRef: journalRef,
      totals:     totals,
      employeeCount: prev.lines.length
    };
  }

  /**
   * Post the consolidated payroll journal.
   * @private
   */
  function _postPayrollJournal(period, totals, date, payrollId) {
    var lines = [];

    // Debits — cost to the company
    if (totals.gross_pay > 0) {
      lines.push({ accountCode: '6100', accountName: 'Salary & Wages', debit: totals.gross_pay, credit: 0 });
    }
    if (totals.pension_employer > 0) {
      lines.push({ accountCode: '6110', accountName: 'Employer Pension Contribution', debit: totals.pension_employer, credit: 0 });
    }

    // Credits — liabilities
    if (totals.paye_tax > 0) {
      lines.push({ accountCode: '2220', accountName: 'PAYE Payable', debit: 0, credit: totals.paye_tax });
    }
    var totalPension = Utils.round2(totals.pension_employee + totals.pension_employer);
    if (totalPension > 0) {
      lines.push({ accountCode: '2230', accountName: 'Pension Payable', debit: 0, credit: totalPension });
    }
    if (totals.other_deductions > 0) {
      lines.push({ accountCode: '2300', accountName: 'Accrued Expenses', debit: 0, credit: totals.other_deductions });
    }
    if (totals.net_pay > 0) {
      lines.push({ accountCode: '2240', accountName: 'Net Salary Payable', debit: 0, credit: totals.net_pay });
    }

    if (lines.length < 2) return '';

    var result = AccountingEngine.createJournalEntry({
      date:          date,
      description:   'Payroll ' + period,
      referenceType: 'Payroll',
      referenceId:   payrollId,
      lines:         lines
    });
    return result.entryNumber || '';
  }

  /**
   * Record payment of net salaries (clears Net Salary Payable to Cash/Bank).
   *
   * @param {Object} data - { payroll_id, payment_method }
   */
  function payNetSalaries(data) {
    var run = Utils.findRow('Payroll', 'payroll_id', data.payroll_id);
    if (!run) throw new Error('Payroll run not found');
    if (run.status === 'Paid') throw new Error('Salaries already paid for this run.');

    var net = Utils.toFloat(run.total_net, 0);
    if (net <= 0) throw new Error('Nothing to pay.');

    var pay = (data.payment_method === 'Cash')
      ? { code: '1100', name: 'Cash on Hand' }
      : { code: '1210', name: 'Main Bank Account' };

    var result = AccountingEngine.createJournalEntry({
      date:          new Date(),
      description:   'Net salary payment ' + run.period,
      referenceType: 'PayrollPayment',
      referenceId:   run.payroll_id,
      lines: [
        { accountCode: '2240', accountName: 'Net Salary Payable', debit: net, credit: 0 },
        { accountCode: pay.code, accountName: pay.name, debit: 0, credit: net }
      ]
    });

    Utils.updateRow('Payroll', run._rowIndex, {
      status: 'Paid', updated_at: new Date()
    });

    AuditService.log('payroll', 'salaries_paid', {
      period: run.period, amount: net, method: data.payment_method
    }, run.payroll_id);

    return { success: true, journalRef: result.entryNumber, amount: net };
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  function _emptyTotals() {
    return {
      basic_salary: 0, allowances: 0, overtime: 0, gross_pay: 0,
      pension_employee: 0, pension_employer: 0, paye_tax: 0,
      other_deductions: 0, total_deductions: 0, net_pay: 0, employer_cost: 0
    };
  }

  function _accumulate(t, c) {
    t.basic_salary     += Utils.toFloat(c.basic_salary, 0);
    t.allowances       += Utils.toFloat(c.allowances, 0);
    t.overtime         += Utils.toFloat(c.overtime, 0);
    t.gross_pay        += Utils.toFloat(c.gross_pay, 0);
    t.pension_employee += Utils.toFloat(c.pension_employee, 0);
    t.pension_employer += Utils.toFloat(c.pension_employer, 0);
    t.paye_tax         += Utils.toFloat(c.paye_tax, 0);
    t.other_deductions += Utils.toFloat(c.other_deductions, 0);
    t.total_deductions += Utils.toFloat(c.total_deductions, 0);
    t.net_pay          += Utils.toFloat(c.net_pay, 0);
    t.employer_cost    += Utils.toFloat(c.employer_cost, 0);
  }

  function _round(t) {
    for (var k in t) t[k] = Utils.round2(t[k]);
    return t;
  }

  function _periodBounds(period) {
    var parts = period.split('-');
    var year  = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10);
    return {
      start: new Date(year, month - 1, 1, 0, 0, 0),
      end:   new Date(year, month, 0, 23, 59, 59)
    };
  }

  function _user() {
    return Utils.currentUserEmail();
  }

  return {
    list:           list,
    get:            get,
    getPayslip:     getPayslip,
    preview:        preview,
    process:        process,
    payNetSalaries: payNetSalaries
  };

})();
