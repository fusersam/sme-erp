// ============================================================
// NODE-ONLY TEST — DO NOT ADD TO THE APPS SCRIPT PROJECT
// ============================================================
// Regression test for a silent data-loss bug: appendRow()/updateRow() would
// not throw on a headerless sheet — they'd silently build an empty row from
// an empty headers array and call sheet.appendRow([]), which either throws a
// confusing native range error OR (depending on the exact failure point)
// leaves no usable row, while the surrounding service code still appeared to
// "succeed" (it could even still log a success audit entry afterward, since
// the audit log call happens after the append).
//
// Real-world symptom this matches: creating a customer produced an audit log
// entry but no row in the Customers sheet at all — the sheet had lost its
// header row at some point (e.g. before getSheet's creation-time header
// seeding existed), and getHeaders() was silently returning [] for it.
//
// Fix: getHeaders() now treats a headerless sheet specially:
//   - if the sheet name is a known schema sheet, it seeds the canonical
//     headers on the spot (self-heal) and returns them — so the very next
//     write actually succeeds and the data is no longer lost.
//   - if the sheet name is NOT recognised, it throws a clear, actionable
//     error instead of silently returning [] and letting appendRow build a
//     meaningless empty row.
//
// Run: node tests/headerless_sheet_selfheal_test.js
// ============================================================
if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
  // Not running under Node — do nothing.
} else {
  (function () {
    function assert(c, m) { if (!c) { console.log('  ✗ FAIL: ' + m); process.exitCode = 1; } else console.log('  ✓ ' + m); }

    // Minimal fake Sheet that mimics the methods Utils relies on.
    function makeFakeSheet(initialRows) {
      var rows = initialRows.map(function (r) { return r.slice(); });
      return {
        getLastRow: function () { return rows.length; },
        getLastColumn: function () { return rows.length ? rows[0].length : 0; },
        getRange: function (r, c, nr, nc) {
          return {
            getValues: function () {
              var out = [];
              for (var i = 0; i < nr; i++) {
                var row = [];
                for (var j = 0; j < nc; j++) row.push((rows[r - 1 + i] || [])[c - 1 + j] || '');
                out.push(row);
              }
              return out;
            },
            setValues: function (vals) {
              for (var i = 0; i < vals.length; i++) rows[r - 1 + i] = vals[i].slice();
            }
          };
        },
        setFrozenRows: function () {},
        appendRow: function (row) {
          if (row.length === 0) throw new Error('Range width must be at least 1');
          rows.push(row.slice());
        },
        dump: function () { return rows; }
      };
    }

    var SCHEMA = {
      Customers: ['customer_id', 'name', 'email', 'phone', 'address', 'city', 'region',
                  'country', 'tax_id', 'payment_terms', 'credit_limit', 'balance', 'status',
                  'notes', 'created_at', 'updated_at', 'created_by']
    };

    // Faithful mirror of the FIXED getHeaders()/appendRow() in server/utilities.gs.
    function buildUtils(sheet) {
      var _headerCache = {};
      function getHeaders(sheetName) {
        if (_headerCache[sheetName]) return _headerCache[sheetName];
        if (sheet.getLastRow() === 0) {
          var headers = SCHEMA[sheetName];
          if (!headers) {
            throw new Error('Sheet "' + sheetName + '" has no header row and is not a ' +
              'recognised schema sheet, so it cannot be safely written to. ' +
              'Run "Initialize Database" from the menu to repair sheet headers.');
          }
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.setFrozenRows(1);
          _headerCache[sheetName] = headers;
          return headers;
        }
        var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
          .map(function (h) { return h.toString().trim(); });
        _headerCache[sheetName] = headers;
        return headers;
      }
      function appendRow(sheetName, obj) {
        var headers = getHeaders(sheetName);
        var row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
        sheet.appendRow(row);
        return sheet.getLastRow();
      }
      return { getHeaders: getHeaders, appendRow: appendRow };
    }

    console.log('\n=== Headerless KNOWN sheet self-heals instead of losing data ===');
    var sheet = makeFakeSheet([]); // exactly the reported scenario: 0 rows
    var Utils = buildUtils(sheet);
    var customer = { customer_id: 'CUS1', name: 'Acme Ltd', email: 'a@acme.com', status: 'Active', balance: 0 };

    var threw = false;
    try { Utils.appendRow('Customers', customer); }
    catch (e) { threw = true; console.log('  unexpected throw: ' + e.message); }
    assert(!threw, 'appendRow on a headerless known sheet does not throw');

    var dump = sheet.dump();
    assert(dump.length === 2, 'Sheet now has a header row + the data row (was: data silently lost)');
    assert(dump[0][1] === 'name', 'Header row was seeded correctly');
    assert(dump[1][1] === 'Acme Ltd', 'Customer data actually persisted');

    console.log('\n=== Second write on the same (now-healed) sheet behaves normally ===');
    Utils.appendRow('Customers', { customer_id: 'CUS2', name: 'Beta Co' });
    assert(sheet.dump().length === 3, 'Second customer appended correctly after self-heal');

    console.log('\n=== Headerless UNKNOWN sheet throws a clear, actionable error ===');
    var sheet2 = makeFakeSheet([]);
    var Utils2 = buildUtils(sheet2);
    var errMsg = null;
    try { Utils2.appendRow('SomeRandomSheet', { x: 1 }); }
    catch (e) { errMsg = e.message; }
    assert(errMsg !== null, 'Throws instead of silently writing an empty row');
    assert(errMsg && /no header row/.test(errMsg), 'Error message is clear and actionable');
    assert(sheet2.dump().length === 0, 'No garbage row was written for the unrecognised sheet');

    console.log('\n=== ALL HEADERLESS-SHEET SELF-HEAL TESTS COMPLETE ===');
  })();
}
