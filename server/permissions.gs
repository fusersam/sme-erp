/**
 * Permissions Service
 * ====================
 * UI-level permission checks and menu visibility control.
 * Works in tandem with AuthService for granular access control.
 */

var PermissionsService = (function() {
  
  // Define which navigation items each role can see
  var NAV_PERMISSIONS = {
    'Administrator': ['dashboard', 'accounting', 'inventory', 'sales', 'purchasing', 
                      'expenses', 'cashbank', 'payroll', 'assets', 'reports', 'settings', 'users'],
    'Accountant':    ['dashboard', 'accounting', 'sales', 'purchasing', 'expenses', 
                      'cashbank', 'payroll', 'assets', 'reports'],
    'Inventory Officer': ['dashboard', 'inventory', 'purchasing', 'reports'],
    'Sales Officer': ['dashboard', 'sales', 'inventory', 'reports'],
    'HR Officer':    ['dashboard', 'payroll', 'reports'],
    'Viewer':        ['dashboard', 'reports']
  };
  
  /**
   * Get the navigation items the current user can see.
   * @returns {string[]} Array of module keys
   */
  function getVisibleModules() {
    var user = AuthService.getCurrentUser();
    if (!user) return [];
    return NAV_PERMISSIONS[user.role] || ['dashboard'];
  }
  
  /**
   * Check if the current user can see a specific module.
   * @param {string} module
   * @returns {boolean}
   */
  function canAccessModule(module) {
    return getVisibleModules().indexOf(module) !== -1;
  }
  
  /**
   * Check if the current user can create records in a module.
   * @param {string} module
   * @returns {boolean}
   */
  function canCreate(module) {
    return AuthService.hasPermission(module, 'create');
  }
  
  /**
   * Check if the current user can edit records in a module.
   * @param {string} module
   * @returns {boolean}
   */
  function canEdit(module) {
    return AuthService.hasPermission(module, 'update');
  }
  
  /**
   * Check if the current user can delete records in a module.
   * @param {string} module
   * @returns {boolean}
   */
  function canDelete(module) {
    return AuthService.hasPermission(module, 'delete');
  }
  
  /**
   * Get complete permission set for the current user (for client-side).
   * @returns {Object}
   */
  function getClientPermissions() {
    var user = AuthService.getCurrentUser();
    if (!user) return { modules: [], canCreate: false, canEdit: false, canDelete: false, isAdmin: false };
    
    return {
      role: user.role,
      modules: getVisibleModules(),
      isAdmin: user.role === 'Administrator',
      canCreate: user.role !== 'Viewer',
      canEdit: user.role !== 'Viewer',
      canDelete: user.role === 'Administrator'
    };
  }
  
  return {
    getVisibleModules: getVisibleModules,
    canAccessModule: canAccessModule,
    canCreate: canCreate,
    canEdit: canEdit,
    canDelete: canDelete,
    getClientPermissions: getClientPermissions,
    NAV_PERMISSIONS: NAV_PERMISSIONS
  };
  
})();
