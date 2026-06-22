/**
 * Report Service
 * ==============
 * Orchestrates all financial, operational, and analytical reports.
 *
 * Most statement-level reports delegate to primitives that already live in
 * the accounting engine and other services (single source of truth). This
 * service adds the genuinely new pieces:
 *   - Financial ratio analysis (liquidity, profitability, efficiency, cash flow)
 *   - Payroll reports (statutory remittance, cost by department, run summary)
 *   - A unified report catalog and a single getReport() dispatcher
 *
 * Replaces the Phase 1 ReportService stub.
 */

var ReportService = (function() {

  // ─────────────────────────────────────────
  // CATALOG
  // ─────────────────────────────────────────

  var CATALOG = [
    { id: 'profit_loss',       name: 'Profit & Loss Statement', group: 'Financial', params: ['start', 'end'] },
    { id: 'balance_sheet',     name: 'Balance Sheet',           group: 'Financial', params: ['asOf'] },
    { id: 'cash_flow',         name: 'Cash Flow Statement',     group: 'Financial', params: ['start', 'end'] },
    { id: 'trial_balance',     name: 'Trial Balance',           group: 'Financial', params: ['asOf'] },
    { id: 'general_ledger',    name: 'General Ledger',          group: 'Financial', params: ['start', 'end'] },
    { id: 'ar_aging',          name: 'Accounts Receivable Aging', group: 'Receivables', params: [] },
    { id: 'ap_aging',          name: 'Accounts Payable Aging',  group: 'Payables', params: [] },
    { id: 'inventory_valuation', name: 'Inventory Valuation',   group: 'Inventory', params: [] },
    { id: 'inventory_lowstock', name: 'Low Stock Report',       group: 'Inventory', params: [] },
    { id: 'payroll_summary',   name: 'Payroll Summary',         group: 'Payroll', params: ['start', 'end'] },
    { id: 'payroll_statutory', name: 'Statutory Remittance',    group: 'Payroll', params: ['start', 'end'] },
    { id: 'payroll_by_dept',   name: 'Payroll Cost by Department', group: 'Payroll', params: ['start', 'end'] },
    { id: 'financial_ratios',  name: 'Financial Ratios',        group: 'Analytics', params: ['start', 'end'] }
  ];

  /**
   * List the available reports (for the UI catalog).
   */
  function list() {
    return { data: CATALOG };
  }

  /**
   * Dispatch a report by id.
   * @param {Object} data - { report, ...params }
   */
  function get(data) {
    return generate(data);
  }

  function generate(data) {
    var report = data.report || data.id;
    switch (report) {
      case 'profit_loss':         return AccountingEngine.getProfitAndLoss(data);
      case 'balance_sheet':       return AccountingEngine.getBalanceSheet(data);
      case 'cash_flow':           return AccountingEngine.getCashFlow(data);
      case 'trial_balance':       return AccountingEngine.getTrialBalance(data.asOf || null);
      case 'general_ledger':      return AccountingEngine.getGeneralLedger(data);
      case 'ar_aging':            return InvoiceService.getAging(data);
      case 'ap_aging':            return SupplierService.getPayableAging();
      case 'inventory_valuation': return ProductService.getValuationReport();
      case 'inventory_lowstock':  return ProductService.getLowStockReport();
      case 'payroll_summary':     return getPayrollSummary(data);
      case 'payroll_statutory':   return getStatutoryRemittance(data);
      case 'payroll_by_dept':     return getPayrollByDepartment(data);
      case 'financial_ratios':    return getFinancialRatios(data);
      default: throw new Error('Unknown report: ' + report);
    }
  }

  // ─────────────────────────────────────────
  // PAYROLL REPORTS
  // ─────────────────────────────────────────

  /**
   * Filter payroll runs to a date range by period (yyyy-MM).
   * @private
   */
  function _payrollRunsInRange(range) {
    var runs = Utils.sheetToObjects('Payroll', { sort: 'period', order: 'asc' }).data || [];
    if (!range.start && !range.end) return runs;
    var startP = range.start ? range.start.slice(0, 7) : '0000-00';
    var endP   = range.end ? range.end.slice(0, 7) : '9999-99';
    return runs.filter(function(r) {
      return r.period >= startP && r.period <= endP;
    });
  }

  function _range(data) {
    return {
      start: data.start ? Utilities.formatDate(new Date(data.start), Session.getScriptTimeZone(), 'yyyy-MM-dd') : null,
      end:   data.end ? Utilities.formatDate(new Date(data.end), Session.getScriptTimeZone(), 'yyyy-MM-dd') : null
    };
  }

  /**
   * Payroll summary across runs in a period.
   */
  function getPayrollSummary(data) {
    var range = _range(data);
    var runs = _payrollRunsInRange(range);

    var totals = {
      gross: 0, paye: 0, pensionEmployee: 0, pensionEmployer: 0,
      net: 0, employerCost: 0, employeeCount: 0, runCount: runs.length
    };
    var rows = runs.map(function(r) {
      var gross = Utils.toFloat(r.total_gross, 0);
      var paye  = Utils.toFloat(r.total_paye, 0);
      var pe    = Utils.toFloat(r.total_pension_employee, 0);
      var per   = Utils.toFloat(r.total_pension_employer, 0);
      var net   = Utils.toFloat(r.total_net, 0);
      var cost  = Utils.toFloat(r.total_employer_cost, 0);
      totals.gross += gross; totals.paye += paye;
      totals.pensionEmployee += pe; totals.pensionEmployer += per;
      totals.net += net; totals.employerCost += cost;
      totals.employeeCount += Utils.toFloat(r.employee_count, 0);
      return {
        period: r.period, status: r.status, employees: Utils.toFloat(r.employee_count, 0),
        gross: gross, paye: paye, pension: Utils.round2(pe + per), net: net, employerCost: cost
      };
    });
    for (var k in totals) totals[k] = Utils.round2(totals[k]);

    return { rows: rows, totals: totals, range: range, generatedAt: new Date().toISOString() };
  }

  /**
   * Statutory remittance report — what's owed to GRA (PAYE) and SSNIT.
   */
  function getStatutoryRemittance(data) {
    var range = _range(data);
    var runs = _payrollRunsInRange(range);

    var rows = runs.map(function(r) {
      var paye = Utils.toFloat(r.total_paye, 0);
      var pe   = Utils.toFloat(r.total_pension_employee, 0);
      var per  = Utils.toFloat(r.total_pension_employer, 0);
      return {
        period: r.period,
        paye: paye,
        ssnit_employee: pe,
        ssnit_employer: per,
        ssnit_total: Utils.round2(pe + per),
        total_statutory: Utils.round2(paye + pe + per)
      };
    });

    var totals = rows.reduce(function(t, r) {
      t.paye += r.paye; t.ssnit_employee += r.ssnit_employee;
      t.ssnit_employer += r.ssnit_employer; t.ssnit_total += r.ssnit_total;
      t.total_statutory += r.total_statutory;
      return t;
    }, { paye: 0, ssnit_employee: 0, ssnit_employer: 0, ssnit_total: 0, total_statutory: 0 });
    for (var k in totals) totals[k] = Utils.round2(totals[k]);

    return { rows: rows, totals: totals, range: range, generatedAt: new Date().toISOString() };
  }

  /**
   * Payroll cost by department (joins PayrollDetails to Employees).
   */
  function getPayrollByDepartment(data) {
    var range = _range(data);
    var runs = _payrollRunsInRange(range);
    var runIds = {};
    runs.forEach(function(r) { runIds[r.payroll_id] = true; });

    // Map employee -> department
    var empDept = {};
    (Utils.sheetToObjects('Employees', {}).data || []).forEach(function(e) {
      empDept[e.employee_id] = e.department || 'Unassigned';
    });

    var details = Utils.sheetToObjects('PayrollDetails', {}).data || [];
    var byDept = {};
    details.forEach(function(d) {
      if (!runIds[d.payroll_id]) return;
      var dept = empDept[d.employee_id] || 'Unassigned';
      if (!byDept[dept]) byDept[dept] = { department: dept, headcount: {}, gross: 0, net: 0, paye: 0 };
      byDept[dept].headcount[d.employee_id] = true;
      byDept[dept].gross += Utils.toFloat(d.gross_pay, 0);
      byDept[dept].net   += Utils.toFloat(d.net_pay, 0);
      byDept[dept].paye  += Utils.toFloat(d.paye_tax, 0);
    });

    var rows = Object.keys(byDept).map(function(dept) {
      var b = byDept[dept];
      return {
        department: dept,
        employees: Object.keys(b.headcount).length,
        gross: Utils.round2(b.gross),
        paye: Utils.round2(b.paye),
        net: Utils.round2(b.net)
      };
    }).sort(function(a, b) { return b.gross - a.gross; });

    var totals = rows.reduce(function(t, r) {
      t.gross += r.gross; t.paye += r.paye; t.net += r.net; t.employees += r.employees;
      return t;
    }, { gross: 0, paye: 0, net: 0, employees: 0 });
    for (var k in totals) totals[k] = Utils.round2(totals[k]);

    return { rows: rows, totals: totals, range: range, generatedAt: new Date().toISOString() };
  }

  // ─────────────────────────────────────────
  // FINANCIAL RATIOS / ANALYTICS
  // ─────────────────────────────────────────

  /**
   * Compute SME financial ratios from the balance sheet and P&L.
   *
   * Liquidity:    current ratio, quick ratio
   * Profitability: gross margin, net margin, return on assets
   * Efficiency:   inventory turnover, receivable days, payable days, asset turnover
   * Cash flow:    operating cash flow, free cash flow, burn rate, cash runway
   *
   * @param {Object} data - { start, end }
   */
  function getFinancialRatios(data) {
    var range = _range(data);
    var asOf = range.end || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    var bs = AccountingEngine.getBalanceSheet({ asOf: asOf });
    var pl = AccountingEngine.getProfitAndLoss({ start: range.start, end: range.end });
    var cf = AccountingEngine.getCashFlow({ start: range.start, end: range.end });

    // Classify balance-sheet items into current vs non-current by code
    var currentAssets = 0, inventory = 0, receivables = 0, cash = 0, totalAssets = bs.totalAssets;
    bs.assets.forEach(function(a) {
      var code = parseInt(a.code, 10);
      if (code >= 1100 && code <= 1499) currentAssets += a.amount; // current asset band
      if (code >= 1100 && code <= 1299) cash += a.amount;
      if (code === 1300) receivables += a.amount;
      if (code === 1400) inventory += a.amount;
    });
    var currentLiabilities = 0, payables = 0;
    bs.liabilities.forEach(function(l) {
      var code = parseInt(l.code, 10);
      if (code >= 2100 && code <= 2499) currentLiabilities += l.amount; // current liab band
      if (code === 2100) payables += l.amount;
    });

    currentAssets = Utils.round2(currentAssets);
    currentLiabilities = Utils.round2(currentLiabilities);

    function safeDiv(n, d) { return d !== 0 ? Utils.round2(n / d) : null; }
    function pct(n, d) { return d !== 0 ? Utils.round2(n / d * 100) : null; }

    // Period length in days for annualization / per-day metrics
    var days = 30;
    if (range.start && range.end) {
      days = Math.max(1, Math.round((new Date(range.end) - new Date(range.start)) / 86400000) + 1);
    }

    var revenue = pl.totalRevenue;
    var cogs    = pl.totalCogs;
    var netProfit = pl.netProfit;
    var operatingCashFlow = cf.operatingTotal;
    var capex = Math.abs(cf.investingTotal < 0 ? cf.investingTotal : 0);

    // Monthly burn for runway (use net operating outflow if negative)
    var monthlyBurn = days > 0 ? Utils.round2((pl.totalCogs + pl.totalExpenses) / days * 30) : 0;

    var liquidity = {
      currentRatio: safeDiv(currentAssets, currentLiabilities),
      quickRatio:   safeDiv(Utils.round2(currentAssets - inventory), currentLiabilities)
    };

    var profitability = {
      grossMargin:   pct(pl.grossProfit, revenue),
      netMargin:     pct(netProfit, revenue),
      returnOnAssets: pct(netProfit, totalAssets)
    };

    var efficiency = {
      inventoryTurnover: safeDiv(cogs, inventory),
      receivableDays:    revenue !== 0 ? Utils.round2(receivables / revenue * days) : null,
      payableDays:       cogs !== 0 ? Utils.round2(payables / cogs * days) : null,
      assetTurnover:     safeDiv(revenue, totalAssets)
    };

    var cashFlowMetrics = {
      operatingCashFlow: operatingCashFlow,
      freeCashFlow:      Utils.round2(operatingCashFlow - capex),
      burnRate:          monthlyBurn,
      cashRunwayMonths:  monthlyBurn > 0 ? Utils.round2(cash / monthlyBurn) : null
    };

    return {
      asOf: asOf,
      range: range,
      inputs: {
        revenue: revenue, cogs: cogs, netProfit: netProfit,
        currentAssets: currentAssets, currentLiabilities: currentLiabilities,
        inventory: inventory, receivables: receivables, payables: payables,
        cash: cash, totalAssets: totalAssets, operatingCashFlow: operatingCashFlow
      },
      liquidity: liquidity,
      profitability: profitability,
      efficiency: efficiency,
      cashFlow: cashFlowMetrics,
      generatedAt: new Date().toISOString()
    };
  }

  return {
    list:                   list,
    get:                    get,
    generate:               generate,
    getPayrollSummary:      getPayrollSummary,
    getStatutoryRemittance: getStatutoryRemittance,
    getPayrollByDepartment: getPayrollByDepartment,
    getFinancialRatios:     getFinancialRatios
  };

})();
