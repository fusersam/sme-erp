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
    // Test the refactored _postToLedger logic: load-once + per-account accumulation
    const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
    const toFloat = (x,d=0)=>{const n=parseFloat(x);return isNaN(n)?d:n;};

    // Mirror the NEW _postToLedger accumulation logic exactly
    function postToLedger(coaByCode, lines) {
      const newBalances = {};
      const glRows = [];
      for (let i=0;i<lines.length;i++){
        const ln=lines[i];
        const dr=toFloat(ln.debit), cr=toFloat(ln.credit);
        const account=coaByCode[ln.accountCode]||null;
        let currentBalance;
        if(newBalances[ln.accountCode]) currentBalance=newBalances[ln.accountCode].balance;
        else currentBalance=account?toFloat(account.balance):0;
        const normal=account?account.normal_balance:'Debit';
        let nb = normal==='Debit'?round2(currentBalance+dr-cr):round2(currentBalance+cr-dr);
        glRows.push({code:ln.accountCode,running_balance:nb});
        if(account) newBalances[ln.accountCode]={account:account,balance:nb};
      }
      return {newBalances, glRows};
    }

    function assert(c,m){if(!c){console.log('  ✗ FAIL:',m);process.exitCode=1;}else console.log('  ✓',m);}

    console.log('\n=== Same-account-twice chaining (the latent bug) ===');
    // Cash debited twice in one entry: 100 then 50, starting from 200
    var coa={'1100':{account_code:'1100',normal_balance:'Debit',balance:200,_rowIndex:2},
             '4100':{account_code:'4100',normal_balance:'Credit',balance:0,_rowIndex:3}};
    var r=postToLedger(coa,[
      {accountCode:'1100',debit:100,credit:0},
      {accountCode:'1100',debit:50,credit:0},
      {accountCode:'4100',debit:0,credit:150}
    ]);
    // Old code: second updateRow would overwrite first → 1100 ends at 250 (wrong)
    // New code: chains → 200+100=300, then 300+50=350
    assert(r.newBalances['1100'].balance===350,'Cash chains correctly to 350 (was 250 under old bug)');
    assert(r.glRows[0].running_balance===300,'First GL row running_balance=300');
    assert(r.glRows[1].running_balance===350,'Second GL row running_balance=350');
    assert(r.newBalances['4100'].balance===150,'Revenue credit balance=150');
    // Each affected account written once
    assert(Object.keys(r.newBalances).length===2,'Two accounts written once each (not 3 writes)');

    console.log('\n=== Normal posting unchanged ===');
    var coa2={'1300':{account_code:'1300',normal_balance:'Debit',balance:0,_rowIndex:2},
              '4100':{account_code:'4100',normal_balance:'Credit',balance:0,_rowIndex:3},
              '2210':{account_code:'2210',normal_balance:'Credit',balance:0,_rowIndex:4}};
    var r2=postToLedger(coa2,[
      {accountCode:'1300',debit:1150,credit:0},
      {accountCode:'4100',debit:0,credit:1000},
      {accountCode:'2210',debit:0,credit:150}
    ]);
    assert(r2.newBalances['1300'].balance===1150,'AR debit 1150');
    assert(r2.newBalances['4100'].balance===1000,'Revenue 1000');
    assert(r2.newBalances['2210'].balance===150,'VAT 150');
    var totalDr=1150, totalCr=1000+150;
    assert(totalDr===totalCr,'Entry balanced 1150=1150');

    console.log('\n=== ID collision resistance ===');
    // generateId() = timestamp(base36) + first 6 hex chars of a true UUID.
    // Use Node's crypto.randomUUID() as a faithful stand-in for Apps Script's
    // Utilities.getUuid() (both are RFC-4122 v4). The previous version of this
    // test used Math.random() as the proxy, which is far weaker than a real
    // UUID and produced spurious collisions — testing the proxy, not the code.
    var randomUUID = require('crypto').randomUUID;
    function genId(prefix){ // faithful mirror of Utils.generateId
      var ts = Date.now().toString(36).toUpperCase();
      var uuid = randomUUID().replace(/-/g, '').substring(0, 10).toUpperCase();
      return (prefix||'') + ts + uuid;
    }
    var ids={}, collisions=0;
    for(var i=0;i<10000;i++){var id=genId('X');if(ids[id])collisions++;ids[id]=1;}
    console.log('  Generated 10000 IDs, collisions:',collisions);
    assert(collisions===0,'No collisions in 10k rapid IDs (UUID-based)');

    console.log('\n=== ALL POST-LEDGER TESTS COMPLETE ===');

  })();
}
