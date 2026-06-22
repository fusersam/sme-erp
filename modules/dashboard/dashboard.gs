/**
 * Dashboard Service
 * ==================
 * Calculates KPIs, metrics, and chart data for the executive dashboard.
 * Uses caching to minimize spreadsheet reads.
 */

var DashboardService = (function() {
  
  /**
   * Get all dashboard data for a given period.
   * @param {string} period - 'month', 'quarter', 'year'
   * @returns {Object} Complete dashboard payload
   */
  function getData(period) {
    period = period || 'month';
    
    // Check cache first
    var cacheKey = 'dashboard_' + period;
    var cached = _getCache(cacheKey);
    if (cached) return cached;
    
    var range = Utils.getDateRange(period);
    
    var data = {
      period: period,
      dateRange: {
        start: Utils.formatDate(range.start),
        end: Utils.formatDate(range.end)
      },
      financial: _getFinancialKPIs(range),
      inventory: _getInventoryKPIs(),
      payroll: _getPayrollKPIs(range),
      charts: _getChartData(range),
      recentActivity: _getRecentActivity(),
      alerts: _getAlerts(),
      generatedAt: new Date().toISOString()
    };
    
    // Cache the result
    _setCache(cacheKey, data, APP_CONFIG.DASHBOARD_CACHE_DURATION);
    
    return data;
  }
  
  /**
   * Calculate financial KPIs.
   */
  function _getFinancialKPIs(range) {
    try {
      var invoices = Utils.sheetToObjects('Invoices', {}).data || [];
      var receipts = Utils.sheetToObjects('Receipts', {}).data || [];
      var expenses = Utils.sheetToObjects('Expenses', {}).data || [];
      var cashbook = Utils.sheetToObjects('Cashbook', {}).data || [];
      
      var periodInvoices = _filterByDateRange(invoices, 'date', range);
      var periodExpenses = _filterByDateRange(expenses, 'date', range);
      var periodReceipts = _filterByDateRange(receipts, 'date', range);
      
      // Revenue = sum of invoiced amounts in period
      var revenue = periodInvoices.reduce(function(sum, inv) {
        return sum + Utils.toFloat(inv.total);
      }, 0);
      
      // Expenses = sum of expense amounts in period
      var totalExpenses = periodExpenses.reduce(function(sum, exp) {
        return sum + Utils.toFloat(exp.amount);
      }, 0);
      
      // COGS = expenses categorized as COGS (simplified)
      var cogs = periodExpenses.filter(function(e) {
        var cat = (e.category || '').toLowerCase();
        return cat.indexOf('cost of goods') !== -1 || cat.indexOf('cogs') !== -1 || cat.indexOf('purchase') !== -1;
      }).reduce(function(sum, e) { return sum + Utils.toFloat(e.amount); }, 0);
      
      var grossProfit = revenue - cogs;
      var netProfit = revenue - totalExpenses;
      
      // Cash position from cashbook
      var cashBalance = cashbook.reduce(function(sum, entry) {
        return sum + Utils.toFloat(entry.debit) - Utils.toFloat(entry.credit);
      }, 0);
      
      // Accounts Receivable = total unpaid invoice balances
      var accountsReceivable = invoices
        .filter(function(inv) { return inv.status !== 'Paid' && inv.status !== 'Deleted'; })
        .reduce(function(sum, inv) { return sum + Utils.toFloat(inv.balance_due); }, 0);
      
      // Accounts Payable (from PurchaseOrders)
      var pos = Utils.sheetToObjects('PurchaseOrders', {}).data || [];
      var accountsPayable = pos
        .filter(function(po) { return po.status !== 'Paid' && po.status !== 'Deleted'; })
        .reduce(function(sum, po) { return sum + Utils.toFloat(po.balance_due); }, 0);
      
      // Receipts collected in period
      var cashCollected = periodReceipts.reduce(function(sum, r) {
        return sum + Utils.toFloat(r.amount);
      }, 0);
      
      return {
        revenue: Utils.round2(revenue),
        expenses: Utils.round2(totalExpenses),
        cogs: Utils.round2(cogs),
        grossProfit: Utils.round2(grossProfit),
        netProfit: Utils.round2(netProfit),
        grossMargin: revenue > 0 ? Utils.round2((grossProfit / revenue) * 100) : 0,
        netMargin: revenue > 0 ? Utils.round2((netProfit / revenue) * 100) : 0,
        cashPosition: Utils.round2(cashBalance),
        cashCollected: Utils.round2(cashCollected),
        accountsReceivable: Utils.round2(accountsReceivable),
        accountsPayable: Utils.round2(accountsPayable),
        invoiceCount: periodInvoices.length,
        expenseCount: periodExpenses.length
      };
    } catch (e) {
      Logger.log('Financial KPI error: ' + e.message);
      return _emptyFinancialKPIs();
    }
  }
  
  function _emptyFinancialKPIs() {
    return {
      revenue: 0, expenses: 0, cogs: 0, grossProfit: 0, netProfit: 0,
      grossMargin: 0, netMargin: 0, cashPosition: 0, cashCollected: 0,
      accountsReceivable: 0, accountsPayable: 0, invoiceCount: 0, expenseCount: 0
    };
  }
  
  /**
   * Calculate inventory KPIs.
   */
  function _getInventoryKPIs() {
    try {
      var products = Utils.sheetToObjects('Products', {}).data || [];
      var active = products.filter(function(p) { return p.status !== 'Deleted' && p.status !== 'Inactive'; });
      
      var totalValue = 0;
      var lowStock = 0;
      var outOfStock = 0;
      
      active.forEach(function(p) {
        var qty = Utils.toFloat(p.quantity_on_hand);
        var cost = Utils.toFloat(p.cost_price);
        totalValue += qty * cost;
        
        var reorderLevel = Utils.toFloat(p.reorder_level, APP_CONFIG.LOW_STOCK_THRESHOLD);
        if (qty <= 0) outOfStock++;
        else if (qty <= reorderLevel) lowStock++;
      });
      
      return {
        totalProducts: active.length,
        inventoryValue: Utils.round2(totalValue),
        lowStockItems: lowStock,
        outOfStockItems: outOfStock
      };
    } catch (e) {
      Logger.log('Inventory KPI error: ' + e.message);
      return { totalProducts: 0, inventoryValue: 0, lowStockItems: 0, outOfStockItems: 0 };
    }
  }
  
  /**
   * Calculate payroll KPIs.
   */
  function _getPayrollKPIs(range) {
    try {
      var employees = Utils.sheetToObjects('Employees', {}).data || [];
      var active = employees.filter(function(e) { return e.status === 'Active'; });
      
      var payrolls = Utils.sheetToObjects('Payroll', {}).data || [];
      var periodPayrolls = _filterByDateRange(payrolls, 'start_date', range);
      
      var totalPayrollCost = periodPayrolls.reduce(function(sum, p) {
        return sum + Utils.toFloat(p.total_gross);
      }, 0);
      
      return {
        employeeCount: active.length,
        payrollCost: Utils.round2(totalPayrollCost),
        payrollRuns: periodPayrolls.length
      };
    } catch (e) {
      Logger.log('Payroll KPI error: ' + e.message);
      return { employeeCount: 0, payrollCost: 0, payrollRuns: 0 };
    }
  }
  
  /**
   * Generate chart data for the dashboard.
   */
  function _getChartData(range) {
    try {
      var invoices = Utils.sheetToObjects('Invoices', {}).data || [];
      var expenses = Utils.sheetToObjects('Expenses', {}).data || [];
      
      // Monthly revenue vs expenses (last 6 months)
      var monthlyData = _getMonthlyTrends(invoices, expenses, 6);
      
      return {
        revenueVsExpenses: monthlyData,
        topExpenseCategories: _getTopExpenseCategories(expenses, range),
        invoiceStatusBreakdown: _getInvoiceStatusBreakdown(invoices)
      };
    } catch (e) {
      Logger.log('Chart data error: ' + e.message);
      return {
        revenueVsExpenses: { labels: [], revenue: [], expenses: [] },
        topExpenseCategories: { labels: [], values: [] },
        invoiceStatusBreakdown: { labels: [], values: [] }
      };
    }
  }
  
  /**
   * Get monthly revenue and expense trends.
   */
  function _getMonthlyTrends(invoices, expenses, months) {
    var labels = [];
    var revenueData = [];
    var expenseData = [];
    var profitData = [];
    
    var now = new Date();
    
    for (var i = months - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      var label = Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM yyyy');
      
      var monthRevenue = invoices
        .filter(function(inv) {
          var invDate = new Date(inv.date);
          return invDate >= d && invDate <= monthEnd;
        })
        .reduce(function(sum, inv) { return sum + Utils.toFloat(inv.total); }, 0);
      
      var monthExpenses = expenses
        .filter(function(exp) {
          var expDate = new Date(exp.date);
          return expDate >= d && expDate <= monthEnd;
        })
        .reduce(function(sum, exp) { return sum + Utils.toFloat(exp.amount); }, 0);
      
      labels.push(label);
      revenueData.push(Utils.round2(monthRevenue));
      expenseData.push(Utils.round2(monthExpenses));
      profitData.push(Utils.round2(monthRevenue - monthExpenses));
    }
    
    return { labels: labels, revenue: revenueData, expenses: expenseData, profit: profitData };
  }
  
  /**
   * Get top expense categories.
   */
  function _getTopExpenseCategories(expenses, range) {
    var periodExpenses = _filterByDateRange(expenses, 'date', range);
    var categoryMap = {};
    
    periodExpenses.forEach(function(e) {
      var cat = e.category || 'Uncategorized';
      categoryMap[cat] = (categoryMap[cat] || 0) + Utils.toFloat(e.amount);
    });
    
    var sorted = Object.keys(categoryMap)
      .map(function(k) { return { label: k, value: categoryMap[k] }; })
      .sort(function(a, b) { return b.value - a.value; })
      .slice(0, 8);
    
    return {
      labels: sorted.map(function(s) { return s.label; }),
      values: sorted.map(function(s) { return Utils.round2(s.value); })
    };
  }
  
  /**
   * Get invoice status breakdown.
   */
  function _getInvoiceStatusBreakdown(invoices) {
    var statusMap = {};
    invoices.forEach(function(inv) {
      var s = inv.status || 'Unknown';
      statusMap[s] = (statusMap[s] || 0) + 1;
    });
    
    return {
      labels: Object.keys(statusMap),
      values: Object.keys(statusMap).map(function(k) { return statusMap[k]; })
    };
  }
  
  /**
   * Get recent activity feed.
   */
  function _getRecentActivity() {
    try {
      var logs = AuditService.query({}, 10);
      return logs.map(function(l) {
        return {
          timestamp: l.timestamp,
          user: l.user_email,
          module: l.module,
          action: l.action,
          entity: l.entity_id
        };
      });
    } catch (e) {
      return [];
    }
  }
  
  /**
   * Get system alerts (low stock, overdue invoices, etc.).
   */
  function _getAlerts() {
    var alerts = [];
    
    try {
      // Low stock alerts
      var products = Utils.sheetToObjects('Products', {}).data || [];
      products.forEach(function(p) {
        if (p.status === 'Active') {
          var qty = Utils.toFloat(p.quantity_on_hand);
          var reorder = Utils.toFloat(p.reorder_level, APP_CONFIG.LOW_STOCK_THRESHOLD);
          if (qty <= 0) {
            alerts.push({ type: 'danger', icon: 'exclamation-triangle', message: 'Out of stock: ' + p.name });
          } else if (qty <= reorder) {
            alerts.push({ type: 'warning', icon: 'exclamation-circle', message: 'Low stock: ' + p.name + ' (' + qty + ' left)' });
          }
        }
      });
      
      // Overdue invoices
      var invoices = Utils.sheetToObjects('Invoices', {}).data || [];
      var today = new Date();
      invoices.forEach(function(inv) {
        if ((inv.status === 'Sent' || inv.status === 'Partial') && inv.due_date) {
          var due = new Date(inv.due_date);
          if (due < today) {
            alerts.push({
              type: 'warning', icon: 'clock',
              message: 'Overdue invoice: ' + inv.invoice_number + ' (' + inv.customer_name + ')'
            });
          }
        }
      });
    } catch (e) {
      Logger.log('Alerts error: ' + e.message);
    }
    
    return alerts.slice(0, 20); // Limit to 20 alerts
  }
  
  // ─── Helpers ───
  
  function _filterByDateRange(items, dateField, range) {
    return items.filter(function(item) {
      if (!item[dateField]) return false;
      var d = new Date(item[dateField]);
      return d >= range.start && d <= range.end;
    });
  }
  
  function _getCache(key) {
    try {
      var cache = CacheService.getScriptCache();
      var val = cache.get(key);
      return val ? JSON.parse(val) : null;
    } catch (e) {
      return null;
    }
  }
  
  function _setCache(key, data, ttl) {
    try {
      var cache = CacheService.getScriptCache();
      var json = JSON.stringify(data);
      if (json.length < 100000) { // CacheService limit
        cache.put(key, json, ttl || 300);
      }
    } catch (e) {
      Logger.log('Cache set error: ' + e.message);
    }
  }
  
  return {
    getData: getData
  };
  
})();
