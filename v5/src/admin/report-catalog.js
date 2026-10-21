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
  json: { action: 'export-json', label: 'JSON', menu: 'Export JSON', icon: 'download' },
  print: { action: 'export-print', label: 'Print', menu: 'Print', icon: 'printer' },
};

export const REPORT_GROUPS = ['Sales', 'Clients', 'Purchasing', 'Stock', 'Menus', 'Documents'];

export const REPORT_CATALOG = [
  {
    id: 'headlines',
    group: 'Sales',
    title: 'Headlines',
    description: 'Gross, net, items and the best of the event, from till sales.',
    formats: ['csv', 'pdf'],
    feature: null,
    filters: true,
  },
  {
    id: 'sales',
    group: 'Sales',
    title: 'Sales',
    description: 'Net, gross and items grouped by product, category, location, date or event.',
    formats: ['csv'],
    feature: null,
    filters: true,
  },
  {
    id: 'revenue',
    group: 'Sales',
    title: 'Revenue & GP',
    description: 'Forecast against actual serves, cost and gross profit.',
    formats: ['csv'],
    feature: null,
    filters: false,
  },
  {
    id: 'loose',
    group: 'Sales',
    title: 'Loose stock',
    description: 'Loose units against allowances, and what is still chargeable.',
    formats: ['csv', 'pdf'],
    feature: null,
    filters: false,
  },
  {
    id: 'volume',
    group: 'Sales',
    title: 'Volume by category',
    description: 'PLU, PLU with 5% uplift, and physical consumption, grouped by category.',
    formats: ['xlsx'],
    feature: null,
    filters: false,
  },
  {
    id: 'clients',
    group: 'Clients',
    title: 'Transfers by client',
    description: 'What went to each client, with invoice prices and a hidden markup.',
    formats: ['csv', 'invoice'],
    feature: null,
    filters: true,
  },
  {
    id: 'suppliers',
    group: 'Purchasing',
    title: 'Supplier delivery cost',
    description: 'What stock cost coming in from suppliers, by supplier or by delivery.',
    formats: ['csv'],
    feature: null,
    filters: true,
  },
  {
    id: 'orders',
    group: 'Purchasing',
    title: 'Purchase orders',
    description: 'Every purchase order on this event, with the supplier PDF on each row.',
    formats: ['csv'],
    feature: 'planning.orders',
    filters: true,
  },
  {
    id: 'recon',
    group: 'Stock',
    title: 'Post-event recon',
    description: 'The same reconciliation spreadsheet downloaded from Recon.',
    formats: ['csv'],
    feature: 'finance.recon',
    filters: false,
  },
  {
    id: 'deliveries',
    group: 'Stock',
    title: 'Deliveries',
    description: 'Stock received on this event: supplier, reference and quantity.',
    formats: ['csv'],
    feature: 'stock.deliveries',
    filters: true,
  },
  {
    id: 'wastage',
    group: 'Stock',
    title: 'Wastage',
    description: 'Write-offs logged on this event, priced at event stock cost.',
    formats: ['csv'],
    feature: 'stock.wastage',
    filters: true,
  },
  {
    id: 'transfers',
    group: 'Stock',
    title: 'Transfers',
    description: 'Every transfer, with a delivery note on each row.',
    formats: ['csv'],
    feature: 'stock.transfers',
    filters: true,
  },
  {
    id: 'counts',
    group: 'Stock',
    title: 'Stock counts',
    description: 'Counted cases and singles from each count session.',
    formats: ['csv'],
    feature: 'stock.counts',
    filters: true,
  },
  {
    id: 'closing',
    group: 'Stock',
    title: 'Closing stock',
    description: 'Closing cases and singles, with a pallet sticker when cases were counted.',
    formats: ['csv'],
    feature: 'stock.closing',
    filters: false,
  },
  {
    id: 'products',
    group: 'Stock',
    title: 'Event products',
    description: 'The opening list for this event: pack, ABV and opening quantity.',
    formats: ['csv'],
    feature: 'stock.products_view',
    filters: false,
  },
  {
    id: 'menu-designer',
    group: 'Menus',
    title: 'Designer menu',
    description: 'Menu copy with names, serve sizes, ABV and prices.',
    formats: ['pdf', 'xlsx', 'csv'],
    feature: 'planning.menu_gp',
    filters: false,
  },
  {
    id: 'menu-client',
    group: 'Menus',
    title: 'Client pack',
    description: 'Product mix, menu prices and pricing scenarios. Internal cost and GP stay off unless an admin includes them.',
    formats: ['pdf', 'xlsx', 'csv'],
    feature: 'planning.menu_gp',
    filters: false,
  },
  {
    id: 'menu-sor',
    group: 'Menus',
    title: 'Schedule of rates',
    description: 'Agreed products, units and rates.',
    formats: ['pdf', 'xlsx', 'csv'],
    feature: 'planning.menu_gp',
    filters: true,
  },
  {
    id: 'count-sheets',
    group: 'Documents',
    title: 'Count sheets',
    description: 'Blank paper count sheets for all locations, the whole event, or one bar.',
    formats: ['print'],
    feature: 'stock.counts',
    filters: true,
  },
  {
    id: 'closing-sheets',
    group: 'Documents',
    title: 'Closing sheets',
    description: 'Blank closing count sheets for all locations, the whole event, or one bar.',
    formats: ['print'],
    feature: 'stock.closing',
    filters: true,
  },
  {
    id: 'audit',
    group: 'Documents',
    title: 'Forensic audit',
    description: 'Software integrity findings for this event, as a JSON download.',
    formats: ['json'],
    feature: 'dev.audit',
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
