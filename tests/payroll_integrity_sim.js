// ============================================================
// NODE-ONLY TEST — DO NOT ADD TO THE APPS SCRIPT PROJECT
// ============================================================
// This file is a standalone Node.js simulation used to verify engine logic.
// It is NOT part of the deployed application. Run it with:  node <thisfile>
// It must never be pasted into the Apps Script editor: its top-level helper
// declarations (round2, toFloat, ...) would collide with utilities.gs and
// throw "Identifier 'round2' has already been declared".
//
// The guard below makes the file inert if it is ever loaded outside Node,
// so an accidental import cannot break the app.
// ============================================================
if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
  // Not running under Node — do nothing.
} else {
  (function () {
    // Simulation of TaxEngine + payroll journal balance
    const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
    const toFloat = (x,d=0) => { const n=parseFloat(x); return isNaN(n)?d:n; };

    // Settings (mirror defaults)
    const SETTINGS = {
      pension_employee_rate: 5.5,
      pension_employer_rate: 13,
      ssnit_monthly_cap: 61000,
      paye_bands: '490:0,110:5,130:10,3166.67:17.5,16000:25,30520:30,0:35'
    };
    const getSetting = (k,d) => SETTINGS[k] !== undefined ? SETTINGS[k] : d;

    function parseBands(){
      return getSetting('paye_bands','').split(',').map(p=>{const[w,r]=p.split(':');return{width:toFloat(w),rate:toFloat(r)};});
    }
    function calculateSSNIT(basic){
      basic=toFloat(basic);
      if(basic<=0) return {employee:0,employer:0,base:0};
      const cap=toFloat(getSetting('ssnit_monthly_cap',61000));
      const base=(cap>0&&basic>cap)?cap:basic;
      return {employee:round2(base*getSetting('pension_employee_rate',5.5)/100),
              employer:round2(base*getSetting('pension_employer_rate',13)/100),base:round2(base)};
    }
    function calculatePAYE(income){
      income=toFloat(income);
      if(income<=0) return {tax:0};
      const bands=parseBands();
      let remaining=income,tax=0;
      for(let i=0;i<bands.length&&remaining>0;i++){
        const b=bands[i];
        const slice=(b.width===0)?remaining:Math.min(remaining,b.width);
        tax+=round2(slice*b.rate/100);
        remaining=round2(remaining-slice);
      }
      return {tax:round2(tax)};
    }
    function calculatePayslip(emp){
      const basic=toFloat(emp.basic_salary);
      const allow=round2(toFloat(emp.transport_allowance)+toFloat(emp.housing_allowance)+toFloat(emp.other_allowance));
      const gross=round2(basic+allow);
      const ssnit=emp.ssnit_applicable!==false?calculateSSNIT(basic):{employee:0,employer:0,base:0};
      const chargeable=round2(gross-ssnit.employee);
      const paye=emp.paye_applicable!==false?calculatePAYE(chargeable):{tax:0};
      const totalDed=round2(ssnit.employee+paye.tax);
      const net=round2(gross-totalDed);
      return {gross_pay:gross,pension_employee:ssnit.employee,pension_employer:ssnit.employer,
              paye_tax:paye.tax,total_deductions:totalDed,net_pay:net,
              employer_cost:round2(gross+ssnit.employer)};
    }

    function assert(c,m){ if(!c){console.log('  ✗ FAIL: '+m);process.exitCode=1;} else console.log('  ✓ '+m); }

    console.log('\n=== SSNIT calculation ===');
    let s=calculateSSNIT(2000);
    assert(s.employee===110,'Employee SSNIT 5.5% of 2000 = 110 (got '+s.employee+')');
    assert(s.employer===260,'Employer SSNIT 13% of 2000 = 260 (got '+s.employer+')');

    console.log('\n=== SSNIT cap ===');
    let sc=calculateSSNIT(70000);
    assert(sc.base===61000,'SSNIT base capped at 61000 (got '+sc.base+')');
    assert(sc.employee===round2(61000*0.055),'Capped employee SSNIT (got '+sc.employee+')');

    console.log('\n=== PAYE bands ===');
    // Income exactly in tax-free band
    assert(calculatePAYE(490).tax===0,'PAYE on 490 (tax-free) = 0');
    // 490(0%) + 110(5%)=5.5 + 130(10%)=13 → on 730 = 18.50
    assert(calculatePAYE(730).tax===18.5,'PAYE on 730 = 18.50 (got '+calculatePAYE(730).tax+')');
    // Above all lower bands into 17.5%: 490+110+130=730 covered, next 3166.67 @17.5%
    // income 1730 → 730 covered (18.50) + 1000@17.5% = 175 → 193.50
    assert(calculatePAYE(1730).tax===193.5,'PAYE on 1730 = 193.50 (got '+calculatePAYE(1730).tax+')');

    console.log('\n=== Full payslip ===');
    let p=calculatePayslip({basic_salary:3000,transport_allowance:300,housing_allowance:200,other_allowance:0});
    // gross=3500, ssnit_ee=165 (5.5% of 3000), chargeable=3335
    // PAYE: 490@0 + 110@5=5.5 + 130@10=13 + (3335-730=2605)@17.5=455.875→455.88 = 474.38
    console.log('  gross='+p.gross_pay+' ssnit_ee='+p.pension_employee+' paye='+p.paye_tax+' net='+p.net_pay);
    assert(p.gross_pay===3500,'Gross = 3500');
    assert(p.pension_employee===165,'Employee SSNIT = 165');
    assert(p.net_pay===round2(3500-165-p.paye_tax),'Net = gross - ssnit - paye');

    console.log('\n=== Payroll journal balances ===');
    // Build totals from 3 employees
    const emps=[
      {basic_salary:3000,transport_allowance:300,housing_allowance:200},
      {basic_salary:1500,transport_allowance:100},
      {basic_salary:800}  // below tax-free after ssnit
    ];
    let T={gross:0,pe:0,per:0,paye:0,net:0};
    emps.forEach(e=>{const c=calculatePayslip(e);T.gross+=c.gross_pay;T.pe+=c.pension_employee;T.per+=c.pension_employer;T.paye+=c.paye_tax;T.net+=c.net_pay;});
    for(let k in T) T[k]=round2(T[k]);
    // Journal: Dr 6100 gross + Dr 6110 employer_pension = Cr 2220 paye + Cr 2230 (pe+per) + Cr 2240 net
    let totalDr=round2(T.gross+T.per);
    let totalCr=round2(T.paye+round2(T.pe+T.per)+T.net);
    console.log('  Dr: 6100='+T.gross+' + 6110='+T.per+' = '+totalDr);
    console.log('  Cr: 2220(PAYE)='+T.paye+' + 2230(pension)='+round2(T.pe+T.per)+' + 2240(net)='+T.net+' = '+totalCr);
    assert(totalDr===totalCr,'Payroll journal balanced ('+totalDr+'='+totalCr+')');
    // Sanity: gross = net + paye + employee pension
    assert(T.gross===round2(T.net+T.paye+T.pe),'Gross = net + PAYE + employee SSNIT');

    console.log('\n=== ALL PAYROLL SCENARIOS COMPLETE ===');

  })();
}
