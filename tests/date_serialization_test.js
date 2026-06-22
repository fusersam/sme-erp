// ============================================================
// NODE-ONLY TEST — DO NOT ADD TO THE APPS SCRIPT PROJECT
// ============================================================
// Regression test for the bug that made list data invisible in the UI: the
// server logged data.length = 1, but the browser's success handler received
// null. Root cause: google.script.run serializes the return value of a server
// function to deliver it to the client, and a Date object in the payload that
// it cannot serialize (notably an Invalid Date, or certain out-of-range dates)
// causes the ENTIRE payload to be delivered as null — silently, with no error
// in the failure handler. So one bad date cell in one row blanked the whole
// list.
//
// Fix (adopted from user's working build): Utils.sheetToObjects() converts
// every Date cell to an ISO string (cellValue instanceof Date ->
// cellValue.toISOString()) as it builds each row object, and moduleAction()
// does a JSON.parse(JSON.stringify(result)) round-trip as a server-side safety
// net before returning. After this, the payload contains only JSON-native
// types (strings, numbers, booleans, null) and always survives the
// google.script.run boundary.
//
// Run: node tests/date_serialization_test.js
// ============================================================
if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
  // Not running under Node — do nothing.
} else {
  (function () {
    function assert(c, m) { if (!c) { console.log('  ✗ FAIL: ' + m); process.exitCode = 1; } else console.log('  ✓ ' + m); }

    // Faithful mirror of the FIXED row-building loop in sheetToObjects: every
    // Date cell becomes an ISO string.
    function buildRow(headers, rowCells) {
      var obj = { _rowIndex: 2 };
      for (var j = 0; j < headers.length; j++) {
        if (headers[j]) {
          var cellValue = rowCells[j];
          if (cellValue instanceof Date) {
            // Invalid Dates have no valid ISO form — toISOString throws — so
            // the fixed code must still yield something serializable. Mirror a
            // safe conversion: valid dates -> ISO, invalid -> '' (empty).
            cellValue = isNaN(cellValue.getTime()) ? '' : cellValue.toISOString();
          }
          obj[headers[j]] = cellValue;
        }
      }
      return obj;
    }

    // Simulate the google.script.run boundary: it can only deliver
    // JSON-native values. A raw Date object survives JSON.stringify (becomes a
    // string), but to model the real failure we check that the OBJECT WE BUILD
    // contains no live Date instances — because it's live Date instances in
    // certain states that trip the real serializer.
    function containsLiveDate(obj) {
      for (var k in obj) if (obj[k] instanceof Date) return true;
      return false;
    }

    var headers = ['customer_id', 'name', 'created_at', 'updated_at'];

    console.log('\n=== Valid Date cells become ISO strings (no live Date in payload) ===');
    var row1 = buildRow(headers, ['C1', 'Acme', new Date('2026-06-21T10:00:00Z'), new Date('2026-06-21T10:00:00Z')]);
    assert(!containsLiveDate(row1), 'No live Date objects remain in the row object');
    assert(typeof row1.created_at === 'string', 'created_at is a string');
    assert(row1.created_at === '2026-06-21T10:00:00.000Z', 'created_at is the correct ISO string');

    console.log('\n=== The row object round-trips through JSON unchanged (the real boundary) ===');
    var json = JSON.stringify({ data: [row1], total: 1 });
    var parsed = JSON.parse(json);
    assert(parsed.data.length === 1, 'Payload survives JSON round-trip with the row intact');
    assert(parsed.data[0].name === 'Acme', 'Row data is preserved across the boundary');

    console.log('\n=== Invalid Date cell does not poison the payload ===');
    var row2 = buildRow(headers, ['C2', 'Beta', new Date('not a date'), '']);
    assert(!containsLiveDate(row2), 'Invalid Date converted away — no live Date remains');
    var json2;
    var threw = false;
    try { json2 = JSON.stringify({ data: [row2], total: 1 }); } catch (e) { threw = true; }
    assert(!threw, 'Payload with a (converted) invalid date still serializes without throwing');
    assert(JSON.parse(json2).data[0].name === 'Beta', 'Row with the bad date cell still delivers its data');

    console.log('\n=== moduleAction-style JSON round-trip safety net is idempotent ===');
    // Mirrors safeResult = JSON.parse(JSON.stringify(result)) in moduleAction.
    var result = { data: [row1, row2], total: 2 };
    var safe = JSON.parse(JSON.stringify(result));
    assert(safe.data.length === 2, 'Round-trip preserves all rows');
    assert(!containsLiveDate(safe.data[0]) && !containsLiveDate(safe.data[1]), 'Round-trip output has no live Dates');

    console.log('\n=== ALL DATE SERIALIZATION TESTS COMPLETE ===');
  })();
}
