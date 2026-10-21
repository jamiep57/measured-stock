/**
 * Reports library. Each entry is a named report with the formats it can
 * produce and the feature flag of the page that already owns that export.
 * Entries with no feature are part of Reports itself (`finance.reports`).
 */

export const REPORT_FORMATS = {
  csv: { action: 'export-csv', label: 'CSV', menu: 'Export CSV', icon: 'download' },
  pdf: { action: 'export-pdf', label: 'PDF', menu: 'Export PDF', icon: 'file-text' },
  xlsx: { action: 'export-xlsx', label: 'Excel', menu: 'Export Excel', icon: 'download' },
  invoice: { action: 'export-invoice', label: 'Invoice', menu: 'Export invoice', icon: 'file-text' },
};

export const REPORT_GROUPS = ['Sales', 'Clients', 'Purchasing', 'Stock', 'Menus'];

export const REPORT_CATALOG = [
  {
    id: 'headlines',
    group: 'Sales',
    icon: 'trending-up',
    title: 'Headlines',
    description: 'Gross, net, items and the best of the event, from till sales.',
    formats: ['csv', 'pdf'],
    feature: null,
    filters: true,
  },
  {
    id: 'sales',
    group: 'Sales',
    icon: 'bar-chart-3',
    title: 'Sales',
    description: 'Net, gross and items grouped by product, category, location, date or event.',
    formats: ['csv'],
    feature: null,
    filters: true,
  },
  {
    id: 'revenue',
    group: 'Sales',
    icon: 'pie-chart',
    title: 'Revenue & GP',
    description: 'Forecast against actual serves, cost and gross profit.',
    formats: ['csv'],
    feature: null,
    filters: false,
  },
  {
    id: 'loose',
    group: 'Sales',
    icon: 'glass-water',
    title: 'Loose stock',
    description: 'Loose units against allowances, and what is still chargeable.',
    formats: ['csv', 'pdf'],
    feature: null,
    filters: false,
  },
  {
    id: 'volume',
    group: 'Sales',
    icon: 'layers',
    title: 'Volume by category',
    description: 'PLU, PLU with 5% uplift, and physical consumption, grouped by category.',
    formats: ['xlsx'],
    feature: null,
    filters: false,
  },
  {
    id: 'clients',
    group: 'Clients',
    icon: 'users',
    title: 'Transfers by client',
    description: 'What went to each client, with invoice prices and a hidden markup.',
    ready: true,
    formats: ['csv', 'invoice'],
    feature: null,
    filters: true,
  },
  {
    id: 'suppliers',
    group: 'Purchasing',
    icon: 'truck',
    title: 'Cost Price by Supplier',
    description: 'Stock received from each supplier, with the case price on each product and the cost total.',
    formats: ['csv'],
    feature: null,
    filters: true,
  },
  {
    id: 'orders',
    group: 'Purchasing',
    icon: 'shopping-cart',
    title: 'Purchase orders',
    description: 'Every purchase order on this event, with the supplier PDF on each row.',
    formats: ['csv'],
    feature: 'planning.orders',
    filters: true,
  },
  {
    id: 'recon',
    group: 'Stock',
    icon: 'clipboard-check',
    title: 'Post-event recon',
    description: 'The same reconciliation spreadsheet downloaded from Recon.',
    formats: ['csv'],
    feature: 'finance.recon',
    filters: false,
  },
  {
    id: 'deliveries',
    group: 'Stock',
    icon: 'package',
    title: 'Deliveries',
    description: 'Stock received on this event: supplier, reference and quantity.',
    formats: ['csv'],
    feature: 'stock.deliveries',
    filters: true,
  },
  {
    id: 'wastage',
    group: 'Stock',
    icon: 'trash',
    title: 'Wastage',
    description: 'Write-offs logged on this event, priced at event stock cost.',
    ready: true,
    formats: ['csv'],
    feature: 'stock.wastage',
    filters: true,
  },
  {
    id: 'transfers',
    group: 'Stock',
    icon: 'arrow-left-right',
    title: 'Transfers',
    description: 'Every transfer as its own group, with each product and its quantity.',
    ready: true,
    formats: ['csv'],
    feature: 'stock.transfers',
    filters: true,
  },
  {
    id: 'counts',
    group: 'Stock',
    icon: 'clipboard-list',
    title: 'Stock counts',
    description: 'Each count session. Open one to see the products, cases and singles.',
    formats: ['csv'],
    feature: 'stock.counts',
    filters: true,
  },
  {
    id: 'closing',
    group: 'Stock',
    icon: 'archive',
    title: 'Closing stock',
    description: 'Closing cases and singles, with a pallet sticker when cases were counted.',
    formats: ['csv'],
    feature: 'stock.closing',
    filters: false,
  },
  {
    id: 'products',
    group: 'Stock',
    icon: 'list',
    title: 'Event products',
    description: 'The opening list for this event: pack, ABV and opening quantity.',
    formats: ['csv'],
    feature: 'stock.products_view',
    filters: false,
  },
  {
    id: 'menu-designer',
    group: 'Menus',
    icon: 'book-open',
    title: 'Designer menu',
    description: 'Menu copy with names, serve sizes, ABV and prices, and which bars serve each drink.',
    formats: ['pdf', 'xlsx', 'csv'],
    feature: 'planning.menu_gp',
    filters: false,
  },
  {
    id: 'menu-client',
    group: 'Menus',
    icon: 'contact',
    title: 'Client pack',
    description: 'Product mix, menu prices and pricing scenarios. Internal cost and GP stay off unless an admin includes them.',
    formats: ['pdf', 'xlsx', 'csv'],
    feature: 'planning.menu_gp',
    filters: false,
  },
  {
    id: 'menu-sor',
    group: 'Menus',
    icon: 'receipt',
    title: 'Schedule of rates',
    description: 'Agreed products, units and rates.',
    formats: ['pdf', 'xlsx', 'csv'],
    feature: 'planning.menu_gp',
    filters: true,
  },
  {
    id: 'menu-rate-card',
    group: 'Menus',
    icon: 'wallet',
    title: '3rd Party Rate card',
    description: 'Each serve at its cost, plus a margin you choose.',
    formats: ['pdf', 'xlsx', 'csv'],
    feature: 'planning.menu_gp',
    filters: false,
  },
];

export function reportById(id) {
  return REPORT_CATALOG.find((entry) => entry.id === id) || null;
}

/** @param {(feature: string) => boolean} can */
export function visibleReports(can) {
  return REPORT_CATALOG.filter((entry) => !entry.feature || can(entry.feature));
}

export function formatSpec(key) {
  return REPORT_FORMATS[key] || null;
}
