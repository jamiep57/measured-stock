/**
 * Roles and feature access for Measured Stock.
 * Shared by the admin UI, the auth cookie, and the user API.
 * Sysadmin is always fully on and is not stored in the permission grid.
 */

export const ROLES = ['sysadmin', 'admin', 'manager', 'user'];

/** Roles an admin may assign. Sysadmin is assigned only by a sysadmin. */
export const ADMIN_ASSIGNABLE_ROLES = ['user', 'manager', 'admin'];

export const ROLE_LABELS = {
  sysadmin: 'Sysadmin',
  admin: 'Admin',
  manager: 'Manager',
  user: 'User',
};

/** Field-app capabilities. Anything else enabled for User opens the desktop app. */
export const FIELD_FEATURES = new Set([
  'stock.deliveries',
  'stock.counts',
  'stock.transfers',
  'stock.wastage',
  'kit.event',
]);

export const FEATURE_GROUPS = [
  {
    id: 'home',
    label: 'Home',
    features: [
      { key: 'home.dashboard', label: 'Dashboard' },
      { key: 'home.library', label: 'Library' },
      { key: 'home.accounts', label: 'Accounts' },
      { key: 'home.suppliers', label: 'Suppliers' },
      { key: 'home.warehouses', label: 'Warehouses' },
      { key: 'home.event_setup', label: 'Event setup' },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    features: [
      { key: 'planning.menu_gp', label: 'Menu & GP' },
      { key: 'planning.orders', label: 'Orders' },
      { key: 'planning.distribution', label: 'Distribution' },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    features: [
      { key: 'stock.products_view', label: 'Products' },
      { key: 'stock.products_edit', label: 'Edit product information' },
      { key: 'stock.deliveries', label: 'Deliveries' },
      { key: 'stock.counts', label: 'Counts' },
      { key: 'stock.transfers', label: 'Transfers' },
      { key: 'stock.wastage', label: 'Wastage' },
      { key: 'stock.closing', label: 'Closing' },
    ],
  },
  {
    id: 'kit',
    label: 'Kit',
    features: [
      { key: 'kit.library', label: 'Kit library' },
      { key: 'kit.event', label: 'Event kit' },
    ],
  },
  {
    id: 'square',
    label: 'Square and mapping',
    features: [
      { key: 'square.modifiers', label: 'Square & modifiers' },
      { key: 'square.volume_pools', label: 'Volume pools' },
    ],
  },
  {
    id: 'finance',
    label: 'Financials',
    features: [
      { key: 'finance.reports', label: 'Reports' },
      { key: 'finance.recon', label: 'Recon' },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    features: [
      { key: 'workspace.organisation', label: 'Organisation' },
      { key: 'workspace.users', label: 'Users' },
      { key: 'workspace.access', label: 'Access' },
      { key: 'workspace.history', label: 'Change history' },
      { key: 'workspace.categories', label: 'Product categories' },
      { key: 'workspace.case_sizes', label: 'Case sizes' },
    ],
  },
  {
    id: 'dev',
    label: 'Developer',
    developer: true,
    features: [
      { key: 'dev.bugs', label: 'Bug inbox' },
      { key: 'dev.audit', label: 'Forensic audit' },
      { key: 'dev.backup', label: 'Backup' },
    ],
  },
];

const MANAGER_OFF = new Set([
  'planning.menu_gp',
  'finance.reports',
  'finance.recon',
  'workspace.organisation',
  'workspace.users',
  'workspace.access',
  'workspace.history',
  'workspace.categories',
  'workspace.case_sizes',
]);

const USER_ON = new Set(['stock.deliveries', 'stock.counts']);

/** Admin cannot turn these off, so the organisation always keeps a way back in. */
export const ADMIN_LOCKED_ON = new Set(['workspace.users', 'workspace.access']);

const EVENT_PANEL_FEATURES = {
  dashboard: 'home.dashboard',
  setup: 'home.event_setup',
  planning: 'planning.menu_gp',
  orders: 'planning.orders',
  distribution: 'planning.distribution',
  products: 'stock.products_view',
  deliveries: 'stock.deliveries',
  counts: 'stock.counts',
  transfers: 'stock.transfers',
  wastage: 'stock.wastage',
  closing: 'stock.closing',
  kit: 'kit.event',
  sales: 'square.modifiers',
  reports: 'finance.reports',
  recon: 'finance.recon',
  summary: 'finance.reports',
};

const VIEW_FEATURES = {
  library: 'home.library',
  accounts: 'home.accounts',
  suppliers: 'home.suppliers',
  warehouses: 'home.warehouses',
  'kit-library': 'kit.library',
  'volume-pools': 'square.volume_pools',
  bugs: 'dev.bugs',
  audit: 'dev.audit',
  backup: 'dev.backup',
};

export const SETTINGS_FEATURES = {
  organisation: 'workspace.organisation',
  users: 'workspace.users',
  access: 'workspace.access',
  history: 'workspace.history',
  warehouses: 'home.warehouses',
  categories: 'workspace.categories',
  'case-sizes': 'workspace.case_sizes',
};

const EVENT_PANEL_ORDER = [
  'dashboard', 'products', 'deliveries', 'counts', 'transfers', 'wastage', 'closing',
  'orders', 'distribution', 'planning', 'kit', 'sales', 'reports', 'recon', 'setup',
];

const SETTINGS_ORDER = ['users', 'access', 'organisation', 'history', 'warehouses', 'categories', 'case-sizes'];

export function allFeatureKeys() {
  return FEATURE_GROUPS.flatMap((group) => group.features.map((feature) => feature.key));
}

/** @param {unknown} role */
export function normalizeRole(role) {
  const value = String(role || '');
  if (value === 'staff') return 'user';
  if (ROLES.includes(value)) return value;
  return 'user';
}

/** @param {unknown} role */
export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || 'User';
}

/** @param {unknown} role */
export function isOrgAdminRole(role) {
  const value = normalizeRole(role);
  return value === 'admin' || value === 'sysadmin';
}

/** @param {unknown} role */
export function isSysadminRole(role) {
  return normalizeRole(role) === 'sysadmin';
}

/**
 * @param {unknown} viewerRole
 * @returns {Array<{ value: string, label: string }>}
 */
export function assignableRoles(viewerRole) {
  const values = isSysadminRole(viewerRole)
    ? [...ADMIN_ASSIGNABLE_ROLES, 'sysadmin']
    : ADMIN_ASSIGNABLE_ROLES;
  return values.map((value) => ({ value, label: roleLabel(value) }));
}

/**
 * @param {unknown} role
 * @param {string} feature
 */
export function defaultEnabled(role, feature) {
  const value = normalizeRole(role);
  if (value === 'sysadmin') return true;
  if (String(feature).startsWith('dev.')) return false;
  if (value === 'admin') return true;
  if (value === 'manager') return !MANAGER_OFF.has(feature);
  if (value === 'user') return USER_ON.has(feature);
  return false;
}

/**
 * @param {unknown} role
 * @param {Array<{ role?: string, feature?: string, enabled?: boolean }>} [grants]
 */
export function needsDesktopShell(role, grants = []) {
  const value = normalizeRole(role);
  if (value !== 'user') return true;
  const enabled = new Map();
  for (const feature of allFeatureKeys()) {
    enabled.set(feature, defaultEnabled('user', feature));
  }
  for (const grant of grants) {
    if (grant?.role === 'user' && grant.feature) enabled.set(grant.feature, !!grant.enabled);
  }
  for (const [feature, on] of enabled) {
    if (on && !FIELD_FEATURES.has(feature)) return true;
  }
  return false;
}

/**
 * @param {unknown} viewerRole
 * @param {string} role
 * @param {string} feature
 */
export function canEditGrant(viewerRole, role, feature) {
  if (!isOrgAdminRole(viewerRole)) return false;
  if (role === 'sysadmin') return false;
  if (String(feature).startsWith('dev.') && !isSysadminRole(viewerRole)) return false;
  if (role === 'admin' && ADMIN_LOCKED_ON.has(feature)) return false;
  return true;
}

/** @param {{ view?: string, panel?: string, section?: string } | null | undefined} route */
export function featureForRoute(route) {
  if (!route) return null;
  if (route.view === 'home' || route.view === 'not-found') return null;
  if (route.view === 'event') return EVENT_PANEL_FEATURES[route.panel || 'dashboard'] || null;
  if (route.view === 'settings') return SETTINGS_FEATURES[route.section || 'users'] || null;
  if (route.view === 'dev') return null;
  return VIEW_FEATURES[route.view] || null;
}

/**
 * @param {{ view?: string, panel?: string, section?: string }} route
 * @param {(feature: string) => boolean} can
 */
export function routeAllowed(route, can) {
  if (!route || route.view === 'home' || route.view === 'not-found') return true;
  if (route.view === 'dev') return can('dev.bugs') || can('dev.audit') || can('dev.backup');
  const feature = featureForRoute(route);
  if (!feature) return true;
  return can(feature);
}

/**
 * @param {{ view?: string, eventId?: string, section?: string }} route
 * @param {(feature: string) => boolean} can
 */
export function fallbackRoute(route, can) {
  if (route?.view === 'event' && route.eventId) {
    const panel = EVENT_PANEL_ORDER.find((key) => can(EVENT_PANEL_FEATURES[key]));
    if (panel) return { view: 'event', eventId: route.eventId, panel };
  }
  if (route?.view === 'settings') {
    const section = SETTINGS_ORDER.find((key) => can(SETTINGS_FEATURES[key]));
    if (section) return { view: 'settings', section };
  }
  if (route?.view === 'dev' || route?.view === 'bugs' || route?.view === 'audit' || route?.view === 'backup') {
    if (can('dev.bugs')) return { view: 'bugs' };
    if (can('dev.audit')) return { view: 'audit' };
    if (can('dev.backup')) return { view: 'backup' };
  }
  const globals = [
    ['library', 'home.library'],
    ['accounts', 'home.accounts'],
    ['suppliers', 'home.suppliers'],
    ['warehouses', 'home.warehouses'],
    ['kit-library', 'kit.library'],
    ['volume-pools', 'square.volume_pools'],
  ];
  const view = globals.find(([, feature]) => can(feature));
  if (view) return { view: view[0] };
  return { view: 'home' };
}

/** @param {(feature: string) => boolean} can */
export function firstSettingsSection(can) {
  return SETTINGS_ORDER.find((key) => can(SETTINGS_FEATURES[key])) || null;
}
