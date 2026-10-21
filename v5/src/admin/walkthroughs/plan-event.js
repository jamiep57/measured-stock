/**
 * Plan-an-event tour steps.
 * Targets are resolved when a step is shown. Nothing here writes menu lines or orders.
 */

import { openEventNextAction } from '../walkthrough-model.js';

function shown(el) {
  if (!el || !el.isConnected) return null;
  if (el.closest('[hidden]')) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return el;
}

function eventSectionOpen() {
  const section = document.querySelector('.sidebar-section[data-section="event-planning"]');
  return !!section && !section.hidden;
}

function onHome() {
  return !!document.querySelector('.home-page');
}

function homeHasEvents() {
  return !!document.querySelector('.home-page .event-card');
}

function workspaceHasEvents() {
  return !!document.querySelector('#sidebarWorkspaceMenu [data-workspace="event"]');
}

function eventName() {
  return document.getElementById('sidebarWorkspaceName')?.textContent?.trim() || 'this event';
}

function planningLink() {
  return shown(document.querySelector('#sidebarEventPlanning a[data-route="planning"]'));
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

export function planEventSteps() {
  return [
    {
      id: 'open-event',
      title: 'Open an event',
      autoAdvance: true,
      passthrough: true,
      body() {
        if (eventSectionOpen()) {
          return `You're in ${eventName()}. Prices, orders, and stock for the job all live in this workspace. Switch events from here.`;
        }
        if (onHome() && !homeHasEvents()) {
          return 'Create an event when you are ready. You can do that now, or continue and come back once one exists.';
        }
        if (homeHasEvents()) {
          return 'Open an event from this switcher, or from the grid. Planning stays in the sidebar once an event is selected.';
        }
        return 'Choose an event from this switcher. Planning appears in the sidebar after you do.';
      },
      target() {
        if (!eventSectionOpen() && onHome() && !homeHasEvents()) {
          return shown(document.getElementById('homeNewEvent'));
        }
        return shown(document.getElementById('sidebarWorkspace'));
      },
      route: { needsEvent: true },
      finishOnNext() {
        return openEventNextAction({
          eventOpen: eventSectionOpen(),
          hasEvents: homeHasEvents() || workspaceHasEvents(),
        });
      },
      arm() {
        const open = eventSectionOpen();
        return { autoAdvance: !open, passthrough: !open };
      },
    },
    {
      id: 'menu-nav',
      feature: 'planning.menu_gp',
      title: 'Menu & GP',
      autoAdvance: true,
      route: { view: 'event', panel: 'planning' },
      destination: eventRoute('planning'),
      body: 'Menu & GP is where this event’s prices and margins are set. Adding a product here also adds it to Opening stock, with nothing ordered yet.',
      target: planningLink,
    },
    {
      id: 'add-menu',
      feature: 'planning.menu_gp',
      title: 'Add to the menu',
      ensure: true,
      route: { view: 'event', panel: 'planning' },
      destination: eventRoute('planning'),
      body: 'Add a product from the library, or use Recipe builder for a drink sold as one item and costed from its ingredients.',
      target() {
        return shown(document.querySelector('[data-toolbar-menu="plan-add"]'))
          || shown(document.querySelector('[data-add-product]'));
      },
    },
    {
      id: 'price-gp',
      feature: 'planning.menu_gp',
      title: 'Price and GP',
      ensure: true,
      route: { view: 'event', panel: 'planning' },
      destination: eventRoute('planning'),
      body() {
        const totals = shown(document.getElementById('planKpis'));
        if (totals) {
          return 'Menu price, the GP badge, and target serves roll up into these totals. Target GP % for the event is in the settings control beside Add.';
        }
        return 'Once a product is on the menu, its price, GP, and target serves show up here. Target GP % for the event is in the settings control beside Add.';
      },
      target() {
        return shown(document.getElementById('planKpis'))
          || shown(document.querySelector('#planPanel .empty'))
          || shown(document.querySelector('[data-add-product]'));
      },
    },
    {
      id: 'orders-nav',
      feature: 'planning.orders',
      title: 'Orders',
      autoAdvance: true,
      route: { view: 'event', panel: 'orders' },
      destination: eventRoute('orders'),
      body: 'Orders turns target serves into cases and purchase orders. An order records what you asked a supplier for. Only a delivery creates stock.',
      target: ordersLink,
    },
    {
      id: 'projections',
      feature: 'planning.orders',
      title: 'Projections',
      ensure: true,
      route: { view: 'event', panel: 'orders' },
      destination: eventRoute('orders'),
      body: 'Set a target revenue. Each line’s share of that target, divided by its menu price, becomes the serves you plan to sell.',
      ready: () => !!shown(document.querySelector('[data-ord-tab="take"]')),
      prepare: () => selectOrdersTab('take'),
      target() {
        return shown(document.getElementById('ordTarget'))
          || shown(document.querySelector('[data-ord-tab="take"]'));
      },
    },
    {
      id: 'shortfalls',
      feature: 'planning.orders',
      title: 'What is still short',
      ensure: true,
      route: { view: 'event', panel: 'orders' },
      destination: eventRoute('orders'),
      body: 'This grid compares the cases you need with what you have already ordered. Short rows still need a purchase order. New order in the top bar starts a blank one.',
      ready: () => !!shown(document.querySelector('[data-ord-tab="orders"]')),
      prepare: () => selectOrdersTab('orders'),
      target() {
        return shown(document.getElementById('ordGrid'))
          || shown(document.querySelector('[data-ord-tab="orders"]'));
      },
    },
    {
      id: 'ledger',
      feature: 'planning.orders',
      title: 'Where orders live',
      ensure: true,
      route: { view: 'event', panel: 'orders' },
      destination: eventRoute('orders'),
      body: 'Raised orders are listed here. Open one to review it, then send or confirm it when you are ready.',
      ready: () => !!shown(document.querySelector('[data-ord-tab="ledger"]')),
      prepare: () => selectOrdersTab('ledger'),
      target() {
        return shown(document.querySelector('[data-ord-tab="ledger"]'));
      },
    },
  ];
}
