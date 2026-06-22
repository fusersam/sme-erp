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
    // ============================================================
    // Accounting Engine Simulation — proves double-entry integrity
    // Mirrors the core logic of accounting_engine.gs against in-memory sheets
    // ============================================================

    const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
    const toFloat = (x,d=0) => { const n = parseFloat(x); return isNaN(n) ? d : n; };

    // In-memory "sheets"
    let COA = {};        // code -> {type, normal, balance}
    let GL = [];         // ledger rows
    let JE = [];         // journal lines
    let PERIODS = {};    // period -> {status}

    function seedCOA() {
      const accts = [
        ['1100','Asset','Debit'],['1210','Asset','Debit'],['1300','Asset','Debit'],['1400','Asset','Debit'],
        ['2100','Liability','Credit'],['2210','Liability','Credit'],
        ['3100','Equity','Credit'],['3200','Equity','Credit'],
        ['4100','Revenue','Credit'],['4600','Revenue','Debit'],
        ['5000','COGS','Debit'],['5400','COGS','Debit'],
        ['6100','Expense','Debit'],['6200','Expense','Debit'],['6980','Expense','Debit'],
      ];
      COA = {};
      accts.forEach(([code,type,normal]) => COA[code] = {code,type,normal,balance:0});
      GL = []; JE = []; PERIODS = {};
    }

    function isPeriodClosed(p) { return PERIODS[p] && PERIODS[p].status === 'Closed'; }

    function createJournalEntry(params) {
      let totalDr=0, totalCr=0;
      if(!params.lines || params.lines.length<2) throw new Error('min 2 lines');
      params.lines.forEach((ln,i)=>{
        const dr=toFloat(ln.debit), cr=toFloat(ln.credit);
        if(dr===0&&cr===0) throw new Error('line '+(i+1)+' zero');
        if(dr!==0&&cr!==0) throw new Error('line '+(i+1)+' both');
        totalDr+=dr; totalCr+=cr;
      });
      if(round2(totalDr)!==round2(totalCr)) throw new Error('UNBALANCED: '+totalDr+' vs '+totalCr);

      const date = params.date ? new Date(params.date) : new Date();
      const period = date.toISOString().slice(0,7);
      if(!params._allowClosedPeriod && isPeriodClosed(period)) throw new Error('period '+period+' closed');

      const jid = 'J'+(JE.length);
      params.lines.forEach(ln=>{
        const dr=toFloat(ln.debit), cr=toFloat(ln.credit);
        JE.push({journal_id:jid, account_code:ln.accountCode, debit:dr, credit:cr, status:'Posted', period});
        // post to ledger + update CoA
        const acc=COA[ln.accountCode];
        if(!acc){ throw new Error('unknown account '+ln.accountCode); }
        const newBal = acc.normal==='Debit' ? round2(acc.balance+dr-cr) : round2(acc.balance+cr-dr);
        acc.balance=newBal;
        GL.push({date,account_code:ln.accountCode,debit:dr,credit:cr,period,journal_id:jid});
      });
      return {journalId:jid, period};
    }

    function getTrialBalance() {
      let totalDr=0, totalCr=0;
      Object.values(COA).forEach(a=>{
        if(round2(a.balance)===0) return;
        if(a.normal==='Debit'){ if(a.balance>=0) totalDr+=a.balance; else totalCr+=Math.abs(a.balance); }
        else { if(a.balance>=0) totalCr+=a.balance; else totalDr+=Math.abs(a.balance); }
      });
      return {totalDebits:round2(totalDr), totalCredits:round2(totalCr), balanced:round2(totalDr)===round2(totalCr)};
    }

    function getBalanceSheet() {
      let A=0,L=0,E=0,NI=0;
      Object.values(COA).forEach(a=>{
        const bal=round2(a.balance);
        if(bal===0) return;
        if(a.type==='Asset') A+=bal;
        else if(a.type==='Liability') L+=bal;
        else if(a.type==='Equity') E+=bal;
        else if(a.type==='Revenue') NI += (a.normal==='Credit') ? bal : -bal;
        else if(a.type==='COGS'||a.type==='Expense') NI -= (a.normal==='Debit') ? bal : -bal;
      });
      E += NI; // current earnings
      return {A:round2(A), L:round2(L), E:round2(E), LE:round2(L+E), balanced:round2(A)===round2(L+E)};
    }

    // ============================================================
    // POSTING RULES (mirror engine)
    // ============================================================
    function postInvoice(inv){
      const lines=[{accountCode:'1300',debit:inv.total,credit:0},{accountCode:'4100',debit:0,credit:inv.subtotal}];
      if(inv.tax>0) lines.push({accountCode:'2210',debit:0,credit:inv.tax});
      return createJournalEntry({date:inv.date,lines});
    }
    function postCOGS(p){ return createJournalEntry({date:p.date,lines:[{accountCode:'5000',debit:p.cost,credit:0},{accountCode:'1400',debit:0,credit:p.cost}]}); }
    function postReceipt(r){ return createJournalEntry({date:r.date,lines:[{accountCode:'1210',debit:r.amount,credit:0},{accountCode:'1300',debit:0,credit:r.amount}]}); }
    function postOpeningStock(p){ return createJournalEntry({date:p.date,lines:[{accountCode:'1400',debit:p.value,credit:0},{accountCode:'3200',debit:0,credit:p.value}]}); }
    function postExpense(p){ return createJournalEntry({date:p.date,lines:[{accountCode:p.acct,debit:p.amount,credit:0},{accountCode:'1210',debit:0,credit:p.amount}]}); }
    function postStockAdjustment(p){
      if(p.value>=0) return createJournalEntry({date:p.date,lines:[{accountCode:'1400',debit:p.value,credit:0},{accountCode:'5400',debit:0,credit:p.value}]});
      return createJournalEntry({date:p.date,lines:[{accountCode:'5400',debit:Math.abs(p.value),credit:0},{accountCode:'1400',debit:0,credit:Math.abs(p.value)}]});
    }
    function postCustomerReturn(p){
      const lines=[];
      if(p.cost>0){lines.push({accountCode:'1400',debit:p.cost,credit:0});lines.push({accountCode:'5000',debit:0,credit:p.cost});}
      if(p.sale>0){lines.push({accountCode:'4600',debit:p.sale,credit:0});lines.push({accountCode:'1300',debit:0,credit:p.sale});}
      return createJournalEntry({date:p.date,lines});
    }

    // ============================================================
    // PERIOD CLOSE (mirror engine)
    // ============================================================
    function closePeriod(period){
      // Zero each P&L account by reversing its net balance (works for contra too).
      // Compute per-account net debit movement from the running CoA balance, signed
      // by normal balance: net debit = (normal Debit ? +bal : -bal).
      let lines=[], re=0;
      Object.values(COA).forEach(a=>{
        if(!['Revenue','COGS','Expense'].includes(a.type)) return;
        const bal=round2(a.balance);
        if(bal===0) return;
        const netDebit = (a.normal==='Debit') ? bal : -bal; // positive = net debit
        if(netDebit>0) lines.push({accountCode:a.code,debit:0,credit:netDebit});
        else lines.push({accountCode:a.code,debit:Math.abs(netDebit),credit:0});
        if(a.type==='Revenue') re += round2(-netDebit);
        else re -= round2(netDebit);
      });
      re=round2(re);
      if(lines.length>0){
        if(re>=0) lines.push({accountCode:'3200',debit:0,credit:round2(re)});
        else lines.push({accountCode:'3200',debit:round2(Math.abs(re)),credit:0});
        createJournalEntry({date:new Date(period+'-28'),lines,_allowClosedPeriod:true});
      }
      PERIODS[period]={status:'Closed'};
      return {netIncome:round2(re)};
    }

    // ============================================================
    // TEST SCENARIOS
    // ============================================================
    function assert(cond,msg){ if(!cond){ console.log('  ✗ FAIL: '+msg); process.exitCode=1; } else console.log('  ✓ '+msg); }

    console.log('\n=== SCENARIO 1: Full sales cycle ===');
    seedCOA();
    postOpeningStock({date:'2025-01-05',value:10000});      // Dr Inventory / Cr RE
    postInvoice({date:'2025-01-10',total:1150,subtotal:1000,tax:150}); // Dr AR / Cr Rev / Cr VAT
    postCOGS({date:'2025-01-10',cost:600});                 // Dr COGS / Cr Inventory
    postReceipt({date:'2025-01-15',amount:1150});           // Dr Bank / Cr AR
    let tb=getTrialBalance();
    assert(tb.balanced,'Trial balance balanced after sales cycle ('+tb.totalDebits+'='+tb.totalCredits+')');
    let bs=getBalanceSheet();
    assert(bs.balanced,'Balance sheet balanced: A='+bs.A+' L+E='+bs.LE);

    console.log('\n=== SCENARIO 2: Expenses + adjustments + returns ===');
    postExpense({date:'2025-01-20',acct:'6200',amount:500}); // rent
    postExpense({date:'2025-01-21',acct:'6100',amount:800}); // salary
    postStockAdjustment({date:'2025-01-22',value:-150});     // shrinkage
    postStockAdjustment({date:'2025-01-23',value:200});      // found stock
    postCustomerReturn({date:'2025-01-25',cost:120,sale:230}); // return
    tb=getTrialBalance();
    assert(tb.balanced,'Trial balance balanced after expenses/adjustments/returns');
    bs=getBalanceSheet();
    assert(bs.balanced,'Balance sheet still balanced: A='+bs.A+' L+E='+bs.LE);

    console.log('\n=== SCENARIO 3: Period close ===');
    const before=getBalanceSheet();
    const close=closePeriod('2025-01');
    console.log('  Net income for period: '+close.netIncome);
    tb=getTrialBalance();
    assert(tb.balanced,'Trial balance balanced after period close');
    const after=getBalanceSheet();
    assert(after.balanced,'Balance sheet balanced after close: A='+after.A+' L+E='+after.LE);
    assert(round2(before.A)===round2(after.A),'Total assets unchanged by closing entry ('+before.A+' = '+after.A+')');
    // After close, all P&L accounts must be zero
    let plZero=true;
    Object.values(COA).forEach(a=>{ if(['Revenue','COGS','Expense'].includes(a.type) && round2(a.balance)!==0) plZero=false; });
    assert(plZero,'All P&L accounts zeroed after close');

    console.log('\n=== SCENARIO 4: Period lock enforcement ===');
    let blocked=false;
    try { postExpense({date:'2025-01-28',acct:'6200',amount:100}); }
    catch(e){ blocked = e.message.includes('closed'); }
    assert(blocked,'Posting into closed period is blocked');
    // Posting into open period still works
    let ok=true;
    try { postExpense({date:'2025-02-05',acct:'6200',amount:100}); } catch(e){ ok=false; }
    assert(ok,'Posting into open period still works');
    tb=getTrialBalance();
    assert(tb.balanced,'Trial balance balanced across periods');

    console.log('\n=== SCENARIO 5: Unbalanced entry rejected ===');
    let rejected=false;
    try { createJournalEntry({date:'2025-02-10',lines:[{accountCode:'1100',debit:100,credit:0},{accountCode:'4100',debit:0,credit:90}]}); }
    catch(e){ rejected = e.message.includes('UNBALANCED'); }
    assert(rejected,'Unbalanced journal entry rejected');

    console.log('\n=== ALL SCENARIOS COMPLETE ===');

  })();
}
