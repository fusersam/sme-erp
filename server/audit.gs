/**
 * Audit Service
 * ==============
 * Comprehensive audit trail for all system actions.
 * Logs to the AuditLog sheet with user, module, action, and details.
 */

var AuditService = (function() {
  
  /**
   * Log an action to the audit trail.
   * @param {string} module - Module name (e.g., 'invoices', 'products')
   * @param {string} action - Action performed (e.g., 'create', 'update', 'delete')
   * @param {Object} details - Additional details (truncated for storage)
   * @param {string} entityId - Optional entity ID (e.g., invoice number)
   */
  function log(module, action, details, entityId) {
    try {
      var email = '';
      try {
        email = Session.getActiveUser().getEmail();
      } catch (e) {
        email = 'system';
      }
      
      var detailStr = '';
      if (details) {
        try {
          detailStr = JSON.stringify(details);
          if (detailStr.length > 2000) {
            detailStr = detailStr.substring(0, 2000) + '...[truncated]';
          }
        } catch (e) {
          detailStr = String(details);
        }
      }
      
      var sheet = ConfigService.getSheet('AuditLog');
      sheet.appendRow([
        Utilities.getUuid(),         // log_id
        new Date(),                  // timestamp
        email,                       // user_email
        module,                      // module
        action,                      // action
        entityId || '',              // entity_id
        detailStr,                   // details
        _getClientInfo()             // client_info
      ]);
      
    } catch (e) {
      // Audit logging should never break the application
      Logger.log('Audit log error: ' + e.message);
    }
  }
  
  /**
   * Log a system event (not user-initiated).
   * @param {string} event - Event description
   * @param {string} details - Details
   */
  function logSystem(event, details) {
    log('system', event, details, '');
  }
  
  /**
   * Log an error.
   * @param {string} module
   * @param {string} action
   * @param {Error} error
   */
  function logError(module, action, error) {
    log(module, 'error', {
      message: error.message,
      stack: error.stack ? error.stack.substring(0, 500) : ''
    }, '');
  }
  
  /**
   * Get client info string for audit context.
   * @returns {string}
   */
  function _getClientInfo() {
    try {
      return 'Apps Script Web App';
    } catch (e) {
      return 'unknown';
    }
  }
  
  /**
   * Query audit logs with filters.
   * @param {Object} filters - { module, action, user, startDate, endDate }
   * @param {number} limit - Max results
   * @returns {Object[]}
   */
  function query(filters, limit) {
    filters = filters || {};
    limit = limit || 100;
    
    var result = Utils.sheetToObjects('AuditLog', {
      sort: 'timestamp',
      order: 'desc',
      limit: limit
    });
    
    var logs = result.data;
    
    if (filters.module) {
      logs = logs.filter(function(l) { return l.module === filters.module; });
    }
    if (filters.action) {
      logs = logs.filter(function(l) { return l.action === filters.action; });
    }
    if (filters.user) {
      logs = logs.filter(function(l) { return l.user_email === filters.user; });
    }
    if (filters.startDate) {
      var sd = new Date(filters.startDate);
      logs = logs.filter(function(l) { return new Date(l.timestamp) >= sd; });
    }
    if (filters.endDate) {
      var ed = new Date(filters.endDate);
      logs = logs.filter(function(l) { return new Date(l.timestamp) <= ed; });
    }
    
    return logs;
  }
  
  return {
    log: log,
    logSystem: logSystem,
    logError: logError,
    query: query
  };
  
})();
