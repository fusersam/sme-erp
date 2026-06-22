/**
 * Inventory Module
 * =================
 * Three services in one file:
 *
 *  CategoryService  — Product category CRUD
 *  ProductService   — Full product lifecycle (replaces Phase 1 stub)
 *  InventoryService — Stock movement engine:
 *      • FIFO and Weighted Average valuation
 *      • All transaction types: Purchase, Sale, Adjustment, Damage,
 *        Transfer, Customer Return, Supplier Return, Opening Stock
 *      • Automatic COGS / adjustment journal posting
 *      • Reorder alerts and valuation reports
 */

// ╔═══════════════════════════════════════════════════════╗
// ║                  CATEGORY SERVICE                     ║
// ╚═══════════════════════════════════════════════════════╝

var CategoryService = (function() {

  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'name'; data.order = 'asc'; }
    return Utils.sheetToObjects('ProductCategories', data);
  }

  function get(data) {
    var id = data.id || data.category_id;
    var cat = Utils.findRow('ProductCategories', 'category_id', id);
    if (!cat) throw new Error('Category not found');
    return cat;
  }

  function create(data) {
    data = Validators.sanitizeObject(data);
    var v = Validators.validateCategory(data);
    if (!v.valid) throw new Error(v.errors.join(', '));

    var existing = Utils.findRow('ProductCategories', 'name', data.name);
    if (existing && existing.status !== 'Inactive') {
      throw new Error('Category "' + data.name + '" already exists.');
    }

    data.category_id  = Utils.generateId('CAT');
    data.status       = 'Active';
    data.created_at   = new Date();
    data.updated_at   = new Date();
    data.created_by   = Utils.currentUserEmail();

    Utils.appendRow('ProductCategories', data);
    AuditService.log('inventory', 'category_created', { name: data.name }, data.category_id);
    return { success: true, id: data.category_id, name: data.name };
  }

  function update(data) {
    var id = data.id || data.category_id;
    var existing = Utils.findRow('ProductCategories', 'category_id', id);
    if (!existing) throw new Error('Category not found');
    data.updated_at = new Date();
    Utils.updateRow('ProductCategories', existing._rowIndex, Validators.sanitizeObject(data));
    AuditService.log('inventory', 'category_updated', { id: id }, id);
    return { success: true };
  }

  function remove(data) {
    var id = data.id || data.category_id;
    var existing = Utils.findRow('ProductCategories', 'category_id', id);
    if (!existing) throw new Error('Category not found');

    // Prevent deletion if products reference this category
    var products = Utils.sheetToObjects('Products', {
      filters: { category_id: id }
    }).data.filter(function(p) { return p.status !== 'Discontinued' && p.status !== 'Inactive'; });

    if (products.length > 0) {
      throw new Error('Category has ' + products.length + ' active product(s). Reassign them first.');
    }

    Utils.updateRow('ProductCategories', existing._rowIndex, {
      status: 'Inactive',
      updated_at: new Date()
    });
    return { success: true };
  }

  return { list: list, get: get, create: create, update: update, remove: remove, delete: remove };

})();

// ╔═══════════════════════════════════════════════════════╗
// ║                  PRODUCT SERVICE                      ║
// ╚═══════════════════════════════════════════════════════╝

var ProductService = (function() {

  // ─────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────

  function list(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'name'; data.order = 'asc'; }
    return Utils.sheetToObjects('Products', data);
  }

  function get(data) {
    var id = data.id || data.product_id;
    var product = Utils.findRow('Products', 'product_id', id);
    if (!product) throw new Error('Product not found');

    // Attach recent transactions
    var txResult = Utils.sheetToObjects('InventoryTransactions', {
      filters: { product_id: id },
      sort: 'date', order: 'desc', limit: 20
    });
    product.recentTransactions = txResult.data;

    return product;
  }

  function create(data) {
    data = Validators.sanitizeObject(data);
    var v = Validators.validateProduct(data);
    if (!v.valid) throw new Error(v.errors.join(', '));

    var settings = ConfigService.getAllSettings();

    // SKU uniqueness check
    if (data.sku) {
      var skuExists = Utils.findRow('Products', 'sku', data.sku);
      if (skuExists) throw new Error('SKU "' + data.sku + '" already in use.');
    }

    var openingQty  = Utils.toFloat(data.quantity_on_hand, 0);
    var costPrice   = Utils.toFloat(data.cost_price, 0);
    var valuationMethod = data.valuation_method ||
                          settings.valuation_method ||
                          APP_CONFIG.DEFAULT_VALUATION_METHOD ||
                          'weighted_average';

    data.product_id       = Utils.generateId('PRD');
    data.sku              = data.sku || Utils.generateDocNumber('Products', 'sku', 'SKU-', 5);
    data.quantity_on_hand = openingQty;
    data.cost_price       = costPrice;
    data.unit_price       = Utils.toFloat(data.unit_price, 0);
    data.tax_rate         = Utils.toFloat(data.tax_rate, Utils.toFloat(settings.default_tax_rate, 15));
    data.reorder_level    = Utils.toFloat(data.reorder_level, Utils.toFloat(settings.low_stock_threshold, 10));
    data.reorder_quantity = Utils.toFloat(data.reorder_quantity, 0);
    data.valuation_method = valuationMethod;
    data.status           = 'Active';
    data.created_at       = new Date();
    data.updated_at       = new Date();
    data.created_by       = Utils.currentUserEmail();

    Utils.appendRow('Products', data);

    // Post opening stock to accounting and create initial FIFO layer
    if (openingQty > 0 && costPrice > 0) {
      InventoryService.recordOpeningStock({
        product_id:   data.product_id,
        product_name: data.name,
        quantity:     openingQty,
        unit_cost:    costPrice,
        date:         new Date()
      });
    }

    AuditService.log('inventory', 'product_created', { name: data.name, sku: data.sku }, data.product_id);
    return { success: true, id: data.product_id, name: data.name, sku: data.sku };
  }

  function update(data) {
    var id = data.id || data.product_id;
    var existing = Utils.findRow('Products', 'product_id', id);
    if (!existing) throw new Error('Product not found');

    // SKU uniqueness (if changing)
    if (data.sku && data.sku !== existing.sku) {
      var skuExists = Utils.findRow('Products', 'sku', data.sku);
      if (skuExists && skuExists.product_id !== id) {
        throw new Error('SKU "' + data.sku + '" already in use.');
      }
    }

    // Quantity changes must go through InventoryService.adjust(), not direct update
    delete data.quantity_on_hand;

    data.updated_at = new Date();
    Utils.updateRow('Products', existing._rowIndex, Validators.sanitizeObject(data));
    AuditService.log('inventory', 'product_updated', { id: id }, id);
    return { success: true };
  }

  function remove(data) {
    var id = data.id || data.product_id;
    var existing = Utils.findRow('Products', 'product_id', id);
    if (!existing) throw new Error('Product not found');

    // Check for active invoice line items
    var invoiceItems = Utils.sheetToObjects('InvoiceItems', {
      filters: { product_id: id }
    }).data;
    if (invoiceItems.length > 0) {
      // Soft discontinue instead of delete
      Utils.updateRow('Products', existing._rowIndex, {
        status: 'Discontinued',
        updated_at: new Date()
      });
    } else {
      Utils.updateRow('Products', existing._rowIndex, {
        status: 'Inactive',
        updated_at: new Date()
      });
    }
    AuditService.log('inventory', 'product_deactivated', { id: id }, id);
    return { success: true };
  }

  // ─────────────────────────────────────────
  // REPORTING
  // ─────────────────────────────────────────

  /**
   * Get products below their reorder level.
   */
  function getLowStockReport() {
    var products = Utils.sheetToObjects('Products', {
      sort: 'name', order: 'asc'
    }).data;

    var lowStock    = [];
    var outOfStock  = [];

    products.forEach(function(p) {
      if (p.status !== 'Active') return;
      var qty    = Utils.toFloat(p.quantity_on_hand, 0);
      var reorder = Utils.toFloat(p.reorder_level, APP_CONFIG.LOW_STOCK_THRESHOLD);

      if (qty <= 0) {
        outOfStock.push(_formatStockItem(p, qty));
      } else if (qty <= reorder) {
        lowStock.push(_formatStockItem(p, qty));
      }
    });

    return {
      lowStock:    lowStock,
      outOfStock:  outOfStock,
      totalLow:    lowStock.length,
      totalOut:    outOfStock.length
    };
  }

  /**
   * Get inventory valuation report.
   * Returns total value of stock using each product's valuation method.
   */
  function getValuationReport() {
    var products = Utils.sheetToObjects('Products', {
      sort: 'category', order: 'asc'
    }).data;

    var items = [];
    var totalValue = 0;

    products.forEach(function(p) {
      if (p.status === 'Inactive' || p.status === 'Deleted') return;
      var qty   = Utils.toFloat(p.quantity_on_hand, 0);
      var cost  = Utils.toFloat(p.cost_price, 0);
      var value = Utils.round2(qty * cost);

      items.push({
        product_id:       p.product_id,
        sku:              p.sku,
        name:             p.name,
        category:         p.category || '',
        unit:             p.unit || '',
        quantity:         qty,
        cost_price:       cost,
        total_value:      value,
        valuation_method: p.valuation_method || 'weighted_average',
        reorder_level:    Utils.toFloat(p.reorder_level, 0),
        status:           p.status
      });

      totalValue += value;
    });

    // Group by category
    var byCategory = {};
    items.forEach(function(item) {
      var cat = item.category || 'Uncategorised';
      if (!byCategory[cat]) byCategory[cat] = { items: [], total: 0 };
      byCategory[cat].items.push(item);
      byCategory[cat].total = Utils.round2(byCategory[cat].total + item.total_value);
    });

    return {
      items:       items,
      byCategory:  byCategory,
      totalValue:  Utils.round2(totalValue),
      totalItems:  items.length,
      generatedAt: new Date().toISOString()
    };
  }

  function _formatStockItem(p, qty) {
    return {
      product_id:      p.product_id,
      sku:             p.sku,
      name:            p.name,
      category:        p.category || '',
      quantity:        qty,
      reorder_level:   Utils.toFloat(p.reorder_level, 0),
      reorder_quantity: Utils.toFloat(p.reorder_quantity, 0),
      unit:            p.unit || '',
      supplier_id:     p.supplier_id || '',
      cost_price:      Utils.toFloat(p.cost_price, 0)
    };
  }

  return {
    list:               list,
    get:                get,
    create:             create,
    update:             update,
    remove:             remove,
    delete:             remove,
    getLowStockReport:  getLowStockReport,
    getValuationReport: getValuationReport
  };

})();

// ╔═══════════════════════════════════════════════════════╗
// ║                 INVENTORY SERVICE                     ║
// ╚═══════════════════════════════════════════════════════╝

var InventoryService = (function() {

  // ─────────────────────────────────────────
  // TRANSACTION TYPES
  // ─────────────────────────────────────────
  var TYPES = {
    PURCHASE:         'Purchase',
    SALE:             'Sale',
    ADJUSTMENT_IN:    'Adjustment In',
    ADJUSTMENT_OUT:   'Adjustment Out',
    DAMAGE:           'Damage',
    TRANSFER:         'Transfer',
    CUSTOMER_RETURN:  'Customer Return',
    SUPPLIER_RETURN:  'Supplier Return',
    OPENING_STOCK:    'Opening Stock'
  };

  // ─────────────────────────────────────────
  // CORE TRANSACTION RECORDER
  // ─────────────────────────────────────────

  /**
   * Record a stock movement. Updates product quantity and writes to InventoryTransactions.
   * Does NOT post accounting entries — callers are responsible for that.
   *
   * @param {Object} params
   *   product_id, type, quantity (signed — positive=in, negative=out),
   *   unit_cost, reference_type, reference_id, location_from, location_to,
   *   notes, date, journal_ref
   * @returns {Object} { transaction_id, running_qty, total_cost }
   */
  function _recordMovement(params) {
    var product = Utils.findRow('Products', 'product_id', params.product_id);
    if (!product) throw new Error('Product not found: ' + params.product_id);

    var qty      = Utils.toFloat(params.quantity, 0);
    var cost     = Utils.toFloat(params.unit_cost, product.cost_price || 0);
    var totalCost = Utils.round2(Math.abs(qty) * cost);

    // Update running quantity
    var currentQty = Utils.toFloat(product.quantity_on_hand, 0);
    var newQty     = Utils.round2(currentQty + qty);

    Utils.updateRow('Products', product._rowIndex, {
      quantity_on_hand: newQty,
      updated_at:       new Date()
    });

    // Write transaction row
    var txId = Utilities.getUuid();
    Utils.appendRow('InventoryTransactions', {
      transaction_id: txId,
      date:           params.date || new Date(),
      product_id:     params.product_id,
      product_name:   product.name,
      type:           params.type,
      quantity:       qty,
      unit_cost:      cost,
      total_cost:     totalCost,
      running_qty:    newQty,
      reference_type: params.reference_type || '',
      reference_id:   params.reference_id   || '',
      location_from:  params.location_from  || '',
      location_to:    params.location_to    || '',
      journal_ref:    params.journal_ref    || '',
      notes:          params.notes          || '',
      created_at:     new Date(),
      created_by:     _getUser()
    });

    return { transaction_id: txId, running_qty: newQty, unit_cost: cost, total_cost: totalCost };
  }

  // ─────────────────────────────────────────
  // FIFO LAYER MANAGEMENT
  // ─────────────────────────────────────────

  /**
   * Add a FIFO cost layer (stock in).
   * @param {Object} params - { product_id, product_name, quantity, unit_cost, reference_type, reference_id, date }
   */
  function _addFIFOLayer(params) {
    Utils.appendRow('InventoryFIFOLayers', {
      layer_id:           Utilities.getUuid(),
      product_id:         params.product_id,
      product_name:       params.product_name || '',
      date:               params.date || new Date(),
      quantity_in:        Utils.toFloat(params.quantity, 0),
      quantity_remaining: Utils.toFloat(params.quantity, 0),
      unit_cost:          Utils.toFloat(params.unit_cost, 0),
      reference_type:     params.reference_type || '',
      reference_id:       params.reference_id   || '',
      created_at:         new Date()
    });
  }

  /**
   * Consume from FIFO layers (stock out).
   * Updates layer quantity_remaining in place.
   *
   * @param {string} productId
   * @param {number} qtyToConsume
   * @returns {Object} { totalCost, avgUnitCost, consumed }
   */
  function _consumeFIFOLayers(productId, qtyToConsume) {
    var layersResult = Utils.sheetToObjects('InventoryFIFOLayers', {
      filters: { product_id: productId }
    });
    var layers = (layersResult.data || []).filter(function(l) {
      return Utils.toFloat(l.quantity_remaining, 0) > 0;
    });

    // Sort by date ASC (oldest first = FIFO)
    layers.sort(function(a, b) {
      return new Date(a.date) - new Date(b.date);
    });

    var totalCost  = 0;
    var remaining  = Utils.toFloat(qtyToConsume, 0);
    var lastCost   = 0;

    for (var i = 0; i < layers.length && remaining > 0.0001; i++) {
      var layer     = layers[i];
      var layerQty  = Utils.toFloat(layer.quantity_remaining, 0);
      var consumed  = Math.min(layerQty, remaining);
      var lineCost  = Utils.round2(consumed * Utils.toFloat(layer.unit_cost, 0));

      totalCost   += lineCost;
      remaining   -= consumed;
      lastCost     = Utils.toFloat(layer.unit_cost, 0);

      Utils.updateRow('InventoryFIFOLayers', layer._rowIndex, {
        quantity_remaining: Utils.round2(layerQty - consumed)
      });
    }

    // If still remaining (negative stock), use last known cost
    if (remaining > 0.0001 && lastCost > 0) {
      totalCost += remaining * lastCost;
    }

    totalCost = Utils.round2(totalCost);
    var consumed = Utils.toFloat(qtyToConsume, 0) - Math.max(0, remaining);

    return {
      totalCost:    totalCost,
      avgUnitCost:  qtyToConsume > 0 ? Utils.round2(totalCost / qtyToConsume) : 0,
      consumed:     Utils.round2(consumed)
    };
  }

  // ─────────────────────────────────────────
  // WEIGHTED AVERAGE COST UPDATE
  // ─────────────────────────────────────────

  /**
   * Recalculate weighted-average cost_price on stock-in.
   * Formula: new_avg = (existing_qty * existing_avg + new_qty * new_cost) / total_qty
   *
   * @param {Object} product - product row object
   * @param {number} inQty   - units arriving
   * @param {number} inCost  - cost per arriving unit
   */
  function _updateWeightedAverage(product, inQty, inCost) {
    var existingQty  = Utils.toFloat(product.quantity_on_hand, 0);
    var existingCost = Utils.toFloat(product.cost_price, 0);
    var totalQty     = existingQty + inQty;

    if (totalQty <= 0) return;

    var newAvg = Utils.round2(
      (existingQty * existingCost + inQty * inCost) / totalQty
    );

    Utils.updateRow('Products', product._rowIndex, {
      cost_price:  newAvg,
      updated_at:  new Date()
    });
  }

  // ─────────────────────────────────────────
  // RESOLVE COST — FIFO or Weighted Average
  // ─────────────────────────────────────────

  /**
   * Get the COGS unit cost for a stock-out movement.
   * For FIFO: consumes layers. For WA: uses product.cost_price.
   *
   * @param {Object} product - product row
   * @param {number} qty     - quantity going out
   * @returns {Object} { unitCost, totalCost }
   */
  function _getCOGSCost(product, qty) {
    var method = (product.valuation_method || 'weighted_average').toLowerCase();

    if (method === 'fifo') {
      var result = _consumeFIFOLayers(product.product_id, qty);
      return { unitCost: result.avgUnitCost, totalCost: result.totalCost };
    }

    // Weighted average
    var unitCost  = Utils.toFloat(product.cost_price, 0);
    return {
      unitCost:  unitCost,
      totalCost: Utils.round2(qty * unitCost)
    };
  }

  // ─────────────────────────────────────────
  // PUBLIC TRANSACTION METHODS
  // ─────────────────────────────────────────

  /**
   * Record a purchase (stock received from a supplier).
   * Updates weighted average cost or adds FIFO layer.
   * Posts accounting if postAccounting = true.
   *
   * @param {Object} params
   *   product_id, quantity, unit_cost, date,
   *   reference_type, reference_id, location_to, notes, journal_ref
   * @returns {Object} Transaction result
   */
  function recordPurchase(params) {
    var product = Utils.findRow('Products', 'product_id', params.product_id);
    if (!product) throw new Error('Product not found: ' + params.product_id);

    var qty      = Utils.toFloat(params.quantity, 0);
    var unitCost = Utils.toFloat(params.unit_cost, product.cost_price || 0);
    if (qty <= 0) throw new Error('Purchase quantity must be positive.');

    var method = (product.valuation_method || 'weighted_average').toLowerCase();

    // Update valuation before movement (so _recordMovement sees current qty)
    if (method === 'fifo') {
      _addFIFOLayer({
        product_id:     params.product_id,
        product_name:   product.name,
        quantity:       qty,
        unit_cost:      unitCost,
        reference_type: params.reference_type,
        reference_id:   params.reference_id,
        date:           params.date
      });
    } else {
      _updateWeightedAverage(product, qty, unitCost);
      // Re-read product to get refreshed cost_price after WA update
      product = Utils.findRow('Products', 'product_id', params.product_id);
    }

    var result = _recordMovement({
      product_id:     params.product_id,
      type:           TYPES.PURCHASE,
      quantity:       qty,
      unit_cost:      unitCost,
      reference_type: params.reference_type || 'Purchase',
      reference_id:   params.reference_id   || '',
      location_to:    params.location_to    || product.location || '',
      notes:          params.notes          || '',
      journal_ref:    params.journal_ref    || '',
      date:           params.date
    });

    AuditService.log('inventory', 'purchase_received', {
      product: product.name,
      qty: qty,
      unitCost: unitCost
    }, result.transaction_id);

    return result;
  }

  /**
   * Record a sale (stock out for an invoice line item).
   * Resolves COGS cost, posts journal entry.
   *
   * @param {Object} params
   *   product_id, quantity, date, reference_type, reference_id, invoice_number
   * @returns {Object} { transaction_id, cogsTotal, unitCost }
   */
  function recordSale(params) {
    var product = Utils.findRow('Products', 'product_id', params.product_id);
    if (!product) throw new Error('Product not found: ' + params.product_id);

    var qty = Utils.toFloat(params.quantity, 0);
    if (qty <= 0) throw new Error('Sale quantity must be positive.');

    // Resolve COGS cost
    var costResult = _getCOGSCost(product, qty);

    var result = _recordMovement({
      product_id:     params.product_id,
      type:           TYPES.SALE,
      quantity:       -qty,            // negative = stock out
      unit_cost:      costResult.unitCost,
      reference_type: params.reference_type || 'Invoice',
      reference_id:   params.reference_id   || '',
      location_from:  product.location || '',
      notes:          'Invoice ' + (params.invoice_number || ''),
      date:           params.date
    });

    // Post COGS to accounting
    if (costResult.totalCost > 0) {
      try {
        var journalResult = AccountingEngine.postCOGS({
          product_name:   product.name,
          cost_value:     costResult.totalCost,
          reference_type: 'Invoice',
          reference_id:   params.reference_id || '',
          date:           params.date || new Date()
        });
        // Back-write journal ref
        if (journalResult && journalResult.entryNumber) {
          var txRow = Utils.findRow('InventoryTransactions', 'transaction_id', result.transaction_id);
          if (txRow) {
            Utils.updateRow('InventoryTransactions', txRow._rowIndex, {
              journal_ref: journalResult.entryNumber
            });
          }
        }
      } catch (e) {
        Logger.log('COGS posting error: ' + e.message);
      }
    }

    return {
      transaction_id: result.transaction_id,
      running_qty:    result.running_qty,
      cogsTotal:      costResult.totalCost,
      unitCost:       costResult.unitCost
    };
  }

  /**
   * Record a stock adjustment (manual count correction).
   * Posts Inventory Adjustment journal entry.
   *
   * @param {Object} params
   *   product_id, quantity_counted (physical count), date, reason, notes
   */
  function adjust(params) {
    params = Validators.sanitizeObject(params);
    var v = Validators.validateStockAdjustment(params);
    if (!v.valid) throw new Error(v.errors.join(', '));

    var product = Utils.findRow('Products', 'product_id', params.product_id);
    if (!product) throw new Error('Product not found');

    // If quantity_counted is provided: variance = counted - on_hand
    // If quantity is a direct signed adjustment, use it directly
    var currentQty = Utils.toFloat(product.quantity_on_hand, 0);
    var variance;

    if (params.quantity_counted !== undefined) {
      var counted = Utils.toFloat(params.quantity_counted, 0);
      variance    = Utils.round2(counted - currentQty);
    } else {
      variance = Utils.toFloat(params.quantity, 0);
    }

    if (variance === 0) return { success: true, message: 'No variance — no adjustment needed.' };

    var unitCost  = Utils.toFloat(product.cost_price, 0);
    var adjValue  = Utils.round2(Math.abs(variance) * unitCost);
    var txType    = variance > 0 ? TYPES.ADJUSTMENT_IN : TYPES.ADJUSTMENT_OUT;
    var txId      = Utilities.getUuid();

    // For FIFO: add layer if positive, consume if negative
    var method = (product.valuation_method || 'weighted_average').toLowerCase();
    if (method === 'fifo' && variance > 0) {
      _addFIFOLayer({
        product_id:     params.product_id,
        product_name:   product.name,
        quantity:       variance,
        unit_cost:      unitCost,
        reference_type: 'Adjustment',
        reference_id:   txId,
        date:           params.date
      });
    } else if (method === 'fifo' && variance < 0) {
      _consumeFIFOLayers(params.product_id, Math.abs(variance));
    }

    // Post accounting
    var journalRef = '';
    try {
      var jr = AccountingEngine.postStockAdjustment({
        product_name:      product.name,
        quantity:          variance,
        adjustment_value:  (variance > 0 ? 1 : -1) * adjValue,
        reference_id:      txId,
        date:              params.date
      });
      if (jr && jr.entryNumber) journalRef = jr.entryNumber;
    } catch (e) {
      Logger.log('Adjustment accounting error: ' + e.message);
    }

    _recordMovement({
      product_id:     params.product_id,
      type:           txType,
      quantity:       variance,
      unit_cost:      unitCost,
      reference_type: 'Adjustment',
      reference_id:   txId,
      notes:          params.reason || params.notes || '',
      journal_ref:    journalRef,
      date:           params.date
    });

    AuditService.log('inventory', 'stock_adjusted', {
      product: product.name,
      variance: variance,
      reason: params.reason
    }, txId);

    return {
      success:    true,
      variance:   variance,
      newQty:     Utils.round2(currentQty + variance),
      journalRef: journalRef
    };
  }

  /**
   * Record inventory damage / write-off.
   * Posts Inventory Write-off Loss journal.
   *
   * @param {Object} params - { product_id, quantity, date, notes }
   */
  function recordDamage(params) {
    var v = Validators.required(params, ['product_id', 'quantity', 'date']);
    if (!v.valid) throw new Error(v.errors.join(', '));

    var product = Utils.findRow('Products', 'product_id', params.product_id);
    if (!product) throw new Error('Product not found');

    var qty      = Utils.toFloat(params.quantity, 0);
    if (qty <= 0) throw new Error('Damage quantity must be positive.');

    var unitCost     = Utils.toFloat(product.cost_price, 0);
    var damageValue  = Utils.round2(qty * unitCost);
    var txId         = Utilities.getUuid();

    // Consume FIFO layers if applicable
    var method = (product.valuation_method || 'weighted_average').toLowerCase();
    if (method === 'fifo') {
      var consumed = _consumeFIFOLayers(params.product_id, qty);
      damageValue  = consumed.totalCost;
    }

    // Post accounting
    var journalRef = '';
    try {
      var jr = AccountingEngine.postInventoryDamage({
        product_name:  product.name,
        damage_value:  damageValue,
        reference_id:  txId,
        date:          params.date
      });
      if (jr && jr.entryNumber) journalRef = jr.entryNumber;
    } catch (e) {
      Logger.log('Damage accounting error: ' + e.message);
    }

    _recordMovement({
      product_id:     params.product_id,
      type:           TYPES.DAMAGE,
      quantity:       -qty,
      unit_cost:      unitCost,
      reference_type: 'Damage',
      reference_id:   txId,
      notes:          params.notes || 'Damaged/written off',
      journal_ref:    journalRef,
      date:           params.date
    });

    AuditService.log('inventory', 'damage_recorded', {
      product: product.name, qty: qty, value: damageValue
    }, txId);

    return { success: true, qty: qty, value: damageValue, journalRef: journalRef };
  }

  /**
   * Record a stock transfer between locations.
   * No accounting entry (location change only).
   *
   * @param {Object} params - { product_id, quantity, location_from, location_to, date, notes }
   */
  function recordTransfer(params) {
    var v = Validators.validateTransfer(params);
    if (!v.valid) throw new Error(v.errors.join(', '));

    var product = Utils.findRow('Products', 'product_id', params.product_id);
    if (!product) throw new Error('Product not found');

    var qty = Utils.toFloat(params.quantity, 0);
    if (qty <= 0) throw new Error('Transfer quantity must be positive.');

    // Validate sufficient stock at source
    var currentQty = Utils.toFloat(product.quantity_on_hand, 0);
    if (qty > currentQty) {
      throw new Error('Insufficient stock: ' + currentQty + ' available, ' + qty + ' requested.');
    }

    var txId = Utilities.getUuid();

    // Two-leg transaction: out from location_from, in to location_to (net qty = 0)
    _recordMovement({
      product_id:     params.product_id,
      type:           TYPES.TRANSFER,
      quantity:       0,          // Net zero for location transfer
      unit_cost:      Utils.toFloat(product.cost_price, 0),
      reference_type: 'Transfer',
      reference_id:   txId,
      location_from:  params.location_from,
      location_to:    params.location_to,
      notes:          'Transfer: ' + params.location_from + ' → ' + params.location_to + (params.notes ? ' | ' + params.notes : ''),
      date:           params.date
    });

    // Update product's primary location if it matches the source
    if ((product.location || '') === params.location_from) {
      Utils.updateRow('Products', product._rowIndex, {
        location:   params.location_to,
        updated_at: new Date()
      });
    }

    AuditService.log('inventory', 'transfer_recorded', {
      product: product.name, qty: qty,
      from: params.location_from, to: params.location_to
    }, txId);

    return { success: true, qty: qty };
  }

  /**
   * Record a customer return (goods returned from a customer).
   * Increases inventory; posts revenue reversal + COGS reversal.
   *
   * @param {Object} params
   *   product_id, quantity, unit_cost (original cost), sale_price (original selling price),
   *   date, reference_id (invoice_id), notes
   */
  function recordCustomerReturn(params) {
    var v = Validators.validateReturn(
      Object.assign({}, params, { return_type: 'Customer Return' })
    );
    if (!v.valid) throw new Error(v.errors.join(', '));

    var product = Utils.findRow('Products', 'product_id', params.product_id);
    if (!product) throw new Error('Product not found');

    var qty       = Utils.toFloat(params.quantity, 0);
    var unitCost  = Utils.toFloat(params.unit_cost, product.cost_price || 0);
    var salePrice = Utils.toFloat(params.sale_price, 0);
    var costValue = Utils.round2(qty * unitCost);
    var saleValue = Utils.round2(qty * salePrice);
    var txId      = Utilities.getUuid();

    // Restore FIFO layer
    var method = (product.valuation_method || 'weighted_average').toLowerCase();
    if (method === 'fifo') {
      _addFIFOLayer({
        product_id:     params.product_id,
        product_name:   product.name,
        quantity:       qty,
        unit_cost:      unitCost,
        reference_type: 'Customer Return',
        reference_id:   txId,
        date:           params.date
      });
    }

    // Post accounting
    var journalRef = '';
    try {
      var jr = AccountingEngine.postCustomerReturn({
        product_name:   product.name,
        quantity:       qty,
        cost_value:     costValue,
        sale_value:     saleValue,
        reference_id:   txId,
        date:           params.date
      });
      if (jr && jr.entryNumber) journalRef = jr.entryNumber;
    } catch (e) {
      Logger.log('Customer return accounting error: ' + e.message);
    }

    _recordMovement({
      product_id:     params.product_id,
      type:           TYPES.CUSTOMER_RETURN,
      quantity:       qty,            // positive = stock back in
      unit_cost:      unitCost,
      reference_type: 'Customer Return',
      reference_id:   params.reference_id || txId,
      notes:          params.notes || '',
      journal_ref:    journalRef,
      date:           params.date
    });

    AuditService.log('inventory', 'customer_return', {
      product: product.name, qty: qty
    }, txId);

    return { success: true, qty: qty, costValue: costValue, journalRef: journalRef };
  }

  /**
   * Record a supplier return (goods sent back to supplier).
   * Decreases inventory; posts A/P reduction.
   *
   * @param {Object} params
   *   product_id, quantity, unit_cost, date, reference_id, notes
   */
  function recordSupplierReturn(params) {
    var v = Validators.validateReturn(
      Object.assign({}, params, { return_type: 'Supplier Return' })
    );
    if (!v.valid) throw new Error(v.errors.join(', '));

    var product = Utils.findRow('Products', 'product_id', params.product_id);
    if (!product) throw new Error('Product not found');

    var qty       = Utils.toFloat(params.quantity, 0);
    var unitCost  = Utils.toFloat(params.unit_cost, product.cost_price || 0);
    var costValue = Utils.round2(qty * unitCost);
    var txId      = Utilities.getUuid();

    // Consume FIFO layers
    var method = (product.valuation_method || 'weighted_average').toLowerCase();
    if (method === 'fifo') {
      _consumeFIFOLayers(params.product_id, qty);
    }

    // Post accounting
    var journalRef = '';
    try {
      var jr = AccountingEngine.postSupplierReturn({
        product_name: product.name,
        quantity:     qty,
        cost_value:   costValue,
        reference_id: txId,
        date:         params.date
      });
      if (jr && jr.entryNumber) journalRef = jr.entryNumber;
    } catch (e) {
      Logger.log('Supplier return accounting error: ' + e.message);
    }

    _recordMovement({
      product_id:     params.product_id,
      type:           TYPES.SUPPLIER_RETURN,
      quantity:       -qty,           // negative = stock out
      unit_cost:      unitCost,
      reference_type: 'Supplier Return',
      reference_id:   params.reference_id || txId,
      notes:          params.notes || '',
      journal_ref:    journalRef,
      date:           params.date
    });

    AuditService.log('inventory', 'supplier_return', {
      product: product.name, qty: qty
    }, txId);

    return { success: true, qty: qty, costValue: costValue, journalRef: journalRef };
  }

  /**
   * Record opening stock (initial stock on system setup).
   * Posts Dr Inventory / Cr Retained Earnings.
   *
   * @param {Object} params - { product_id, product_name, quantity, unit_cost, date }
   */
  function recordOpeningStock(params) {
    var qty      = Utils.toFloat(params.quantity, 0);
    var unitCost = Utils.toFloat(params.unit_cost, 0);
    var value    = Utils.round2(qty * unitCost);
    var txId     = params.transaction_id || Utilities.getUuid();

    if (qty <= 0) return { success: true, skipped: true };

    // Add FIFO layer regardless of valuation method (for historical tracking)
    _addFIFOLayer({
      product_id:     params.product_id,
      product_name:   params.product_name || '',
      quantity:       qty,
      unit_cost:      unitCost,
      reference_type: 'Opening Stock',
      reference_id:   txId,
      date:           params.date
    });

    // Post accounting
    var journalRef = '';
    try {
      var jr = AccountingEngine.postOpeningStock({
        product_name: params.product_name || params.product_id,
        value:        value,
        reference_id: txId,
        date:         params.date || new Date()
      });
      if (jr && jr.entryNumber) journalRef = jr.entryNumber;
    } catch (e) {
      Logger.log('Opening stock accounting error: ' + e.message);
    }

    Utils.appendRow('InventoryTransactions', {
      transaction_id: txId,
      date:           params.date || new Date(),
      product_id:     params.product_id,
      product_name:   params.product_name || '',
      type:           TYPES.OPENING_STOCK,
      quantity:       qty,
      unit_cost:      unitCost,
      total_cost:     value,
      running_qty:    qty,
      reference_type: 'Opening Stock',
      reference_id:   txId,
      journal_ref:    journalRef,
      notes:          'Initial stock entry',
      created_at:     new Date(),
      created_by:     _getUser()
    });

    return { success: true, value: value, journalRef: journalRef };
  }

  // ─────────────────────────────────────────
  // QUERY / REPORTING
  // ─────────────────────────────────────────

  /**
   * List inventory transactions with optional filters.
   * @param {Object} data - { filters: { product_id, type }, sort, limit, offset }
   */
  function listTransactions(data) {
    data = data || {};
    if (!data.sort) { data.sort = 'date'; data.order = 'desc'; }
    return Utils.sheetToObjects('InventoryTransactions', data);
  }

  /**
   * Get a single transaction.
   */
  function getTransaction(data) {
    return Utils.findRow('InventoryTransactions', 'transaction_id', data.id);
  }

  /**
   * Get stock movement summary for a product over a date range.
   * @param {Object} params - { product_id, start, end }
   */
  function getProductMovement(params) {
    var product = Utils.findRow('Products', 'product_id', params.product_id);
    if (!product) throw new Error('Product not found');

    var result = Utils.sheetToObjects('InventoryTransactions', {
      filters: { product_id: params.product_id },
      sort: 'date', order: 'asc'
    });
    var txs = result.data;

    if (params.start) {
      var start = new Date(params.start);
      txs = txs.filter(function(t) { return new Date(t.date) >= start; });
    }
    if (params.end) {
      var end = new Date(params.end);
      end.setHours(23, 59, 59);
      txs = txs.filter(function(t) { return new Date(t.date) <= end; });
    }

    var totalIn  = 0;
    var totalOut = 0;

    txs.forEach(function(t) {
      var qty = Utils.toFloat(t.quantity, 0);
      if (qty > 0) totalIn  += qty;
      else         totalOut += Math.abs(qty);
    });

    return {
      product:        product,
      transactions:   txs,
      totalIn:        Utils.round2(totalIn),
      totalOut:       Utils.round2(totalOut),
      net:            Utils.round2(totalIn - totalOut),
      currentQty:     Utils.toFloat(product.quantity_on_hand, 0)
    };
  }

  /**
   * Get stock levels for all products (for low-stock dashboard).
   */
  function getStockLevels() {
    var products = Utils.sheetToObjects('Products', {
      filters: { status: 'Active' },
      sort: 'name', order: 'asc'
    }).data;

    return products.map(function(p) {
      var qty     = Utils.toFloat(p.quantity_on_hand, 0);
      var reorder = Utils.toFloat(p.reorder_level, APP_CONFIG.LOW_STOCK_THRESHOLD);
      var status  = qty <= 0 ? 'out_of_stock' : (qty <= reorder ? 'low' : 'ok');

      return {
        product_id:   p.product_id,
        sku:          p.sku,
        name:         p.name,
        category:     p.category || '',
        quantity:     qty,
        reorder_level: reorder,
        reorder_quantity: Utils.toFloat(p.reorder_quantity, 0),
        unit:         p.unit || '',
        cost_price:   Utils.toFloat(p.cost_price, 0),
        unit_price:   Utils.toFloat(p.unit_price, 0),
        stock_status: status,
        stock_value:  Utils.round2(qty * Utils.toFloat(p.cost_price, 0))
      };
    });
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  function _getUser() {
    return Utils.currentUserEmail();
  }

  // ─────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────

  return {
    // Stock in
    recordPurchase:       recordPurchase,
    recordOpeningStock:   recordOpeningStock,
    recordCustomerReturn: recordCustomerReturn,

    // Stock out
    recordSale:           recordSale,
    recordDamage:         recordDamage,
    recordSupplierReturn: recordSupplierReturn,

    // Neutral
    adjust:               adjust,
    recordTransfer:       recordTransfer,

    // Query
    listTransactions:     listTransactions,
    getTransaction:       getTransaction,
    getProductMovement:   getProductMovement,
    getStockLevels:       getStockLevels,

    // Expose transaction type constants
    TYPES: TYPES
  };

})();
