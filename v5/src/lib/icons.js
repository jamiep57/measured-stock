/**
 * Lucide icons — tree-shaken SVG helpers for v5 admin.
 * @see https://lucide.dev/
 */

import { createElement, createIcons } from 'lucide';
import {
  Archive,
  BookOpen,
  Building2,
  Calculator,
  Calendar,
  CircleAlert,
  LockOpen,
  Sparkles,
  ClipboardCheck,
  Contact,
  Copy,
  FileSpreadsheet,
  History,
  Mail,
  Megaphone,
  Phone,
  Receipt,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Wallet,
  ArrowLeft,
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
  Folder,
  Funnel,
  Pencil,
  Gauge,
  GlassWater,
  House,
  Image,
  Layers,
  Library,
  List,
  ListSortDescending,
  Lock,
  LogOut,
  Martini,
  Maximize2,
  Merge,
  Package,
  PieChart,
  Plus,
  PoundSterling,
  Printer,
  Redo2,
  RefreshCw,
  Rows3,
  Save,
  ScanBarcode,
  Search,
  Settings,
  Share2,
  Store,
  Trash2,
  Truck,
  Upload,
  Undo2,
  User,
  WandSparkles,
  Warehouse,
  X,
} from 'lucide';

/** Square’s mark: rounded frame with a square in the middle. Filled, so it stays the logo at 16px. */
const SquareLogo = [
  ['path', {
    fill: 'currentColor',
    stroke: 'none',
    'fill-rule': 'evenodd',
    d: 'M6.1 1.2h11.8c2.7 0 4.9 2.2 4.9 4.9v11.8c0 2.7-2.2 4.9-4.9 4.9H6.1c-2.7 0-4.9-2.2-4.9-4.9V6.1c0-2.7 2.2-4.9 4.9-4.9zm.55 4.55h10.7c.85 0 1.55.7 1.55 1.55v9.4c0 .85-.7 1.55-1.55 1.55H6.65c-.85 0-1.55-.7-1.55-1.55V7.3c0-.85.7-1.55 1.55-1.55zM9.35 9.35h5.3v5.3h-5.3z',
  }],
];

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
  'arrow-left': ArrowLeft,
  'arrow-left-right': ArrowLeftRight,
  trash: Trash2,
  lock: Lock,
  martini: Martini,
  'glass-water': GlassWater,
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
  save: Save,
  square: SquareLogo,
  upload: Upload,
  download: Download,
  'file-text': FileText,
  folder: Folder,
  printer: Printer,
  'rows-3': Rows3,
  'maximize-2': Maximize2,
  merge: Merge,
  'wand-sparkles': WandSparkles,
  ellipsis: Ellipsis,
  search: Search,
  'scan-barcode': ScanBarcode,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevrons-up-down': ChevronsUpDown,
  user: User,
  archive: Archive,
  'book-open': BookOpen,
  'building-2': Building2,
  calculator: Calculator,
  calendar: Calendar,
  'circle-alert': CircleAlert,
  'lock-open': LockOpen,
  sparkles: Sparkles,
  'clipboard-check': ClipboardCheck,
  contact: Contact,
  copy: Copy,
  'file-spreadsheet': FileSpreadsheet,
  history: History,
  mail: Mail,
  megaphone: Megaphone,
  phone: Phone,
  receipt: Receipt,
  'shopping-cart': ShoppingCart,
  target: Target,
  'trending-up': TrendingUp,
  users: Users,
  wallet: Wallet,
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
