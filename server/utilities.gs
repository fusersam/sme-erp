/**
 * Utility Functions
 * ==================
 * Shared helpers used across all modules.
 */

var Utils = (function() {
  
  /**
   * Generate a unique ID with optional prefix.
   * Combines a base-36 timestamp with a slice of a UUID so concurrent calls
   * within the same millisecond do not collide. Uses 10 hex characters
   * (~1.1 trillion combinations) rather than a shorter slice: a tight loop
   * generating many IDs within one millisecond (e.g. a payroll run, a bulk
   * import) relies entirely on this slice for uniqueness since the timestamp
   * doesn't vary, and the birthday paradox makes a short slice genuinely
   * risky — 10,000 IDs drawn from a 6-hex-char (16.7M) space hitting the
   * same millisecond had a ~95% chance of collision; the 10-hex-char space
   * used here brings that down to ~0.0000455%.
   * @param {string} prefix - e.g., 'INV', 'REC', 'PO'
   * @returns {string}
   */
  function generateId(prefix) {
    var ts = new Date().getTime().toString(36).toUpperCase();
    var uuid = Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase();
    return (prefix || '') + ts + uuid;
  }
  
  /**
   * Generate a sequential document number.
   * Reads the last number from the sheet and increments.
   * @param {string} sheetName - Sheet to check
   * @param {string} columnName - Column header containing the number
   * @param {string} prefix - e.g., 'INV-'
   * @param {number} padLength - Zero-pad length, default 5
   * @returns {string} e.g., 'INV-00042'
   */
  function generateDocNumber(sheetName, columnName, prefix, padLength) {
    padLength = padLength || 5;
    try {
      var sheet = ConfigService.getSheet(sheetName);
      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var colIdx = headers.indexOf(columnName);
      if (colIdx === -1) colIdx = 0;
      
      var maxNum = 0;
      for (var i = 1; i < data.length; i++) {
        var val = data[i][colIdx];
        if (val) {
          var numStr = val.toString().replace(prefix, '');
          var num = parseInt(numStr, 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      }
      
      var next = maxNum + 1;
      return prefix + String(next).padStart(padLength, '0');
    } catch (e) {
      // Fallback to timestamp-based
      return prefix + new Date().getTime().toString().slice(-padLength);
    }
  }
  
  /**
   * Format a date to the configured format.
   * @param {Date} date
   * @param {string} format - Optional override
   * @returns {string}
   */
  function formatDate(date, format) {
    if (!date) return '';
    if (!(date instanceof Date)) date = new Date(date);
    if (isNaN(date.getTime())) return '';
    return Utilities.formatDate(date, Session.getScriptTimeZone(), format || APP_CONFIG.DATE_FORMAT);
  }
  
  /**
   * Format a number as currency.
   * @param {number} amount
   * @param {string} symbol - Currency symbol override
   * @returns {string}
   */
  function formatCurrency(amount, symbol) {
    symbol = symbol || APP_CONFIG.CURRENCY_SYMBOL;
    if (amount === null || amount === undefined || isNaN(amount)) return symbol + '0.00';
    return symbol + parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  
  /**
   * Round a number to 2 decimal places.
   * @param {number} num
   * @returns {number}
   */
  function round2(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }
  
  /**
   * Convert a sheet's data to an array of objects.
   * @param {string} sheetName
   * @param {Object} options - { filters: {col: value}, sort: 'col', order: 'asc'|'desc', limit: n, offset: n }
   * @returns {Object[]}
   */
  function sheetToObjects(sheetName, options) {
    options = options || {};
    var sheet = ConfigService.getSheet(sheetName);
    var data = sheet.getDataRange().getValues();

    // Empty sheet (no rows) or headers-only (1 row): return the SAME object
    // shape as the populated path so callers can always read result.data.
    // (Returning a bare [] here caused "Cannot read properties of undefined
    // (reading 'length')" in findRow when adding the first record to a sheet.)
    if (data.length < 2) {
      return { data: [], total: 0, offset: options.offset || 0, limit: options.limit || 0 };
    }
    
    var headers = data[0].map(function(h) { return h.toString().trim(); });
    var results = [];
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      // Skip completely empty rows
      if (row.every(function(cell) { return cell === '' || cell === null || cell === undefined; })) continue;
      
      var obj = { _rowIndex: i + 1 }; // 1-based row for updates
      for (var j = 0; j < headers.length; j++) {
        if (headers[j]) {
          obj[headers[j]] = row[j];
        }
      }
      
      // Apply filters
      if (options.filters) {
        var match = true;
        for (var key in options.filters) {
          if (obj[key] !== undefined) {
            var filterVal = options.filters[key];
            if (Array.isArray(filterVal)) {
              if (filterVal.indexOf(obj[key]) === -1) { match = false; break; }
            } else if (obj[key] != filterVal) {
              match = false; break;
            }
          }
        }
        if (!match) continue;
      }
      
      results.push(obj);
    }
    
    // Sort
    if (options.sort) {
      var sortKey = options.sort;
      var sortOrder = (options.order === 'desc') ? -1 : 1;
      results.sort(function(a, b) {
        if (a[sortKey] < b[sortKey]) return -1 * sortOrder;
        if (a[sortKey] > b[sortKey]) return 1 * sortOrder;
        return 0;
      });
    }
    
    // Pagination
    var offset = options.offset || 0;
    var limit = options.limit || results.length;
    var total = results.length;
    
    results = results.slice(offset, offset + limit);
    
    return { data: results, total: total, offset: offset, limit: limit };
  }
  
  // Per-execution header cache. Headers rarely change within a single
  // request; caching them turns N sheet reads into 1 per sheet.
  var _headerCache = {};

  /**
   * Get headers for a sheet (cached per execution).
   *
   * If the sheet exists but has no header row (getLastRow() === 0), this is
   * NOT treated as "no headers, carry on" — that previously let appendRow
   * silently build an empty row from an empty headers array and write a
   * meaningless row (or fail in a confusing way), with no clear error and no
   * data actually persisted. A headerless sheet for a KNOWN schema sheet is
   * now self-healed by seeding the canonical headers on the spot (mirroring
   * ConfigService.getSheet's seeding for newly-created sheets, which does not
   * cover a sheet that already existed but lost its header row). A headerless
   * UNKNOWN sheet throws a clear, actionable error instead of returning [].
   *
   * @param {string} sheetName
   * @returns {string[]}
   */
  function getHeaders(sheetName) {
    if (_headerCache[sheetName]) return _headerCache[sheetName];
    var sheet = ConfigService.getSheet(sheetName);

    if (sheet.getLastRow() === 0) {
      var seeded = _seedHeadersIfKnownSchema(sheet, sheetName);
      if (seeded) {
        _headerCache[sheetName] = seeded;
        return seeded;
      }
      throw new Error('Sheet "' + sheetName + '" has no header row and is not a ' +
        'recognised schema sheet, so it cannot be safely written to. ' +
        'Run "Initialize Database" from the menu to repair sheet headers.');
    }

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function(h) { return h.toString().trim(); });
    _headerCache[sheetName] = headers;
    return headers;
  }

  /**
   * Seed canonical headers onto an empty (0-row) sheet if its name is a known
   * schema sheet. Returns the header array on success, or null if the sheet
   * name isn't recognised (caller decides how to handle that).
   * @private
   */
  function _seedHeadersIfKnownSchema(sheet, sheetName) {
    try {
      if (typeof DatabaseInit === 'undefined' || !DatabaseInit.getSchema) return null;
      var schema = DatabaseInit.getSchema();
      var headers = schema && schema[sheetName];
      if (!headers || !headers.length) return null;
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      Logger.log('getHeaders: self-healed missing header row on "' + sheetName + '"');
      return headers;
    } catch (e) {
      Logger.log('getHeaders: could not self-heal headers for ' + sheetName + ': ' + e.message);
      return null;
    }
  }

  /**
   * Invalidate the header cache for a sheet (call after schema changes).
   * @param {string} [sheetName] - omit to clear all
   */
  function clearHeaderCache(sheetName) {
    if (sheetName) delete _headerCache[sheetName];
    else _headerCache = {};
  }

  /**
   * Append a row to a sheet using header mapping.
   * @param {string} sheetName
   * @param {Object} obj - Key-value pairs matching headers
   * @returns {number} The new row number
   */
  function appendRow(sheetName, obj) {
    var sheet = ConfigService.getSheet(sheetName);
    var headers = getHeaders(sheetName);

    var row = headers.map(function(h) {
      return obj.hasOwnProperty(h) ? obj[h] : '';
    });

    sheet.appendRow(row);
    return sheet.getLastRow();
  }

  /**
   * Update a row by row index using header mapping.
   *
   * Writes all changed cells in a single contiguous range operation where the
   * changed columns are adjacent, falling back to per-cell writes only for
   * sparse updates. This replaces the previous one-setValue-per-field loop.
   *
   * @param {string} sheetName
   * @param {number} rowIndex - 1-based row number
   * @param {Object} obj - Fields to update
   */
  function updateRow(sheetName, rowIndex, obj) {
    var sheet = ConfigService.getSheet(sheetName);
    var headers = getHeaders(sheetName);

    // Resolve which columns (0-based) are being written
    var cols = [];
    for (var key in obj) {
      var colIdx = headers.indexOf(key);
      if (colIdx !== -1) cols.push({ idx: colIdx, value: obj[key] });
    }
    if (cols.length === 0) return;

    // Single field — one setValue.
    if (cols.length === 1) {
      sheet.getRange(rowIndex, cols[0].idx + 1).setValue(cols[0].value);
      return;
    }

    // Read the full row once, patch the changed cells, write it back in one call.
    var lastCol = sheet.getLastColumn();
    var range = sheet.getRange(rowIndex, 1, 1, lastCol);
    var rowValues = range.getValues()[0];
    for (var c = 0; c < cols.length; c++) {
      rowValues[cols[c].idx] = cols[c].value;
    }
    range.setValues([rowValues]);
  }
  
  /**
   * Find a row by a key column value.
   * @param {string} sheetName
   * @param {string} column - Header name
   * @param {*} value - Value to find
   * @returns {Object|null} Object with _rowIndex, or null
   */
  function findRow(sheetName, column, value) {
    var result = sheetToObjects(sheetName, { filters: {} });
    var items = (result && result.data) ? result.data : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i][column] == value) { // loose equality for type flexibility
        return items[i];
      }
    }
    return null;
  }
  
  /**
   * Delete a row (by clearing it, to preserve row references, or actual delete).
   * @param {string} sheetName
   * @param {number} rowIndex - 1-based
   * @param {boolean} hardDelete - If true, removes the row entirely
   */
  function deleteRow(sheetName, rowIndex, hardDelete) {
    var sheet = ConfigService.getSheet(sheetName);
    if (hardDelete) {
      sheet.deleteRow(rowIndex);
    } else {
      // Soft delete: set status to 'Deleted'
      var headers = getHeaders(sheetName);
      var statusIdx = headers.indexOf('status');
      if (statusIdx !== -1) {
        sheet.getRange(rowIndex, statusIdx + 1).setValue('Deleted');
      }
    }
  }
  
  /**
   * Get the fiscal year start and end dates.
   * @param {Date} refDate - Reference date (defaults to now)
   * @returns {Object} { start: Date, end: Date }
   */
  function getFiscalYear(refDate) {
    refDate = refDate || new Date();
    var startMonth = APP_CONFIG.FISCAL_YEAR_START_MONTH - 1; // 0-based
    var year = refDate.getFullYear();
    
    if (refDate.getMonth() < startMonth) year--;
    
    var start = new Date(year, startMonth, 1);
    var end = new Date(year + 1, startMonth, 0);
    
    return { start: start, end: end };
  }
  
  /**
   * Get date range for a period.
   * @param {string} period - 'today', 'week', 'month', 'quarter', 'year'
   * @returns {Object} { start: Date, end: Date }
   */
  function getDateRange(period) {
    var now = new Date();
    var start, end;
    
    switch (period) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        break;
      case 'week':
        var day = now.getDay();
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - day), 23, 59, 59);
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        break;
      case 'quarter':
        var qm = Math.floor(now.getMonth() / 3) * 3;
        start = new Date(now.getFullYear(), qm, 1);
        end = new Date(now.getFullYear(), qm + 3, 0, 23, 59, 59);
        break;
      case 'year':
      default:
        return getFiscalYear(now);
    }
    
    return { start: start, end: end };
  }
  
  /**
   * Parse a value to float safely.
   * @param {*} val
   * @param {number} fallback
   * @returns {number}
   */
  function toFloat(val, fallback) {
    var num = parseFloat(val);
    return isNaN(num) ? (fallback || 0) : num;
  }
  
  /**
   * Get the current user's email, with the same fallback chain used across
   * the app. Returns 'system' if no identity is available (e.g. time-driven
   * triggers). This is the single source of truth for "who is acting"; the
   * per-module _user()/_getUser() helpers delegate to it.
   * @returns {string}
   */
  function currentUserEmail() {
    var email = '';
    try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
    if (!email) {
      try { email = Session.getEffectiveUser().getEmail() || ''; } catch (e) {}
    }
    return email || 'system';
  }

  /**
   * Deep clone an object (JSON-safe).
   * @param {Object} obj
   * @returns {Object}
   */
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  
  return {
    generateId: generateId,
    generateDocNumber: generateDocNumber,
    formatDate: formatDate,
    formatCurrency: formatCurrency,
    round2: round2,
    sheetToObjects: sheetToObjects,
    getHeaders: getHeaders,
    clearHeaderCache: clearHeaderCache,
    appendRow: appendRow,
    updateRow: updateRow,
    findRow: findRow,
    deleteRow: deleteRow,
    getFiscalYear: getFiscalYear,
    getDateRange: getDateRange,
    toFloat: toFloat,
    currentUserEmail: currentUserEmail,
    clone: clone
  };
  
})();
