// ============================================================
// NODE-ONLY TEST — DO NOT ADD TO THE APPS SCRIPT PROJECT
// ============================================================
// Regression test for the "Cannot read properties of undefined (reading
// 'length')" crash when adding the FIRST record to a sheet.
//
// Root cause: sheetToObjects() returned a bare [] for a sheet with < 2 rows
// (headers only), but every caller — including findRow — reads result.data.
// findRow did `result.data.length` → undefined.length → TypeError, so the
// duplicate check on the first create() crashed before the record was added.
//
// Fix: sheetToObjects returns the same { data, total, offset, limit } shape on
// the empty path; findRow guards with (result && result.data) || [].
// Run: node tests/sheettoobjects_shape_test.js
// ============================================================
if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
  // Not running under Node — do nothing.
} else {
  (function () {
    function assert(c, m) { if (!c) { console.log('  ✗ FAIL: ' + m); process.exitCode = 1; } else console.log('  ✓ ' + m); }

    // Faithful mirror of the FIXED sheetToObjects shape contract.
    function sheetToObjects(rows, options) {
      options = options || {};
      var data = rows;
      if (data.length < 2) {
        return { data: [], total: 0, offset: options.offset || 0, limit: options.limit || 0 };
      }
      var headers = data[0].map(function (h) { return h.toString().trim(); });
      var results = [];
      for (var i = 1; i < data.length; i++) {
        var obj = { _rowIndex: i + 1 };
        for (var j = 0; j < headers.length; j++) if (headers[j]) obj[headers[j]] = data[i][j];
        results.push(obj);
      }
      return { data: results, total: results.length, offset: 0, limit: results.length };
    }
    function findRow(rows, column, value) {
      var result = sheetToObjects(rows, { filters: {} });
      var items = (result && result.data) ? result.data : [];
      for (var i = 0; i < items.length; i++) if (items[i][column] == value) return items[i];
      return null;
    }

    console.log('\n=== sheetToObjects shape contract ===');
    // Always an object with a .data array, regardless of row count.
    var empty = sheetToObjects([], {});
    assert(empty && Array.isArray(empty.data), 'Empty sheet → object with .data array');
    assert(empty.total === 0, 'Empty sheet → total 0');

    var headersOnly = sheetToObjects([['customer_id', 'email', 'name']], {});
    assert(headersOnly && Array.isArray(headersOnly.data), 'Headers-only sheet → object with .data array');
    assert(headersOnly.data.length === 0, 'Headers-only sheet → 0 data rows');

    var populated = sheetToObjects([['customer_id', 'email', 'name'], ['C1', 'a@b.com', 'Alice']], {});
    assert(populated.data.length === 1, 'Populated sheet → 1 data row');
    assert(populated.total === 1, 'Populated sheet → total 1');

    console.log('\n=== findRow never crashes on sparse sheets (the bug) ===');
    var r1;
    try { r1 = findRow([['customer_id', 'email', 'name']], 'email', 'a@b.com'); }
    catch (e) { console.log('  ✗ FAIL: findRow crashed: ' + e.message); process.exitCode = 1; }
    assert(r1 === null, 'findRow on headers-only sheet → null (was TypeError: length)');

    var r2 = findRow([], 'email', 'a@b.com');
    assert(r2 === null, 'findRow on empty sheet → null');

    console.log('\n=== first-insert duplicate check passes ===');
    // create() calls findRow to reject duplicate emails; on an empty sheet it
    // must return null so the FIRST customer can be added.
    var dup = findRow([['customer_id', 'email', 'name']], 'email', 'new@x.com');
    assert(dup === null, 'No duplicate found on empty sheet → first insert allowed');

    var dup2 = findRow([['customer_id', 'email', 'name'], ['C1', 'taken@x.com', 'Bob']], 'email', 'taken@x.com');
    assert(dup2 && dup2.name === 'Bob', 'Duplicate correctly detected on populated sheet');

    console.log('\n=== ALL SHEETTOOBJECTS SHAPE TESTS COMPLETE ===');
  })();
}
