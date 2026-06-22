/**
 * Ghana Tax Engine
 * =================
 * Pure calculation helpers for payroll statutory deductions:
 *   - SSNIT pension (Tier 1 employee + employer) on basic salary
 *   - PAYE income tax on chargeable income (gross less SSNIT employee)
 *
 * All rates and bands are read from Settings so they can be updated
 * without code changes when GRA/SSNIT figures change:
 *   pension_employee_rate   (default 5.5)
 *   pension_employer_rate   (default 13)
 *   ssnit_monthly_cap       (default 61000)
 *   paye_bands              "width:rate,width:rate,...  (last width 0 = remainder)"
 *
 * PAYE is progressive: each band taxes the portion of chargeable income that
 * falls within that band's width. SSNIT employee contribution is deducted
 * BEFORE PAYE (it reduces chargeable income), per GRA rules.
 */

var TaxEngine = (function() {

  // Fallback monthly PAYE bands (2026 GRA schedule, monthly = annual / 12)
  var DEFAULT_BANDS = [
    { width: 490,     rate: 0 },
    { width: 110,     rate: 5 },
    { width: 130,     rate: 10 },
    { width: 3166.67, rate: 17.5 },
    { width: 16000,   rate: 25 },
    { width: 30520,   rate: 30 },
    { width: 0,       rate: 35 }   // remainder
  ];

  /**
   * Parse the paye_bands setting string into an array of {width, rate}.
   * Format: "490:0,110:5,130:10,..." — last entry with width 0 = remainder.
   * @private
   */
  function _parseBands() {
    try {
      var raw = ConfigService.getSetting('paye_bands', '');
      if (!raw) return DEFAULT_BANDS;
      var bands = raw.split(',').map(function(pair) {
        var parts = pair.split(':');
        return { width: Utils.toFloat(parts[0], 0), rate: Utils.toFloat(parts[1], 0) };
      });
      return bands.length ? bands : DEFAULT_BANDS;
    } catch (e) {
      return DEFAULT_BANDS;
    }
  }

  /**
   * Compute SSNIT contributions on basic salary.
   *
   * @param {number} basicSalary - Monthly basic salary
   * @returns {Object} { employee, employer, base }
   */
  function calculateSSNIT(basicSalary) {
    var basic = Utils.toFloat(basicSalary, 0);
    if (basic <= 0) return { employee: 0, employer: 0, base: 0 };

    var empRate = Utils.toFloat(ConfigService.getSetting('pension_employee_rate', 5.5), 5.5);
    var erRate  = Utils.toFloat(ConfigService.getSetting('pension_employer_rate', 13), 13);
    var cap     = Utils.toFloat(ConfigService.getSetting('ssnit_monthly_cap', 61000), 61000);

    // Insurable earnings are capped
    var base = (cap > 0 && basic > cap) ? cap : basic;

    return {
      employee: Utils.round2(base * empRate / 100),
      employer: Utils.round2(base * erRate / 100),
      base:     Utils.round2(base)
    };
  }

  /**
   * Compute PAYE income tax on chargeable income using progressive bands.
   *
   * @param {number} chargeableIncome - Gross less SSNIT employee (and reliefs)
   * @returns {Object} { tax, effectiveRate, breakdown: [ {band, rate, taxable, tax} ] }
   */
  function calculatePAYE(chargeableIncome) {
    var income = Utils.toFloat(chargeableIncome, 0);
    if (income <= 0) return { tax: 0, effectiveRate: 0, breakdown: [] };

    var bands = _parseBands();
    var remaining = income;
    var totalTax = 0;
    var breakdown = [];
    var bandNo = 0;

    for (var i = 0; i < bands.length && remaining > 0; i++) {
      var band = bands[i];
      bandNo++;
      // width 0 means "all the rest" (top band)
      var slice = (band.width === 0) ? remaining : Math.min(remaining, band.width);
      var bandTax = Utils.round2(slice * band.rate / 100);
      totalTax += bandTax;
      remaining = Utils.round2(remaining - slice);

      if (slice > 0) {
        breakdown.push({
          band:    bandNo,
          rate:    band.rate,
          taxable: Utils.round2(slice),
          tax:     bandTax
        });
      }
    }

    totalTax = Utils.round2(totalTax);
    return {
      tax:           totalTax,
      effectiveRate: income > 0 ? Utils.round2(totalTax / income * 100) : 0,
      breakdown:     breakdown
    };
  }

  /**
   * Compute a full payslip calculation for one employee for one month.
   *
   * @param {Object} emp - { basic_salary, transport_allowance, housing_allowance,
   *                         other_allowance, ssnit_applicable, paye_applicable }
   * @param {Object} [extras] - { overtime, other_deductions }
   * @returns {Object} Full breakdown
   */
  function calculatePayslip(emp, extras) {
    extras = extras || {};

    var basic      = Utils.toFloat(emp.basic_salary, 0);
    var transport  = Utils.toFloat(emp.transport_allowance, 0);
    var housing    = Utils.toFloat(emp.housing_allowance, 0);
    var otherAllow = Utils.toFloat(emp.other_allowance, 0);
    var overtime   = Utils.toFloat(extras.overtime, 0);
    var otherDed   = Utils.toFloat(extras.other_deductions, 0);

    var allowances = Utils.round2(transport + housing + otherAllow);
    var grossPay   = Utils.round2(basic + allowances + overtime);

    // SSNIT is on basic salary only
    var ssnitApplicable = emp.ssnit_applicable !== false && emp.ssnit_applicable !== 'false';
    var ssnit = ssnitApplicable ? calculateSSNIT(basic) : { employee: 0, employer: 0, base: 0 };

    // Chargeable income = gross less SSNIT employee contribution
    var chargeable = Utils.round2(grossPay - ssnit.employee);

    // PAYE
    var payeApplicable = emp.paye_applicable !== false && emp.paye_applicable !== 'false';
    var paye = payeApplicable ? calculatePAYE(chargeable) : { tax: 0, effectiveRate: 0, breakdown: [] };

    var totalDeductions = Utils.round2(ssnit.employee + paye.tax + otherDed);
    var netPay          = Utils.round2(grossPay - totalDeductions);

    // Total cost to employer = gross + employer SSNIT
    var employerCost = Utils.round2(grossPay + ssnit.employer);

    return {
      basic_salary:     basic,
      transport_allowance: transport,
      housing_allowance:   housing,
      other_allowance:     otherAllow,
      allowances:       allowances,
      overtime:         overtime,
      gross_pay:        grossPay,
      ssnit_base:       ssnit.base,
      pension_employee: ssnit.employee,
      pension_employer: ssnit.employer,
      chargeable_income: chargeable,
      paye_tax:         paye.tax,
      paye_breakdown:   paye.breakdown,
      other_deductions: otherDed,
      total_deductions: totalDeductions,
      net_pay:          netPay,
      employer_cost:    employerCost
    };
  }

  return {
    calculateSSNIT:   calculateSSNIT,
    calculatePAYE:    calculatePAYE,
    calculatePayslip: calculatePayslip
  };

})();
