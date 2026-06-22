// ============================================================
// NODE-ONLY TEST — DO NOT ADD TO THE APPS SCRIPT PROJECT
// ============================================================
// Regression test for a silent permission-lockout bug: the 'role' cell in
// the Users sheet can only ever be set by editing the spreadsheet directly
// (there is no role-assignment UI), with no validation. PERMISSIONS[role] is
// an exact, case-sensitive object-key lookup, so a single typo, stray space,
// or wrong casing in that cell (e.g. "sales officer" instead of the
// canonical "Sales Officer") made hasPermission() return false for EVERY
// action for that user — including reads, not just writes — with the
// failure surfacing as a generic "Permission denied" thrown before
// moduleAction's audit log line ever runs. From the outside this looked
// indistinguishable from a deeper bug: no audit log entry at all.
//
// Fix: _normalizeRole() trims whitespace and does a case-insensitive match
// against the canonical PERMISSIONS keys at the point the role is first read
// from the sheet (in getCurrentUser), so every downstream comparison gets a
// clean canonical value regardless of how the cell was typed. A genuinely
// unrecognised role still passes through unchanged (and is still correctly
// denied) rather than being silently coerced into something misleading.
//
// Run: node tests/role_normalization_test.js
// ============================================================
if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
  // Not running under Node — do nothing.
} else {
  (function () {
    function assert(c, m) { if (!c) { console.log('  ✗ FAIL: ' + m); process.exitCode = 1; } else console.log('  ✓ ' + m); }

    var PERMISSIONS = {
      'Administrator': { all: true },
      'Accountant': { modules: ['sales', 'accounting'], actions: ['list', 'get', 'create', 'update', 'export'] },
      'Inventory Officer': { modules: ['inventory'], actions: ['list', 'get', 'create', 'update', 'export'] },
      'Sales Officer': { modules: ['sales'], actions: ['list', 'get', 'create', 'update', 'export'] },
      'HR Officer': { modules: ['payroll'], actions: ['list', 'get', 'create', 'update', 'export'] },
      'Viewer': { modules: ['dashboard'], actions: ['list', 'get', 'export'] }
    };

    // Faithful mirror of the FIXED _normalizeRole() in server/auth.gs.
    function _normalizeRole(raw) {
      var trimmed = (raw || '').toString().trim();
      if (!trimmed) return 'Viewer';
      if (PERMISSIONS[trimmed]) return trimmed;
      var lower = trimmed.toLowerCase();
      for (var key in PERMISSIONS) {
        if (key.toLowerCase() === lower) return key;
      }
      return trimmed;
    }

    function hasPermission(role, module, action) {
      var perms = PERMISSIONS[role];
      if (!perms) return false;
      if (perms.all) return true;
      return perms.modules.indexOf(module) !== -1 && perms.actions.indexOf(action) !== -1;
    }

    console.log('\n=== Before the fix, an exact-match lookup silently denies EVERYTHING on a typo ===');
    assert(hasPermission('sales officer', 'sales', 'create') === false, 'Unnormalized lowercase typo blocks create');
    assert(hasPermission('sales officer', 'sales', 'get') === false, 'Unnormalized lowercase typo ALSO blocks get/list — not just writes');

    console.log('\n=== Common real-world cell variations all normalize correctly ===');
    var variants = ['sales officer', 'SALES OFFICER', ' Sales Officer ', 'Sales officer', 'Sales Officer'];
    variants.forEach(function (v) {
      var role = _normalizeRole(v);
      assert(role === 'Sales Officer', 'normalizes "' + v + '" -> "' + role + '"');
      assert(hasPermission(role, 'sales', 'create') === true, '  create permission now resolves correctly for "' + v + '"');
    });

    console.log('\n=== Genuinely unrecognised role is NOT silently coerced ===');
    var unknown = _normalizeRole('Salesperson');
    assert(unknown === 'Salesperson', 'Unknown role passes through unchanged for visibility/debugging');
    assert(hasPermission(unknown, 'sales', 'create') === false, 'Still correctly denied — not masked as some other role');

    console.log('\n=== Blank/missing role cell defaults to Viewer (least privilege), not undefined ===');
    assert(_normalizeRole('') === 'Viewer', 'Empty string -> Viewer');
    assert(_normalizeRole(null) === 'Viewer', 'Null -> Viewer');
    assert(_normalizeRole(undefined) === 'Viewer', 'Undefined -> Viewer');

    console.log('\n=== Administrator and other exact-match roles still work as before ===');
    assert(_normalizeRole('Administrator') === 'Administrator', 'Exact "Administrator" still matches (fast path)');
    assert(_normalizeRole('administrator') === 'Administrator', 'Lowercase "administrator" still resolves to Administrator');

    console.log('\n=== ALL ROLE NORMALIZATION TESTS COMPLETE ===');
  })();
}
