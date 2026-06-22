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
    // Verify Cash Flow (indirect) reconciles to actual cash movement
    const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
    function assert(c,m){ if(!c){console.log('  ✗ FAIL: '+m);process.exitCode=1;} else console.log('  ✓ '+m); }

    // Build a tiny GL: opening cash via equity, a credit sale, a receipt, an expense paid cash
    // Accounts: normal balances
    const COA={
      '1210':{type:'Asset',normal:'Debit'},   // Bank
      '1300':{type:'Asset',normal:'Debit'},   // AR
      '1400':{type:'Asset',normal:'Debit'},   // Inventory
      '1500':{type:'Asset',normal:'Debit'},   // Fixed asset (equipment)
      '2100':{type:'Liability',normal:'Credit'}, // AP
      '3100':{type:'Equity',normal:'Credit'}, // Capital
      '4100':{type:'Revenue',normal:'Credit'},
      '5000':{type:'COGS',normal:'Debit'},
      '6200':{type:'Expense',normal:'Debit'}
    };
    // movements within period: {code:[debits,credits]}
    const M={
      '3100':[0,10000],   // owner injects 10000 capital → financing +10000
      '1210':[10000,0],   // into bank
      '4100':[0,5000],    // sale on credit (revenue)
      '1300':[5000,0],    // AR up 5000 (uses cash in operating)
      '5000':[2000,0],    // COGS 2000
      '1400':[0,2000],    // inventory down 2000 (provides cash operating)
      '6200':[1000,0],    // expense 1000
      '1210b':[0,1000],   // paid from bank — represent as separate credit to 1210
      '1500':[3000,0],    // bought equipment 3000 (investing outflow)
      '1210c':[0,3000]    // from bank
    };
    // Consolidate cash movements (1210 appears 3 times)
    function movementOf(code){
      // gather all keys starting with code
      let dr=0,cr=0;
      for(const k in M){ if(k===code||k.startsWith(code)){ dr+=M[k][0]; cr+=M[k][1]; } }
      const a=COA[code];
      return a.normal==='Debit'?round2(dr-cr):round2(cr-dr);
    }

    // Net income = revenue - cogs - expense = 5000-2000-1000 = 2000
    const netIncome=5000-2000-1000;

    let operating=[{label:'Net income',amount:netIncome}];
    let investing=[], financing=[];
    let cashMove=0;
    for(const code of Object.keys(COA)){
      const move=movementOf(code);
      if(move===0) continue;
      const c=parseInt(code,10);
      if(c>=1100&&c<=1299){ cashMove+=move; continue; }
      if(COA[code].type==='Asset'){
        if(c>=1500&&c<=1599) investing.push({label:code,amount:round2(-move)});
        else operating.push({label:'Δ '+code,amount:round2(-move)});
      } else if(COA[code].type==='Liability'){
        operating.push({label:'Δ '+code,amount:round2(move)});
      } else if(COA[code].type==='Equity'){
        if(code!=='3200') financing.push({label:code,amount:round2(move)});
      }
    }
    const sum=rows=>round2(rows.reduce((s,r)=>s+r.amount,0));
    const opT=sum(operating), invT=sum(investing), finT=sum(financing);
    const netChange=round2(opT+invT+finT);
    cashMove=round2(cashMove);

    console.log('\n=== Cash Flow reconciliation ===');
    console.log('  Operating:',opT,'Investing:',invT,'Financing:',finT);
    console.log('  Net change:',netChange,'  Actual cash move:',cashMove);
    assert(netChange===cashMove,'Cash flow reconciles to actual cash movement ('+netChange+'='+cashMove+')');
    // Expected cash: +10000 capital -? AR +5000 not collected, inventory sold, equipment -3000, expense -1000
    // Bank actual: 10000 -1000 -3000 = 6000
    assert(cashMove===6000,'Actual bank movement = 6000');

    console.log('\n=== Financial ratios ===');
    // Current assets: bank 6000 + AR 5000 + inventory (started? in this sim inventory net -2000 so 0 unless opening)
    // Use simple snapshot
    const currentAssets=6000+5000+0, currentLiabilities=0+ /*AP*/ 0;
    const inventory=0, receivables=5000, cash=6000;
    const revenue=5000, cogs=2000, netProfit=2000, totalAssets=6000+5000+3000;
    function safeDiv(n,d){return d!==0?round2(n/d):null;}
    function pct(n,d){return d!==0?round2(n/d*100):null;}
    const grossMargin=pct(revenue-cogs,revenue);
    const netMargin=pct(netProfit,revenue);
    const roa=pct(netProfit,totalAssets);
    console.log('  Gross margin:',grossMargin+'%','Net margin:',netMargin+'%','ROA:',roa+'%');
    assert(grossMargin===60,'Gross margin = 60%');
    assert(netMargin===40,'Net margin = 40%');
    assert(roa===round2(2000/14000*100),'ROA computed');
    // Quick ratio with zero current liabilities → null (no div by zero)
    assert(safeDiv(currentAssets-inventory,currentLiabilities)===null,'Quick ratio null when no current liabilities (no div-by-zero)');

    console.log('\n=== ALL REPORT SCENARIOS COMPLETE ===');

  })();
}
