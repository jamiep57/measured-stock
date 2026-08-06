/**
 * Lucide icons — tree-shaken SVG helpers for v5 admin.
 * @see https://lucide.dev/
 */

import { createElement, createIcons } from 'lucide';
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  Columns3,
  Container,
  Camera,
  CornerUpLeft,
  Download,
  Ellipsis,
  FileText,
  Funnel,
  Pencil,
  Gauge,
  House,
  Image,
  Layers,
  Library,
  List,
  ListSortDescending,
  Lock,
  LogOut,
  Maximize2,
  Package,
  PieChart,
  Plus,
  PoundSterling,
  Printer,
  Redo2,
  RefreshCw,
  Rows3,
  ScanBarcode,
  Search,
  Settings,
  Share2,
  Store,
  Trash2,
  Truck,
  Upload,
  Undo2,
  WandSparkles,
  Warehouse,
  X,
} from 'lucide';

/** @type {Record<string, import('lucide').IconNode>} */
const iconsByKebab = {
  house: House,
  image: Image,
  library: Library,
  layers: Layers,
  truck: Truck,
  package: Package,
  boxes: Boxes,
  bug: Bug,
  gauge: Gauge,
  settings: Settings,
  'log-out': LogOut,
  list: List,
  warehouse: Warehouse,
  'share-2': Share2,
  container: Container,
  'clipboard-list': ClipboardList,
  'bar-chart-3': BarChart3,
  'arrow-left-right': ArrowLeftRight,
  trash: Trash2,
  lock: Lock,
  store: Store,
  'pound-sterling': PoundSterling,
  'pie-chart': PieChart,
  funnel: Funnel,
  pencil: Pencil,
  camera: Camera,
  x: X,
  plus: Plus,
  columns: Columns3,
  'list-sort-descending': ListSortDescending,
  'undo-2': Undo2,
  'redo-2': Redo2,
  'corner-up-left': CornerUpLeft,
  'refresh-cw': RefreshCw,
  upload: Upload,
  download: Download,
  'file-text': FileText,
  printer: Printer,
  'rows-3': Rows3,
  'maximize-2': Maximize2,
  'wand-sparkles': WandSparkles,
  ellipsis: Ellipsis,
  search: Search,
  'scan-barcode': ScanBarcode,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevrons-up-down': ChevronsUpDown,
};

function toCamelCase(name) {
  return name.replace(/^([A-Z])|[\s-_]+(\w)/g, (match, p1, p2) => (
    p2 ? p2.toUpperCase() : p1.toLowerCase()
  ));
}

function toPascalCase(name) {
  const camel = toCamelCase(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** PascalCase keys — required by lucide `createIcons()` lookup. */
const iconsByPascal = Object.fromEntries(
  Object.entries(iconsByKebab).map(([kebab, node]) => [toPascalCase(kebab), node]),
);

/**
 * Render a Lucide icon as an SVG string (for HTML templates).
 * @param {string} name — kebab-case key (e.g. "funnel", "list-sort-descending")
 * @param {{ size?: number, class?: string, strokeWidth?: number }} [opts]
 */
export function icon(name, opts = {}) {
  const Icon = iconsByKebab[name];
  if (!Icon) return '';

  const { size = 16, class: className = '', strokeWidth = 1.75 } = opts;
  const svg = createElement(Icon);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', ['lucide-icon', className].filter(Boolean).join(' '));
  return svg.outerHTML;
}

/** Hydrate `[data-lucide]` placeholders in static HTML. */
export function initIcons(root = document) {
  createIcons({
    icons: iconsByPascal,
    nameAttr: 'data-lucide',
    attrs: {
      class: 'lucide-icon',
      'stroke-width': 1.75,
    },
    root,
  });
}
