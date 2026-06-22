/**
 * Validation Service
 * ===================
 * Input validation, sanitization, and business rule checks.
 */

var Validators = (function() {
  
  /**
   * Validate required fields in an object.
   * @param {Object} obj - Data object
   * @param {string[]} fields - Required field names
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function required(obj, fields) {
    var errors = [];
    fields.forEach(function(field) {
      if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
        errors.push(field + ' is required');
      }
    });
    return { valid: errors.length === 0, errors: errors };
  }
  
  /**
   * Validate email format.
   * @param {string} email
   * @returns {boolean}
   */
  function isValidEmail(email) {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  
  /**
   * Validate a positive number.
   * @param {*} val
   * @returns {boolean}
   */
  function isPositiveNumber(val) {
    var num = parseFloat(val);
    return !isNaN(num) && num > 0;
  }
  
  /**
   * Validate a non-negative number.
   * @param {*} val
   * @returns {boolean}
   */
  function isNonNegativeNumber(val) {
    var num = parseFloat(val);
    return !isNaN(num) && num >= 0;
  }
  
  /**
   * Validate a date value.
   * @param {*} val
   * @returns {boolean}
   */
  function isValidDate(val) {
    if (!val) return false;
    var d = new Date(val);
    return !isNaN(d.getTime());
  }
  
  /**
   * Sanitize a string: trim and remove dangerous characters.
   * @param {string} str
   * @returns {string}
   */
  function sanitize(str) {
    if (str === null || str === undefined) return '';
    return str.toString().trim()
      .replace(/[<>]/g, '') // Remove angle brackets
      .substring(0, 1000);   // Limit length
  }
  
  /**
   * Sanitize all string values in an object.
   * @param {Object} obj
   * @returns {Object}
   */
  function sanitizeObject(obj) {
    var clean = {};
    for (var key in obj) {
      if (typeof obj[key] === 'string') {
        clean[key] = sanitize(obj[key]);
      } else {
        clean[key] = obj[key];
      }
    }
    return clean;
  }
  
  /**
   * Validate a customer object.
   * @param {Object} data
   * @returns {Object} { valid, errors }
   */
  function validateCustomer(data) {
    var result = required(data, ['name']);
    if (data.email && !isValidEmail(data.email)) {
      result.errors.push('Invalid email format');
      result.valid = false;
    }
    return result;
  }
  
  /**
   * Validate an invoice object.
   * @param {Object} data
   * @returns {Object} { valid, errors }
   */
  function validateInvoice(data) {
    var result = required(data, ['customer_id', 'date']);
    if (!isValidDate(data.date)) {
      result.errors.push('Invalid invoice date');
      result.valid = false;
    }
    if (data.items && data.items.length === 0) {
      result.errors.push('Invoice must have at least one item');
      result.valid = false;
    }
    return result;
  }
  
  /**
   * Validate a journal entry for double-entry compliance.
   * @param {Object} entry - { entries: [{ account, debit, credit }] }
   * @returns {Object} { valid, errors }
   */
  function validateJournalEntry(entry) {
    var errors = [];
    
    if (!entry.entries || entry.entries.length < 2) {
      errors.push('Journal entry must have at least two lines');
    } else {
      var totalDebit = 0;
      var totalCredit = 0;
      
      entry.entries.forEach(function(line, idx) {
        if (!line.account) errors.push('Line ' + (idx + 1) + ': account is required');
        totalDebit += Utils.toFloat(line.debit);
        totalCredit += Utils.toFloat(line.credit);
      });
      
      if (Utils.round2(totalDebit) !== Utils.round2(totalCredit)) {
        errors.push('Debits (' + totalDebit.toFixed(2) + ') must equal Credits (' + totalCredit.toFixed(2) + ')');
      }
    }
    
    return { valid: errors.length === 0, errors: errors };
  }
  
  /**
   * Validate a product object.
   * @param {Object} data
   * @returns {Object} { valid, errors }
   */
  function validateProduct(data) {
    var result = required(data, ['name', 'category']);
    if (data.unit_price !== undefined && !isNonNegativeNumber(data.unit_price)) {
      result.errors.push('Unit price must be non-negative');
      result.valid = false;
    }
    if (data.cost_price !== undefined && !isNonNegativeNumber(data.cost_price)) {
      result.errors.push('Cost price must be non-negative');
      result.valid = false;
    }
    return result;
  }
  
  /**
   * Validate a quotation object.
   * @param {Object} data
   * @returns {Object} { valid, errors }
   */
  function validateQuotation(data) {
    var result = required(data, ['customer_id', 'date']);
    if (!isValidDate(data.date)) {
      result.errors.push('Invalid quotation date');
      result.valid = false;
    }
    if (data.items && data.items.length === 0) {
      result.errors.push('Quotation must have at least one item');
      result.valid = false;
    }
    return result;
  }
  
  /**
   * Validate a stock adjustment.
   */
  function validateStockAdjustment(data) {
    var result = required(data, ['product_id', 'quantity', 'date', 'reason']);
    if (data.quantity !== undefined && isNaN(parseFloat(data.quantity))) {
      result.errors.push('Quantity must be a number');
      result.valid = false;
    }
    if (data.date && !isValidDate(data.date)) {
      result.errors.push('Invalid date');
      result.valid = false;
    }
    return result;
  }

  /**
   * Validate a stock transfer.
   */
  function validateTransfer(data) {
    var result = required(data, ['product_id', 'quantity', 'date', 'location_from', 'location_to']);
    if (data.quantity !== undefined && !isPositiveNumber(data.quantity)) {
      result.errors.push('Transfer quantity must be positive');
      result.valid = false;
    }
    if (data.location_from && data.location_to && data.location_from === data.location_to) {
      result.errors.push('Source and destination locations must differ');
      result.valid = false;
    }
    return result;
  }

  /**
   * Validate a return transaction.
   */
  function validateReturn(data) {
    var result = required(data, ['product_id', 'quantity', 'date', 'return_type']);
    if (data.quantity !== undefined && !isPositiveNumber(data.quantity)) {
      result.errors.push('Return quantity must be positive');
      result.valid = false;
    }
    var validTypes = ['Customer Return', 'Supplier Return'];
    if (data.return_type && validTypes.indexOf(data.return_type) === -1) {
      result.errors.push('return_type must be Customer Return or Supplier Return');
      result.valid = false;
    }
    return result;
  }

  /**
   * Validate a category.
   */
  function validateCategory(data) {
    return required(data, ['name']);
  }

  /**
   * Validate an employee.
   */
  function validateEmployee(data) {
    var result = required(data, ['first_name', 'last_name', 'basic_salary']);
    if (data.email && !isValidEmail(data.email)) {
      result.errors.push('Invalid email format');
      result.valid = false;
    }
    if (data.basic_salary !== undefined && !isNonNegativeNumber(data.basic_salary)) {
      result.errors.push('Basic salary must be a non-negative number');
      result.valid = false;
    }
    return result;
  }

  return {
    required: required,
    isValidEmail: isValidEmail,
    isPositiveNumber: isPositiveNumber,
    isNonNegativeNumber: isNonNegativeNumber,
    isValidDate: isValidDate,
    sanitize: sanitize,
    sanitizeObject: sanitizeObject,
    validateCustomer: validateCustomer,
    validateInvoice: validateInvoice,
    validateQuotation: validateQuotation,
    validateJournalEntry: validateJournalEntry,
    validateProduct: validateProduct,
    validateStockAdjustment: validateStockAdjustment,
    validateTransfer: validateTransfer,
    validateReturn: validateReturn,
    validateCategory: validateCategory,
    validateEmployee: validateEmployee
  };
  
})();
