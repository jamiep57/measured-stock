/**
 * Plan-an-event tour steps on a hidden practice event.
 * Action steps wait until the user does the work. Nothing here writes data.
 */

function shown(el) {
  if (!el || !el.isConnected) return null;
  if (el.closest('[hidden]')) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return el;
}

function ordersLink() {
  return shown(document.querySelector('#sidebarEventPlanning a[data-route="orders"]'));
}

function eventRoute(panel) {
  return (eventId) => (eventId ? { view: 'event', eventId, panel } : null);
}

function selectOrdersTab(id) {
  const tab = document.querySelector(`[data-ord-tab="${id}"]`);
  if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
}

function menuHasLine() {
  return !!shown(document.querySelector('#planBody tr, #planGrid tbody tr'));
}

function menuPriceFilled() {
  const input = document.querySelector('#planGrid [data-field="menu_price"]');
  if (!shown(input)) return false;
  const n = Number(String(input.value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0;
}

function targetRevenueFilled() {
  const input = document.getElementById('ordTarget');
  if (!shown(input)) return false;
  const n = Number(String(input.value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0;
}

function orderExists() {
  return !!shown(document.querySelector('[data-open-po], .ord-rail-row'));
}

export function planEventSteps() {
  return [
    {
      id: 'create-event',
      title: 'Create an event',
      ensure: true,
      route: { view: 'home' },
      destination: () => ({ view: 'home' }),
      body: 'Every job starts with an event. Click New event, give it a name, and create it. This one is practice — it stays off your event list.',
      target() {
        return shown(document.getElementById('homeNewEvent'))
          || shown(document.getElementById('homeEmptyCreate'));
      },
      complete: () => false,
    },
    {
      id: 'add-menu',
      feature: 'planning.menu_gp',
      title: 'Add a product',
      ensure: true,
      route: { view: 'event', panel: 'planning' },
      destination: eventRoute('planning'),
      body: 'Open Add and pick a product from the library, or type a name to create one. Adding it here also puts it on Opening stock. The tour continues once it is on the menu.',
      target() {
        return shown(document.querySelector('[data-toolbar-menu="plan-add"]'))
          || shown(document.querySelector('[data-add-product]'));
      },
      complete: menuHasLine,
    },
    {
      id: 'price-gp',
      feature: 'planning.menu_gp',
      title: 'Set a menu price',
      ensure: true,
      route: { view: 'event', panel: 'planning' },
      destination: eventRoute('planning'),
      body: 'Type a selling price in Menu price. That figure, with cost and target serves, is what GP is calculated from.',
      target() {
        return shown(document.querySelector('#planGrid [data-field="menu_price"]'))
          || shown(document.getElementById('planKpis'));
      },
      complete: menuPriceFilled,
    },
    {
      id: 'orders-nav',
      feature: 'planning.orders',
      title: 'Orders',
      autoAdvance: true,
      route: { view: 'event', panel: 'orders' },
      destination: eventRoute('orders'),
      body: 'Open Orders. Target serves become cases here. An order is what you asked a supplier for. Only a delivery creates stock.',
      target: ordersLink,
    },
    {
      id: 'projections',
      feature: 'planning.orders',
      title: 'Set a target revenue',
      ensure: true,
      route: { view: 'event', panel: 'orders' },
      destination: eventRoute('orders'),
      body: 'Type a target revenue, for example 10000. Each line’s share of that target, divided by its menu price, becomes the serves you plan to sell.',
      ready: () => !!shown(document.querySelector('[data-ord-tab="take"]')),
      prepare: () => selectOrdersTab('take'),
      target() {
        return shown(document.getElementById('ordTarget'))
          || shown(document.querySelector('[data-ord-tab="take"]'));
      },
      complete: targetRevenueFilled,
    },
    {
      id: 'raise-order',
      feature: 'planning.orders',
      title: 'Raise a purchase order',
      ensure: true,
      route: { view: 'event', panel: 'orders' },
      destination: eventRoute('orders'),
      body: 'Open Purchase orders. Click New order, or the cart on a short row, and save a draft. The tour continues once an order exists.',
      ready: () => !!shown(document.querySelector('[data-ord-tab="orders"]')),
      prepare: () => selectOrdersTab('orders'),
      target() {
        return shown(document.querySelector('[data-po-action="raise"]:not([disabled])'))
          || shown(document.querySelector('[data-toolbar-action="orders-new"]'))
          || shown(document.querySelector('[data-ord-tab="orders"]'));
      },
      complete: orderExists,
    },
    {
      id: 'ledger',
      feature: 'planning.orders',
      title: 'Where orders live',
      ensure: true,
      route: { view: 'event', panel: 'orders' },
      destination: eventRoute('orders'),
      body: 'Raised orders are listed here. Open one to review it, then send or confirm it when you are ready. Practice stays on this hidden event.',
      ready: () => !!shown(document.querySelector('[data-ord-tab="ledger"]')),
      prepare: () => selectOrdersTab('ledger'),
      target() {
        return shown(document.querySelector('.ord-rail-row, [data-open-po]'))
          || shown(document.querySelector('[data-ord-tab="ledger"]'));
      },
    },
  ];
}
