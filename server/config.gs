/**
 * Configuration Service
 * =====================
 * Central configuration management for the SME ERP system.
 * Reads settings from the Settings sheet and provides defaults.
 */

var APP_CONFIG = {
  APP_NAME: 'SME Business Manager',
  VERSION: '1.5.3-deploycheck',
  
  // Set this to your Google Sheets spreadsheet ID after creation
  // Leave empty to auto-create on first run
  SPREADSHEET_ID: '',
  
  // Default currency
  CURRENCY: 'GHS',
  CURRENCY_SYMBOL: 'GH₵',
  
  // Date format
  DATE_FORMAT: 'yyyy-MM-dd',
  DATETIME_FORMAT: 'yyyy-MM-dd HH:mm:ss',
  
  // Tax
  DEFAULT_TAX_RATE: 15.0, // VAT/GST percentage
  TAX_NAME: 'VAT',
  
  // Pagination
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 500,
  
  // Cache duration in seconds
  CACHE_DURATION: 300, // 5 minutes
  DASHBOARD_CACHE_DURATION: 600, // 10 minutes
  
  // Fiscal year start month (1 = January)
  FISCAL_YEAR_START_MONTH: 1,
  
  // Depreciation
  DEFAULT_DEPRECIATION_METHOD: 'straight_line',
  
  // Payroll
  PAYE_ENABLED: true,
  PENSION_RATE: 5.5, // Employee contribution %
  EMPLOYER_PENSION_RATE: 13.0,
  
  // Inventory
  DEFAULT_VALUATION_METHOD: 'weighted_average',
  LOW_STOCK_THRESHOLD: 10,
  
  // Admin email for system notifications
  ADMIN_EMAIL: ''
};

var ConfigService = (function() {
  
  var _settingsCache = null;
  var _cacheTime = 0;
  
  // Cache the resolved spreadsheet for the duration of one execution so we
  // don't repeatedly re-resolve / re-open it on every getSheet call.
  var _resolvedSs = null;

  /**
   * Get the main database spreadsheet.
   *
   * Resolution order (first that works wins):
   *   1. The ACTIVE spreadsheet — only non-null when this Apps Script project
   *      is container-bound (created from inside a Sheet via Extensions →
   *      Apps Script). When present this is always the right file and needs
   *      no configuration, so it is preferred.
   *   2. A configured spreadsheet ID — APP_CONFIG.SPREADSHEET_ID (compile-time
   *      constant) or the DB_SPREADSHEET_ID script property (runtime, set via
   *      the Database Info → Set Spreadsheet ID control). Used for standalone
   *      projects, where getActiveSpreadsheet() returns null.
   *
   * If NEITHER resolves, this throws a clear error. It deliberately does NOT
   * silently create a new spreadsheet any more: that old behaviour is what
   * scattered data across phantom auto-created files — a write would "succeed"
   * into a spreadsheet nobody was looking at, and the next cold start could
   * create yet another. Failing loudly here makes a misconfiguration obvious
   * immediately instead of months later.
   *
   * @returns {Spreadsheet}
   */
  function getSpreadsheet() {
    if (_resolvedSs) return _resolvedSs;

    // 1. Container-bound active spreadsheet (zero-config, always correct).
    try {
      var active = SpreadsheetApp.getActiveSpreadsheet();
      if (active) {
        _resolvedSs = active;
        return active;
      }
    } catch (e) {
      // getActiveSpreadsheet can throw in some execution contexts; fall through.
    }

    // 2. Explicitly configured spreadsheet ID.
    var id = APP_CONFIG.SPREADSHEET_ID || _getSavedSpreadsheetId();
    if (id) {
      try {
        _resolvedSs = SpreadsheetApp.openById(id);
        return _resolvedSs;
      } catch (e) {
        throw new Error('Configured database spreadsheet (' + id + ') could not be opened: ' +
          e.message + '. Check the ID and that this account has access, then set it again ' +
          'via Database Info → Set Spreadsheet ID.');
      }
    }

    // 3. Nothing configured — fail loudly rather than auto-creating a rogue file.
    throw new Error('No database spreadsheet is configured. This project is not bound to a ' +
      'spreadsheet, and no spreadsheet ID has been set. Open the app menu → Database Info → ' +
      'Set Spreadsheet ID and paste the ID of the Google Sheet you want to use as the database. ' +
      '(If you intend this project to be container-bound, create it from inside the sheet via ' +
      'Extensions → Apps Script instead.)');
  }

  /**
   * Provision a brand-new database spreadsheet ON PURPOSE.
   *
   * This is the explicit, opt-in version of what getSpreadsheet() used to do
   * implicitly. It is only called from the first-run setup path / a deliberate
   * admin action — never as a silent fallback — so a new spreadsheet is only
   * ever created when someone actually asked for one. The new ID is persisted
   * to the script property so every subsequent request uses it.
   *
   * @returns {Spreadsheet}
   */
  function createDatabaseSpreadsheet() {
    var ss = SpreadsheetApp.create(APP_CONFIG.APP_NAME + ' Database');
    _saveSpreadsheetId(ss.getId());
    _resolvedSs = ss;
    Logger.log('Created new database spreadsheet on request: ' + ss.getId());
    return ss;
  }
  
  /**
   * Save spreadsheet ID to Script Properties for persistence.
   */
  function _saveSpreadsheetId(id) {
    PropertiesService.getScriptProperties().setProperty('DB_SPREADSHEET_ID', id);
  }
  
  /**
   * Retrieve saved spreadsheet ID from Script Properties.
   */
  function _getSavedSpreadsheetId() {
    return PropertiesService.getScriptProperties().getProperty('DB_SPREADSHEET_ID') || '';
  }
  
  /**
   * Get or create a specific sheet by name.
   *
   * If the sheet must be created and its name is a known schema sheet, the
   * canonical header row is written immediately so the sheet is never left
   * headerless (a headerless sheet was the root cause of an earlier
   * duplicate-record incident). Unknown sheets are created bare, as before.
   *
   * @param {string} sheetName
   * @returns {Sheet}
   */
  function getSheet(sheetName) {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      // Write canonical headers for known sheets so we never create a
      // headerless sheet. Defensive: never let this throw out of getSheet.
      try {
        if (typeof DatabaseInit !== 'undefined' && DatabaseInit.getSchema) {
          var schema = DatabaseInit.getSchema();
          var headers = schema && schema[sheetName];
          if (headers && headers.length) {
            sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
            sheet.setFrozenRows(1);
            // Header cache (if present) may now be stale for this sheet.
            try {
              if (typeof Utils !== 'undefined' && Utils.clearHeaderCache) {
                Utils.clearHeaderCache(sheetName);
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        Logger.log('getSheet: could not seed headers for ' + sheetName + ': ' + e.message);
      }
    }
    return sheet;
  }
  
  /**
   * Load settings from the Settings sheet into cache.
   */
  function _loadSettings() {
    var now = new Date().getTime();
    if (_settingsCache && (now - _cacheTime) < APP_CONFIG.CACHE_DURATION * 1000) {
      return _settingsCache;
    }
    
    try {
      var sheet = getSheet('Settings');
      var data = sheet.getDataRange().getValues();
      var settings = {};
      
      for (var i = 1; i < data.length; i++) {
        if (data[i][0]) {
          settings[data[i][0]] = data[i][1];
        }
      }
      
      _settingsCache = settings;
      _cacheTime = now;
      return settings;
    } catch (e) {
      Logger.log('Error loading settings: ' + e.message);
      return {};
    }
  }
  
  /**
   * Get a specific setting value.
   * @param {string} key
   * @param {*} defaultValue
   * @returns {*}
   */
  function getSetting(key, defaultValue) {
    var settings = _loadSettings();
    return settings.hasOwnProperty(key) ? settings[key] : (defaultValue !== undefined ? defaultValue : null);
  }
  
  /**
   * Get all settings.
   * @returns {Object}
   */
  function getAllSettings() {
    return _loadSettings();
  }
  
  /**
   * Update or insert a setting.
   * @param {string} key
   * @param {*} value
   * @returns {Object} Success result
   */
  function updateSetting(key, value) {
    var sheet = getSheet('Settings');
    var data = sheet.getDataRange().getValues();
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        sheet.getRange(i + 1, 4).setValue(new Date()); // updated_at
        _settingsCache = null; // Invalidate cache
        return { success: true, message: 'Setting updated' };
      }
    }
    
    // Insert new setting
    sheet.appendRow([key, value, '', new Date()]);
    _settingsCache = null;
    return { success: true, message: 'Setting created' };
  }
  
  /**
   * Get config suitable for the client (no sensitive data).
   * @returns {Object}
   */
  function getClientConfig() {
    return {
      appName: APP_CONFIG.APP_NAME,
      version: APP_CONFIG.VERSION,
      currency: getSetting('currency', APP_CONFIG.CURRENCY),
      currencySymbol: getSetting('currency_symbol', APP_CONFIG.CURRENCY_SYMBOL),
      taxRate: parseFloat(getSetting('default_tax_rate', APP_CONFIG.DEFAULT_TAX_RATE)),
      taxName: getSetting('tax_name', APP_CONFIG.TAX_NAME),
      dateFormat: APP_CONFIG.DATE_FORMAT,
      fiscalYearStartMonth: parseInt(getSetting('fiscal_year_start_month', APP_CONFIG.FISCAL_YEAR_START_MONTH)),
      lowStockThreshold: parseInt(getSetting('low_stock_threshold', APP_CONFIG.LOW_STOCK_THRESHOLD)),
      valuationMethod: getSetting('valuation_method', APP_CONFIG.DEFAULT_VALUATION_METHOD)
    };
  }
  
  /**
   * Invalidate all caches.
   */
  function clearCache() {
    _settingsCache = null;
    _cacheTime = 0;
    _resolvedSs = null; // force the spreadsheet to be re-resolved next call
    _headerCacheReset();
    var cache = CacheService.getScriptCache();
    // We can't enumerate cache keys, but we clear our known ones
    cache.removeAll(['dashboard_month', 'dashboard_quarter', 'dashboard_year']);
  }

  /**
   * Reset the Utils header cache if available (best-effort — Utils may load
   * after config in some contexts).
   * @private
   */
  function _headerCacheReset() {
    try {
      if (typeof Utils !== 'undefined' && Utils.clearHeaderCache) Utils.clearHeaderCache();
    } catch (e) {}
  }
  
  return {
    getSpreadsheet: getSpreadsheet,
    createDatabaseSpreadsheet: createDatabaseSpreadsheet,
    getSheet: getSheet,
    getSetting: getSetting,
    getAllSettings: getAllSettings,
    updateSetting: updateSetting,
    getClientConfig: getClientConfig,
    clearCache: clearCache
  };
  
})();
