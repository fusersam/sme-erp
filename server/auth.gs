/**
 * Authentication & Authorization Service
 * ========================================
 * Handles user authentication via Google Account,
 * role-based access control, and session management.
 */

var AuthService = (function() {

  var _userCache = {};

  // Permission matrix: role -> allowed modules/actions
  var PERMISSIONS = {
    'Administrator': { all: true },
    'Accountant': {
      modules: ['dashboard', 'accounting', 'sales', 'purchasing', 'expenses',
                'cashbank', 'payroll', 'assets', 'reports', 'customers', 'suppliers'],
      actions: ['list', 'get', 'create', 'update', 'export']
    },
    'Inventory Officer': {
      modules: ['dashboard', 'inventory', 'products', 'purchasing', 'suppliers', 'reports'],
      actions: ['list', 'get', 'create', 'update', 'export']
    },
    'Sales Officer': {
      modules: ['dashboard', 'sales', 'invoices', 'receipts', 'customers', 'products', 'reports'],
      actions: ['list', 'get', 'create', 'update', 'export']
    },
    'HR Officer': {
      modules: ['dashboard', 'payroll', 'employees', 'reports'],
      actions: ['list', 'get', 'create', 'update', 'export']
    },
    'Viewer': {
      modules: ['dashboard', 'reports'],
      actions: ['list', 'get', 'export']
    }
  };

  /**
   * Normalize a role string read from the Users sheet to one of the canonical
   * PERMISSIONS keys, tolerant of stray whitespace and any casing.
   *
   * There is currently no in-app UI for assigning roles — the 'role' column
   * can only be edited directly in the Users sheet, with no validation or
   * dropdown. A single typo, extra space, or wrong casing there (e.g.
   * "sales officer" instead of "Sales Officer") previously made the EXACT,
   * case-sensitive `PERMISSIONS[user.role]` lookup fail silently: hasPermission
   * returns false for every action, with no error surfaced anywhere except a
   * permission-denied throw that happens before any audit log entry is
   * written — which looks indistinguishable from a deeper bug. Normalizing
   * once here, at the point the role is first read, means every downstream
   * comparison (permission checks, requireRole, UI role badges) works
   * correctly regardless of how the cell was typed.
   *
   * @param {string} raw - the raw 'role' cell value
   * @returns {string} a canonical PERMISSIONS key if recognised, otherwise the
   *   trimmed original value (so an unrecognised role is still visible/
   *   debuggable rather than silently coerced into something misleading)
   */
  function _normalizeRole(raw) {
    var trimmed = (raw || '').toString().trim();
    if (!trimmed) return 'Viewer';
    if (PERMISSIONS[trimmed]) return trimmed; // exact match, fast path
    var lower = trimmed.toLowerCase();
    for (var key in PERMISSIONS) {
      if (key.toLowerCase() === lower) return key;
    }
    return trimmed; // unrecognised — surfaced as-is rather than masked
  }

  // Canonical Users sheet column headers — must match database_init.gs SCHEMA
  var USERS_HEADERS = [
    'user_id', 'email', 'name', 'role', 'status',
    'department', 'created_at', 'last_login', 'created_by'
  ];

  // ─────────────────────────────────────────
  // SESSION
  // ─────────────────────────────────────────

  /**
   * Get the current user's email using every available session method.
   *
   * - getActiveUser()   → returns the visiting user's email when deployed as
   *                       "Execute as: User", or the owner's email for "Execute
   *                       as: Me". Returns '' for truly anonymous visitors.
   * - getEffectiveUser()→ always returns the account the script runs under
   *                       (owner for "Execute as: Me", visitor for "Execute as: User").
   *
   * Trying both covers the "Execute as: Me" case where getActiveUser() may
   * return '' but getEffectiveUser() correctly returns the owner/deployer.
   */
  function _getSessionEmail() {
    var email = '';
    try { email = Session.getActiveUser().getEmail() || ''; } catch(e) {}
    if (email) return email;
    try { email = Session.getEffectiveUser().getEmail() || ''; } catch(e) {}
    return email || '';
  }

  /**
   * Public wrapper — lets Code.gs read the detected email for the login template.
   */
  function getSessionEmail() {
    return _getSessionEmail();
  }

  // ─────────────────────────────────────────
  // HEADER MANAGEMENT
  // ─────────────────────────────────────────

  /**
   * Return true if the supplied row array looks like the Users header row.
   * At least half of its values must match known header names.
   * @param {Array} row
   * @returns {boolean}
   */
  function _rowIsHeader(row) {
    if (!row || row.length === 0) return false;
    var matches = 0;
    for (var i = 0; i < row.length; i++) {
      if (USERS_HEADERS.indexOf(row[i].toString().trim()) !== -1) matches++;
    }
    return matches >= Math.ceil(USERS_HEADERS.length / 2);
  }

  /**
   * Ensure the Users sheet has a valid header row as row 1.
   * If row 1 contains data (not headers), inserts a blank row at the top
   * and writes the headers there.  Formats the header row.
   * @param {Sheet} sheet
   */
  function _ensureHeaders(sheet) {
    var lastRow = sheet.getLastRow();

    if (lastRow === 0) {
      // Completely empty — write headers
      sheet.getRange(1, 1, 1, USERS_HEADERS.length).setValues([USERS_HEADERS]);
      _formatHeaderRow(sheet);
      return;
    }

    var firstRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (!_rowIsHeader(firstRow)) {
      // Row 1 is data — insert a header row above it
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, USERS_HEADERS.length).setValues([USERS_HEADERS]);
      _formatHeaderRow(sheet);
      Logger.log('AuthService: inserted missing Users header row');
    }
  }

  function _formatHeaderRow(sheet) {
    var r = sheet.getRange(1, 1, 1, USERS_HEADERS.length);
    r.setFontWeight('bold');
    r.setBackground('#1a73e8');
    r.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  // ─────────────────────────────────────────
  // USER LOOKUP
  // ─────────────────────────────────────────

  /**
   * Get the current user from the Users sheet.
   * Handles first-run (no sheet / no headers / no users).
   * @returns {Object|null}
   */
  /**
   * Get the current user object from the Users sheet.
   *
   * @param {string} [emailHint] - Optional fallback email, supplied by doGet()
   *   server-side when Session methods return empty in the google.script.run
   *   context. Only used when _getSessionEmail() returns ''.
   */
  function getCurrentUser(emailHint) {
    var email = _getSessionEmail() || (emailHint ? emailHint.toString().trim().toLowerCase() : '');
    if (!email) return null;

    // In-memory cache (per execution)
    if (_userCache[email] && _userCache[email]._ts > new Date().getTime() - 60000) {
      return _userCache[email];
    }

    try {
      var ss     = ConfigService.getSpreadsheet();
      var sheet  = ss.getSheetByName('Users');

      // ── First-run: Users sheet doesn't exist yet ──────────────
      if (!sheet) {
        // Auto-initialize the whole database so all sheets get headers
        DatabaseInit.initialize();
        sheet = ss.getSheetByName('Users');
        if (!sheet) throw new Error('Failed to create Users sheet during auto-init.');
        return _autoRegisterAdmin(sheet, email);
      }

      // ── Ensure headers are present (repair if missing) ────────
      _ensureHeaders(sheet);

      // ── Read all rows ─────────────────────────────────────────
      var data    = sheet.getDataRange().getValues();
      var headers = data[0].map(function(h) { return h.toString().trim(); });

      var emailIdx     = headers.indexOf('email');
      var statusIdx    = headers.indexOf('status');
      var lastLoginIdx = headers.indexOf('last_login');

      // Walk data rows (skip row 0 = headers)
      for (var i = 1; i < data.length; i++) {
        var row      = data[i];
        var rowEmail = (emailIdx >= 0 ? row[emailIdx] : row[1] || '').toString().trim();

        if (rowEmail.toLowerCase() !== email.toLowerCase()) continue;

        // Found the user
        if (statusIdx >= 0 && row[statusIdx] === 'Inactive') return null;

        var user = {
          id:         row[headers.indexOf('user_id')] || row[0],
          email:      rowEmail,
          name:       row[headers.indexOf('name')]       || row[2] || email.split('@')[0],
          role:       _normalizeRole(row[headers.indexOf('role')] || row[3]),
          status:     row[headers.indexOf('status')]     || row[4] || 'Active',
          department: row[headers.indexOf('department')] || row[5] || '',
          lastLogin:  new Date(),
          _ts:        new Date().getTime()
        };

        // Update last_login timestamp
        if (lastLoginIdx >= 0) {
          sheet.getRange(i + 1, lastLoginIdx + 1).setValue(new Date());
        }

        _userCache[email] = user;
        return user;
      }

      // No matching user found
      if (data.length <= 1) {
        // Headers exist but zero data rows → register first admin
        return _autoRegisterAdmin(sheet, email);
      }

      return null; // Not registered

    } catch (e) {
      Logger.log('getCurrentUser error: ' + e.message);
      return null;
    }
  }

  // ─────────────────────────────────────────
  // AUTO-REGISTER FIRST ADMIN
  // ─────────────────────────────────────────

  /**
   * Register the very first user as Administrator.
   * Always ensures the header row exists before appending data.
   * @param {Sheet} sheet
   * @param {string} email
   * @returns {Object} User object
   */
  function _autoRegisterAdmin(sheet, email) {
    // Guard: ensure headers exist before writing data
    _ensureHeaders(sheet);

    // Guard: check again — another concurrent request might have just written this user
    var data = sheet.getDataRange().getValues();
    if (data.length > 1) {
      var headers   = data[0].map(function(h) { return h.toString().trim(); });
      var emailIdx  = headers.indexOf('email');
      for (var i = 1; i < data.length; i++) {
        var rowEmail = (emailIdx >= 0 ? data[i][emailIdx] : data[i][1] || '').toString().trim();
        if (rowEmail.toLowerCase() === email.toLowerCase()) {
          // Already exists — return them
          var user = {
            id:         data[i][headers.indexOf('user_id')] || data[i][0],
            email:      rowEmail,
            name:       data[i][headers.indexOf('name')]       || email.split('@')[0],
            role:       _normalizeRole(data[i][headers.indexOf('role')] || 'Administrator'),
            status:     'Active',
            department: '',
            lastLogin:  new Date(),
            _ts:        new Date().getTime()
          };
          _userCache[email] = user;
          return user;
        }
      }
    }

    var userId = Utilities.getUuid();
    var name   = email.split('@')[0];
    var now    = new Date();

    sheet.appendRow([
      userId, email, name, 'Administrator', 'Active', '', now, now, email
    ]);

    var user = {
      id: userId, email: email, name: name,
      role: 'Administrator', status: 'Active',
      department: '', lastLogin: now,
      _ts: now.getTime()
    };

    _userCache[email] = user;
    Logger.log('AuthService: auto-registered first Administrator: ' + email);
    return user;
  }

  // ─────────────────────────────────────────
  // GUARDS
  // ─────────────────────────────────────────

  function requireLogin() {
    var user = getCurrentUser();
    if (!user) throw new Error('Authentication required. Please log in.');
    return user;
  }

  function requireRole(role) {
    var user = requireLogin();
    if (user.role !== role && user.role !== 'Administrator') {
      throw new Error('Access denied. Required role: ' + role);
    }
    return user;
  }

  function hasPermission(module, action) {
    var user = getCurrentUser();
    if (!user) return false;
    var perms = PERMISSIONS[user.role];
    if (!perms) return false;
    if (perms.all) return true;
    return (perms.modules && perms.modules.indexOf(module) !== -1) &&
           (perms.actions && perms.actions.indexOf(action) !== -1);
  }

  function requirePermission(module, action) {
    if (!hasPermission(module, action)) {
      throw new Error('Permission denied for ' + module + '/' + action);
    }
  }

  function getUserPermissions() {
    var user = getCurrentUser();
    if (!user) return {};
    return PERMISSIONS[user.role] || {};
  }

  function getRoles() { return Object.keys(PERMISSIONS); }

  return {
    getCurrentUser:     getCurrentUser,
    getSessionEmail:    getSessionEmail,
    requireLogin:       requireLogin,
    requireRole:        requireRole,
    hasPermission:      hasPermission,
    requirePermission:  requirePermission,
    getUserPermissions: getUserPermissions,
    getRoles:           getRoles,
    PERMISSIONS:        PERMISSIONS
  };

})();
