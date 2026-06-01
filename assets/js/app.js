// ============================================================
// DATA STORE — MULTI-EVENT + CLOUD SYNC
// ============================================================
const DEFAULT_CATEGORIES = ['Beer','Cider','Wine','Sparkling Wine','Spirit & Mixer','RTDs','Canned Cocktails','Hard Seltzer','Shots','Cocktails','Soft Drinks'];
const DEFAULT_KIT_CATEGORIES = ['Structures','Power','AV & Lighting','Staging','Furniture','Fencing','Consumables','Safety','Signage','Other'];

function blankEvent(name, type, linkedId) {
  return {
    id: uid(),
    showName: name || 'New Event',
    showDates: '',
    type: type || 'stock',      // 'stock' | 'kit'
    linkedId: linkedId || null, // ID of the paired event
    bars: [],
    suppliers: [],
    recipients: [],
    categories: type === 'kit' ? [...DEFAULT_KIT_CATEGORIES] : [...DEFAULT_CATEGORIES],
    products: [],
    opening: {},
    distribution: {},
    counts: [],
    transfers: [],
    topups: [],
    wastage: [],
    closing: {},
  };
}

// Returns the linked (paired) event, or null
function getLinkedEvent() {
  if (!state.linkedId) return null;
  return appData.events[state.linkedId] || null;
}

// Returns the stock event of the current pair
function getStockEvent() {
  if (state.type === 'stock') return state;
  return getLinkedEvent();
}

// Returns the kit event of the current pair
function getKitEvent() {
  if (state.type === 'kit') return state;
  return getLinkedEvent();
}

// Returns all event IDs that belong to the same pair as the given event
function getPairIds(eventId) {
  const ev = appData.events[eventId];
  if (!ev) return [eventId];
  const ids = [eventId];
  if (ev.linkedId && appData.events[ev.linkedId]) ids.push(ev.linkedId);
  return ids;
}

// Groups events into pairs for the sidebar
function getEventPairs() {
  const seen = new Set();
  const pairs = [];
  Object.values(appData.events).forEach(ev => {
    if (seen.has(ev.id)) return;
    if (ev.type === 'stock' || !ev.type) {
      const kit = ev.linkedId ? appData.events[ev.linkedId] : null;
      pairs.push({ stock: ev, kit });
      seen.add(ev.id);
      if (kit) seen.add(kit.id);
    } else if (ev.type === 'kit') {
      // orphan kit (no linked stock) — show anyway
      if (!ev.linkedId || !appData.events[ev.linkedId]) {
        pairs.push({ stock: null, kit: ev });
        seen.add(ev.id);
      }
    }
  });
  return pairs;
}

// Top-level storage: { currentEventId, events: {id: eventObj}, recipes: [] }
// `recipes` is a global library shared across every event, synced to Supabase as a
// reserved row in the existing stock_events table (id = '__recipes__'), so the user
// never needs to run any SQL.
let appData = { currentEventId: null, events: {}, recipes: [] };
let state = blankEvent('My First Event'); // active event — alias into appData.events[currentId]

// Reserved row ids used to store global (non-event) data inside stock_events.
// Any row whose id starts with `__` is treated as reserved and never shown
// in the event switcher / event list. This lets us sync app-wide data
// (recipes, bug reports, …) without creating extra Supabase tables.
const RECIPES_ROW_ID = '__recipes__';
const BUGS_ROW_ID    = '__bugs__';
function isReservedRow(id) { return typeof id === 'string' && id.startsWith('__'); }

let editingProductId = null;
let activeCountSessionId = null;
let activeCountBar = null;
let currentMode = 'stock'; // 'stock' | 'kit'

function toggleModeGroup(mode) {
  const stockGroup = document.getElementById('modeGroup-stock');
  const kitGroup   = document.getElementById('modeGroup-kit');
  const stockHdr   = document.getElementById('modeHeader-stock');
  const kitHdr     = document.getElementById('modeHeader-kit');
  const stockChev  = document.getElementById('modeChevron-stock');
  const kitChev    = document.getElementById('modeChevron-kit');

  const isOpen = document.getElementById('modeGroup-' + mode).style.display !== 'none';

  // Close both
  if (stockGroup) stockGroup.style.display = 'none';
  if (kitGroup)   kitGroup.style.display   = 'none';
  if (stockHdr)   stockHdr.classList.remove('mode-open');
  if (kitHdr)     kitHdr.classList.remove('mode-open');
  if (stockChev)  stockChev.style.transform = 'rotate(-90deg)';
  if (kitChev)    kitChev.style.transform   = 'rotate(-90deg)';

  if (!isOpen) {
    // Open requested group
    const group = document.getElementById('modeGroup-' + mode);
    const hdr   = document.getElementById('modeHeader-' + mode);
    const chev  = document.getElementById('modeChevron-' + mode);
    if (group) group.style.display = '';
    if (hdr)   hdr.classList.add('mode-open');
    if (chev)  chev.style.transform = '';
    // Switch to this mode's event
    switchMode(mode);
  }
}

function switchModeAndPanel(mode, panel) {
  // Switch mode if needed, then show panel
  const needsSwitch = (mode === 'kit' && state.type !== 'kit') ||
                      (mode === 'stock' && state.type === 'kit');
  if (needsSwitch) {
    const stockEv = getStockEvent();
    const kitEv   = getKitEvent();
    const targetEv = mode === 'kit' ? kitEv : stockEv;
    if (!targetEv) {
      if (mode === 'kit') {
        toast('No Kit linked to this event — use Settings to add Kit', 'error');
      }
      return;
    }
    appData.events[appData.currentEventId] = state;
    appData.currentEventId = targetEv.id;
    state = targetEv;
    mergeDefaults(state);
    sortAllLists();
    localStorage.setItem('measured_stock_app', JSON.stringify(appData));
    renderAll();
  }
  showPanel(panel);
  updateModeAccordion();
}

function switchMode(mode) {
  const stockEv = getStockEvent();
  const kitEv   = getKitEvent();
  const targetEv = mode === 'kit' ? kitEv : stockEv;
  if (!targetEv) {
    if (mode === 'kit') toast('No Kit linked — use Settings to add Kit', 'error');
    return;
  }
  if (targetEv.id === appData.currentEventId) return;
  appData.events[appData.currentEventId] = state;
  appData.currentEventId = targetEv.id;
  state = targetEv;
  mergeDefaults(state);
  sortAllLists();
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  renderAll();
}

function updateModeBtns() {
  // Legacy — keep for compat but do nothing; accordion handles state
  updateModeAccordion();
}

function updateModeAccordion() {
  const isKit = (state.type === 'kit');
  const activeMode = isKit ? 'kit' : 'stock';
  const inactiveMode = isKit ? 'stock' : 'kit';

  const activeGroup = document.getElementById('modeGroup-' + activeMode);
  const activeHdr   = document.getElementById('modeHeader-' + activeMode);
  const activeChev  = document.getElementById('modeChevron-' + activeMode);
  const inactGroup  = document.getElementById('modeGroup-' + inactiveMode);
  const inactHdr    = document.getElementById('modeHeader-' + inactiveMode);
  const inactChev   = document.getElementById('modeChevron-' + inactiveMode);

  if (activeGroup) activeGroup.style.display = '';
  if (activeHdr)   activeHdr.classList.add('mode-open');
  if (activeChev)  activeChev.style.transform = '';
  if (inactGroup)  inactGroup.style.display = 'none';
  if (inactHdr)    inactHdr.classList.remove('mode-open');
  if (inactChev)   inactChev.style.transform = 'rotate(-90deg)';

  // Highlight correct sub-item
  const currentPanel = document.querySelector('.nav-item.active[data-panel]');
  const cp = currentPanel ? currentPanel.dataset.panel : '';
  document.querySelectorAll('.nav-sub-item').forEach(btn => {
    btn.classList.toggle('active',
      btn.dataset.panel === cp && btn.dataset.mode === activeMode
    );
  });
}

// Add a Kit sibling to an existing event that doesn't have one
function addKitToCurrentEvent() {
  if (!confirm('Add a Kit section to "' + (state.showName || 'this event') + '"?\nThis creates a linked Kit event for tracking equipment.')) return;

  // Check if kit already exists
  if (state.linkedId && appData.events[state.linkedId]) {
    toast('This event already has a Kit section', 'error');
    return;
  }

  // If we're on the kit event, find the stock event
  const stockEv = getStockEvent() || state;

  const kitId = uid();
  const kitEv = blankEvent((stockEv.showName || 'Event') + ' \u2014 Kit', 'kit', stockEv.id);
  kitEv.id = kitId;
  kitEv.bars       = [...(stockEv.bars || [])];
  kitEv.recipients = [...(stockEv.recipients || [])];

  stockEv.linkedId = kitId;
  appData.events[kitId] = kitEv;
  appData.events[stockEv.id] = stockEv;

  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  cloudUpsertEvent(stockEv);
  cloudUpsertEvent(kitEv);

  toast('Kit section added to ' + (stockEv.showName || 'event'), 'success');
  renderAll();
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ============================================================
// CLOUD CONFIG (Supabase)
// ============================================================
// Built-in Supabase project. The anon key is a public JWT — Row Level
// Security on the `stock_events` table is what actually protects the data.
// To rotate: replace the values below and ship a new build. Users do not
// need to (and cannot) enter their own credentials.
const BUILTIN_CLOUD_CONFIG = {
  url: 'https://qqdvzcaukstfdixnfuqq.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxZHZ6Y2F1a3N0ZmRpeG5mdXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTg2NzQsImV4cCI6MjA5MjM3NDY3NH0.pEli5ZEliJIwBTsNLb5JW4mFW1nV1TAnUO0f5_1UhGU',
};

let cloudConfig = { url: '', key: '' };

function loadCloudConfig() {
  // Built-in config wins — we ignore any stale localStorage value so that
  // rotating credentials in a future build takes effect immediately for
  // every device, with no "Disconnect & reconnect" dance.
  if (BUILTIN_CLOUD_CONFIG.url && BUILTIN_CLOUD_CONFIG.key) {
    cloudConfig = { url: BUILTIN_CLOUD_CONFIG.url.replace(/\/$/, ''), key: BUILTIN_CLOUD_CONFIG.key };
    return;
  }
  const raw = localStorage.getItem('measured_stock_cloud');
  if (raw) { try { cloudConfig = JSON.parse(raw); } catch(e) {} }
}

function saveCloudConfig() {
  // Persist a copy as a fallback if the built-in is ever cleared. Harmless
  // either way since loadCloudConfig() prefers the built-in.
  localStorage.setItem('measured_stock_cloud', JSON.stringify(cloudConfig));
}

function hasCloud() {
  return !!(cloudConfig.url && cloudConfig.key);
}

function setSyncStatus(status) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const now = new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
  const map = {
    synced:  {text: '● Synced ' + now, color: '#5a7a2a'},
    syncing: {text: '↻ Syncing…',      color: '#c07a00'},
    offline: {text: '○ Local',         color: '#a89f8c'},
    error:   {text: '✕ Sync error',    color: '#c0392b'},
  };
  const s = map[status] || map.offline;
  el.textContent = s.text;
  el.style.color  = s.color;
}

// _localDirty: true from the moment save() is called until the cloud upsert confirms
let _localDirty = false;

// ── Core Supabase calls ───────────────────────────────────────────────────

async function supabaseFetch(path, options) {
  // Single place for all Supabase HTTP calls — throws on non-OK responses
  const res = await fetch(cloudConfig.url + path, {
    ...options,
    headers: {
      'apikey': cloudConfig.key,
      'Authorization': 'Bearer ' + cloudConfig.key,
      'Content-Type': 'application/json',
      ...(options && options.headers),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error('Supabase ' + res.status + ': ' + body);
  }
  return res;
}

async function cloudPush(eventObj) {
  // Write one event to Supabase. Stamps _savedAt. Returns true on success.
  if (!hasCloud()) return false;
  try {
    setSyncStatus('syncing');
    eventObj._savedAt = Date.now();
    await supabaseFetch('/rest/v1/stock_events', {
      method: 'POST',
      headers: {'Prefer': 'resolution=merge-duplicates'},
      body: JSON.stringify({id: eventObj.id, name: eventObj.showName || 'Unnamed', data: eventObj}),
    });
    _localDirty = false;
    setSyncStatus('synced');
    return true;
  } catch(err) {
    console.error('[Sync] Push failed:', err.message);
    setSyncStatus('error');
    return false;
  }
}

async function cloudPull() {
  // Read all events from Supabase. Returns array or null on error.
  if (!hasCloud()) return null;
  try {
    const res = await supabaseFetch('/rest/v1/stock_events?select=*&order=name');
    return await res.json();
  } catch(err) {
    console.error('[Sync] Pull failed:', err.message);
    setSyncStatus('error');
    return null;
  }
}

async function cloudDeleteEvent(id) {
  if (!hasCloud()) return;
  try {
    await supabaseFetch('/rest/v1/stock_events?id=eq.' + id, {method: 'DELETE'});
  } catch(err) {
    console.error('[Sync] Delete failed:', err.message);
  }
}

// Keep old names as aliases so nothing else in the codebase breaks
async function cloudUpsertEvent(eventObj) { return cloudPush(eventObj); }
async function cloudLoadAllEvents()       { return cloudPull(); }

// ── Polling ───────────────────────────────────────────────────────────────
let pollInterval = null;
let lastKnownRemoteTs = {}; // { eventId: updated_at string }

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  if (!hasCloud()) return;
  pollInterval = setInterval(pollForChanges, 8000);
}

function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
}

async function pollForChanges() {
  if (_localDirty) return; // wait until our own push completes before pulling
  const rows = await cloudPull();
  if (!rows) return;

  let anyChanged = false;
  let recipesChanged = false;
  let bugsChanged = false;

  rows.forEach(row => {
    const remote = row.data;
    if (!remote || !remote.id) return;
    const serverTs = row.updated_at;
    const knownTs  = lastKnownRemoteTs[remote.id];

    if (serverTs === knownTs) return; // nothing changed for this event

    lastKnownRemoteTs[remote.id] = serverTs;

    // Reserved rows (e.g. global recipes / bug reports) — not real events
    if (isReservedRow(remote.id)) {
      if (remote.id === RECIPES_ROW_ID) {
        const remoteSavedAt = remote._savedAt || 0;
        const localSavedAt  = (appData._recipesSavedAt || 0);
        if (remoteSavedAt >= localSavedAt) {
          appData.recipes = Array.isArray(remote.recipes) ? remote.recipes : [];
          appData._recipesSavedAt = remoteSavedAt;
          recipesChanged = true;
        }
      } else if (remote.id === BUGS_ROW_ID) {
        if (mergeRemoteBugs(remote)) bugsChanged = true;
      }
      return;
    }

    if (remote.id === appData.currentEventId) {
      // Active event changed remotely — only pull if their _savedAt is newer
      const remoteSavedAt = remote._savedAt  || 0;
      const localSavedAt  = state._savedAt   || 0;
      if (remoteSavedAt > localSavedAt) {
        mergeDefaults(remote);
        appData.events[remote.id] = remote;
        state = remote;
        localStorage.setItem('measured_stock_app', JSON.stringify(appData));
        renderAll();
        toast('↓ Updated from another device', 'success');
      }
    } else {
      // Non-active event — always take remote
      mergeDefaults(remote);
      appData.events[remote.id] = remote;
      anyChanged = true;
    }
  });

  // New event on remote we don't have
  rows.forEach(row => {
    const remote = row.data;
    if (!remote || !remote.id) return;
    if (isReservedRow(remote.id)) return;
    if (!appData.events[remote.id]) {
      mergeDefaults(remote);
      appData.events[remote.id] = remote;
      anyChanged = true;
    }
  });

  // Event deleted on remote (skip active event)
  const remoteIds = new Set(rows.map(r => r.data && r.data.id).filter(id => id && !isReservedRow(id)));
  Object.keys(appData.events).forEach(id => {
    if (!remoteIds.has(id) && id !== appData.currentEventId) {
      delete appData.events[id];
      anyChanged = true;
    }
  });

  if (recipesChanged) {
    localStorage.setItem('measured_stock_app', JSON.stringify(appData));
    if (document.getElementById('recipeTableBody')) renderRecipes();
    if (document.getElementById('panel-cogs') && document.getElementById('panel-cogs').classList.contains('active')) renderCogs();
    toast('↓ Recipes updated from another device', 'success');
  }

  if (bugsChanged) {
    updateBugCountBadge();
    if (document.getElementById('bugList')) renderBugs();
    toast('↓ Bug reports updated from another device', 'success');
  }

  if (anyChanged) {
    localStorage.setItem('measured_stock_app', JSON.stringify(appData));
    renderEventSwitcher();
  }
  setSyncStatus('synced');
}

function mergeDefaults(ev) {
  if (!ev.type)       ev.type       = 'stock';
  if (!ev.categories) ev.categories = ev.type === 'kit' ? [...DEFAULT_KIT_CATEGORIES] : [...DEFAULT_CATEGORIES];
  if (!ev.transfers)  ev.transfers  = [];
  if (!ev.closing)    ev.closing    = {};
  if (!ev.topups)     ev.topups     = [];
  if (!ev.wastage)    ev.wastage    = [];
}

// ── Initial sync on connect / page load ──────────────────────────────────

async function syncOnConnect() {
  const rows = await cloudPull();
  if (!rows) return false;

  // Split out reserved rows first (recipes + bugs are app-wide, not per event)
  const recipeRow = rows.find(r => r.data && r.data.id === RECIPES_ROW_ID);
  const bugsRow   = rows.find(r => r.data && r.data.id === BUGS_ROW_ID);
  const eventRows = rows.filter(r => r.data && r.data.id && !isReservedRow(r.data.id));

  if (recipeRow) {
    const remoteSavedAt = (recipeRow.data._savedAt) || 0;
    const localSavedAt  = (appData._recipesSavedAt) || 0;
    if (remoteSavedAt >= localSavedAt) {
      appData.recipes = Array.isArray(recipeRow.data.recipes) ? recipeRow.data.recipes : [];
      appData._recipesSavedAt = remoteSavedAt;
    }
    lastKnownRemoteTs[RECIPES_ROW_ID] = recipeRow.updated_at;
  }

  if (bugsRow) {
    mergeRemoteBugs(bugsRow.data);
    lastKnownRemoteTs[BUGS_ROW_ID] = bugsRow.updated_at;
  }

  if (eventRows.length > 0) {
    eventRows.forEach(row => {
      const remote = row.data;
      if (!remote || !remote.id) return;
      mergeDefaults(remote);

      const local = appData.events[remote.id];
      if (!local) {
        appData.events[remote.id] = remote;
      } else {
        const localTs  = local._savedAt  || 0;
        const remoteTs = remote._savedAt || 0;
        if (remoteTs >= localTs) {
          // Preserve linkedId if local has it but remote (older version) doesn't
          if (local.linkedId && !remote.linkedId) remote.linkedId = local.linkedId;
          if (local.type && !remote.type) remote.type = local.type;
          appData.events[remote.id] = remote;
        }
      }

      lastKnownRemoteTs[remote.id] = row.updated_at;
    });

    if (!appData.events[appData.currentEventId]) {
      const first = eventRows[0] && eventRows[0].data;
      if (first) { appData.currentEventId = first.id; state = first; }
    } else {
      state = appData.events[appData.currentEventId];
    }

    localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  }

  // Run migration AFTER cloud pull — creates Kit siblings for old events
  // that came from Supabase without linkedId / type fields
  runMigration();
  state = appData.events[appData.currentEventId]; // re-point after migration

  if (_localDirty || eventRows.length === 0) {
    await cloudPush(state);
  }

  // Push our local recipes back if we have any but the cloud didn't
  if ((appData.recipes || []).length > 0 && !recipeRow) {
    cloudPushRecipes();
  }

  // Same for bug reports — push local-only bugs up to the cloud on first connect
  if (!bugsRow) {
    const localBugs = loadBugs();
    if ((localBugs.items || []).length > 0) cloudPushBugs();
  }

  renderAll();
  setSyncStatus('synced');
  startPolling();
  return true;
}

function renderEventSwitcher() {
  const sel = document.getElementById('eventSelect');
  if (!sel) return;
  // Only show stock events (one per pair) in the dropdown
  const stockEvents = Object.values(appData.events).filter(e => e.type === 'stock' || !e.type);
  // Determine which stock event is current (even if kit is active)
  const currentStockId = (state.type === 'kit' && state.linkedId) ? state.linkedId : appData.currentEventId;
  sel.innerHTML = stockEvents.map(e =>
    '<option value="' + e.id + '" ' + (e.id === currentStockId ? 'selected' : '') + '>' + (e.showName || 'Unnamed') + '</option>'
  ).join('');
  // Sync mode buttons
  updateModeBtns();
  // Render kit pills from linked event
  renderKitPills();
}


function switchEvent(id) {
  // id is always a stock event ID (from dropdown)
  const targetStock = appData.events[id];
  if (!targetStock) return;
  appData.events[appData.currentEventId] = state;
  appData.currentEventId = id;
  state = targetStock;
  mergeDefaults(state);
  currentMode = 'stock';
  sortAllLists();
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  renderAll();
  showPanel('setup');
}

function newEvent() {
  const name = prompt('Event name (e.g. Highlights 2025):', 'New Event');
  if (!name) return;
  appData.events[appData.currentEventId] = state;

  // Create linked Stock + Kit pair
  const stockId = uid();
  const kitId   = uid();
  const stockEv = blankEvent(name.trim(), 'stock', kitId);
  stockEv.id    = stockId;
  const kitEv   = blankEvent(name.trim() + ' — Kit', 'kit', stockId);
  kitEv.id      = kitId;
  kitEv.bars       = [];
  kitEv.recipients = [];

  appData.events[stockId] = stockEv;
  appData.events[kitId]   = kitEv;
  appData.currentEventId  = stockId;
  state = stockEv;

  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  cloudUpsertEvent(stockEv);
  cloudUpsertEvent(kitEv);
  renderAll();
  toast('Event "' + name + '" created with Stock + Kit', 'success');
}

const NAV_ITEMS_HTML = [
  ['products',    '→ Products'],
  ['opening',     '→ Opening Stock'],
  ['distribution','→ Distribution'],
  ['counts',      '→ Stock Counts'],
  ['topups',      '→ Top-Ups'],
  ['transfers',   '→ Transfers'],
  ['closing',     '→ Closing Stock'],
  ['summary',     '→ Summary'],
].map(([panel, label]) =>
  '<button class="nav-item nav-sub" data-panel="' + panel + '" onclick="showPanel(\''+panel+'\')">'+label+'</button>'
).join('');


function renderSidebarPairs() {
  const container = document.getElementById('sidebarPairs');
  if (!container) return;
  const pairs = getEventPairs();
  const currentPanel = document.querySelector('.nav-item.active[data-panel]');
  const cp = currentPanel ? currentPanel.dataset.panel : 'products';

  container.innerHTML = pairs.map(({stock, kit}) => {
    const primaryEv = stock || kit;
    const stockActive = state.id === (stock && stock.id);
    const kitActive   = state.id === (kit && kit.id);
    const pairActive  = stockActive || kitActive;
    const pairName    = (primaryEv.showName || 'Unnamed').replace(' — Kit','').replace(' — Stock','');
    const primaryId   = primaryEv.id;

    // Active sub-item highlight
    const activeSubs = NAV_ITEMS_HTML.replace(
      'data-panel="' + cp + '"',
      'data-panel="' + cp + '" class="nav-item nav-sub active"'
    );

    let html = '<div class="sidebar-pair">';

    // Pair header
    html += '<button class="nav-item nav-pair-header ' + (pairActive ? 'pair-active' : '') + '"' +
      ' onclick="toggleSidebarPair(this)"' +
      ' data-pair-id="' + primaryId + '">' +
      '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>' +
      '<span style="flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + pairName + '</span>' +
      '<span class="pair-chevron" style="font-size:12px;transition:transform 0.2s;opacity:0.5;' + (pairActive ? '' : 'transform:rotate(-90deg)') + '">&nbsp;▾</span>' +
      '</button>';

    // Sub-group
    html += '<div class="nav-sub-group" style="' + (pairActive ? '' : 'display:none') + '">';

    if (stock) {
      const sBtn = document.createElement('button');
      sBtn.className = 'nav-item nav-mode' + (stockActive ? ' mode-active' : '');
      sBtn.dataset.switchid = stock.id;
      sBtn.setAttribute('onclick', 'switchToMode(this.dataset.switchid)');
      sBtn.innerHTML = '<span style="font-size:13px">&#128230;</span><span style="flex:1;text-align:left">Stock</span>';
      html += sBtn.outerHTML;
      if (stockActive) html += activeSubs;
    }

    if (kit) {
      const kBtn = document.createElement('button');
      kBtn.className = 'nav-item nav-mode' + (kitActive ? ' mode-active' : '');
      kBtn.dataset.switchid = kit.id;
      kBtn.setAttribute('onclick', 'switchToMode(this.dataset.switchid)');
      kBtn.innerHTML = '<span style="font-size:13px">&#129520;</span><span style="flex:1;text-align:left">Kit</span>';
      html += kBtn.outerHTML;
      if (kitActive) html += activeSubs;
    }
    html += '</div></div>';
    return html;
  }).join('');
}

function toggleSidebarPair(btn) {
  const primaryId = btn.dataset.pairId;
  const group = btn.nextElementSibling;
  const chev  = btn.querySelector('.pair-chevron');
  if (!group) return;
  const open = group.style.display !== 'none';
  // Close all
  document.querySelectorAll('.nav-sub-group').forEach(g => g.style.display = 'none');
  document.querySelectorAll('.pair-chevron').forEach(c => c.style.transform = 'rotate(-90deg)');
  if (!open) {
    group.style.display = '';
    if (chev) chev.style.transform = '';
  }
}

function switchToMode(eventId) {
  if (eventId === appData.currentEventId) return;
  appData.events[appData.currentEventId] = state;
  appData.currentEventId = eventId;
  state = appData.events[eventId];
  if (!state.categories) state.categories = state.type === 'kit' ? [...DEFAULT_KIT_CATEGORIES] : [...DEFAULT_CATEGORIES];
  if (!state.transfers) state.transfers = [];
  if (!state.closing)   state.closing   = {};
  if (!state.topups)    state.topups    = [];
  sortAllLists();
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  renderAll();
  showPanel('products');
}


function deleteCurrentEvent() {
  const pairs = getEventPairs();
  if (pairs.length <= 1) { toast('Cannot delete the only event', 'error'); return; }
  const primaryEv = (state.type === 'kit' && state.linkedId && appData.events[state.linkedId])
    ? appData.events[state.linkedId]
    : state;
  deleteEventPair(primaryEv.id);
}

function _pickNewCurrentEvent(excludedIds) {
  const blocked = new Set(excludedIds || []);
  const stockEvs = Object.values(appData.events).filter(
    e => !blocked.has(e.id) && (e.type === 'stock' || !e.type)
  );
  if (stockEvs.length) return stockEvs[0];
  const anyEv = Object.values(appData.events).find(e => !blocked.has(e.id));
  return anyEv || null;
}

function deleteEventPair(primaryId) {
  const primary = appData.events[primaryId];
  if (!primary) return;
  const ids = getPairIds(primaryId);
  const pairs = getEventPairs();
  if (pairs.length <= 1) { toast('Cannot delete the only event', 'error'); return; }

  const niceName = (primary.showName || 'Unnamed').replace(/\s*—\s*Kit$/, '').replace(/\s*—\s*Stock$/, '');
  if (!confirm(`Delete "${niceName}" (Stock + Kit)? This cannot be undone.`)) return;

  if (appData.currentEventId === primaryId || ids.includes(appData.currentEventId)) {
    const next = _pickNewCurrentEvent(ids);
    if (next) {
      appData.currentEventId = next.id;
      state = next;
    }
  }

  ids.forEach(id => {
    delete appData.events[id];
    cloudDeleteEvent(id);
  });

  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  mergeDefaults(state);
  renderAll();
  toast(`"${niceName}" deleted`, 'success');
}

function renameEventPair(primaryId) {
  const primary = appData.events[primaryId];
  if (!primary) return;
  const currentName = (primary.showName || '').replace(/\s*—\s*Kit$/, '').replace(/\s*—\s*Stock$/, '');
  const newName = prompt('Rename event:', currentName);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) { toast('Name cannot be empty', 'error'); return; }

  const ids = getPairIds(primaryId);
  ids.forEach(id => {
    const ev = appData.events[id];
    if (!ev) return;
    ev.showName = ev.type === 'kit' ? trimmed + ' — Kit' : trimmed;
    ev._savedAt = Date.now();
    cloudUpsertEvent(ev);
  });

  if (ids.includes(appData.currentEventId)) {
    state = appData.events[appData.currentEventId];
    const showNameInput = document.getElementById('showName');
    if (showNameInput) showNameInput.value = state.showName || '';
    const display = document.getElementById('showNameDisplay');
    if (display) display.textContent = state.showName || '—';
  }
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  renderAll();
  toast(`Renamed to "${trimmed}"`, 'success');
}

function duplicateEventPair(primaryId) {
  const primary = appData.events[primaryId];
  if (!primary) return;
  const baseName = (primary.showName || 'Event').replace(/\s*—\s*Kit$/, '').replace(/\s*—\s*Stock$/, '');
  const suggested = baseName + ' (copy)';
  const newName = prompt('Name the duplicated event:', suggested);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) { toast('Name cannot be empty', 'error'); return; }

  const stockSrc = primary.type === 'stock' || !primary.type
    ? primary
    : (primary.linkedId ? appData.events[primary.linkedId] : null);
  const kitSrc = primary.type === 'kit'
    ? primary
    : (primary.linkedId ? appData.events[primary.linkedId] : null);

  const newStockId = uid();
  const newKitId   = uid();

  let newStock = null;
  if (stockSrc) {
    newStock = JSON.parse(JSON.stringify(stockSrc));
    newStock.id = newStockId;
    newStock.showName = trimmed;
    newStock.linkedId = kitSrc ? newKitId : null;
    newStock._savedAt = Date.now();
    delete newStock._localDirty;
    appData.events[newStockId] = newStock;
    cloudUpsertEvent(newStock);
  }

  if (kitSrc) {
    const newKit = JSON.parse(JSON.stringify(kitSrc));
    newKit.id = newKitId;
    newKit.showName = trimmed + ' — Kit';
    newKit.linkedId = newStock ? newStockId : null;
    newKit._savedAt = Date.now();
    delete newKit._localDirty;
    appData.events[newKitId] = newKit;
    cloudUpsertEvent(newKit);
  }

  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  renderAll();
  toast(`Duplicated as "${trimmed}"`, 'success');
}

function switchToEventPair(primaryId) {
  const primary = appData.events[primaryId];
  if (!primary) return;
  const targetId = (primary.type === 'kit' && primary.linkedId && appData.events[primary.linkedId])
    ? primary.linkedId
    : primaryId;
  if (targetId === appData.currentEventId) {
    showPanel('setup');
    return;
  }
  switchEvent(targetId);
  showPanel('setup');
}

function _fmtRelative(ts) {
  if (!ts) return 'never saved';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + ' min ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' hr ago';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + ' day' + (day === 1 ? '' : 's') + ' ago';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderEventsPage() {
  const container = document.getElementById('eventsList');
  if (!container) return;
  const pairs = getEventPairs();
  const currentId = appData.currentEventId;

  if (!pairs.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--muted-foreground)">No events yet. Click <strong>New Event</strong> to get started.</div>';
    return;
  }

  const sorted = [...pairs].sort((a, b) => {
    const aTs = Math.max((a.stock && a.stock._savedAt) || 0, (a.kit && a.kit._savedAt) || 0);
    const bTs = Math.max((b.stock && b.stock._savedAt) || 0, (b.kit && b.kit._savedAt) || 0);
    return bTs - aTs;
  });

  container.innerHTML = sorted.map(({ stock, kit }) => {
    const primary = stock || kit;
    const primaryId = primary.id;
    const isActive = currentId === (stock && stock.id) || currentId === (kit && kit.id);
    const niceName = (primary.showName || 'Unnamed').replace(/\s*—\s*Kit$/, '').replace(/\s*—\s*Stock$/, '');
    const stockProducts = stock ? (stock.products || []).length : 0;
    const kitProducts   = kit   ? (kit.products   || []).length : 0;
    const lastTs = Math.max((stock && stock._savedAt) || 0, (kit && kit._savedAt) || 0);
    const lastSaved = _fmtRelative(lastTs);
    const bars = stock ? (stock.bars || []).length : 0;
    const counts = stock ? (stock.counts || []).length : 0;

    const stockBadge = stock
      ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:9999px;background:#dbeafe;color:#1e40af;font-size:11px;font-weight:600">Stock · ' + stockProducts + '</span>'
      : '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:9999px;background:#f4f4f5;color:#71717a;font-size:11px;font-weight:600">No Stock</span>';
    const kitBadge = kit
      ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:9999px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600">Kit · ' + kitProducts + '</span>'
      : '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:9999px;background:#f4f4f5;color:#71717a;font-size:11px;font-weight:600">No Kit</span>';
    const activeBadge = isActive
      ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:9999px;background:#dcfce7;color:#166534;font-size:11px;font-weight:600">● Active</span>'
      : '';

    const switchBtn = isActive
      ? '<button class="btn btn-secondary btn-sm" onclick="showPanel(\'setup\')">Open Settings</button>'
      : '<button class="btn btn-secondary btn-sm" onclick="switchToEventPair(\'' + primaryId + '\')">Switch to</button>';

    return '<div class="card" style="' + (isActive ? 'border-color:#16a34a;' : '') + '">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">' +
        '<div style="min-width:0;flex:1">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
            '<div style="font-size:15px;font-weight:600;color:var(--foreground)">' + _escapeHtml(niceName) + '</div>' +
            activeBadge +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' + stockBadge + kitBadge + '</div>' +
          '<div style="font-size:12px;color:var(--muted-foreground);display:flex;gap:14px;flex-wrap:wrap">' +
            '<span>' + bars + ' bar' + (bars === 1 ? '' : 's') + '</span>' +
            '<span>' + counts + ' count session' + (counts === 1 ? '' : 's') + '</span>' +
            '<span>Last saved: ' + lastSaved + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
          switchBtn +
          '<button class="btn btn-outline btn-sm" onclick="renameEventPair(\'' + primaryId + '\')">Rename</button>' +
          '<button class="btn btn-outline btn-sm" onclick="duplicateEventPair(\'' + primaryId + '\')">Duplicate</button>' +
          '<button class="btn btn-danger btn-sm" onclick="deleteEventPair(\'' + primaryId + '\')">Delete</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function updateShowName() {
  state.showName = document.getElementById('showName').value;
  save();
  renderEventSwitcher();
}

function updateShowDates() {
  const startEl = document.getElementById('showDateStart');
  const endEl   = document.getElementById('showDateEnd');
  const preview = document.getElementById('showDatesPreview');
  const hidden  = document.getElementById('showDates');

  const startVal = startEl ? startEl.value : '';
  const endVal   = endEl   ? endEl.value   : '';

  if (!startVal) {
    if (hidden)  hidden.value = '';
    if (preview) preview.textContent = '';
    state.showDates = '';
    save();
    return;
  }

  // If only start is set, single day
  const startDate = new Date(startVal + 'T00:00:00');
  const endDate   = endVal ? new Date(endVal + 'T00:00:00') : startDate;

  // Clamp: end must not be before start
  const effectiveEnd = endDate < startDate ? startDate : endDate;
  if (endEl && endDate < startDate) endEl.value = startVal;

  // Build list of dates in the range
  const dates = [];
  const cur = new Date(startDate);
  while (cur <= effectiveEnd) {
    dates.push(cur.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    cur.setDate(cur.getDate() + 1);
  }

  const joined = dates.join(', ');
  state.showDates = joined;
  if (hidden)  hidden.value = joined;
  if (preview) preview.textContent = dates.length > 1
    ? `${dates.length} days: ${joined}`
    : joined;
  save();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.showName || 'event').replace(/\s+/g,'-') + '_stock_data.json';
  a.click();
  toast('Exported!', 'success');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      // Save current
      appData.events[appData.currentEventId] = state;
      // Give it a fresh id if needed
      if (!imported.id || appData.events[imported.id]) imported.id = uid();
      if (!imported.showName) imported.showName = file.name.replace('.json','');
      appData.events[imported.id] = imported;
      appData.currentEventId = imported.id;
      state = imported;
      if (!state.categories) state.categories = [...DEFAULT_CATEGORIES];
      localStorage.setItem('measured_stock_app', JSON.stringify(appData));
      renderAll();
      toast(`Imported "${state.showName}"`, 'success');
    } catch(err) { toast('Invalid JSON file', 'error'); }
  };
  r.readAsText(file);
}

// ============================================================
// SETUP — BARS, SUPPLIERS, RECIPIENTS, CATEGORIES
// All pills use data-index + event delegation — no inline onclick with names
// ============================================================
function addBar() {
  const v = document.getElementById('newBarInput').value.trim();
  if (!v) return;
  if (state.bars.includes(v)) { toast('Bar already exists', 'error'); return; }
  state.bars.push(v);
  state.bars.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  document.getElementById('newBarInput').value = '';
  save(); renderBarPills();
}

function renderBarPills() {
  const el = document.getElementById('barPills');
  if (!el) return;
  // Sort in place so state stays sorted for downstream use
  state.bars.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  el.innerHTML = state.bars.map((b, i) => `
    <div class="pill" data-type="bar" data-index="${i}">
      <span class="pill-label">${b}</span>
      <button class="pill-edit" data-action="edit-bar" data-index="${i}" title="Rename">✎</button>
      <button class="pill-remove" data-action="remove-bar" data-index="${i}" title="Delete">×</button>
    </div>`
  ).join('');
}

function addSupplier() {
  const name = document.getElementById('newSupplierInput').value.trim();
  const sor = parseFloat(document.getElementById('newSupplierSOR').value) || 0;
  if (!name) return;
  if (state.suppliers.find(s => s.name === name)) { toast('Supplier already exists', 'error'); return; }
  state.suppliers.push({name, sor});
  state.suppliers.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'}));
  document.getElementById('newSupplierInput').value = '';
  document.getElementById('newSupplierSOR').value = '';
  save(); renderSupplierPills();
}

function renderSupplierPills() {
  const el = document.getElementById('supplierPills');
  if (!el) return;
  state.suppliers.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'}));
  el.innerHTML = state.suppliers.map((s, i) => {
    const sorBadge = s.sor ? ` <span style="color:var(--text-muted);font-size:11px">(${s.sor}% SOR)</span>` : '';
    return `<div class="pill" data-type="supplier" data-index="${i}">
      <span class="pill-label">${s.name}${sorBadge}</span>
      <button class="pill-edit" data-action="edit-supplier" data-index="${i}" title="Edit">✎</button>
      <button class="pill-remove" data-action="remove-supplier" data-index="${i}" title="Delete">×</button>
    </div>`;
  }).join('');
}

function addRecipient() {
  const name = document.getElementById('newRecipientInput').value.trim();
  if (!name) return;
  if (state.recipients.includes(name)) { toast('Already exists', 'error'); return; }
  state.recipients.push(name);
  state.recipients.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  document.getElementById('newRecipientInput').value = '';
  save(); renderRecipientPills();
}

function renderRecipientPills() {
  const el = document.getElementById('recipientPills');
  if (!el) return;
  state.recipients.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  el.innerHTML = state.recipients.map((r, i) => `
    <div class="pill" data-type="recipient" data-index="${i}">
      <span class="pill-label">${r}</span>
      <button class="pill-edit" data-action="edit-recipient" data-index="${i}" title="Rename">✎</button>
      <button class="pill-remove" data-action="remove-recipient" data-index="${i}" title="Delete">×</button>
    </div>`
  ).join('');
}

// ============================================================
// CATEGORIES
// ============================================================
function getCategories() {
  if (!state.categories || !state.categories.length) state.categories = [...DEFAULT_CATEGORIES];
  return state.categories;
}

function addCategory(name) {
  const val = (name || document.getElementById('newCategoryInput').value).trim();
  if (!val) return;
  if (!state.categories) state.categories = [...DEFAULT_CATEGORIES];
  // Case-insensitive duplicate check
  if (state.categories.some(c => c.toLowerCase() === val.toLowerCase())) return;
  state.categories.push(val);
  state.categories.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  if (document.getElementById('newCategoryInput')) document.getElementById('newCategoryInput').value = '';
  save(); renderCategoryPills(); refreshCategoryDropdowns();
}

function renderCategoryPills() {
  const el = document.getElementById('categoryPills');
  if (!el) return;
  const cats = getCategories();
  cats.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  el.innerHTML = cats.map((c, i) => `
    <div class="pill" data-type="category" data-index="${i}">
      <span class="pill-label">${c}</span>
      <button class="pill-edit" data-action="edit-category" data-index="${i}" title="Rename">✎</button>
      <button class="pill-remove" data-action="remove-category" data-index="${i}" title="Delete">×</button>
    </div>`
  ).join('');
}

function refreshCategoryDropdowns(selectedValue) {
  const cats = getCategories();
  const opts = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  const pmCat = document.getElementById('pm-cat');
  if (pmCat) {
    const current = selectedValue ?? pmCat.value;
    pmCat.innerHTML = opts;
    if (current && cats.includes(current)) pmCat.value = current;
  }
  const filter = document.getElementById('productCatFilter');
  if (filter) {
    const current = filter.value;
    filter.innerHTML = `<option value="">All Categories</option>` + opts;
    if (current) filter.value = current;
  }
}

// ============================================================
// PILL EVENT DELEGATION — handles all edit/remove for pills safely
// ============================================================
function initPillDelegation() {
  ['barPills','supplierPills','recipientPills','categoryPills'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const idx = parseInt(btn.dataset.index);
      handlePillAction(action, idx, btn);
    });
  });
}

function handlePillAction(action, idx, btn) {
  const pill = btn.closest('.pill');

  if (action.startsWith('remove-')) {
    const type = action.replace('remove-', '');
    if (type === 'bar') {
      if (!confirm(`Remove bar "${state.bars[idx]}"?`)) return;
      state.bars.splice(idx, 1); save(); renderBarPills();
    } else if (type === 'supplier') {
      if (!confirm(`Remove supplier "${state.suppliers[idx]?.name}"?`)) return;
      state.suppliers.splice(idx, 1); save(); renderSupplierPills();
    } else if (type === 'recipient') {
      if (!confirm(`Remove "${state.recipients[idx]}"?`)) return;
      state.recipients.splice(idx, 1); save(); renderRecipientPills();
    } else if (type === 'category') {
      const cat = state.categories[idx];
      const inUse = state.products.some(p => p.category === cat);
      if (inUse && !confirm(`"${cat}" is used by products. Remove anyway?`)) return;
      state.categories.splice(idx, 1); save(); renderCategoryPills(); refreshCategoryDropdowns();
    }
    return;
  }

  if (action.startsWith('edit-')) {
    const type = action.replace('edit-', '');
    // Build inline edit input
    const label = pill.querySelector('.pill-label');
    const currentText = type === 'supplier'
      ? state.suppliers[idx]?.name
      : type === 'bar' ? state.bars[idx]
      : type === 'recipient' ? state.recipients[idx]
      : state.categories[idx];

    pill.classList.add('pill-editing');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.style.width = Math.max(80, currentText.length * 9) + 'px';
    label.replaceWith(input);
    input.focus(); input.select();

    let sorInput = null;
    if (type === 'supplier') {
      sorInput = document.createElement('input');
      sorInput.type = 'number';
      sorInput.placeholder = 'SOR%';
      sorInput.value = state.suppliers[idx]?.sor || '';
      sorInput.style.width = '55px';
      sorInput.style.marginLeft = '4px';
      input.after(sorInput);
    }

    // Hide edit/remove buttons while editing
    pill.querySelectorAll('button').forEach(b => b.style.display = 'none');

    const saveBtn = document.createElement('button');
    saveBtn.className = 'pill-edit';
    saveBtn.title = 'Save';
    saveBtn.textContent = '✓';
    saveBtn.style.color = 'var(--dark)';
    saveBtn.style.fontWeight = '700';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pill-remove';
    cancelBtn.title = 'Cancel';
    cancelBtn.textContent = '×';

    pill.appendChild(saveBtn);
    pill.appendChild(cancelBtn);

    function commitEdit() {
      const newVal = input.value.trim();
      if (!newVal) { cancelEdit(); return; }
      if (type === 'bar') {
        state.bars[idx] = newVal;
        sortAllLists(); save(); renderBarPills();
      } else if (type === 'supplier') {
        state.suppliers[idx].name = newVal;
        if (sorInput) state.suppliers[idx].sor = parseFloat(sorInput.value) || 0;
        sortAllLists(); save(); renderSupplierPills();
      } else if (type === 'recipient') {
        state.recipients[idx] = newVal;
        sortAllLists(); save(); renderRecipientPills();
      } else if (type === 'category') {
        state.categories[idx] = newVal;
        sortAllLists(); save(); renderCategoryPills(); refreshCategoryDropdowns();
      }
    }

    function cancelEdit() {
      pill.classList.remove('pill-editing');
      const re = { bar: renderBarPills, supplier: renderSupplierPills, recipient: renderRecipientPills, category: renderCategoryPills };
      re[type]?.();
    }

    saveBtn.addEventListener('click', commitEdit);
    cancelBtn.addEventListener('click', cancelEdit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') cancelEdit();
    });
    return;
  }
}

// ============================================================
// SAMPLE DATA LOADER
// ============================================================
function loadSampleData(skipConfirm) {
  if (!skipConfirm && !confirm('This will replace all current data with sample data. Continue?')) return;

  state.showName = 'Highlights 2025';
  state.showDates = '29 May, 30 May, 31 May, 1 Jun';
  state.bars = ['Bone Yard', 'Bar 1', 'Bar 2', 'Jubel Bar', 'Artist Bar', 'Red Bull Bar'];
  state.suppliers = [
    {name:'Utopian',  sor:25},
    {name:'Jubel',    sor:30},
    {name:'Brothers', sor:20},
    {name:'Vinca',    sor:15},
    {name:'RW',       sor:0},
    {name:'Served',   sor:20},
    {name:'Liquid Death', sor:0},
    {name:'LWC/MC',   sor:0},
  ];
  state.categories = ['BEER','CIDER','WINE','RTDs','SPIRITS','SOFTS','SELTZERS'];
  state.recipients = ['Fred', 'Artist Liaison', 'Production', 'Notty - CWF'];

  state.products = [
    {id:'p1', name:'Utopian Lager',              category:'BEER',     supplier:'Utopian',      sku:'UTL001', size:'24 x 440ml Cans',  unitsPerSku:24,   qtyOrdered:60,  orderPrice:33.84, arrival:'Tuesday'},
    {id:'p2', name:'Utopian Pale Ale',            category:'BEER',     supplier:'Utopian',      sku:'UTL002', size:'24 x 440ml Cans',  unitsPerSku:24,   qtyOrdered:24,  orderPrice:33.84, arrival:'Tuesday'},
    {id:'p3', name:'Jubel Peach - 4.0%',          category:'BEER',     supplier:'Jubel',        sku:'JBL001', size:'12 x 440ml Cans',  unitsPerSku:12,   qtyOrdered:77,  orderPrice:17.50, arrival:'Wednesday'},
    {id:'p4', name:'Jubel Mango - 4.0%',          category:'BEER',     supplier:'Jubel',        sku:'JBL002', size:'12 x 440ml Cans',  unitsPerSku:12,   qtyOrdered:38,  orderPrice:17.50, arrival:'Wednesday'},
    {id:'p5', name:'Jubel Grapefruit - 4.0%',     category:'BEER',     supplier:'Jubel',        sku:'JBL003', size:'12 x 440ml Cans',  unitsPerSku:12,   qtyOrdered:38,  orderPrice:17.50, arrival:'Wednesday'},
    {id:'p6', name:'Brothers Absolutely Apple',   category:'CIDER',    supplier:'Brothers',     sku:'BRO001', size:'24 x 440ml Cans',  unitsPerSku:24,   qtyOrdered:19,  orderPrice:20.00, arrival:'Tuesday'},
    {id:'p7', name:'Vinca White - 12.5%',         category:'WINE',     supplier:'Vinca',        sku:'VIN001', size:'12 x 187ml PET',   unitsPerSku:12,   qtyOrdered:42,  orderPrice:17.88, arrival:'Wednesday'},
    {id:'p8', name:'Vinca Rosé - 12.5%',          category:'WINE',     supplier:'Vinca',        sku:'VIN002', size:'12 x 187ml PET',   unitsPerSku:12,   qtyOrdered:42,  orderPrice:17.88, arrival:'Wednesday'},
    {id:'p9', name:'No 6 G&T - 7%',              category:'RTDs',     supplier:'RW',           sku:'RW001',  size:'12 x 250ml Cans',  unitsPerSku:12,   qtyOrdered:96,  orderPrice:18.99, arrival:''},
    {id:'p10',name:'Smirnoff Vodka & Cola',       category:'RTDs',     supplier:'RW',           sku:'RW002',  size:'12 x 250ml Cans',  unitsPerSku:12,   qtyOrdered:96,  orderPrice:18.69, arrival:''},
    {id:'p11',name:'Served Lime Hard Seltzer',    category:'SELTZERS', supplier:'Served',       sku:'SRV001', size:'12 x 250ml Cans',  unitsPerSku:12,   qtyOrdered:48,  orderPrice:15.00, arrival:''},
    {id:'p12',name:'Absolut Vodka',               category:'SPIRITS',  supplier:'LWC/MC',       sku:'ABS001', size:'6 x 700ml',        unitsPerSku:6,    qtyOrdered:12,  orderPrice:72.00, arrival:''},
    {id:'p13',name:'Coke',                        category:'SOFTS',    supplier:'RW',           sku:'RW010',  size:'24 x 330ml Cans',  unitsPerSku:24,   qtyOrdered:10,  orderPrice:14.40, arrival:''},
    {id:'p14',name:'Diet Coke',                   category:'SOFTS',    supplier:'RW',           sku:'RW011',  size:'24 x 330ml Cans',  unitsPerSku:24,   qtyOrdered:6,   orderPrice:12.20, arrival:''},
    {id:'p15',name:'Red Bull Original',           category:'SOFTS',    supplier:'RW',           sku:'RW012',  size:'24 x 250ml Cans',  unitsPerSku:24,   qtyOrdered:12,  orderPrice:25.36, arrival:''},
    {id:'p16',name:'Liquid Death Still Water',    category:'SOFTS',    supplier:'Liquid Death', sku:'LD001',  size:'12 x 500ml Cans',  unitsPerSku:12,   qtyOrdered:90,  orderPrice:3.96,  arrival:''},
  ];

  // ── Opening stock (delivered = ordered for most, a couple short/damaged) ──
  state.opening = {
    p1:  {invoiceQty:60,  deliveredQty:60,  damagedQty:0,  openingStock:60},
    p2:  {invoiceQty:24,  deliveredQty:22,  damagedQty:1,  openingStock:21},   // 2 short, 1 damaged
    p3:  {invoiceQty:77,  deliveredQty:77,  damagedQty:0,  openingStock:77},
    p4:  {invoiceQty:38,  deliveredQty:38,  damagedQty:0,  openingStock:38},
    p5:  {invoiceQty:38,  deliveredQty:36,  damagedQty:0,  openingStock:36},   // 2 short
    p6:  {invoiceQty:19,  deliveredQty:19,  damagedQty:0,  openingStock:19},
    p7:  {invoiceQty:42,  deliveredQty:42,  damagedQty:2,  openingStock:40},   // 2 damaged
    p8:  {invoiceQty:42,  deliveredQty:42,  damagedQty:0,  openingStock:42},
    p9:  {invoiceQty:96,  deliveredQty:96,  damagedQty:0,  openingStock:96},
    p10: {invoiceQty:96,  deliveredQty:96,  damagedQty:0,  openingStock:96},
    p11: {invoiceQty:48,  deliveredQty:48,  damagedQty:0,  openingStock:48},
    p12: {invoiceQty:12,  deliveredQty:12,  damagedQty:0,  openingStock:12},
    p13: {invoiceQty:10,  deliveredQty:10,  damagedQty:0,  openingStock:10},
    p14: {invoiceQty:6,   deliveredQty:6,   damagedQty:0,  openingStock:6},
    p15: {invoiceQty:12,  deliveredQty:12,  damagedQty:0,  openingStock:12},
    p16: {invoiceQty:90,  deliveredQty:90,  damagedQty:0,  openingStock:90},
  };

  // ── Distribution across 6 bars ──
  state.distribution = {
    p1:  {'Bone Yard':14, 'Bar 1':12, 'Bar 2':12, 'Jubel Bar':8,  'Artist Bar':8,  'Red Bull Bar':6},
    p2:  {'Bone Yard':5,  'Bar 1':4,  'Bar 2':4,  'Jubel Bar':3,  'Artist Bar':3,  'Red Bull Bar':2},
    p3:  {'Bone Yard':18, 'Bar 1':14, 'Bar 2':14, 'Jubel Bar':14, 'Artist Bar':10, 'Red Bull Bar':7},
    p4:  {'Bone Yard':9,  'Bar 1':7,  'Bar 2':7,  'Jubel Bar':7,  'Artist Bar':5,  'Red Bull Bar':3},
    p5:  {'Bone Yard':8,  'Bar 1':7,  'Bar 2':7,  'Jubel Bar':6,  'Artist Bar':5,  'Red Bull Bar':3},
    p6:  {'Bone Yard':4,  'Bar 1':4,  'Bar 2':4,  'Jubel Bar':4,  'Artist Bar':2,  'Red Bull Bar':1},
    p7:  {'Bone Yard':8,  'Bar 1':6,  'Bar 2':6,  'Jubel Bar':6,  'Artist Bar':8,  'Red Bull Bar':6},
    p8:  {'Bone Yard':8,  'Bar 1':8,  'Bar 2':8,  'Jubel Bar':6,  'Artist Bar':6,  'Red Bull Bar':4},
    p9:  {'Bone Yard':20, 'Bar 1':18, 'Bar 2':18, 'Jubel Bar':14, 'Artist Bar':14, 'Red Bull Bar':12},
    p10: {'Bone Yard':20, 'Bar 1':18, 'Bar 2':18, 'Jubel Bar':14, 'Artist Bar':14, 'Red Bull Bar':12},
    p11: {'Bone Yard':10, 'Bar 1':8,  'Bar 2':8,  'Jubel Bar':8,  'Artist Bar':8,  'Red Bull Bar':6},
    p12: {'Bone Yard':3,  'Bar 1':2,  'Bar 2':2,  'Jubel Bar':2,  'Artist Bar':2,  'Red Bull Bar':1},
    p13: {'Bone Yard':2,  'Bar 1':2,  'Bar 2':2,  'Jubel Bar':1,  'Artist Bar':2,  'Red Bull Bar':1},
    p14: {'Bone Yard':1,  'Bar 1':1,  'Bar 2':1,  'Jubel Bar':1,  'Artist Bar':1,  'Red Bull Bar':1},
    p15: {'Bone Yard':2,  'Bar 1':2,  'Bar 2':2,  'Jubel Bar':2,  'Artist Bar':2,  'Red Bull Bar':2},
    p16: {'Bone Yard':20, 'Bar 1':16, 'Bar 2':16, 'Jubel Bar':14, 'Artist Bar':14, 'Red Bull Bar':10},
  };

  // ── Mid-event stock count (Fri evening after Day 1) ──
  const countId = 'cnt1';
  state.counts = [{
    id: countId,
    name: 'Friday Evening — End of Day 1',
    bar: 'All Bars',
    date: '29 May 2025 20:00',
    savedAt: new Date().toISOString(),
    data: {
      p1:  {'Bone Yard':{cases:6,  singles:8},  'Bar 1':{cases:5, singles:4},  'Bar 2':{cases:5, singles:0},  'Jubel Bar':{cases:3, singles:6},  'Artist Bar':{cases:4, singles:0},  'Red Bull Bar':{cases:2, singles:6}},
      p3:  {'Bone Yard':{cases:7,  singles:4},  'Bar 1':{cases:5, singles:8},  'Bar 2':{cases:5, singles:4},  'Jubel Bar':{cases:5, singles:6},  'Artist Bar':{cases:4, singles:0},  'Red Bull Bar':{cases:2, singles:6}},
      p9:  {'Bone Yard':{cases:8,  singles:4},  'Bar 1':{cases:7, singles:0},  'Bar 2':{cases:6, singles:8},  'Jubel Bar':{cases:5, singles:4},  'Artist Bar':{cases:5, singles:6},  'Red Bull Bar':{cases:4, singles:0}},
      p10: {'Bone Yard':{cases:8,  singles:0},  'Bar 1':{cases:7, singles:4},  'Bar 2':{cases:6, singles:4},  'Jubel Bar':{cases:5, singles:0},  'Artist Bar':{cases:5, singles:0},  'Red Bull Bar':{cases:3, singles:8}},
      p16: {'Bone Yard':{cases:9,  singles:6},  'Bar 1':{cases:7, singles:0},  'Bar 2':{cases:6, singles:6},  'Jubel Bar':{cases:5, singles:6},  'Artist Bar':{cases:5, singles:6},  'Red Bull Bar':{cases:3, singles:6}},
    }
  }];

  // ── Internal transfers ──
  state.transfers = [
    {
      id: 'tf1',
      recipient: 'Artist Liaison',
      unit: 'cases',
      lines: [
        {productId:'p3', productName:'Jubel Peach - 4.0%', qty:3},
        {productId:'p8', productName:'Vinca Rosé - 12.5%', qty:4},
        {productId:'p16',productName:'Liquid Death Still Water', qty:6},
      ],
      timestamp: '29 May 2025 14:30',
    },
    {
      id: 'tf2',
      recipient: 'Production',
      unit: 'cases',
      lines: [
        {productId:'p13',productName:'Coke', qty:1},
        {productId:'p15',productName:'Red Bull Original', qty:2},
        {productId:'p16',productName:'Liquid Death Still Water', qty:4},
      ],
      timestamp: '30 May 2025 09:00',
    },
    {
      id: 'tf3',
      recipient: 'Fred',
      unit: 'units',
      lines: [
        {productId:'p12',productName:'Absolut Vodka', qty:6},
        {productId:'p9', productName:'No 6 G&T - 7%', qty:12},
      ],
      timestamp: '30 May 2025 18:00',
    },
  ];

  // ── Closing stock (end of event) ──
  state.closing = {
    p1:  {closeCount:4,  returnAmount:4,  carriedOver:0},
    p2:  {closeCount:2,  returnAmount:2,  carriedOver:0},
    p3:  {closeCount:6,  returnAmount:6,  carriedOver:0},
    p4:  {closeCount:3,  returnAmount:3,  carriedOver:0},
    p5:  {closeCount:2,  returnAmount:2,  carriedOver:0},
    p6:  {closeCount:1,  returnAmount:1,  carriedOver:0},
    p7:  {closeCount:3,  returnAmount:3,  carriedOver:0},
    p8:  {closeCount:5,  returnAmount:5,  carriedOver:0},
    p9:  {closeCount:8,  returnAmount:0,  carriedOver:8},
    p10: {closeCount:7,  returnAmount:0,  carriedOver:7},
    p11: {closeCount:4,  returnAmount:4,  carriedOver:0},
    p12: {closeCount:2,  returnAmount:0,  carriedOver:2},
    p13: {closeCount:1,  returnAmount:0,  carriedOver:1},
    p14: {closeCount:1,  returnAmount:0,  carriedOver:1},
    p15: {closeCount:1,  returnAmount:0,  carriedOver:1},
    p16: {closeCount:12, returnAmount:0,  carriedOver:12},
  };

  save();
  renderAll();
  toast('✅ Sample data loaded — full event populated!', 'success');
}

// ============================================================
// NAV
// ============================================================
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panelEl = document.getElementById('panel-' + name);
  if (panelEl) panelEl.classList.add('active');

  if (name === 'distribution') renderDistribution();
  if (name === 'opening')      renderOpening();
  if (name === 'closing')      renderClosing();
  if (name === 'summary')      renderSummary();
  if (name === 'counts')       renderCountSessions();
  if (name === 'wastage')      renderWastage();
  if (name === 'transfers')    renderTransfers();
  if (name === 'topups')       renderTopups();
  if (name === 'products')     renderProducts();
  if (name === 'events')       renderEventsPage();
  if (name === 'bugs')         renderBugs();
  if (name === 'recipes')      renderRecipes();
  if (name === 'cogs')         renderCogs();

  // Update sidebar highlight for top-level (non-mode) nav items
  document.querySelectorAll('.sidebar-nav > .nav-item:not(.nav-sub-item):not(.nav-mode-header)').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === name);
  });
}

// ============================================================
// STATS
// ============================================================
function updateStats() {
  document.getElementById('stat-products').textContent = state.products.length;
  document.getElementById('stat-bars').textContent = state.bars.length;
  document.getElementById('stat-suppliers').textContent = state.suppliers.length;
  document.getElementById('stat-counts').textContent = state.counts.length;

  // Update mode badge on Setup tab
  const badge = document.getElementById('setupModeBadge');
  if (badge) {
    if (state.type === 'kit') {
      badge.textContent = '🧰 KIT';
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:3px;margin-left:8px;vertical-align:middle;background:#fef3c7;color:#92400e;border:1px solid #fde68a';
    } else {
      badge.textContent = '📦 STOCK';
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:3px;margin-left:8px;vertical-align:middle;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe';
    }
  }
  const snEl = document.getElementById('showName');
  if (snEl && document.activeElement !== snEl) snEl.value = state.showName || '';
  const sdEl = document.getElementById('showDates');
  if (sdEl && document.activeElement !== sdEl) sdEl.value = state.showDates || '';
  // Hydrate date pickers from stored comma-separated dates
  (function hydrateDatePickers() {
    const raw = (state.showDates || '').trim();
    if (!raw) return;
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    function parseToISO(str) {
      // Handles "29 May", "29 May 2025", "2025-05-29" etc.
      const d = new Date(str + (str.match(/\d{4}/) ? '' : ' ' + new Date().getFullYear()));
      if (isNaN(d)) return '';
      return d.toISOString().slice(0, 10);
    }
    const startISO = parseToISO(parts[0]);
    const endISO   = parts.length > 1 ? parseToISO(parts[parts.length - 1]) : startISO;
    const startEl  = document.getElementById('showDateStart');
    const endEl    = document.getElementById('showDateEnd');
    const preview  = document.getElementById('showDatesPreview');
    if (startEl && startISO) startEl.value = startISO;
    if (endEl   && endISO)   endEl.value   = endISO;
    if (preview && parts.length > 1) preview.textContent = `${parts.length} days: ${raw}`;
    else if (preview && parts.length === 1) preview.textContent = raw;
  })();
  refreshCategoryDropdowns();
  renderEventSwitcher();
}

// ============================================================
// SORT UTILITY — simple A-Z by product name
// ============================================================
function sortedProducts(products) {
  return [...products].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function toggleSection(bodyId, chevronId) {
  const body = document.getElementById(bodyId);
  const chev = document.getElementById(chevronId);
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if (chev) chev.style.transform = collapsed ? '' : 'rotate(-90deg)';
}

// ============================================================
// PRODUCTS
// ============================================================
function catBadge(cat) {
  // Return blank if the category doesn't exactly match one configured in Setup
  if (!cat || !state.categories.includes(cat)) return '';
  const cls = {
    'Beer':'beer', 'Cider':'cider', 'Wine':'wine', 'Sparkling Wine':'wine',
    'Spirit & Mixer':'spirits', 'RTDs':'rtd', 'Canned Cocktails':'rtd',
    'Hard Seltzer':'softs', 'Shots':'spirits', 'Cocktails':'rtd', 'Soft Drinks':'softs',
  }[cat] || 'rtd';
  return `<span class="badge badge-${cls}">${cat}</span>`;
}

function renderProducts() {
  const search = document.getElementById('productSearch').value.toLowerCase();
  const catF = document.getElementById('productCatFilter').value;
  const body = document.getElementById('productTableBody');

  const filtered = sortedProducts(state.products.filter(p =>
    (!search || p.name.toLowerCase().includes(search)) &&
    (!catF || p.category === catF)
  ));
  const pricingIssues = getProductsWithPricingIssues();

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">📦</div><p>No products. Add one above or load sample data.</p></div></td></tr>`;
    return;
  }

  body.innerHTML = filtered.map(p => {
    const priceWarn = pricingIssues.get(p.id);
    return `
    <tr id="prod-row-${p.id}"${priceWarn ? ' class="cogs-row-warn"' : ''}>
      <td style="font-weight:600">${p.name}${priceWarn ? `<span class="product-price-warn" title="Used in recipes — ${escapeHtml(priceWarn)}">⚠ ${escapeHtml(priceWarn)}</span>` : ''}</td>
      <td>${catBadge(p.category)}</td>
      <td style="color:var(--text-muted)">${p.supplier || '—'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${p.sku || '—'}</td>
      <td style="font-size:12px">${p.size || '—'}</td>
      <td style="font-weight:500">${p.unitsPerSku || 0}</td>
      <td class="qty-cell">
        <span class="qty-display">${p.qtyOrdered || 0}</span>
        <input class="qty-inline-input" type="text" value="${p.qtyOrdered || 0}"
          onkeydown="qtyKeydown(event,'${p.id}')"
          onblur="evalMathInput(this)">
      </td>
      <td style="font-weight:500">£${(p.orderPrice||0).toFixed(2)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm btn-icon edit-pencil" onclick="toggleQtyEdit('${p.id}')" title="Edit ordered qty">✏️</button>
          <button class="btn btn-sm btn-icon edit-tick" onclick="toggleQtyEdit('${p.id}')" title="Save qty">✓</button>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="openEditProduct('${p.id}')" title="Edit full product">⚙️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteProduct('${p.id}')" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

function openAddProduct() {
  editingProductId = null;
  if (typeof _pmClearFieldErrors === 'function') _pmClearFieldErrors();
  document.getElementById('productModalTitle').textContent = 'Add Product';
  document.getElementById('pm-name').value = '';
  refreshCategoryDropdowns();
  document.getElementById('pm-cat').value = getCategories()[0] || '';
  document.getElementById('pm-sku').value = '';
  document.getElementById('pm-size').value = '';
  document.getElementById('pm-units').value = '';
  document.getElementById('pm-qty').value = '';
  document.getElementById('pm-price').value = '';

  refreshSupplierSelect();
  const delBtn = document.getElementById('pm-delete-btn');
  if (delBtn) delBtn.style.display = 'none';
  openDrawer('productModal');
  setTimeout(() => { const n = document.getElementById('pm-name'); if (n) n.focus(); }, 220);
}

function openEditProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  if (typeof _pmClearFieldErrors === 'function') _pmClearFieldErrors();
  document.getElementById('productModalTitle').textContent = 'Edit Product';
  document.getElementById('pm-name').value = p.name;
  refreshCategoryDropdowns(p.category);
  document.getElementById('pm-sku').value = p.sku || '';
  document.getElementById('pm-size').value = p.size || '';
  document.getElementById('pm-units').value = p.unitsPerSku || '';
  document.getElementById('pm-qty').value = p.qtyOrdered || '';
  document.getElementById('pm-price').value = p.orderPrice || '';

  refreshSupplierSelect(p.supplier);
  const delBtn = document.getElementById('pm-delete-btn');
  if (delBtn) delBtn.style.display = '';
  openDrawer('productModal');
  setTimeout(() => { const n = document.getElementById('pm-name'); if (n) n.focus(); }, 220);
}

function deleteProductFromDrawer() {
  if (!editingProductId) return;
  if (!confirm('Delete this product?')) return;
  state.products = state.products.filter(p => p.id !== editingProductId);
  save(); renderProducts(); closeProductModal();
  toast('Product deleted', 'success');
}

// Generic drawer helpers — open/close any .modal-overlay.drawer by id.
// (Backwards compatible: still toggles .show, plus enables Esc-to-close.)
function openDrawer(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  _bindDrawerEsc();
}
function closeDrawer(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
}
let _drawerEscBound = false;
function _bindDrawerEsc() {
  if (_drawerEscBound) return;
  _drawerEscBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay.drawer.show').forEach(el => el.classList.remove('show'));
  });
}

function refreshSupplierSelect(selected) {
  const sel = document.getElementById('pm-supplier');
  sel.innerHTML = `<option value="">— None —</option>` + state.suppliers.map(s =>
    `<option value="${s.name}" ${s.name === selected ? 'selected' : ''}>${s.name}</option>`
  ).join('');
}

function evalPriceInput() {
  const el = document.getElementById('pm-price');
  if (!el || !el.value.trim()) return;
  if (/[+\-*\/]/.test(el.value)) {
    try {
      // Only allow safe numeric expressions
      const sanitised = el.value.replace(/[^0-9+\-*\/().\s]/g, '');
      const result = Function('"use strict"; return (' + sanitised + ')')();
      if (isFinite(result)) el.value = Math.round(result * 100) / 100;
    } catch(e) { /* leave as-is if invalid */ }
  }
}

function _pmClearFieldErrors() {
  document.querySelectorAll('#productModal .field-invalid').forEach(el => el.classList.remove('field-invalid'));
  document.querySelectorAll('#productModal .field-error-msg').forEach(el => el.remove());
}

function _pmShowFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('field-invalid');
  const row = el.closest('.form-row') || el.parentElement;
  if (row && !row.querySelector('.field-error-msg')) {
    const err = document.createElement('div');
    err.className = 'field-error-msg';
    err.textContent = msg;
    row.appendChild(err);
  }
  const clear = () => {
    el.classList.remove('field-invalid');
    const m = row && row.querySelector('.field-error-msg');
    if (m) m.remove();
    el.removeEventListener('input', clear);
    el.removeEventListener('change', clear);
  };
  el.addEventListener('input', clear);
  el.addEventListener('change', clear);
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(_) {}
  setTimeout(() => { try { el.focus(); } catch(_) {} }, 50);
}

function saveProduct() {
  _pmClearFieldErrors();
  const name = document.getElementById('pm-name').value.trim();
  if (!name) {
    toast('Product name required', 'error');
    _pmShowFieldError('pm-name', 'Product name is required');
    return;
  }
  const supplierVal = document.getElementById('pm-supplier').value;
  if (!supplierVal) {
    toast('Please select a supplier', 'error');
    _pmShowFieldError('pm-supplier', 'Please choose a supplier — products must belong to one.');
    return;
  }

  const p = {
    id: editingProductId || uid(),
    name,
    category: document.getElementById('pm-cat').value,
    supplier: supplierVal,
    sku: document.getElementById('pm-sku').value.trim(),
    size: document.getElementById('pm-size').value.trim(),
    unitsPerSku: parseFloat(document.getElementById('pm-units').value) || 0,
    qtyOrdered: parseFloat(document.getElementById('pm-qty').value) || 0,
    orderPrice: parseFloat(document.getElementById('pm-price').value) || 0,
    arrival: '',  // removed
  };

  if (editingProductId) {
    const i = state.products.findIndex(x => x.id === editingProductId);
    state.products[i] = p;
  } else {
    state.products.push(p);
  }

  save(); renderProducts(); closeProductModal();
  toast(editingProductId ? 'Product updated' : 'Product added', 'success');
}

function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  state.products = state.products.filter(p => p.id !== id);
  save(); renderProducts();
  toast('Product deleted', 'success');
}

function closeProductModal() {
  document.getElementById('productModal').classList.remove('show');
}

// ============================================================
// OPENING STOCK
// ============================================================
function renderOpening() {
  const body = document.getElementById('openingTableBody');
  // All named products, sorted A-Z (no category header rows)
  const products = [...state.products.filter(p => p.name)].sort((a,b) => (a.name||'').localeCompare(b.name||''));

  if (!products.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="icon">🚚</div><p>Add products first in the Products tab.</p></div></td></tr>`;
    return;
  }

  body.innerHTML = products.map(p => {
    const o = state.opening[p.id] || {};

    const alreadyVal   = o.alreadyInStock != null && o.alreadyInStock !== 0 ? o.alreadyInStock : '';
    const deliveredVal = o.deliveredQty   != null ? o.deliveredQty   : '';
    const damagedVal   = o.damaged        != null && o.damaged        !== 0 ? o.damaged        : '';

    const deliveredForCalc = o.deliveredQty   != null ? o.deliveredQty   : null;
    const alreadyForCalc   = o.alreadyInStock != null ? o.alreadyInStock : 0;
    const damagedForCalc   = o.damaged        != null ? o.damaged        : 0;
    const hasDelivered = deliveredForCalc != null;
    const opening = hasDelivered ? deliveredForCalc + alreadyForCalc - damagedForCalc : null;

    const validCat = state.categories.includes(p.category) ? p.category : '';
    const catBadgeHtml = validCat ? catBadge(validCat) : '';

    // New column order: Product | Category | Pack Size | Already in Stock | Qty Ordered | Qty Delivered | Damaged | Opening Stock
    return `
      <tr>
        <td style="font-weight:600">${p.name}</td>
        <td>${catBadgeHtml}</td>
        <td style="font-size:12px;color:var(--muted-foreground)">${p.size || '—'}</td>
        <td><input type="text" value="${alreadyVal}" placeholder="" id="o-ais-${p.id}" style="width:80px" onblur="evalMathInput(this)" onchange="recalcOpeningRow('${p.id}')"></td>
        <td style="font-weight:600">${p.qtyOrdered || '—'}</td>
        <td><input type="text" value="${deliveredVal}" placeholder="" id="o-del-${p.id}" style="width:80px" onblur="evalMathInput(this)" onchange="recalcOpeningRow('${p.id}')"></td>
        <td><input type="text" value="${damagedVal}" placeholder="" id="o-dmg-${p.id}" style="width:80px" onblur="evalMathInput(this)" onchange="recalcOpeningRow('${p.id}')"></td>
        <td style="font-weight:700" id="o-open-${p.id}">${opening != null ? opening : '—'}</td>
      </tr>
    `;
  }).join('');
}

function recalcOpeningRow(id) {
  const delEl = document.getElementById('o-del-' + id);
  const aisEl = document.getElementById('o-ais-' + id);
  const dmgEl = document.getElementById('o-dmg-' + id);
  const delRaw = delEl ? delEl.value.trim() : '';
  const aisRaw = aisEl ? aisEl.value.trim() : '';
  const del = delRaw !== '' ? parseFloat(delRaw) : null;
  const ais = aisRaw !== '' ? (parseFloat(aisRaw) || 0) : 0;
  const dmgRaw = dmgEl ? dmgEl.value.trim() : '';
  const dmg = dmgRaw !== '' ? (parseFloat(dmgRaw) || 0) : 0;
  const openEl = document.getElementById('o-open-' + id);
  if (del != null && !isNaN(del)) {
    if (openEl) openEl.textContent = Math.round((del + ais - dmg) * 10) / 10;
  } else {
    if (openEl) openEl.textContent = '—';
  }
  // Autosave — preserve invoiceQty if it exists (still used in closing/financial tab)
  const existing = state.opening[id] || {};
  state.opening[id] = {
    invoiceQty:    existing.invoiceQty ?? null,
    deliveredQty:  delRaw !== '' ? parseFloat(delRaw) : null,
    alreadyInStock: ais || 0,
    damaged:       dmg,
  };
  save();
}

function saveOpening() {
  state.products.filter(p => p.name).forEach(p => {
    const delEl  = document.getElementById('o-del-' + p.id);
    const aisEl  = document.getElementById('o-ais-' + p.id);
    const dmgEl  = document.getElementById('o-dmg-' + p.id);
    const delRaw = delEl  ? delEl.value.trim()  : '';
    const aisRaw = aisEl  ? aisEl.value.trim()  : '';
    const dmgRaw = dmgEl  ? dmgEl.value.trim()  : '';
    const existing = state.opening[p.id] || {};
    state.opening[p.id] = {
      invoiceQty:     existing.invoiceQty ?? null,
      deliveredQty:   delRaw !== '' ? parseFloat(delRaw) : null,
      alreadyInStock: aisRaw !== '' ? (parseFloat(aisRaw) || 0) : 0,
      damaged:        dmgRaw !== '' ? (parseFloat(dmgRaw) || 0) : 0,
    };
  });
  save();
  renderCountSessions();
  renderCountSummary();
  toast('Opening stock saved', 'success');
}

function getOpeningStock(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return 0;
  const o = state.opening[productId];
  const base = (o?.deliveredQty ?? p.qtyOrdered) + (o?.alreadyInStock ?? 0) - (o?.damaged ?? 0);
  // Add all top-up deliveries for this product
  const topupTotal = (state.topups || []).reduce((sum, session) => {
    const entry = (session.entries || {})[productId];
    if (!entry) return sum;
    return sum + (entry.qty || 0) - (entry.damaged || 0);
  }, 0);
  return base + topupTotal;
}

// ============================================================
// DISTRIBUTION
// ============================================================
function renderDistribution() {
  const bars = state.bars;
  const products = sortedProducts(state.products.filter(p => p.name));

  if (!products.length || !bars.length) {
    document.getElementById('distHead').innerHTML = '';
    document.getElementById('distBody').innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">🗂</div><p>Add products and bars in Settings first.</p></div></td></tr>`;
    return;
  }

  // Build header
  document.getElementById('distHead').innerHTML = `
    <tr>
      <th>Product</th>
      <th>Category</th>
      <th>Pack Size</th>
      <th>Opening Stock</th>
      <th style="color:var(--accent)">Left to Allocate</th>
      ${bars.map(b => `<th class="dist-bar-header">${b}</th>`).join('')}
    </tr>
  `;

  document.getElementById('distBody').innerHTML = products.map(p => {
    const opening = getOpeningStock(p.id);
    const dist = state.distribution[p.id] || {};
    let allocated = bars.reduce((sum, b) => sum + (parseFloat(dist[b]) || 0), 0);
    const lta = opening - allocated;
    const ltaClass = lta < 0 ? 'lta-over' : lta === 0 ? 'lta-neutral' : 'lta-ok';

    const distCatBadge = catBadge(p.category);
    return `
      <tr>
        <td style="font-weight:500;white-space:nowrap">${p.name}</td>
        <td>${distCatBadge}</td>
        <td style="font-size:12px;color:var(--muted-foreground)">${p.size || '—'}</td>
        <td style="font-family:'DM Mono',monospace">${opening}</td>
        <td><span class="lta-badge ${ltaClass}" id="lta-${p.id}">${lta}</span></td>
        ${bars.map(b => `<td><input type="number" value="${dist[b] || ''}" placeholder="0" style="width:70px" onchange="updateDist('${p.id}','${b}',this.value)" id="dist-${p.id}-${b.replace(/\s/g,'_')}"></td>`).join('')}
      </tr>
    `;
  }).join('');
}

function updateDist(pid, bar, val) {
  if (!state.distribution[pid]) state.distribution[pid] = {};
  state.distribution[pid][bar] = parseFloat(val) || 0;
  // Update LTA live
  const bars = state.bars;
  const opening = getOpeningStock(pid);
  const dist = state.distribution[pid];
  const allocated = bars.reduce((sum, b) => sum + (dist[b] || 0), 0);
  const lta = opening - allocated;
  const ltaEl = document.getElementById('lta-' + pid);
  if (ltaEl) {
    ltaEl.textContent = lta;
    ltaEl.className = 'lta-badge ' + (lta < 0 ? 'lta-over' : lta === 0 ? 'lta-neutral' : 'lta-ok');
  }
  save(); // autosave
}

function saveDistribution() {
  // Sync all inputs
  state.products.forEach(p => {
    state.bars.forEach(b => {
      const el = document.getElementById('dist-' + p.id + '-' + b.replace(/\s/g,'_'));
      if (el) {
        if (!state.distribution[p.id]) state.distribution[p.id] = {};
        state.distribution[p.id][b] = parseFloat(el.value) || 0;
      }
    });
  });
  save();
  toast('Distribution saved', 'success');
}

// ============================================================
// ============================================================
// STOCK COUNTS
// ============================================================

// Returns total counted CASES for a product from ONE specific session, across ALL bars
// singles are converted to fractional cases using unitsPerSku
function getSessionCountedCases(session, productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p || !session) return null; // null = no data entered at all
  let totalUnits = 0;
  let hasAnyEntry = false;
  Object.entries(session.data || {}).forEach(([key, val]) => {
    if (key.startsWith(productId + '_')) {
      const cases   = parseFloat(val.cases)   || 0;
      const singles = parseFloat(val.singles)  || 0;
      if (cases || singles) hasAnyEntry = true;
      totalUnits += (cases * (p.unitsPerSku || 1)) + singles;
    }
  });
  if (!hasAnyEntry) return null; // blank = not yet counted, don't show zero
  return totalUnits / (p.unitsPerSku || 1); // return as cases (may be fractional)
}

function renderCountSessions() {
  const list = document.getElementById('countSessionList');
  if (!list) return;

  if (!state.counts.length) {
    list.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">🔢</div><p>No count sessions yet. Create one above.</p></div>';
    renderCountSummary();
    return;
  }

  list.innerHTML = state.counts.map(c => {
    const isClosing  = c.isClosingCount;
    const isExpanded = c._uiExpanded || false;
    const isChecked  = c._inChecker  || false;
    const closingBadge = isClosing
      ? '<span style="background:#18181b;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;letter-spacing:0.4px;margin-left:8px">CLOSING COUNT</span>'
      : '';
    const closingBtnStyle = isClosing
      ? 'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;'
      : 'background:var(--secondary);border:1px solid var(--border);';

    return `
      <div style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;overflow:hidden;${isClosing ? 'border-left:3px solid #18181b;' : ''}">
        <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;user-select:none"
          onclick="toggleCountSession('${c.id}')">
          <input type="checkbox" ${isChecked ? 'checked' : ''}
            style="width:15px;height:15px;cursor:pointer;flex-shrink:0"
            title="Include in Low Stock Flag Checker"
            onclick="event.stopPropagation(); toggleCountInChecker('${c.id}', this.checked)">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600">${c.name}${closingBadge}</div>
            <div style="font-size:11px;color:var(--muted-foreground);margin-top:2px">${c.bar || 'All Bars'} · ${c.date}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0" onclick="event.stopPropagation()">
            <button class="btn btn-sm" style="${closingBtnStyle}font-size:11px;padding:4px 8px"
              onclick="toggleClosingCount('${c.id}')">${isClosing ? '\u2713 Closing Count' : 'Mark as Closing Count'}</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="deleteCount('${c.id}')">\u{1F5D1}\uFE0F</button>
          </div>
          <span style="font-size:14px;color:var(--muted-foreground);transition:transform 0.2s;transform:${isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)'};flex-shrink:0">\u25be</span>
        </div>
        <div id="count-inline-${c.id}" style="display:${isExpanded ? 'block' : 'none'};border-top:1px solid var(--border)">
          <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;background:var(--muted)">
            <div class="chip-row" id="countBarChips-${c.id}" style="margin:0;gap:6px"></div>
            <button class="btn btn-primary btn-sm" onclick="saveCurrentCount('${c.id}')">&#128190; Save</button>
          </div>
          <div class="table-wrap" style="border:none;border-radius:0">
            <div class="table-scroll"><table>
              <thead>
                <tr>
                  <th>Product</th><th>Category</th><th>Pack Size</th>
                  <th id="countBarHeader-${c.id}">${c.bar || (state.bars[0] || 'Storage Location')}</th>
                  <th>Count (Cases)</th><th>Count (Singles)</th>
                </tr>
              </thead>
              <tbody id="countTableBody-${c.id}"></tbody>
            </table></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Render bar chips and count tables for expanded sessions
  state.counts.forEach(c => {
    if (c._uiExpanded) {
      renderInlineCountTable(c.id);
      renderInlineBarChips(c.id);
    }
  });

  renderCountSummary();
}

function toggleCountSession(id) {
  const c = state.counts.find(x => x.id === id);
  if (!c) return;
  state.counts.forEach(x => { if (x.id !== id) x._uiExpanded = false; });
  c._uiExpanded = !c._uiExpanded;
  activeCountSessionId = c._uiExpanded ? id : null;
  renderCountSessions();
}

function toggleCountInChecker(id, checked) {
  const c = state.counts.find(x => x.id === id);
  if (c) c._inChecker = checked;
  renderCountSummary();
}

function renderInlineBarChips(sessionId) {
  const c = state.counts.find(x => x.id === sessionId);
  if (!c) return;
  const chips = document.getElementById('countBarChips-' + sessionId);
  if (!chips) return;
  if (c.bar) {
    chips.innerHTML = '<span style="font-size:12px;color:var(--muted-foreground)">' + c.bar + '</span>';
    return;
  }
  if (!activeCountBar) activeCountBar = state.bars[0] || '';
  chips.innerHTML = state.bars.map(b => {
    const esc = b.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return '<span class="chip ' + (b === activeCountBar ? 'active' : '') + '" ' +
      'onclick="switchCountBarInline(\'' + sessionId + '\',\'' + esc + '\')">' + b + '</span>';
  }).join('');
}

function switchCountBarInline(sessionId, bar) {
  activeCountBar = bar;
  const chips = document.getElementById('countBarChips-' + sessionId);
  if (chips) chips.querySelectorAll('.chip').forEach(ch => {
    ch.classList.toggle('active', ch.textContent === bar);
  });
  const hdr = document.getElementById('countBarHeader-' + sessionId);
  if (hdr) hdr.textContent = bar;
  renderInlineCountTable(sessionId);
}

function renderInlineCountTable(sessionId) {
  const c = state.counts.find(x => x.id === sessionId);
  if (!c) return;
  const body = document.getElementById('countTableBody-' + sessionId);
  if (!body) return;
  const barKey = activeCountBar || c.bar || '';
  const hdr = document.getElementById('countBarHeader-' + sessionId);
  if (hdr) hdr.textContent = barKey || 'Storage Location';
  const products = [...state.products.filter(p => p.name)]
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));
  body.innerHTML = products.map(p => {
    const key = p.id + '_' + barKey;
    const d = (c.data || {})[key] || {};
    const casesVal   = d.cases   != null && d.cases   !== 0 ? d.cases   : '';
    const singlesVal = d.singles != null && d.singles !== 0 ? d.singles : '';
    return `<tr>
      <td style="font-weight:600">${p.name}</td>
      <td>${catBadge(p.category)}</td>
      <td style="font-size:12px;color:var(--muted-foreground)">${p.size || '—'}</td>
      <td style="font-size:12px;color:var(--muted-foreground)">${barKey}</td>
      <td><input type="text" value="${casesVal}" placeholder="" style="width:90px"
        id="cnt-cases-${sessionId}-${p.id}" onblur="evalMathInput(this)"
        onchange="autoSaveCountEntry('${sessionId}','${p.id}')"></td>
      <td><input type="text" value="${singlesVal}" placeholder="" style="width:90px"
        id="cnt-singles-${sessionId}-${p.id}" onblur="evalMathInput(this)"
        onchange="autoSaveCountEntry('${sessionId}','${p.id}')"></td>
    </tr>`;
  }).join('');
}


function toggleClosingCount(id) {
  // Only one session can be the closing count at a time
  state.counts.forEach(c => {
    if (c.id === id) {
      c.isClosingCount = !c.isClosingCount;
    } else {
      c.isClosingCount = false; // unmark any other
    }
  });
  save();
  renderCountSessions();
}

function renderCountSummary() {
  const wrap     = document.getElementById('lowStockBody');
  const noteEl   = document.getElementById('lowStockSessionNote');
  const tableBody = document.getElementById('countSummaryBody2');
  if (!tableBody) return;

  // Which sessions are ticked for the checker?
  const checkedSessions = (state.counts || []).filter(c => c._inChecker);
  const products = [...state.products.filter(p => p.name)]
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));

  if (!products.length) {
    tableBody.innerHTML = '';
    if (noteEl) noteEl.textContent = 'Add products first.';
    return;
  }

  if (!checkedSessions.length) {
    tableBody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted-foreground);font-size:13px">Tick one or more count sessions above to see low stock flags.</td></tr>';
    if (noteEl) noteEl.style.display = 'none';
    return;
  }

  if (noteEl) noteEl.style.display = 'none';

  const sessionNames = checkedSessions.map(c => c.name).join(', ');
  const progressEl = document.getElementById('eventProgressPct');
  const eventPct = progressEl ? (parseFloat(progressEl.value) || 0) : 0;

  tableBody.innerHTML = products.map(p => {
    const openingCases = getOpeningStock(p.id);

    // Aggregate counted cases across all checked sessions
    let totalCountedUnits = 0;
    let hasAnyEntry = false;
    checkedSessions.forEach(session => {
      Object.entries(session.data || {}).forEach(([key, val]) => {
        if (key.startsWith(p.id + '_')) {
          const cases   = parseFloat(val.cases)   || 0;
          const singles = parseFloat(val.singles)  || 0;
          if (cases || singles) hasAnyEntry = true;
          totalCountedUnits += (cases * (p.unitsPerSku || 1)) + singles;
        }
      });
    });
    const countedCases = hasAnyEntry ? totalCountedUnits / (p.unitsPerSku || 1) : null;

    let suggestedOrder = null;
    let atRisk = false;
    if (countedCases !== null && eventPct > 0 && eventPct < 100 && openingCases > 0) {
      const usedCases = openingCases - countedCases;
      const ratePerPct = usedCases / eventPct;
      const expectedRemaining = ratePerPct * (100 - eventPct);
      const shortfall = expectedRemaining - countedCases;
      if (shortfall > 0) { suggestedOrder = Math.ceil(shortfall); atRisk = true; }
    }

    const openingStr = openingCases > 0 ? String(openingCases) : '—';
    const countedStr = countedCases !== null ? countedCases.toFixed(1).replace(/\.0$/, '') : '—';
    const orderStr   = atRisk
      ? '<span style="display:inline-flex;align-items:center;gap:5px;color:#dc2626;font-weight:700">' + Math.ceil(suggestedOrder) + ' cases <span style="background:#dc2626;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px">\u26a0 ORDER</span></span>'
      : (countedCases !== null && eventPct > 0 ? '<span style="color:#16a34a;font-weight:600">\u2713 On track</span>' : '—');

    return '<tr style="' + (atRisk ? 'background:#fef2f2;' : '') + '">' +
      '<td style="font-weight:600">' + p.name + '</td>' +
      '<td>' + catBadge(p.category) + '</td>' +
      '<td style="font-size:12px;color:var(--muted-foreground)">' + (p.size || '—') + '</td>' +
      '<td style="font-weight:600">' + openingStr + '</td>' +
      '<td style="font-weight:600">' + countedStr + '</td>' +
      '<td>' + orderStr + '</td>' +
      '</tr>';
  }).join('');
}

function downloadCountSummaryPDF() {
  const checkedSessions = (state.counts || []).filter(c => c._inChecker);
  if (!checkedSessions.length) { toast('Tick at least one count session to include in the checker', 'error'); return; }
  const session = checkedSessions[0]; // use first for metadata (name, date)

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW  = 210;
  const pageH  = 297;
  const ml     = 15;
  const mr     = 15;
  const cW     = pageW - ml - mr;
  const black  = [20, 20, 20];
  const grey   = [120, 120, 120];
  const light  = [220, 220, 220];
  const bgGrey = [245, 245, 245];
  const bgRed  = [254, 242, 242];
  const red    = [220, 38, 38];
  const green  = [22, 163, 74];

  function sf(style, size, color) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...(color || black));
  }

  // ── Logo bracket marks ──────────────────────────────────────────────
  const logoX = pageW - mr - 46;
  const logoY = 8;
  doc.setDrawColor(...light);
  doc.setLineWidth(0.6);
  doc.line(logoX, logoY + 4, logoX, logoY);
  doc.line(logoX, logoY, logoX + 4, logoY);
  doc.line(logoX + 46 - 4, logoY + 13, logoX + 46, logoY + 13);
  doc.line(logoX + 46, logoY + 13 - 4, logoX + 46, logoY + 13);
  sf('bold', 22, black);
  doc.text('measured', pageW - mr - 2, 18, { align: 'right' });

  // ── Title ────────────────────────────────────────────────────────────
  sf('bold', 22, black);
  doc.text('Live Count Summary', ml, 18);

  // ── Meta row ─────────────────────────────────────────────────────────
  let y = 28;
  const eventPct = parseFloat(document.getElementById('eventProgressPct')?.value) || 0;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  sf('normal', 9, grey);
  doc.text(`Event: ${state.showName || '—'}`, ml, y);
  doc.text('Sessions: ' + checkedSessions.map(s => s.name).join(', '), ml + 70, y);
  doc.text(`Printed: ${dateStr} at ${timeStr}`, ml, y + 5);
  if (eventPct > 0) {
    doc.text(`Event progress: ${eventPct}%`, ml + 70, y + 5);
  }

  // ── Table ─────────────────────────────────────────────────────────────
  y += 14;

  // Column widths
  const c1 = cW * 0.36; // Product
  const c2 = cW * 0.22; // Pack Size
  const c3 = cW * 0.13; // Opening
  const c4 = cW * 0.13; // Counted
  const c5 = cW - c1 - c2 - c3 - c4; // Suggested Order

  // Header
  doc.setFillColor(...bgGrey);
  doc.rect(ml, y, cW, 8, 'F');
  doc.setDrawColor(...light);
  doc.setLineWidth(0.3);
  doc.rect(ml, y, cW, 8, 'S');
  sf('bold', 8, grey);
  doc.text('PRODUCT',              ml + 2,              y + 5.5);
  doc.text('PACK SIZE',            ml + c1 + 2,         y + 5.5);
  doc.text('OPENING (CASES)',      ml + c1 + c2 + 2,    y + 5.5);
  doc.text('COUNTED (CASES)',      ml + c1 + c2 + c3 + 2, y + 5.5);
  doc.text('SUGGESTED ORDER',      ml + c1 + c2 + c3 + c4 + 2, y + 5.5);
  y += 8;

  const products = sortedProducts(state.products.filter(p => p.name));
  const rowH = 8;
  let lastCat = '';
  let i = 0;

  products.forEach(p => {
    // Page break
    if (y + rowH > pageH - 16) {
      doc.addPage();
      y = 15;
    }

    // Category divider
    if (p.category !== lastCat) {
      lastCat = p.category;
      doc.setFillColor(230, 230, 230);
      doc.rect(ml, y, cW, 6, 'F');
      sf('bold', 7.5, [80, 80, 80]);
      doc.text((p.category || 'Uncategorised').toUpperCase(), ml + 2, y + 4.2);
      y += 6;
    }

    const openingCases = getOpeningStock(p.id);
    // Aggregate across all checked sessions
    let totalCountedUnits = 0; let hasAnyPDF = false;
    checkedSessions.forEach(cs => {
      Object.entries(cs.data || {}).forEach(([key, val]) => {
        if (key.startsWith(p.id + '_')) {
          const cases = parseFloat(val.cases) || 0; const singles = parseFloat(val.singles) || 0;
          if (cases || singles) hasAnyPDF = true;
          totalCountedUnits += (cases * (p.unitsPerSku || 1)) + singles;
        }
      });
    });
    const countedCases = hasAnyPDF ? totalCountedUnits / (p.unitsPerSku || 1) : null;

    let suggestedOrder = null;
    let atRisk = false;
    if (countedCases !== null && eventPct > 0 && eventPct < 100 && openingCases > 0) {
      const usedCases = openingCases - countedCases;
      const ratePerPct = usedCases / eventPct;
      const expectedRemaining = ratePerPct * (100 - eventPct);
      const shortfall = expectedRemaining - countedCases;
      if (shortfall > 0) {
        suggestedOrder = Math.ceil(shortfall);
        atRisk = true;
      }
    }

    // Row background
    if (atRisk) {
      doc.setFillColor(...bgRed);
      doc.rect(ml, y, cW, rowH, 'F');
    } else if (i % 2 === 1) {
      doc.setFillColor(...bgGrey);
      doc.rect(ml, y, cW, rowH, 'F');
    }

    // Row border
    doc.setDrawColor(...light);
    doc.setLineWidth(0.2);
    doc.rect(ml, y, cW, rowH, 'S');

    const openStr    = openingCases > 0 ? String(openingCases) : '—';
    const countStr   = countedCases !== null ? countedCases.toFixed(1).replace(/\.0$/, '') : '—';
    const orderStr   = atRisk ? `${suggestedOrder} cases` : (countedCases !== null && eventPct > 0 ? 'On track' : '—');
    const orderColor = atRisk ? red : (countedCases !== null && eventPct > 0 ? green : grey);

    sf('normal', 8.5, atRisk ? red : black);
    doc.text(p.name || '', ml + 2, y + 5.5, { maxWidth: c1 - 3 });

    sf('normal', 8, grey);
    doc.text(p.size || '—', ml + c1 + 2, y + 5.5, { maxWidth: c2 - 3 });

    sf('normal', 8.5, black);
    doc.text(openStr,  ml + c1 + c2 + 2,         y + 5.5);
    doc.text(countStr, ml + c1 + c2 + c3 + 2,    y + 5.5);

    sf('bold', 8.5, orderColor);
    doc.text(orderStr, ml + c1 + c2 + c3 + c4 + 2, y + 5.5);

    y += rowH;
    i++;
  });

  // ── Footer ────────────────────────────────────────────────────────────
  sf('normal', 7, [180, 180, 180]);
  doc.text(`Generated by Measured STOCK · ${state.showName || ''}`, pageW / 2, pageH - 8, { align: 'center' });

  // ── Save ──────────────────────────────────────────────────────────────
  const safeName = (session.name || 'count').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dateTag  = now.toLocaleDateString('en-GB').replace(/\//g, '-');
  doc.save(`count_summary_${safeName}_${dateTag}.pdf`);
  toast('PDF downloaded', 'success');
}

function openNewCountSession() {
  const sel = document.getElementById('cm-bar');
  sel.innerHTML = `<option value="">All Bars</option>` + state.bars.map(b => `<option value="${b}">${b}</option>`).join('');
  document.getElementById('cm-name').value = new Date().toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'short'});
  document.getElementById('countModal').classList.add('show');
}

function closeCountModal() { document.getElementById('countModal').classList.remove('show'); }

function startCountSession() {
  const name = document.getElementById('cm-name').value.trim();
  if (!name) { toast('Session name required', 'error'); return; }
  const bar = document.getElementById('cm-bar').value;
  const session = { id: uid(), name, bar, date: new Date().toLocaleDateString('en-GB'), data: {} };
  state.counts.push(session);
  save();
  closeCountModal();
  renderCountSessions();
  // Session will render inline when user clicks it
}

function deleteCount(id) {
  if (!confirm('Delete this count session?')) return;
  state.counts = state.counts.filter(c => c.id !== id);
  if (activeCountSessionId === id) activeCountSessionId = null;
  save();
  renderCountSessions();
}

function saveCurrentCount(sessionId) {
  const sid = sessionId || activeCountSessionId;
  const session = state.counts.find(c => c.id === sid);
  if (!session) return;
  if (!session.data) session.data = {};
  const barKey = activeCountBar || session.bar || '';

  state.products.forEach(p => {
    const key        = p.id + '_' + barKey;
    const casesEl   = document.getElementById('cnt-cases-'   + sid + '-' + p.id);
    const singlesEl = document.getElementById('cnt-singles-' + sid + '-' + p.id);
    const casesRaw   = casesEl?.value.trim();
    const singlesRaw = singlesEl?.value.trim();
    const cases   = casesRaw   !== '' ? (parseFloat(casesRaw)   || 0) : 0;
    const singles = singlesRaw !== '' ? (parseFloat(singlesRaw) || 0) : 0;
    if (cases || singles) session.data[key] = { cases, singles };
    else delete session.data[key];
  });

  save();
  renderCountSummary();
  toast('Count saved', 'success');
}

function autoSaveCountEntry(sessionId, productId) {
  const session = state.counts.find(c => c.id === sessionId);
  if (!session) return;
  if (!session.data) session.data = {};
  const barKey    = activeCountBar || session.bar || '';
  const key       = productId + '_' + barKey;
  const casesEl   = document.getElementById('cnt-cases-'   + sessionId + '-' + productId);
  const singlesEl = document.getElementById('cnt-singles-' + sessionId + '-' + productId);
  const casesRaw   = casesEl?.value.trim();
  const singlesRaw = singlesEl?.value.trim();
  const cases   = casesRaw   !== '' ? (parseFloat(casesRaw)   || 0) : 0;
  const singles = singlesRaw !== '' ? (parseFloat(singlesRaw) || 0) : 0;
  if (cases || singles) session.data[key] = { cases, singles };
  else delete session.data[key];
  save();
  renderCountSummary();
}

function closeCountSession() {
  activeCountSessionId = null;
  state.counts.forEach(c => { c._uiExpanded = false; });
  renderCountSessions();
}

// ============================================================
// MATH EVAL FOR INPUTS
// ============================================================
function evalMathInput(input) {
  const raw = input.value.trim();
  if (!raw) return;
  // Only process if it contains operators
  if (/[+\-*\/]/.test(raw)) {
    try {
      // Safe eval: only allow digits, operators, dots, spaces, parens
      const sanitised = raw.replace(/[^0-9+\-*\/().\s]/g, '');
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict"; return (' + sanitised + ')')();
      if (typeof result === 'number' && isFinite(result)) {
        input.value = Math.round(result * 10) / 10;
        // Trigger change for recalc if needed
        input.dispatchEvent(new Event('change'));
      }
    } catch(e) { /* invalid expression — leave as-is */ }
  } else {
    // Just normalise to 1dp if it's a plain number
    const n = parseFloat(raw);
    if (!isNaN(n)) input.value = Math.round(n * 10) / 10;
  }
}

// ============================================================
// INLINE QTY EDITING (Products tab)
// ============================================================
function toggleQtyEdit(id) {
  const row = document.getElementById('prod-row-' + id);
  if (!row) return;
  const isEditing = row.classList.contains('qty-editing');
  if (isEditing) {
    // Save
    const input = row.querySelector('.qty-inline-input');
    evalMathInput(input);
    const newQty = parseFloat(input.value);
    if (!isNaN(newQty) && newQty >= 0) {
      const p = state.products.find(x => x.id === id);
      if (p) {
        p.qtyOrdered = Math.round(newQty * 10) / 10;
        row.querySelector('.qty-display').textContent = p.qtyOrdered;
      }
    }
    row.classList.remove('qty-editing');
    save();
    toast('Qty updated', 'success');
  } else {
    // Enter edit mode
    const p = state.products.find(x => x.id === id);
    row.querySelector('.qty-inline-input').value = p ? p.qtyOrdered : 0;
    row.classList.add('qty-editing');
    setTimeout(() => row.querySelector('.qty-inline-input').select(), 50);
  }
}

// Allow Enter key to save
function qtyKeydown(e, id) {
  if (e.key === 'Enter') toggleQtyEdit(id);
  if (e.key === 'Escape') {
    const row = document.getElementById('prod-row-' + id);
    if (row) row.classList.remove('qty-editing');
  }
}

// ============================================================
// TOP-UPS
// ============================================================
let activeTopupSessionId = null;

function renderTopups() {
  const list = document.getElementById('topupSessionList');
  if (!list) return;
  if (!state.topups || !state.topups.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📦</div><p>No top-up sessions yet. Create one above.</p></div>`;
  } else {
    list.innerHTML = state.topups.map(s => `
      <div class="count-session">
        <div class="count-session-info">
          <div class="count-session-name">${s.name}</div>
          <div class="count-session-meta">${s.supplier || 'Mixed'} · ${s.date}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="openTopupSession('${s.id}')">Open</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteTopup('${s.id}')">🗑️</button>
        </div>
      </div>
    `).join('');
  }
}

function openNewTopupSession() {
  // Populate supplier dropdown in modal
  const sel = document.getElementById('tum-supplier');
  sel.innerHTML = `<option value="">— Mixed / Multiple —</option>` +
    state.suppliers.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  document.getElementById('tum-name').value =
    new Date().toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}) + ' Top-Up';
  document.getElementById('topupModal').classList.add('show');
}

function closeTopupModal() {
  document.getElementById('topupModal').classList.remove('show');
}

function startTopupSession() {
  const name = document.getElementById('tum-name').value.trim();
  if (!name) { toast('Session name required', 'error'); return; }
  const supplier = document.getElementById('tum-supplier').value;
  if (!state.topups) state.topups = [];
  const session = {
    id: uid(),
    name,
    supplier,
    date: new Date().toLocaleDateString('en-GB'),
    entries: {},
  };
  state.topups.push(session);
  save();
  closeTopupModal();
  renderTopups();
  activateTopup(session.id);
}

function deleteTopup(id) {
  if (!confirm('Delete this top-up session?')) return;
  state.topups = state.topups.filter(s => s.id !== id);
  if (activeTopupSessionId === id) {
    activeTopupSessionId = null;
    document.getElementById('activeTopupPanel').style.display = 'none';
  }
  save();
  renderTopups();
  renderAll(); // update counts + summary since getOpeningStock has changed
}

function activateTopup(id) {
  activeTopupSessionId = id;
  const session = state.topups.find(s => s.id === id);
  if (!session) return;
  document.getElementById('activeTopupPanel').style.display = 'block';
  document.getElementById('activeTopupTitle').textContent = session.name;
  document.getElementById('activeTopupMeta').textContent =
    (session.supplier || 'Mixed suppliers') + ' · ' + session.date;
  renderTopupTable();
}

function openTopupSession(id) { activateTopup(id); }

function closeTopupSession() {
  document.getElementById('activeTopupPanel').style.display = 'none';
  activeTopupSessionId = null;
}

function renderTopupTable() {
  const session = state.topups.find(s => s.id === activeTopupSessionId);
  if (!session) return;
  const body = document.getElementById('topupTableBody');
  const products = [...state.products.filter(p => p.name)]
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));

  if (!products.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="icon">📦</div><p>Add products first.</p></div></td></tr>`;
    return;
  }

  body.innerHTML = products.map(p => {
    const entry = (session.entries || {})[p.id] || {};
    const qtyVal     = entry.qty     != null && entry.qty     !== 0 ? entry.qty     : '';
    const damagedVal = entry.damaged != null && entry.damaged !== 0 ? entry.damaged : '';
    // Default invoice price to product's order price; use saved value if already set
    const priceVal   = entry.invoicePrice != null ? entry.invoicePrice : (p.orderPrice || '');

    // Supplier dropdown — default to product's own supplier, then session supplier, then blank
    const defaultSupplier = entry.supplier || p.supplier || session.supplier || '';
    const supplierOpts = `<option value="">— Same as session —</option>` +
      state.suppliers.map(s =>
        `<option value="${s.name}" ${defaultSupplier === s.name ? 'selected' : ''}>${s.name}</option>`
      ).join('');

    const validCat = state.categories.includes(p.category) ? p.category : '';
    const catBadgeHtml = validCat ? catBadge(validCat) : '';

    // Running total = opening stock + all previous top-ups + this entry
    const previousTopups = (state.topups || []).reduce((sum, s) => {
      if (s.id === activeTopupSessionId) return sum;
      const e = (s.entries || {})[p.id];
      return sum + (e ? (e.qty || 0) - (e.damaged || 0) : 0);
    }, 0);
    const baseOpening = (() => {
      const o = state.opening[p.id];
      return (o?.deliveredQty ?? p.qtyOrdered) + (o?.alreadyInStock ?? 0) - (o?.damaged ?? 0);
    })();
    const thisQty = qtyVal !== '' ? (parseFloat(qtyVal) || 0) - (damagedVal !== '' ? parseFloat(damagedVal) || 0 : 0) : 0;
    const runningTotal = baseOpening + previousTopups + thisQty;

    return `
      <tr>
        <td style="font-weight:600">${p.name}</td>
        <td>${catBadgeHtml}</td>
        <td style="font-size:12px;color:var(--muted-foreground)">${p.size || '—'}</td>
        <td>
          <select style="font-size:12px;padding:4px 6px;width:130px" id="tu-sup-${p.id}"
            onchange="autoSaveTopupEntry('${p.id}')">
            ${supplierOpts}
          </select>
        </td>
        <td><input type="text" value="${qtyVal}" placeholder="" id="tu-qty-${p.id}"
          style="width:80px" onblur="evalMathInput(this)" onchange="autoSaveTopupEntry('${p.id}')"></td>
        <td><input type="text" value="${damagedVal}" placeholder="" id="tu-dmg-${p.id}"
          style="width:80px" onblur="evalMathInput(this)" onchange="autoSaveTopupEntry('${p.id}')"></td>
        <td><input type="text" value="${priceVal}" placeholder="£/SKU" id="tu-price-${p.id}"
          style="width:80px" onblur="evalMathInput(this)" onchange="autoSaveTopupEntry('${p.id}')"></td>
        <td style="font-weight:700" id="tu-total-${p.id}">${runningTotal}</td>
      </tr>
    `;
  }).join('');
}

function autoSaveTopupEntry(productId) {
  const session = state.topups.find(s => s.id === activeTopupSessionId);
  if (!session) return;
  if (!session.entries) session.entries = {};

  const qtyEl   = document.getElementById('tu-qty-'   + productId);
  const dmgEl   = document.getElementById('tu-dmg-'   + productId);
  const priceEl = document.getElementById('tu-price-' + productId);
  const supEl   = document.getElementById('tu-sup-'   + productId);

  const qtyRaw   = qtyEl   ? qtyEl.value.trim()   : '';
  const dmgRaw   = dmgEl   ? dmgEl.value.trim()   : '';
  const priceRaw = priceEl ? priceEl.value.trim() : '';

  const qty     = qtyRaw   !== '' ? (parseFloat(qtyRaw)   || 0) : null;
  const damaged = dmgRaw   !== '' ? (parseFloat(dmgRaw)   || 0) : 0;
  const price   = priceRaw !== '' ? (parseFloat(priceRaw) || 0) : null;
  const supplier = supEl ? supEl.value : '';

  if (qty !== null || damaged) {
    session.entries[productId] = {
      qty:          qty ?? 0,
      damaged:      damaged,
      invoicePrice: price,
      supplier:     supplier || null,
    };
  } else {
    delete session.entries[productId];
  }

  save();

  // Update running total cell live
  const p = state.products.find(x => x.id === productId);
  if (p) {
    const previousTopups = (state.topups || []).reduce((sum, s) => {
      if (s.id === activeTopupSessionId) return sum;
      const e = (s.entries || {})[productId];
      return sum + (e ? (e.qty || 0) - (e.damaged || 0) : 0);
    }, 0);
    const o = state.opening[productId];
    const base = (o?.deliveredQty ?? p.qtyOrdered) + (o?.alreadyInStock ?? 0) - (o?.damaged ?? 0);
    const thisQty = (qty ?? 0) - damaged;
    const totalEl = document.getElementById('tu-total-' + productId);
    if (totalEl) totalEl.textContent = base + previousTopups + thisQty;
  }

  // Refresh count summary since getOpeningStock has changed
  renderCountSummary();
}

function saveTopup() {
  const session = state.topups.find(s => s.id === activeTopupSessionId);
  if (!session) return;
  // autoSaveTopupEntry already persists each change — this is a manual full save
  if (!session.entries) session.entries = {};
  const products = state.products.filter(p => p.name);
  products.forEach(p => {
    const qtyEl   = document.getElementById('tu-qty-'   + p.id);
    const dmgEl   = document.getElementById('tu-dmg-'   + p.id);
    const priceEl = document.getElementById('tu-price-' + p.id);
    const supEl   = document.getElementById('tu-sup-'   + p.id);
    const qtyRaw   = qtyEl   ? qtyEl.value.trim()   : '';
    const dmgRaw   = dmgEl   ? dmgEl.value.trim()   : '';
    const priceRaw = priceEl ? priceEl.value.trim() : '';
    const qty = qtyRaw !== '' ? (parseFloat(qtyRaw) || 0) : null;
    if (qty !== null && qty > 0) {
      session.entries[p.id] = {
        qty,
        damaged:      dmgRaw !== '' ? (parseFloat(dmgRaw) || 0) : 0,
        invoicePrice: priceRaw !== '' ? (parseFloat(priceRaw) || 0) : null,
        supplier:     supEl ? supEl.value || null : null,
      };
    } else {
      delete session.entries[p.id];
    }
  });
  save();
  renderCountSessions();
  renderCountSummary();
  toast('Top-up saved', 'success');
}

// ============================================================
// WASTAGE
// ============================================================
let wastageUnit = 'cases';
let wastageLines = [];

function setWastageUnit(unit) {
  wastageUnit = unit;
  document.getElementById('ws-unit-cases').classList.toggle('active', unit === 'cases');
  document.getElementById('ws-unit-units').classList.toggle('active', unit === 'units');
}

function addWastageLine() {
  wastageLines.push({ lineId: uid(), productId: '', qty: '' });
  renderWastageLines();
}

function updateWastageLine(lineId, field, value) {
  const line = wastageLines.find(l => l.lineId === lineId);
  if (line) line[field] = value;
}

function removeWastageLine(lineId) {
  wastageLines = wastageLines.filter(l => l.lineId !== lineId);
  renderWastageLines();
}

function renderWastageLines() {
  const body = document.getElementById('ws-lines-body');
  if (!body) return;
  if (!wastageLines.length) {
    wastageLines.push({ lineId: uid(), productId: '', qty: '' });
  }
  body.innerHTML = wastageLines.map(line => {
    const opts = sortedProducts(state.products).map(p =>
      `<option value="${p.id}" ${p.id === line.productId ? 'selected' : ''}>${p.name}${p.size ? ' — ' + p.size : ''}</option>`
    ).join('');
    return `<tr>
      <td style="padding:6px 10px">
        <select style="width:100%;padding:6px 10px;font-size:13px"
          onchange="updateWastageLine('${line.lineId}','productId',this.value)">
          <option value="">— Select product —</option>${opts}
        </select>
      </td>
      <td style="padding:6px 10px">
        <input type="text" value="${line.qty}" placeholder="0" style="width:90px"
          onblur="evalMathInput(this)"
          onchange="updateWastageLine('${line.lineId}','qty',this.value)">
      </td>
      <td style="padding:6px 4px">
        <button class="btn btn-ghost btn-sm btn-icon" onclick="removeWastageLine('${line.lineId}')">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function logWastage() {
  const validLines = wastageLines.filter(l => l.productId && l.qty !== '' && parseFloat(l.qty) > 0);
  if (!validLines.length) { toast('Add at least one product with a quantity', 'error'); return; }

  const dateEl = document.getElementById('ws-date');
  const timeEl = document.getElementById('ws-time');
  const reasonEl = document.getElementById('ws-reason');
  let wastageDate = new Date();
  if (dateEl && dateEl.value) {
    const [y,m,d] = dateEl.value.split('-').map(Number);
    const timeVal = timeEl && timeEl.value ? timeEl.value : wastageDate.toTimeString().slice(0,5);
    const [hh,mm] = timeVal.split(':').map(Number);
    wastageDate = new Date(y, m-1, d, hh, mm);
  }
  const timestamp = wastageDate.toLocaleDateString('en-GB', {day:'numeric', month:'short'}) + ' ' +
    wastageDate.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
  const reason = reasonEl ? reasonEl.value.trim() : '';
  const batchId = uid();

  if (!state.wastage) state.wastage = [];
  validLines.forEach(line => {
    state.wastage.push({
      id: uid(),
      batchId,
      productId: line.productId,
      qty: Math.round(parseFloat(line.qty) * 10) / 10,
      unit: wastageUnit,
      reason,
      timestamp,
      date: wastageDate.toLocaleDateString('en-GB'),
      saved: true,
    });
  });

  save();
  clearWastageForm();
  renderWastage();
  toast(`Wastage logged — ${validLines.length} product${validLines.length !== 1 ? 's' : ''}`, 'success');
}

function clearWastageForm() {
  if (document.getElementById('ws-reason')) document.getElementById('ws-reason').value = '';
  wastageLines = [{ lineId: uid(), productId: '', qty: '' }];
  setWastageUnit('cases');
  renderWastageLines();
  const now = new Date();
  const dateEl = document.getElementById('ws-date');
  const timeEl = document.getElementById('ws-time');
  if (dateEl) dateEl.value = now.toISOString().slice(0, 10);
  if (timeEl) timeEl.value = now.toTimeString().slice(0, 5);
}

function deleteWastageBatch(batchId) {
  if (!confirm('Delete this wastage record?')) return;
  state.wastage = state.wastage.filter(w => (w.batchId || w.id) !== batchId);
  save();
  renderWastage();
  toast('Wastage record deleted', 'success');
}

function renderWastage() {
  const now = new Date();
  const dateEl = document.getElementById('ws-date');
  const timeEl = document.getElementById('ws-time');
  if (dateEl && !dateEl.value) dateEl.value = now.toISOString().slice(0, 10);
  if (timeEl && !timeEl.value) timeEl.value = now.toTimeString().slice(0, 5);

  renderWastageLines();

  const logBody  = document.getElementById('wastageLogBody');
  const countEl  = document.getElementById('wastageCount');
  if (!logBody) return;

  const saved = (state.wastage || []).filter(w => w.saved);
  if (countEl) countEl.textContent = saved.length ? `${saved.length} record${saved.length !== 1 ? 's' : ''}` : '';

  if (!saved.length) {
    logBody.innerHTML = `<div class="empty-state"><div class="icon">🗑️</div><p>No wastage logged yet.</p></div>`;
    return;
  }

  // Group by batchId
  const batches = {};
  [...saved].reverse().forEach(w => {
    const key = w.batchId || w.id;
    if (!batches[key]) batches[key] = { batchId: key, timestamp: w.timestamp, reason: w.reason, items: [] };
    batches[key].items.push(w);
  });

  logBody.innerHTML = Object.values(batches).map(batch => {
    const itemRows = batch.items.map(w => {
      const prod = state.products.find(p => p.id === w.productId);
      const name = prod ? prod.name : '—';
      const size = prod ? prod.size : '';
      const qtyLabel = w.unit === 'units' ? `${w.qty} units` : `${w.qty} cases`;
      return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
        <span style="font-weight:600">${name}${size ? `<span style="font-weight:400;color:var(--muted-foreground);font-size:12px;margin-left:8px">${size}</span>` : ''}</span>
        <span style="font-weight:700">${qtyLabel}</span>
      </div>`;
    }).join('');

    return `<div class="transfer-log-item" style="display:block;padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <div>
          <span style="font-weight:700;font-size:14px">${batch.reason || 'Wastage'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="transfer-timestamp">${batch.timestamp || '—'}</span>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteWastageBatch('${batch.batchId}')" title="Delete">🗑️</button>
        </div>
      </div>
      <div style="padding-top:4px;border-top:1px solid var(--border)">${itemRows}</div>
    </div>`;
  }).join('');
}

// ============================================================
// ============================================================
// TRANSFERS — MULTI-PRODUCT BATCH
// ============================================================
let transferUnit = 'cases';
let transferLines = []; // [{lineId, productId, qty}]

function setTransferUnit(unit) {
  transferUnit = unit;
  document.getElementById('tf-unit-cases').classList.toggle('active', unit === 'cases');
  document.getElementById('tf-unit-units').classList.toggle('active', unit === 'units');
}

function openTransferDrawer() {
  // Populate recipients, default date/time, and ensure at least one product line.
  const recSel = document.getElementById('tf-recipient');
  if (recSel) {
    const cur = recSel.value;
    recSel.innerHTML = '<option value="">— Select recipient —</option>' +
      state.recipients.map(r => '<option value="' + r + '"' + (r === cur ? ' selected' : '') + '>' + r + '</option>').join('');
  }
  const now = new Date();
  const dateEl = document.getElementById('tf-date');
  const timeEl = document.getElementById('tf-time');
  if (dateEl && !dateEl.value) dateEl.value = now.toISOString().slice(0, 10);
  if (timeEl && !timeEl.value) timeEl.value = now.toTimeString().slice(0, 5);

  if (!transferLines.length) {
    transferLines = [{ lineId: uid(), productId: '', qty: '' }];
  }
  renderTransferLines();

  const modal = document.getElementById('transferModal');
  if (modal) modal.classList.add('show');
}

function closeTransferDrawer() {
  const modal = document.getElementById('transferModal');
  if (modal) modal.classList.remove('show');
}

function addTransferLine() {
  transferLines.push({ lineId: uid(), productId: '', qty: '' });
  renderTransferLines();
  // Focus the new product select
  const rows = document.querySelectorAll('#tf-lines-body tr');
  if (rows.length) {
    const last = rows[rows.length - 1];
    const sel = last.querySelector('select');
    if (sel) sel.focus();
  }
}

function removeTransferLine(lineId) {
  transferLines = transferLines.filter(l => l.lineId !== lineId);
  renderTransferLines();
}

function renderTransferLines() {
  const body = document.getElementById('tf-lines-body');
  if (!body) return;

  if (!transferLines.length) {
    body.innerHTML = `<tr><td colspan="3" style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center">Click "+ Add Product" to add items</td></tr>`;
    return;
  }

  body.innerHTML = transferLines.map(line => `
    <tr>
      <td style="padding:6px 10px">
        <select style="width:100%;padding:6px 10px;font-size:13px"
          onchange="updateTransferLine('${line.lineId}','productId',this.value)">
          <option value="">— Select product —</option>
          ${sortedProducts(state.products).map(p =>
            `<option value="${p.id}" ${p.id === line.productId ? 'selected' : ''}>${p.name}${p.size ? ' — ' + p.size : ''}</option>`
          ).join('')}
        </select>
      </td>
      <td style="padding:6px 10px">
        <input type="text" value="${line.qty}" placeholder="0"
          style="width:100px;padding:6px 10px;font-size:13px"
          onchange="updateTransferLine('${line.lineId}','qty',this.value)"
          onblur="evalTransferLineQty('${line.lineId}',this)">
      </td>
      <td style="padding:6px 8px;text-align:center">
        <button class="btn btn-danger btn-sm btn-icon" onclick="removeTransferLine('${line.lineId}')" title="Remove">×</button>
      </td>
    </tr>
  `).join('');
}

function updateTransferLine(lineId, field, value) {
  const line = transferLines.find(l => l.lineId === lineId);
  if (line) line[field] = value;
}

function evalTransferLineQty(lineId, input) {
  evalMathInput(input);
  const line = transferLines.find(l => l.lineId === lineId);
  if (line) line.qty = input.value;
}

function downloadTransferPDF(batchIds, recipientOverride) {
  const saved = (state.transfers || []).filter(t => t.saved);
  const included = saved.filter(t => batchIds.includes(t.batchId || t.id));
  if (!included.length) { toast('No transfers found', 'error'); return; }
  const recipientName = recipientOverride || included[0].recipientName || '—';
  const lines = included.map(t => ({ productId: t.productId, qty: t.qty }));
  let date = new Date();
  if (included[0].date) {
    const parts = included[0].date.split('/');
    if (parts.length === 3) {
      const parsed = new Date(parts[2], parts[1]-1, parts[0]);
      if (!isNaN(parsed)) date = parsed;
    }
  }
  const unit = included[0].unit || 'cases';
  generateDeliveryNotePDF(recipientName, lines, date, unit);
  toast('Delivery note downloaded', 'success');
}

function renderTransfers() {
  const recSel = document.getElementById('tf-recipient');
  if (recSel) {
    const cur = recSel.value;
    recSel.innerHTML = '<option value="">— Select recipient —</option>' +
      state.recipients.map(r => '<option value="' + r + '" ' + (r === cur ? 'selected' : '') + '>' + r + '</option>').join('');
  }

  const now = new Date();
  const dateEl = document.getElementById('tf-date');
  const timeEl = document.getElementById('tf-time');
  if (dateEl && !dateEl.value) dateEl.value = now.toISOString().slice(0, 10);
  if (timeEl && !timeEl.value) timeEl.value = now.toTimeString().slice(0, 5);

  const logBody = document.getElementById('transferLogBody');
  const countEl = document.getElementById('transferCount');
  const saved = (state.transfers || []).filter(t => t.saved);
  if (countEl) countEl.textContent = saved.length ? saved.length + ' transfer' + (saved.length !== 1 ? 's' : '') : '';

  if (!saved.length) {
    logBody.innerHTML = '<div class="empty-state"><div class="icon">↔️</div><p>No transfers logged yet.</p></div>';
    return;
  }

  // Group by batchId
  const batches = {};
  [...saved].reverse().forEach(t => {
    const key = t.batchId || t.id;
    if (!batches[key]) batches[key] = { batchId: key, timestamp: t.timestamp, recipientName: t.recipientName, items: [] };
    batches[key].items.push(t);
  });
  const batchList = Object.values(batches);
  const allBatchIds = batchList.map(b => b.batchId);
  const recipients = [...new Set(saved.map(t => t.recipientName).filter(Boolean))].sort();

  // Bulk download bar — shown when more than one batch exists
  let bulkHtml = '';
  if (batchList.length > 1) {
    // Store batch IDs in a temporary global so onclick strings stay simple
    window._xfrBatchMap = window._xfrBatchMap || {};
    const allKey = '_xfrAll';
    window._xfrBatchMap[allKey] = JSON.stringify(allBatchIds);
    const recipBtns = recipients.map(r => {
      const ids = batchList.filter(b => b.recipientName === r).map(b => b.batchId);
      const k = '_xfr_' + r.replace(/[^a-zA-Z0-9]/g,'_');
      window._xfrBatchMap[k] = JSON.stringify(ids);
      return '<button class="btn btn-outline btn-sm" onclick="downloadTransferPDF(JSON.parse(window._xfrBatchMap[\''+k+'\']))">' +
        'All → ' + r + '</button>';
    }).join('');
    bulkHtml = '<div style="padding:12px 16px;border-bottom:1px solid var(--border);background:var(--muted);display:flex;align-items:center;flex-wrap:wrap;gap:8px">' +
      '<span style="font-size:11px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:0.5px;margin-right:4px">Download:</span>' +
      '<button class="btn btn-outline btn-sm" onclick="downloadTransferPDF(JSON.parse(window._xfrBatchMap[\'_xfrAll\']),\'All Transfers\')">All Transfers</button>' +
      recipBtns + '</div>';
  }

  logBody.innerHTML = bulkHtml + batchList.map(batch => {
    const itemRows = batch.items.map(t => {
      const prod = state.products.find(p => p.id === t.productId);
      const name = prod ? prod.name : '—';
      const size = prod ? prod.size : '';
      const qtyLabel = t.unit === 'units' ? t.qty + ' units' : t.qty + ' cases';
      return '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">' +
        '<span style="font-weight:600">' + name + (size ? '<span style="font-weight:400;color:var(--muted-foreground);font-size:12px;margin-left:8px">' + size + '</span>' : '') + '</span>' +
        '<span style="font-weight:700">' + qtyLabel + '</span></div>';
    }).join('');

    return '<div class="transfer-log-item" style="display:block;padding:14px 16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">' +
      '<span style="font-weight:700;font-size:14px">' + (batch.recipientName || '—') + '</span>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span class="transfer-timestamp">' + (batch.timestamp || '—') + '</span>' +
      '<button class="btn btn-outline btn-sm" style="font-size:11px;padding:4px 8px" onclick="downloadTransferPDF([\'' + batch.batchId + '\'])">&#8659; Note</button>' +
      '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteBatchTransfer(\'' + batch.batchId + '\')" title="Delete">🗑️</button>' +
      '</div></div>' +
      '<div style="padding-top:4px;border-top:1px solid var(--border)">' + itemRows + '</div>' +
      '</div>';
  }).join('');
}

function logTransfer(downloadPDF = false) {
  const recipientName = document.getElementById('tf-recipient').value;
  if (!recipientName) { toast('Select a recipient', 'error'); return; }

  const validLines = transferLines.filter(l => l.productId && l.qty !== '' && parseFloat(l.qty) > 0);
  if (!validLines.length) { toast('Add at least one product with a quantity', 'error'); return; }

  // Use manually entered date/time if set, otherwise fall back to now
  const dateInput = document.getElementById('tf-date');
  const timeInput = document.getElementById('tf-time');
  let transferDate = new Date();
  if (dateInput && dateInput.value) {
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const timeVal = timeInput && timeInput.value ? timeInput.value : transferDate.toTimeString().slice(0,5);
    const [hh, mm] = timeVal.split(':').map(Number);
    transferDate = new Date(y, m - 1, d, hh, mm);
  }
  const timestamp = transferDate.toLocaleDateString('en-GB', {day:'numeric', month:'short'}) + ' ' +
    transferDate.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
  const batchId = uid();

  validLines.forEach(line => {
    state.transfers.push({
      id: uid(),
      batchId,
      productId: line.productId,
      recipientName,
      qty: Math.round(parseFloat(line.qty) * 10) / 10,
      unit: transferUnit,
      timestamp,
      date: transferDate.toLocaleDateString('en-GB'),
      saved: true,
    });
  });

  save();

  if (downloadPDF) {
    generateDeliveryNotePDF(recipientName, validLines, transferDate, transferUnit);
  }

  clearTransferForm();
  renderTransfers();
  closeTransferDrawer();
  toast(`Transfer logged — ${validLines.length} product${validLines.length !== 1 ? 's' : ''}${downloadPDF ? ' · PDF downloading' : ''}`, 'success');
}

function generateDeliveryNotePDF(recipientName, lines, date, unit) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = 210;
  const pageH = 297;
  const ml = 15; // margin left
  const mr = 15; // margin right
  const contentW = pageW - ml - mr;

  // ── Fonts & helpers ──────────────────────────────────────
  const black  = [20, 20, 20];
  const grey   = [120, 120, 120];
  const lightGrey = [220, 220, 220];
  const bgGrey = [242, 242, 242];

  function setFont(style, size, color) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...(color || black));
  }

  // ── Logo area (top right) ────────────────────────────────
  // Draw the bracket marks around "measured" logo in text form
  setFont('bold', 22, black);
  doc.text('measured', pageW - mr - 2, 18, { align: 'right' });
  // Draw bracket corners (top-left and bottom-right of logo text)
  const logoX = pageW - mr - 46;
  const logoY = 8;
  const logoW = 46;
  const logoH = 13;
  doc.setDrawColor(...lightGrey);
  doc.setLineWidth(0.6);
  // top-left bracket
  doc.line(logoX, logoY + 4, logoX, logoY);
  doc.line(logoX, logoY, logoX + 4, logoY);
  // bottom-right bracket
  doc.line(logoX + logoW - 4, logoY + logoH, logoX + logoW, logoY + logoH);
  doc.line(logoX + logoW, logoY + logoH - 4, logoX + logoW, logoY + logoH);

  // ── Title ────────────────────────────────────────────────
  setFont('bold', 26, black);
  doc.text('Delivery Note', ml, 18);

  // ── Event / Date row ─────────────────────────────────────
  let y = 30;
  setFont('normal', 9, grey);
  doc.text('Event:', ml, y);
  doc.text('Date:', pageW - mr - 36, y);

  y += 3;
  // Event box
  doc.setDrawColor(...lightGrey);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(ml, y, contentW - 42, 9, 1, 1, 'S');
  setFont('normal', 10, black);
  doc.text(state.showName || '', ml + 2, y + 6);

  // Date box  (dd/mm/yyyy)
  const dateStr = date.toLocaleDateString('en-GB').replace(/\//g, '  /  ');
  doc.roundedRect(pageW - mr - 38, y, 38, 9, 1, 1, 'S');
  setFont('normal', 10, black);
  doc.text(dateStr, pageW - mr - 36, y + 6);

  // ── Time / Company row ───────────────────────────────────
  y += 14;
  setFont('normal', 9, grey);
  doc.text('Time:', ml, y);
  doc.text('Company/Department:', ml + 40, y);

  y += 3;
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  doc.roundedRect(ml, y, 35, 9, 1, 1, 'S');
  setFont('normal', 10, black);
  doc.text(timeStr, ml + 2, y + 6);

  doc.roundedRect(ml + 40, y, contentW - 40, 9, 1, 1, 'S');
  setFont('normal', 10, black);
  doc.text(recipientName, ml + 42, y + 6);

  // ── Counts section ───────────────────────────────────────
  y += 18;
  setFont('bold', 16, black);
  doc.text('Counts', ml, y);

  y += 6;
  // Column widths
  const col1W = contentW * 0.52; // Product/Item
  const col2W = contentW * 0.28; // Size/Specs
  const col3W = contentW - col1W - col2W; // Count

  // Table header
  setFont('normal', 9, grey);
  doc.text('Product/Item', ml + 2, y + 4);
  doc.text('Size/Specs', ml + col1W + 2, y + 4);
  doc.text('(eg 24x330ml, 8x1L, 1x50L)', ml + col1W + 2, y + 7.5);
  doc.text('Count', ml + col1W + col2W + 2, y + 4);

  y += 10;

  // Table rows
  const rowH = 9;
  const maxRows = 15;

  for (let i = 0; i < maxRows; i++) {
    const line = lines[i];
    const isAlt = i % 2 === 1;

    if (isAlt) {
      doc.setFillColor(...bgGrey);
      doc.rect(ml, y, contentW, rowH, 'F');
    }

    // Draw cell borders
    doc.setDrawColor(...lightGrey);
    doc.setLineWidth(0.3);
    doc.rect(ml, y, col1W, rowH, 'S');
    doc.rect(ml + col1W, y, col2W, rowH, 'S');
    doc.rect(ml + col1W + col2W, y, col3W, rowH, 'S');

    if (line) {
      const product = state.products.find(p => p.id === line.productId);
      if (product) {
        setFont('normal', 9.5, black);
        doc.text(product.name || '', ml + 2, y + 6);
        doc.text(product.size || '', ml + col1W + 2, y + 6);
        const qtyLabel = `${line.qty} ${unit}`;
        doc.text(qtyLabel, ml + col1W + col2W + 2, y + 6);
      }
    }
    y += rowH;
  }

  // ── Signature block ──────────────────────────────────────
  y += 8;
  const sigRows = [
    { label: 'Sender &\nCompany' },
    { label: 'Signed Sender' },
    { label: 'Receiver &\nCompany' },
    { label: 'Signed Receiver' },
  ];

  const labelW = 36;
  const sigH = 13;

  sigRows.forEach(row => {
    doc.setDrawColor(...lightGrey);
    doc.setLineWidth(0.4);
    doc.setFillColor(255, 255, 255);
    doc.rect(ml, y, contentW, sigH, 'S');

    // Label cell (shaded)
    doc.setFillColor(...bgGrey);
    doc.rect(ml, y, labelW, sigH, 'F');
    doc.rect(ml, y, labelW, sigH, 'S');

    setFont('bold', 8.5, black);
    const labelLines = row.label.split('\n');
    if (labelLines.length === 2) {
      doc.text(labelLines[0], ml + labelW - 2, y + sigH / 2 - 1, { align: 'right' });
      doc.text(labelLines[1], ml + labelW - 2, y + sigH / 2 + 4, { align: 'right' });
    } else {
      doc.text(row.label, ml + labelW - 2, y + sigH / 2 + 1.5, { align: 'right' });
    }

    y += sigH;
  });

  // ── Footer ───────────────────────────────────────────────
  setFont('normal', 7, [180, 180, 180]);
  doc.text(`Generated by Measured STOCK · ${state.showName || ''}`, pageW / 2, pageH - 8, { align: 'center' });

  // ── Save ─────────────────────────────────────────────────
  const safeName = (recipientName || 'transfer').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dateTag  = date.toLocaleDateString('en-GB').replace(/\//g, '-');
  doc.save(`delivery_note_${safeName}_${dateTag}.pdf`);
}

function clearTransferForm() {
  document.getElementById('tf-recipient').value = '';
  transferLines = [{ lineId: uid(), productId: '', qty: '' }];
  setTransferUnit('cases');
  renderTransferLines();
  // Reset date/time to now
  const now = new Date();
  const dateEl = document.getElementById('tf-date');
  const timeEl = document.getElementById('tf-time');
  if (dateEl) dateEl.value = now.toISOString().slice(0, 10);
  if (timeEl) timeEl.value = now.toTimeString().slice(0, 5);
}

function deleteTransfer(id) {
  if (!confirm('Delete this transfer?')) return;
  state.transfers = state.transfers.filter(t => t.id !== id);
  save(); renderTransfers();
}

function deleteBatchTransfer(batchId) {
  if (!confirm('Delete this transfer?')) return;
  state.transfers = state.transfers.filter(t => (t.batchId || t.id) !== batchId);
  save(); renderTransfers();
  toast('Transfer deleted', 'success');
}

// Legacy stubs
function addTransferRow() {}
function removeTransfer() {}
function saveTransfers() { save(); toast('Saved', 'success'); }

// ============================================================
// CLOSING STOCK
// ============================================================
// Sort state for the Closing Stock table.
// mode: 'name' | 'category'   dir: 'asc' | 'desc'
let closingSortMode = 'name';
let closingSortDir  = 'asc';

function setClosingSort(mode) {
  if (closingSortMode === mode) {
    closingSortDir = closingSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    closingSortMode = mode;
    closingSortDir  = 'asc';
  }
  renderClosing();
}

function updateClosingSortArrows() {
  ['name','category'].forEach(m => {
    const el = document.getElementById('closingSortArrow-' + m);
    if (!el) return;
    if (closingSortMode === m) {
      el.textContent = closingSortDir === 'asc' ? ' \u25B2' : ' \u25BC';
      el.style.color = 'var(--foreground)';
      el.style.opacity = '1';
    } else {
      el.textContent = ' \u2195';
      el.style.color = 'var(--muted-foreground)';
      el.style.opacity = '0.4';
    }
  });
}

function renderClosing() {
  const body = document.getElementById('closingTableBody');
  const dir = closingSortDir === 'desc' ? -1 : 1;
  const products = [...state.products.filter(p => p.name)].sort((a,b) => {
    if (closingSortMode === 'category') {
      const ca = (a.category || '\uffff').toLowerCase();
      const cb = (b.category || '\uffff').toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb) * dir;
      // tie-breaker: name always ascending so rows within a category read naturally
      return (a.name||'').localeCompare(b.name||'');
    }
    return (a.name||'').localeCompare(b.name||'') * dir;
  });

  updateClosingSortArrows();

  if (!products.length) {
    body.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="icon">📊</div><p>Add products first.</p></div></td></tr>`;
    return;
  }

  body.innerHTML = products.map(p => {
    const o = state.opening[p.id] || {};
    // Invoice qty now entered here on the financial reconciliation section
    const invoiceQty = o.invoiceQty != null ? o.invoiceQty : '';
    const cl = state.closing[p.id] || {};
    const closingCases = cl.closingCases ?? cl.fullCount ?? '';
    const closingSingles = cl.closingSingles ?? '';
    const supplier = state.suppliers.find(s => s.name === p.supplier) || {};
    const sor = (supplier.sor != null && supplier.sor !== '') ? parseFloat(supplier.sor) : null;
    const sorDisplay = sor != null ? sor + '%' : '—';
    // Max returnable = Invoice QTY × SOR%, rounded DOWN to the nearest whole integer.
    const invForCalc = invoiceQty !== '' ? parseFloat(invoiceQty) : (o.deliveredQty ?? p.qtyOrdered ?? 0);
    const maxReturn = sor != null ? Math.floor((invForCalc || 0) * sor / 100) : '—';

    return `
      <tr>
        <td style="font-weight:500">${p.name}</td>
        <td>${catBadge(p.category)}</td>
        <td style="font-size:12px;color:var(--muted-foreground)">${p.size || '—'}</td>
        <td style="color:var(--muted-foreground)">${p.supplier || '—'}</td>
        <td style="font-weight:600">${sorDisplay}</td>
        <td><input type="text" value="${invoiceQty}" placeholder="" style="width:90px" id="cl-inv-${p.id}" oninput="recalcClosing('${p.id}')" onblur="evalMathInput(this); flushClosing('${p.id}')"></td>
        <td><input type="number" min="0" value="${closingCases}" placeholder="" style="width:90px" id="cl-cases-${p.id}" oninput="recalcClosing('${p.id}')" onblur="flushClosing('${p.id}')"></td>
        <td><input type="number" min="0" value="${closingSingles}" placeholder="" style="width:90px" id="cl-singles-${p.id}" oninput="recalcClosing('${p.id}')" onblur="flushClosing('${p.id}')"></td>
        <td style="font-weight:700" id="cl-maxret-${p.id}">${maxReturn}</td>
        <td style="font-weight:700" id="cl-return-${p.id}">${maxReturn !== '—' ? maxReturn : '—'}</td>
        <td><input type="number" value="${cl.carriedOver ?? ''}" placeholder="" style="width:80px" id="cl-carry-${p.id}" oninput="recalcClosing('${p.id}')" onblur="flushClosing('${p.id}')"></td>
      </tr>
    `;
  }).join('');
}

function recalcClosing(id) {
  const p = state.products.find(x => x.id === id);
  const invEl  = document.getElementById('cl-inv-'  + id);
  const invRaw = invEl ? invEl.value.trim() : '';
  const invoiceQty = invRaw !== '' ? parseFloat(invRaw) : (state.opening[id]?.invoiceQty ?? state.opening[id]?.deliveredQty ?? p.qtyOrdered ?? 0);

  // Persist invoice qty back to opening state so other tabs can use it.
  // An empty field clears the stored value so the user can blank it out.
  if (!state.opening[id]) state.opening[id] = {};
  state.opening[id].invoiceQty = invRaw !== '' ? parseFloat(invRaw) : null;

  const supplier = state.suppliers.find(s => s.name === p.supplier) || {};
  const sor = (supplier.sor != null && supplier.sor !== '') ? parseFloat(supplier.sor) : null;
  // Max returnable = Invoice QTY × SOR%, rounded DOWN to the nearest whole integer.
  const maxReturn = sor != null ? Math.floor((invoiceQty || 0) * sor / 100) : '—';

  const maxRetEl = document.getElementById('cl-maxret-' + id);
  const retEl    = document.getElementById('cl-return-'  + id);
  if (maxRetEl) maxRetEl.textContent = maxReturn;
  if (retEl)    retEl.textContent    = maxReturn;

  const casesEl   = document.getElementById('cl-cases-'   + id);
  const singlesEl = document.getElementById('cl-singles-' + id);
  const carryEl   = document.getElementById('cl-carry-'   + id);
  const cases   = casesEl   ? (parseFloat(casesEl.value)   || 0) : 0;
  const singles = singlesEl ? (parseFloat(singlesEl.value) || 0) : 0;
  const ups     = p.unitsPerSku || 1;
  state.closing[id] = {
    closingCases:   cases,
    closingSingles: singles,
    // fullCount kept for back-compat: total closing stock expressed in cases.
    fullCount:      cases + (ups > 0 ? singles / ups : 0),
    carriedOver:    carryEl ? (parseFloat(carryEl.value) || 0) : 0,
  };
  save();
}

// Called on blur from any closing-stock input. recalcClosing has already
// written the latest value to state and scheduled a debounced cloud push;
// this flushes that debounce so the user-finished value reaches Supabase
// immediately even if they navigate away before the 1.2s timer fires.
function flushClosing(id) {
  recalcClosing(id);
  clearTimeout(save._cloudTimer);
  cloudUpsertEvent(state);
}

function saveClosing() {
  state.products.forEach(p => {
    const invEl     = document.getElementById('cl-inv-'     + p.id);
    const casesEl   = document.getElementById('cl-cases-'   + p.id);
    const singlesEl = document.getElementById('cl-singles-' + p.id);
    const carryEl   = document.getElementById('cl-carry-'   + p.id);
    const cases   = casesEl   ? (parseFloat(casesEl.value)   || 0) : 0;
    const singles = singlesEl ? (parseFloat(singlesEl.value) || 0) : 0;
    const ups     = p.unitsPerSku || 1;
    // Invoice qty lives on state.opening so other tabs can read it. Capture it
    // here too — relying solely on the input's onchange means a value that was
    // typed-but-never-blurred (or cleared) would be silently dropped.
    if (!state.opening[p.id]) state.opening[p.id] = {};
    if (invEl) {
      const invRaw = invEl.value.trim();
      state.opening[p.id].invoiceQty = invRaw !== '' ? parseFloat(invRaw) : null;
    }
    state.closing[p.id] = {
      closingCases:   cases,
      closingSingles: singles,
      fullCount:      cases + (ups > 0 ? singles / ups : 0),
      carriedOver:    carryEl ? (parseFloat(carryEl.value) || 0) : 0,
    };
  });
  save({ immediate: true });
  toast('Closing stock saved', 'success');
}

// ============================================================
// SUMMARY
// ============================================================
function renderSummary() {
  const products = sortedProducts(state.products.filter(p => p.name));

  let totalOrdered = 0, totalOpening = 0, totalConsumed = 0, totalReturn = 0, totalCost = 0;

  const rows = products.map(p => {
    const opening = getOpeningStock(p.id);
    const cl = state.closing[p.id] || {};
    const closing = cl.fullCount ?? 0;
    const ups = p.unitsPerSku || 1;
    // Transfers and wastage may be logged in either cases or units — convert to cases.
    const transferred = (state.transfers || [])
      .filter(t => t.productId === p.id)
      .reduce((s, t) => s + (t.unit === 'units' && ups > 0 ? (t.qty || 0) / ups : (t.qty || 0)), 0);
    const wastage = (state.wastage || [])
      .filter(w => w.productId === p.id)
      .reduce((s, w) => s + (w.unit === 'units' && ups > 0 ? (w.qty || 0) / ups : (w.qty || 0)), 0);
    const supplier = state.suppliers.find(s => s.name === p.supplier) || {};
    const sor = (supplier.sor != null && supplier.sor !== '') ? parseFloat(supplier.sor) : null;
    // Return amount = Invoice QTY × SOR%, rounded down.
    const o = state.opening[p.id] || {};
    const invoiceQty = o.invoiceQty != null ? o.invoiceQty : (o.deliveredQty ?? p.qtyOrdered ?? 0);
    const returnAmt = sor != null ? Math.floor((invoiceQty || 0) * sor / 100) : 0;
    const consumed = opening - transferred - wastage - closing;

    totalOrdered += p.qtyOrdered || 0;
    totalOpening += opening;
    totalConsumed += Math.max(0, consumed);
    totalReturn   += typeof returnAmt === 'number' ? returnAmt : 0;
    totalCost     += Math.max(0, consumed) * (p.orderPrice || 0);

    return {p, opening, closing, transferred, wastage, consumed, returnAmt};
  });

  document.getElementById('summaryStats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Ordered</div><div class="stat-value">${totalOrdered.toLocaleString()}</div><div class="stat-sub">SKUs across all products</div></div>
    <div class="stat-card"><div class="stat-label">Total Stock Cost</div><div class="stat-value">£${totalCost.toLocaleString('en-GB', {minimumFractionDigits:0, maximumFractionDigits:0})}</div><div class="stat-sub">consumed value</div></div>
    <div class="stat-card"><div class="stat-label">Total Opening</div><div class="stat-value">${totalOpening.toLocaleString()}</div><div class="stat-sub">units after delivery</div></div>
    <div class="stat-card"><div class="stat-label">Total Consumed</div><div class="stat-value">${totalConsumed.toLocaleString()}</div><div class="stat-sub">units sold / used</div></div>
    <div class="stat-card"><div class="stat-label">Total Returns</div><div class="stat-value">${totalReturn.toLocaleString()}</div><div class="stat-sub">units to return</div></div>
  `;

  const fmt = (n) => {
    const v = Number(n) || 0;
    return Number.isInteger(v) ? v.toString() : v.toFixed(2).replace(/\.?0+$/, '');
  };
  let lastCat = '';
  document.getElementById('summaryTableBody').innerHTML = rows.map(({p, opening, closing, transferred, wastage, consumed, returnAmt}) => {
    let catRow = '';
    if (p.category !== lastCat) {
      lastCat = p.category;
      catRow = `<tr class="category-row"><td colspan="8">${p.category}</td></tr>`;
    }
    return catRow + `
      <tr>
        <td style="font-weight:500">${p.name}</td>
        <td>${catBadge(p.category)}</td>
        <td style="font-family:'DM Mono',monospace">${fmt(opening)}</td>
        <td style="font-family:'DM Mono',monospace">${fmt(transferred)}</td>
        <td style="font-family:'DM Mono',monospace">${fmt(wastage)}</td>
        <td style="font-family:'DM Mono',monospace">${fmt(closing)}</td>
        <td style="font-family:'DM Mono',monospace;font-weight:600;color:var(--accent3)">${fmt(Math.max(0,consumed))}</td>
        <td style="font-family:'DM Mono',monospace;font-weight:600;color:var(--accent2)">${returnAmt}</td>
      </tr>
    `;
  }).join('');

  // Supplier summary — cost of stock consumed (opening − transfers − closing) × price per SKU
  const supplierMap = {};
  rows.forEach(({p, opening, returnAmt, consumed}) => {
    const s = p.supplier || 'Unknown';
    if (!supplierMap[s]) supplierMap[s] = { ordered: 0, consumedUnits: 0, consumedCost: 0, returnAmt: 0, opening: 0 };
    supplierMap[s].ordered       += p.qtyOrdered || 0;
    supplierMap[s].consumedUnits += Math.max(0, consumed);
    supplierMap[s].consumedCost  += Math.max(0, consumed) * (p.orderPrice || 0);
    supplierMap[s].returnAmt     += typeof returnAmt === 'number' ? returnAmt : 0;
    supplierMap[s].opening       += opening;
  });

  document.getElementById('supplierSummaryBody').innerHTML = Object.entries(supplierMap).map(([s, d]) => `
    <tr>
      <td style="font-weight:600">${s}</td>
      <td style="font-weight:500">${d.ordered.toLocaleString()}</td>
      <td style="font-weight:500">${d.consumedUnits.toLocaleString()}</td>
      <td style="font-weight:700;color:var(--dark)">£${d.consumedCost.toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
      <td style="font-weight:500;color:var(--text-muted)">${d.returnAmt > 0 ? d.returnAmt.toLocaleString() : '—'}</td>
    </tr>
  `).join('') + `
    <tr style="border-top:2px solid var(--dark);background:var(--surface2)">
      <td style="font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-size:11px">Total</td>
      <td style="font-weight:700">${Object.values(supplierMap).reduce((s,d) => s + d.ordered, 0).toLocaleString()}</td>
      <td style="font-weight:700">${Object.values(supplierMap).reduce((s,d) => s + d.consumedUnits, 0).toLocaleString()}</td>
      <td style="font-weight:800;color:var(--dark);font-size:15px">£${Object.values(supplierMap).reduce((s,d) => s + d.consumedCost, 0).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
      <td style="font-weight:700">${Object.values(supplierMap).reduce((s,d) => s + (typeof d.returnAmt==='number' ? d.returnAmt : 0), 0).toLocaleString()}</td>
    </tr>
  `;
}

// ============================================================
// TOAST
// ============================================================
let toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ============================================================
// RENDER ALL
// ============================================================
// ── Kit supplier / category helpers ────────────────────────────────────────
// Kit data is stored on the linked Kit event
function getKitEventData() {
  const kitEv = getKitEvent();
  if (!kitEv) return null;
  if (!kitEv.suppliers)  kitEv.suppliers  = [];
  if (!kitEv.categories) kitEv.categories = [...DEFAULT_KIT_CATEGORIES];
  return kitEv;
}

function addKitSupplier() {
  const kit = getKitEventData();
  if (!kit) { toast('No Kit event linked — create a new event first', 'error'); return; }
  const name = document.getElementById('newKitSupplierInput').value.trim();
  if (!name) return;
  if (kit.suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) return;
  kit.suppliers.push({ name, sor: 0 });
  kit.suppliers.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'}));
  appData.events[kit.id] = kit;
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  cloudUpsertEvent(kit);
  document.getElementById('newKitSupplierInput').value = '';
  renderKitPills();
  toast('Kit supplier added', 'success');
}

function addKitCategory() {
  const kit = getKitEventData();
  if (!kit) { toast('No Kit event linked', 'error'); return; }
  const val = document.getElementById('newKitCategoryInput').value.trim();
  if (!val) return;
  if (kit.categories.some(c => c.toLowerCase() === val.toLowerCase())) return;
  kit.categories.push(val);
  kit.categories.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  appData.events[kit.id] = kit;
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  cloudUpsertEvent(kit);
  document.getElementById('newKitCategoryInput').value = '';
  renderKitPills();
}

function renderKitPills() {
  const kit = getKitEventData();
  const supEl = document.getElementById('kitSupplierPills');
  const catEl = document.getElementById('kitCategoryPills');
  if (!kit) {
    if (supEl) supEl.innerHTML = '<p style="font-size:12px;color:var(--muted-foreground)">Link a Kit event first by creating a new event.</p>';
    if (catEl) catEl.innerHTML = '';
    return;
  }
  if (supEl) {
    supEl.innerHTML = (kit.suppliers || []).map((s, i) => `
      <div class="pill" data-type="kit-supplier" data-index="${i}">
        <span class="pill-label">${s.name}</span>
        <button class="pill-remove" onclick="removeKitSupplier(${i})" title="Delete">×</button>
      </div>`).join('');
  }
  if (catEl) {
    catEl.innerHTML = (kit.categories || []).map((c, i) => `
      <div class="pill" data-type="kit-category" data-index="${i}">
        <span class="pill-label">${c}</span>
        <button class="pill-remove" onclick="removeKitCategory(${i})" title="Delete">×</button>
      </div>`).join('');
  }
}

function removeKitSupplier(idx) {
  const kit = getKitEventData();
  if (!kit) return;
  kit.suppliers.splice(idx, 1);
  appData.events[kit.id] = kit;
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  cloudUpsertEvent(kit);
  renderKitPills();
}

function removeKitCategory(idx) {
  const kit = getKitEventData();
  if (!kit) return;
  kit.categories.splice(idx, 1);
  appData.events[kit.id] = kit;
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  cloudUpsertEvent(kit);
  renderKitPills();
}

function renderAll() {
  updateStats();
  updateModeBtns();
  renderBarPills();
  renderSupplierPills();
  renderRecipientPills();
  renderCategoryPills();
  renderKitPills();
  refreshCategoryDropdowns();
  renderProducts();
  renderOpening();
  renderDistribution();
  renderCountSessions();
  renderCountSummary();
  renderTopups();
  renderWastage();
  renderTransfers();
  renderClosing();
  renderSummary();
  renderRecipes();
  renderCogs();
  renderEventSwitcher();
  renderEventsPage();
}

function sortAllLists() {
  if (state.bars)       state.bars.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  if (state.suppliers)  state.suppliers.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'}));
  if (state.recipients) state.recipients.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  if (state.categories) state.categories.sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
}

// ============================================================
// ============================================================
// LOAD / SAVE
// ============================================================
function save(opts) {
  appData.events[appData.currentEventId] = state;
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  _localDirty = true;
  updateStats();
  clearTimeout(save._cloudTimer);
  // `immediate: true` is used by explicit Save buttons (e.g. Save Closing Stock)
  // so the user-initiated push isn't lost if they navigate away inside the
  // debounce window. Background autosaves stay debounced to avoid spam.
  if (opts && opts.immediate) {
    cloudUpsertEvent(state);
  } else {
    save._cloudTimer = setTimeout(() => cloudUpsertEvent(state), 1200);
  }
}

function load() {
  loadCloudConfig();
  const raw = localStorage.getItem('measured_stock_app');
  if (raw) {
    try {
      appData = JSON.parse(raw);
      if (!appData.events) appData.events = {};
      if (!Array.isArray(appData.recipes)) appData.recipes = [];
      if (!appData.currentEventId || !appData.events[appData.currentEventId]) {
        const first = Object.values(appData.events)[0];
        if (first) {
          appData.currentEventId = first.id;
        } else {
          const e = blankEvent('My First Event');
          appData.events[e.id] = e;
          appData.currentEventId = e.id;
          _autoLoadSample = true;
        }
      }
      state = appData.events[appData.currentEventId];
      mergeDefaults(state);
      runMigration();
    } catch(err) {
      console.warn('load() error:', err);
      const e = blankEvent('My First Event');
      appData = { currentEventId: e.id, events: { [e.id]: e } };
      state = e;
      _autoLoadSample = true;
    }
  } else {
    const e = blankEvent('My First Event');
    appData = { currentEventId: e.id, events: { [e.id]: e }, recipes: [] };
    state = e;
    _autoLoadSample = true;
  }
  if (!Array.isArray(appData.recipes)) appData.recipes = [];
  setSyncStatus(hasCloud() ? 'synced' : 'offline');
}

function runMigration() {
  // 1. Ensure every event has a type field
  Object.values(appData.events).forEach(ev => {
    if (!ev.type) ev.type = 'stock';
  });

  // 2. Create Kit siblings for Stock events that don't have one
  // (handles events created before the pairing system was introduced)
  const toAdd = [];
  Object.values(appData.events).forEach(ev => {
    if (ev.type === 'stock' && (!ev.linkedId || !appData.events[ev.linkedId])) {
      const kitId = uid();
      const kitEv = blankEvent((ev.showName || 'Event') + ' \u2014 Kit', 'kit', ev.id);
      kitEv.id      = kitId;
      kitEv.bars    = [];
      kitEv.recipients = [];
      ev.linkedId = kitId;
      toAdd.push(kitEv);
    }
  });
  toAdd.forEach(ev => { appData.events[ev.id] = ev; });

  // 3. Re-point state after migration
  if (appData.currentEventId && appData.events[appData.currentEventId]) {
    state = appData.events[appData.currentEventId];
  }
}

// ============================================================
// INIT
// ============================================================
let _autoLoadSample = false;
load();
sortAllLists();
save(); // persist the sorted order so it survives next load
if (_autoLoadSample) loadSampleData(true);
else renderAll();
initPillDelegation();

// Defer cloud init until all scripts have loaded
window.addEventListener('load', () => {
  initCloudUI();
  if (hasCloud()) {
    syncOnConnect();
  } else {
    setSyncStatus('offline');
  }
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => {
    if (e.target === o) o.classList.remove('show');
  });
});
// ============================================================
// EXCEL IMPORT
// ============================================================
let pendingImportProducts = [];

function importProductsFile(e) {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting same file
  if (!file) return;

  document.getElementById('importStatus').textContent = 'Reading file…';
  document.getElementById('importPreviewWrap').style.display = 'none';
  document.getElementById('importConfirmBtn').style.display = 'none';
  document.getElementById('importModal').classList.add('show');

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = new Uint8Array(ev.target.result);
      const wb = XLSX.read(data, { type: 'array' });

      // Try "Products" sheet first, fallback to first sheet
      const sheetName = wb.SheetNames.includes('Products') ? 'Products' : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      // Normalise column names — strip spaces, lowercase for matching
      const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

      // Column name map: canonical -> variations
      const colMap = {
        name:       ['productname','name','product'],
        category:   ['category','cat','type'],
        supplier:   ['supplier','vendor'],
        sku:        ['skucode','sku','code'],
        size:       ['packsize','packsizeformat','format','size','packformat'],
        unitsPerSku:['unitsperskuperskuunitspersku','unitsperskuunits','unitspercaseunitspersku','unitspersku','unitspercaseunits','unitspercase','units'],
        qtyOrdered: ['qtyordered','quantityordered','ordered','qty','quantity'],
        orderPrice: ['orderpriceprice','orderprice','price','priceperskulitre'],
        arrival:    ['arrivalday','arrival','arrivaldate','day'],
      };

      function findCol(rowKeys, field) {
        const variants = colMap[field];
        for (const k of rowKeys) {
          if (variants.includes(norm(k))) return k;
        }
        return null;
      }

      // Filter out empty/header-repeat rows
      const validRows = rows.filter(r => {
        const keys = Object.keys(r);
        const nameCol = findCol(keys, 'name');
        const val = nameCol ? String(r[nameCol]).trim() : '';
        return val && val !== 'Product Name *' && val !== 'Product Name' && !val.startsWith('↓');
      });

      if (!validRows.length) {
        document.getElementById('importStatus').textContent = '⚠️ No product rows found. Make sure you\'re using the STOCK template and products start from row 3 in the Products sheet.';
        return;
      }

      const keys = Object.keys(validRows[0]);

      // Normalise a raw category string for matching against existing categories
      const normCat = s => String(s).trim().toUpperCase().replace(/[^A-Z0-9&]/g,'');
      const existingNorm = getCategories().map(c => ({ norm: normCat(c), display: c }));

      function resolveCategory(raw) {
        if (!raw) return getCategories()[0] || 'BEER';
        const n = normCat(raw);
        // Exact normalised match first
        const match = existingNorm.find(e => e.norm === n);
        if (match) return match.display;
        // No match — use the raw value as-is (will be added to state on confirm)
        return String(raw).trim() || (getCategories()[0] || 'BEER');
      }

      pendingImportProducts = validRows.map(r => {
        const rawCat = String(r[findCol(keys,'category')] || '').trim();
        return {
          id: uid(),
          name:        String(r[findCol(keys,'name')] || '').trim(),
          category:    resolveCategory(rawCat),
          supplier:    String(r[findCol(keys,'supplier')] || '').trim(),
          sku:         String(r[findCol(keys,'sku')] || '').trim(),
          size:        String(r[findCol(keys,'size')] || '').trim(),
          unitsPerSku: parseFloat(r[findCol(keys,'unitsPerSku')]) || 0,
          qtyOrdered:  parseFloat(r[findCol(keys,'qtyOrdered')]) || 0,
          orderPrice:  parseFloat(r[findCol(keys,'orderPrice')]) || 0,
          arrival:     String(r[findCol(keys,'arrival')] || '').trim(),
        };
      }).filter(p => p.name);

      // Build preview
      document.getElementById('importCount').textContent = pendingImportProducts.length;

      const dupes = pendingImportProducts.filter(p =>
        state.products.some(e => e.name.toLowerCase() === p.name.toLowerCase())
      ).length;

      const newCats = [...new Set(pendingImportProducts.map(p => p.category))]
        .filter(c => !getCategories().map(x => x.toUpperCase()).includes(c.toUpperCase()));

      let dupeNote = dupes ? `  ·  ${dupes} duplicate(s) will be skipped.` : '';
      if (newCats.length) dupeNote += `  ·  New categories to add: ${newCats.join(', ')}`;
      document.getElementById('importDupeNote').textContent = dupeNote;

      document.getElementById('importPreviewBody').innerHTML = pendingImportProducts.map(p => `
        <tr>
          <td style="font-weight:500">${p.name}</td>
          <td>${catBadge(p.category)}</td>
          <td style="color:var(--text-muted)">${p.supplier || '—'}</td>
          <td style="font-size:11px;color:var(--text-muted)">${p.size || '—'}</td>
          <td style="font-family:'DM Mono',monospace">${p.unitsPerSku || '—'}</td>
          <td style="font-family:'DM Mono',monospace">${p.qtyOrdered || '—'}</td>
          <td style="font-family:'DM Mono',monospace">${p.orderPrice ? '£' + p.orderPrice.toFixed(2) : '—'}</td>
          <td style="color:var(--text-muted)">${''}</td>
        </tr>
      `).join('');

      document.getElementById('importStatus').textContent = `File: ${file.name}  ·  Sheet: "${sheetName}"`;
      document.getElementById('importPreviewWrap').style.display = 'block';
      document.getElementById('importConfirmBtn').style.display = 'inline-flex';

    } catch(err) {
      document.getElementById('importStatus').textContent = '❌ Could not read file. Make sure it\'s a valid .xlsx Excel file.';
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

function confirmImport() {
  // Auto-register any new categories found in the imported products
  const existingCatsNorm = getCategories().map(c => c.toUpperCase());
  pendingImportProducts.forEach(p => {
    if (p.category && !existingCatsNorm.includes(p.category.toUpperCase())) {
      state.categories.push(p.category);
      existingCatsNorm.push(p.category.toUpperCase());
    }
  });

  const replace = document.getElementById('importReplace').checked;
  if (replace) {
    state.products = pendingImportProducts;
  } else {
    const existing = new Set(state.products.map(p => p.name.toLowerCase()));
    const newOnes = pendingImportProducts.filter(p => !existing.has(p.name.toLowerCase()));
    state.products = [...state.products, ...newOnes];
    if (pendingImportProducts.length - newOnes.length > 0) {
      toast(`Skipped ${pendingImportProducts.length - newOnes.length} duplicates`, 'success');
    }
  }
  save();
  renderProducts();
  renderCategoryPills();
  refreshCategoryDropdowns();
  closeImportModal();
  toast(`✅ ${pendingImportProducts.length} products imported!`, 'success');
  pendingImportProducts = [];
}

function closeImportModal() {
  document.getElementById('importModal').classList.remove('show');
  pendingImportProducts = [];
}

// ============================================================
// CLOUD UI HELPERS
// ============================================================
// Manual resync button on the Cloud Sync card. Handy if the user thinks
// another device has changed something and doesn't want to wait for the
// 8s poll, or if a previous push failed (sync status shows ✕).
async function forceResync() {
  const msg = document.getElementById('cloudStatusMsg');
  if (!hasCloud()) {
    if (msg) {
      msg.textContent = '✗ No cloud config baked into this build.';
      msg.style.color = 'var(--danger)';
    }
    return;
  }
  if (msg) {
    msg.textContent = 'Resyncing…';
    msg.style.color = 'var(--muted-foreground)';
  }
  setSyncStatus('syncing');
  const ok = await syncOnConnect();
  if (ok) {
    if (msg) {
      msg.textContent = '✓ Resynced from cloud.';
      msg.style.color = 'var(--success)';
    }
    toast('Resynced from cloud', 'success');
  } else {
    if (msg) {
      msg.textContent = '✗ Resync failed — check console for details.';
      msg.style.color = 'var(--danger)';
    }
    toast('Resync failed', 'error');
  }
}

function initCloudUI() {
  loadCloudConfig();
  const msg = document.getElementById('cloudStatusMsg');
  if (!msg) return;
  if (hasCloud()) {
    msg.textContent = '✓ Built-in cloud sync is active. Data syncs across all devices automatically.';
    msg.style.color = 'var(--success)';
  } else {
    msg.textContent = '✗ No cloud config baked into this build — running in local-only mode.';
    msg.style.color = 'var(--danger)';
  }
}

function downloadImportTemplate() {
  const wb = XLSX.utils.book_new();

  // ── Instructions sheet ──
  const insData = [
    ['STOCK — Product Import Template'],
    [''],
    ['HOW TO USE'],
    ['1.', 'Go to the Products sheet (tab below)'],
    ['2.', 'Fill in one product per row, starting from row 3'],
    ['3.', 'Product Name is required — all other columns are optional'],
    ['4.', 'Category can be anything — standard ones are BEER, CIDER, WINE, RTDs, SPIRITS, SOFTS, SELTZERS'],
    ['', '   Custom categories (e.g. "Low & No Alcohol") will be added to the app automatically on import'],
    ['5.', 'Save the file and upload it in STOCK → Products → Import from Excel'],
    [''],
    ['COLUMN GUIDE'],
    ['Product Name *', 'Required. Full product name e.g. "Jubel Peach - 4.0%"'],
    ['Category',       'Any value accepted. Standard: BEER, CIDER, WINE, RTDs, SPIRITS, SOFTS, SELTZERS. Custom values are auto-added.'],
    ['Supplier',       'Supplier name — ideally matching your Setup suppliers'],
    ['SKU Code',       'Optional internal or supplier SKU code'],
    ['Pack Size',      'e.g. "24 x 440ml Cans" or "30L Keg"'],
    ['Units Per SKU',  'Number of individual units in one case / SKU'],
    ['Qty Ordered',    'Number of SKUs / cases ordered'],
    ['Order Price (£)','Price per SKU / case in pounds'],
    ['Arrival Day',    'e.g. Tuesday, Wednesday, Day 1'],
  ];
  const insWS = XLSX.utils.aoa_to_sheet(insData);
  insWS['!cols'] = [{wch:22},{wch:60}];
  XLSX.utils.book_append_sheet(wb, insWS, 'Instructions');

  // ── Products sheet ──
  const headers = [
    'Product Name *','Category','Supplier','SKU Code',
    'Pack Size / Format','Units Per SKU','Qty Ordered','Order Price (£)','Arrival Day'
  ];

  const samples = [
    ['Utopian Lager','BEER','Utopian','','24 x 440ml Cans',24,1440,33.84,'Tuesday'],
    ['Jubel Peach - 4.0%','BEER','Jubel','','12 x 440ml Cans',12,924,17.50,'Wednesday'],
    ['Brothers Absolutely Apple - 4.4%','CIDER','Brothers','','24 x 440ml Cans',24,450,20.00,'Tuesday'],
    ['Vinca White - 12.5%','WINE','Vinca','','12 x 187ml PET',12,504,17.88,'Wednesday'],
    ['No 6 G&T - 7%','RTDs','RW','','12 x 250ml Cans',12,1152,18.99,''],
    ['Coke','SOFTS','RW','','24 x 330ml Cans',24,110,14.40,''],
    ['Red Bull','SOFTS','RW','','24 x 330ml Cans',24,144,25.36,''],
    ['Absolut Vodka','SPIRITS','LWC/MC','','6 x 700ml Glass',6,72,0,''],
    ['Served Lime Hard Seltzer - 4.0%','SELTZERS','Served','','12 x 250ml Cans',12,576,15.00,''],
  ];

  const prodData = [headers, ...samples];
  const prodWS = XLSX.utils.aoa_to_sheet(prodData);
  prodWS['!cols'] = [
    {wch:36},{wch:12},{wch:16},{wch:12},
    {wch:22},{wch:12},{wch:12},{wch:14},{wch:12}
  ];
  prodWS['!freeze'] = {xSplit:0, ySplit:1};
  XLSX.utils.book_append_sheet(wb, prodWS, 'Products');

  XLSX.writeFile(wb, 'STOCK_Product_Import_Template.xlsx');
  toast('Template downloaded!', 'success');
}
// ── UI patches: active nav + topbar title ──
const _panelTitles = {
  events: 'Events',
  setup: 'Settings',
  products: 'Products',
  opening: 'Opening Stock',
  distribution: 'Distribution',
  counts: 'Stock Counts',
  topups: 'Top-Ups',
  wastage: 'Wastage',
  transfers: 'Transfers',
  closing: 'Closing Stock',
  cogs: 'COGS',
  recipes: 'Recipes',
  summary: 'Summary',
  bugs: 'Bug Reports',
};

const _origShowPanel = showPanel;
showPanel = function(id) {
  _origShowPanel(id);
  document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === id);
  });
  const t = document.getElementById('currentPanelTitle');
  if (t) {
    const modePrefix = (typeof state !== 'undefined' && state.type === 'kit') ? 'Kit — ' : '';
    t.textContent = modePrefix + (_panelTitles[id] || id);
  }
  updateModeBtns();
};

// keep showNameDisplay in sync
const _origUpdateShowName = window.updateShowName;
if (typeof _origUpdateShowName === 'function') {
  window.updateShowName = function() {
    _origUpdateShowName();
    const el = document.getElementById('showNameDisplay');
    if (el) el.textContent = state.showName || '—';
  };
}

// keep topbar event name updated on load + switch
const _origSwitchEvent = window.switchEvent;
if (typeof _origSwitchEvent === 'function') {
  window.switchEvent = function(id) {
    _origSwitchEvent(id);
    const el = document.getElementById('showNameDisplay');
    if (el) el.textContent = state.showName || '—';
  };
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const el = document.getElementById('showNameDisplay');
    if (el && typeof state !== 'undefined') el.textContent = state.showName || '—';
  }, 200);
});

// ============================================================
// BUG REPORTS
// Stored app-wide (not per event). localStorage key 'measured_stock_bugs'
// is the offline source of truth; if cloud sync is connected the same
// payload also lives in the existing `stock_events` table as a reserved
// row (id = '__bugs__'), following the same pattern as the global recipes
// library. No SQL setup required.
// Shape: { items: [ { id, title, description, area, status, createdAt, resolvedAt } ], _savedAt }
// ============================================================
const BUGS_STORAGE_KEY = 'measured_stock_bugs';
let bugFilter = 'open';

function loadBugs() {
  try {
    const raw = localStorage.getItem(BUGS_STORAGE_KEY);
    if (!raw) return { items: [], _savedAt: 0 };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return { items: [], _savedAt: 0 };
    if (typeof parsed._savedAt !== 'number') parsed._savedAt = 0;
    return parsed;
  } catch (err) {
    console.warn('loadBugs() error:', err);
    return { items: [], _savedAt: 0 };
  }
}

function saveBugs(data) {
  data._savedAt = Date.now();
  localStorage.setItem(BUGS_STORAGE_KEY, JSON.stringify(data));
  updateBugCountBadge();
  // Debounced cloud push — same pattern as the recipes library so
  // rapid edits coalesce into a single request.
  clearTimeout(saveBugs._timer);
  saveBugs._timer = setTimeout(() => cloudPushBugs(), 600);
}

// Push the local bug list up to Supabase. No-op if cloud isn't configured.
async function cloudPushBugs() {
  if (!hasCloud()) return false;
  try {
    const data = loadBugs();
    const payload = {
      id:       BUGS_ROW_ID,
      _savedAt: data._savedAt || Date.now(),
      items:    data.items || [],
    };
    await supabaseFetch('/rest/v1/stock_events', {
      method:  'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body:    JSON.stringify({ id: BUGS_ROW_ID, name: '__bugs__', data: payload }),
    });
    return true;
  } catch (err) {
    console.error('[Sync] Bugs push failed:', err.message);
    return false;
  }
}

// Merge a remote bugs payload into localStorage using last-write-wins
// on the whole list (same strategy as recipes). Returns true if local
// bugs actually changed, so callers can re-render.
function mergeRemoteBugs(remote) {
  if (!remote || !Array.isArray(remote.items)) return false;
  const local = loadBugs();
  const remoteSavedAt = remote._savedAt || 0;
  const localSavedAt  = local._savedAt  || 0;
  if (remoteSavedAt < localSavedAt) return false;
  if (remoteSavedAt === localSavedAt && remote.items.length === local.items.length) return false;
  const next = { items: remote.items, _savedAt: remoteSavedAt };
  localStorage.setItem(BUGS_STORAGE_KEY, JSON.stringify(next));
  return true;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBugDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return 'Today ' + time;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + time;
}

function submitBug() {
  const titleEl = document.getElementById('bug-title');
  const areaEl  = document.getElementById('bug-area');
  const descEl  = document.getElementById('bug-desc');
  const title = (titleEl?.value || '').trim();
  if (!title) {
    toast('Please enter a bug title', 'error');
    titleEl?.focus();
    return;
  }
  const data = loadBugs();
  data.items.unshift({
    id: uid(),
    title,
    description: (descEl?.value || '').trim(),
    area: (areaEl?.value || '').trim(),
    status: 'open',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  });
  saveBugs(data);
  clearBugForm();
  bugFilter = 'open';
  syncBugFilterButtons();
  renderBugs();
  toast('Bug report added', 'success');
}

function clearBugForm() {
  ['bug-title', 'bug-area', 'bug-desc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function setBugFilter(f) {
  bugFilter = f;
  syncBugFilterButtons();
  renderBugs();
}

function syncBugFilterButtons() {
  ['open', 'resolved', 'all'].forEach(f => {
    const btn = document.getElementById('bug-filter-' + f);
    if (btn) btn.classList.toggle('active', bugFilter === f);
  });
}

function toggleBugStatus(id) {
  const data = loadBugs();
  const bug = data.items.find(b => b.id === id);
  if (!bug) return;
  if (bug.status === 'resolved') {
    bug.status = 'open';
    bug.resolvedAt = null;
    toast('Bug reopened', 'success');
  } else {
    bug.status = 'resolved';
    bug.resolvedAt = new Date().toISOString();
    toast('Marked resolved', 'success');
  }
  saveBugs(data);
  renderBugs();
}

function deleteBug(id) {
  if (!confirm('Delete this bug report? This cannot be undone.')) return;
  const data = loadBugs();
  data.items = data.items.filter(b => b.id !== id);
  saveBugs(data);
  renderBugs();
}

function updateBugCountBadge() {
  const badge = document.getElementById('bugOpenCount');
  if (!badge) return;
  const data = loadBugs();
  const openCount = data.items.filter(b => b.status === 'open').length;
  if (openCount > 0) {
    badge.textContent = openCount;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function renderBugs() {
  const list = document.getElementById('bugList');
  const counts = document.getElementById('bugCounts');
  if (!list) return;

  const data = loadBugs();
  const all = data.items.slice();
  const openCount = all.filter(b => b.status === 'open').length;
  const resolvedCount = all.filter(b => b.status === 'resolved').length;

  if (counts) counts.textContent = `${openCount} open · ${resolvedCount} resolved`;

  const filtered = all.filter(b => {
    if (bugFilter === 'open') return b.status === 'open';
    if (bugFilter === 'resolved') return b.status === 'resolved';
    return true;
  });

  filtered.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  if (!filtered.length) {
    let msg = 'No bug reports yet — use the form above to log one.';
    if (bugFilter === 'open') msg = 'No open bug reports. Nice work!';
    else if (bugFilter === 'resolved') msg = 'No resolved bug reports yet.';
    list.innerHTML = `<div class="empty-state"><div class="icon">🐛</div><p>${msg}</p></div>`;
    updateBugCountBadge();
    return;
  }

  list.innerHTML = filtered.map(b => {
    const isResolved = b.status === 'resolved';
    const dotClass = isResolved ? 'bug-status-resolved' : 'bug-status-open';
    const created = formatBugDate(b.createdAt);
    const resolved = formatBugDate(b.resolvedAt);
    const areaPill = b.area
      ? `<span class="bug-area-pill">${escapeHtml(b.area)}</span>`
      : '';
    const meta = [
      areaPill,
      created ? `<span>Logged ${escapeHtml(created)}</span>` : '',
      isResolved && resolved ? `<span>Resolved ${escapeHtml(resolved)}</span>` : '',
    ].filter(Boolean).join('');
    const desc = b.description
      ? `<div class="bug-desc">${escapeHtml(b.description)}</div>`
      : '';
    const toggleLabel = isResolved ? 'Reopen' : '✓ Mark Resolved';
    const toggleClass = isResolved ? 'btn-outline' : 'btn-primary';
    return `
      <div class="bug-row ${isResolved ? 'resolved' : ''}">
        <div class="bug-status-dot ${dotClass}" title="${isResolved ? 'Resolved' : 'Open'}"></div>
        <div>
          <div class="bug-title">${escapeHtml(b.title)}</div>
          <div class="bug-meta">${meta}</div>
          ${desc}
        </div>
        <div class="bug-actions">
          <button class="btn ${toggleClass} btn-sm" onclick="toggleBugStatus('${b.id}')">${toggleLabel}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBug('${b.id}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  updateBugCountBadge();
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    syncBugFilterButtons();
    updateBugCountBadge();
  }, 220);
});

// ============================================================
// ============================================================
// RECIPES & COGS
// ============================================================
// Recipes are a GLOBAL library shared across every event. They live in
// `appData.recipes` locally and sync to Supabase as one reserved row in the
// existing `stock_events` table (id = '__recipes__'). No SQL setup needed —
// the table already exists from cloud sync onboarding.
//
// `state.tillSales` is per-event — the Square till summary CSV the user imports.
// ============================================================

// ── Cloud helper: push the global recipe library ─────────────────────────
async function cloudPushRecipes() {
  if (!hasCloud()) return false;
  try {
    const now = Date.now();
    appData._recipesSavedAt = now;
    const payload = {
      id:        RECIPES_ROW_ID,
      _savedAt:  now,
      recipes:   appData.recipes || [],
    };
    await supabaseFetch('/rest/v1/stock_events', {
      method:  'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body:    JSON.stringify({ id: RECIPES_ROW_ID, name: '__recipes__', data: payload }),
    });
    return true;
  } catch(err) {
    console.error('[Sync] Recipe push failed:', err.message);
    return false;
  }
}

function saveRecipesLibrary() {
  localStorage.setItem('measured_stock_app', JSON.stringify(appData));
  clearTimeout(saveRecipesLibrary._timer);
  saveRecipesLibrary._timer = setTimeout(() => cloudPushRecipes(), 800);
}

// ── Quantity input parsing (handles "1/24", "2/24", math expressions) ────
function parseQtyExpr(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const n = parseFloat(s);
  if (!isNaN(n) && String(n) === s) return n;
  if (/^[0-9+\-*/().\s]+$/.test(s)) {
    try {
      const r = Function('"use strict"; return (' + s + ')')();
      if (typeof r === 'number' && isFinite(r)) return r;
    } catch(e) { /* fall through */ }
  }
  const f = parseFloat(s);
  return isFinite(f) ? f : 0;
}

function formatQty(q) {
  if (q == null) return '';
  const n = Number(q);
  if (!isFinite(n)) return '';
  if (n === Math.round(n)) return String(n);
  return n.toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
}

// ============================================================
// RECIPES — UI
// ============================================================
let editingRecipeId = null;

function renderRecipes() {
  const body = document.getElementById('recipeTableBody');
  if (!body) return;
  const searchEl = document.getElementById('recipeSearch');
  const q = (searchEl ? searchEl.value : '').toLowerCase().trim();
  const recipes = (appData.recipes || []).slice().sort((a,b) =>
    (a.tillItem || '').localeCompare(b.tillItem || '')
  );
  const filtered = q
    ? recipes.filter(r => (r.tillItem || '').toLowerCase().includes(q) ||
                          (r.ingredients || []).some(i => (i.productName||'').toLowerCase().includes(q)))
    : recipes;

  // Sync status line
  const ss = document.getElementById('recipeSyncStatus');
  if (ss) {
    const count = (appData.recipes || []).length;
    if (!hasCloud()) {
      ss.textContent = count + ' recipes saved locally. Connect cloud sync in Setup to share across devices.';
    } else {
      ss.textContent = count + ' recipes — synced globally across every event.';
    }
  }

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="icon">📖</div><p>${q ? 'No recipes match your search.' : 'No recipes yet. Add one to start mapping till items to ingredients.'}</p></div></td></tr>`;
    return;
  }

  body.innerHTML = filtered.map(r => {
    const ings = (r.ingredients || []).map(i => {
      // Prefer the live product lookup so size stays in sync if it's edited.
      const p = (i.productId && state.products.find(x => x.id === i.productId)) ||
                state.products.find(x => (x.name || '').toLowerCase() === (i.productName || '').toLowerCase());
      const sizeBit = p && p.size
        ? ` <span style="color:var(--muted-foreground);font-weight:400">(${escapeHtml(p.size)})</span>`
        : '';
      return `<div><strong>${escapeHtml(i.productName || '?')}</strong>${sizeBit} · <span style="font-family:'DM Mono',monospace">${formatQty(i.qty)}</span></div>`;
    }).join('') || '<span style="color:var(--muted-foreground)">—</span>';
    const needsReview = /auto-mapped/i.test(r.notes || '');
    const reviewBadge = needsReview
      ? `<span class="review-badge" title="${escapeHtml(r.notes || '')}">REVIEW</span>`
      : '';
    return `
      <tr${needsReview ? ' class="recipe-row-review"' : ''}>
        <td style="font-weight:600">${escapeHtml(r.tillItem || '—')} ${reviewBadge}</td>
        <td style="color:var(--muted-foreground)">${escapeHtml(r.tillVariation || 'Regular')}</td>
        <td class="cogs-ingredients-cell">${ings}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm btn-icon" onclick="openEditRecipe('${r.id}')" title="Edit">⚙️</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="deleteRecipe('${r.id}')" title="Delete">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openAddRecipe(prefillName) {
  editingRecipeId = null;
  document.getElementById('recipeModalTitle').textContent = 'Add Recipe';
  document.getElementById('rm-item').value = prefillName || '';
  document.getElementById('rm-variation').value = 'Regular';
  document.getElementById('rm-notes').value = '';
  document.getElementById('rm-ingredients').innerHTML = '';
  addIngredientRow();
  const delBtn = document.getElementById('rm-delete-btn');
  if (delBtn) delBtn.style.display = 'none';
  openDrawer('recipeModal');
  setTimeout(() => { const n = document.getElementById('rm-item'); if (n && !n.value) n.focus(); }, 220);
}

function openEditRecipe(id) {
  const r = (appData.recipes || []).find(x => x.id === id);
  if (!r) return;
  editingRecipeId = id;
  document.getElementById('recipeModalTitle').textContent = 'Edit Recipe';
  document.getElementById('rm-item').value = r.tillItem || '';
  document.getElementById('rm-variation').value = r.tillVariation || 'Regular';
  document.getElementById('rm-notes').value = r.notes || '';
  document.getElementById('rm-ingredients').innerHTML = '';
  (r.ingredients || []).forEach(i => addIngredientRow(i.productId, i.productName, i.qty));
  if (!(r.ingredients || []).length) addIngredientRow();
  const delBtn = document.getElementById('rm-delete-btn');
  if (delBtn) delBtn.style.display = '';
  openDrawer('recipeModal');
}

function addIngredientRow(productId, productName, qty) {
  const wrap = document.getElementById('rm-ingredients');
  if (!wrap) return;
  const idx = wrap.children.length;
  const row = document.createElement('div');
  row.className = 'ingredient-row';

  // Back-compat: if we only have a productName (old recipes), resolve to the
  // first product with that exact name so the dropdown pre-selects something.
  let selectedId = productId || '';
  if (!selectedId && productName) {
    const match = state.products.find(p => (p.name || '').toLowerCase() === productName.toLowerCase());
    if (match) selectedId = match.id;
  }

  const selectedProduct = selectedId ? state.products.find(p => p.id === selectedId) : null;
  const selectedLabel = selectedProduct
    ? selectedProduct.name + (selectedProduct.size ? ' — ' + selectedProduct.size : '')
    : '';

  row.innerHTML = `
    <div class="ing-search" data-idx="${idx}">
      <input type="hidden" class="ing-product" value="${escapeHtml(selectedId)}">
      <input type="text" class="ing-search-input" placeholder="Search products…" autocomplete="off"
        value="${escapeHtml(selectedLabel)}"
        onfocus="onIngSearchFocus(this)"
        oninput="onIngSearchInput(this)"
        onkeydown="onIngSearchKeydown(event, this)">
      <div class="ing-dropdown" role="listbox" hidden></div>
    </div>
    <input type="text" class="ing-qty" placeholder="1" value="${qty != null ? formatQty(qty) : ''}" data-idx="${idx}">
    <div style="display:flex;gap:2px">
      <button type="button" class="quick-btn" onclick="setIngQtySmart(this,'whole')" title="One whole can/bottle/pint (1 ÷ units per case)">1 unit</button>
      <button type="button" class="quick-btn" onclick="setIngQtySmart(this,'shot')" title="Single shot — 1/(24 × bottles per case)">Shot</button>
      <button type="button" class="quick-btn" onclick="setIngQtySmart(this,'double')" title="Double shot — 2/(24 × bottles per case)">Double</button>
      <button type="button" class="quick-btn" onclick="setIngQty(this,'1')" title="One whole case (SKU)">1 case</button>
    </div>
    <button type="button" class="ing-remove" onclick="this.parentElement.remove()" title="Remove">×</button>
  `;
  wrap.appendChild(row);
}

function renderIngDropdown(searchEl, query) {
  const dropdown = searchEl.querySelector('.ing-dropdown');
  const hidden = searchEl.querySelector('.ing-product');
  if (!dropdown || !hidden) return;
  const q = (query || '').trim().toLowerCase();
  const products = sortedProducts(state.products.filter(p => p.name));
  const filtered = q
    ? products.filter(p => {
        const label = (p.name + (p.size ? ' ' + p.size : '')).toLowerCase();
        return label.includes(q);
      })
    : products;
  const max = 60;
  const items = filtered.slice(0, max);
  if (!items.length) {
    dropdown.innerHTML = `<div class="ing-search-empty">No products match</div>`;
    return;
  }
  const more = filtered.length > max
    ? `<div class="ing-search-empty">…${filtered.length - max} more — keep typing</div>`
    : '';
  dropdown.innerHTML = items.map(p => {
    const label = p.name + (p.size ? ' — ' + p.size : '');
    return `<div class="ing-search-option" data-id="${escapeHtml(p.id)}" role="option" onmousedown="event.preventDefault()" onclick="onIngSearchOptionClick(this)">${escapeHtml(label)}</div>`;
  }).join('') + more;

  // Mark an option as active for keyboard nav: prefer the currently selected
  // product, else fall back to the first item.
  let activeIdx = items.findIndex(p => p.id === hidden.value);
  if (activeIdx < 0) activeIdx = 0;
  setActiveIngIdx(searchEl, activeIdx);
}

function setActiveIngIdx(searchEl, idx) {
  const opts = searchEl.querySelectorAll('.ing-search-option');
  opts.forEach((o, i) => o.classList.toggle('active', i === idx));
  if (opts[idx]) opts[idx].scrollIntoView({ block: 'nearest' });
}

function moveIngActive(searchEl, dir) {
  const opts = searchEl.querySelectorAll('.ing-search-option');
  if (!opts.length) return;
  let idx = -1;
  opts.forEach((o, i) => { if (o.classList.contains('active')) idx = i; });
  idx = (idx + dir + opts.length) % opts.length;
  setActiveIngIdx(searchEl, idx);
}

function openIngDropdown(searchEl) {
  // Close any other open ingredient dropdowns first.
  document.querySelectorAll('.ing-search.open').forEach(s => {
    if (s !== searchEl) closeIngDropdown(s);
  });
  const dropdown = searchEl.querySelector('.ing-dropdown');
  const input = searchEl.querySelector('.ing-search-input');
  if (!dropdown || !input) return;
  renderIngDropdown(searchEl, input.value);
  dropdown.hidden = false;
  searchEl.classList.add('open');
}

function closeIngDropdown(searchEl) {
  const dropdown = searchEl.querySelector('.ing-dropdown');
  if (!dropdown) return;
  dropdown.hidden = true;
  searchEl.classList.remove('open');
}

function onIngSearchFocus(input) {
  const searchEl = input.closest('.ing-search');
  if (searchEl) {
    input.select();
    openIngDropdown(searchEl);
  }
}

function onIngSearchInput(input) {
  const searchEl = input.closest('.ing-search');
  if (!searchEl) return;
  // Typing invalidates any prior selection until the user picks again.
  const hidden = searchEl.querySelector('.ing-product');
  if (hidden) hidden.value = '';
  openIngDropdown(searchEl);
  renderIngDropdown(searchEl, input.value);
}

function onIngSearchKeydown(event, input) {
  const searchEl = input.closest('.ing-search');
  if (!searchEl) return;
  const dropdown = searchEl.querySelector('.ing-dropdown');
  const isOpen = dropdown && !dropdown.hidden;
  if (event.key === 'ArrowDown') {
    if (!isOpen) openIngDropdown(searchEl);
    else moveIngActive(searchEl, 1);
    event.preventDefault();
  } else if (event.key === 'ArrowUp') {
    if (isOpen) { moveIngActive(searchEl, -1); event.preventDefault(); }
  } else if (event.key === 'Enter') {
    if (isOpen) {
      const active = searchEl.querySelector('.ing-search-option.active');
      if (active) {
        selectIngOption(searchEl, active.dataset.id);
        event.preventDefault();
      }
    }
  } else if (event.key === 'Escape') {
    if (isOpen) { closeIngDropdown(searchEl); event.preventDefault(); }
  } else if (event.key === 'Tab') {
    closeIngDropdown(searchEl);
  }
}

function onIngSearchOptionClick(optEl) {
  const searchEl = optEl.closest('.ing-search');
  if (searchEl) selectIngOption(searchEl, optEl.dataset.id);
}

function selectIngOption(searchEl, productId) {
  const hidden = searchEl.querySelector('.ing-product');
  const input = searchEl.querySelector('.ing-search-input');
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  if (hidden) hidden.value = p.id;
  if (input) input.value = p.name + (p.size ? ' — ' + p.size : '');
  closeIngDropdown(searchEl);
  // Move focus to the qty field for fast entry.
  const row = searchEl.closest('.ingredient-row');
  const qtyInput = row && row.querySelector('.ing-qty');
  if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
}

// Close any open ingredient dropdown when clicking/tapping outside it.
document.addEventListener('mousedown', (e) => {
  document.querySelectorAll('.ing-search.open').forEach(s => {
    if (!s.contains(e.target)) {
      const input = s.querySelector('.ing-search-input');
      const hidden = s.querySelector('.ing-product');
      // If the user typed but didn't pick a result, restore the previously
      // selected product label (or clear if nothing was selected).
      if (input && hidden) {
        if (hidden.value) {
          const p = state.products.find(x => x.id === hidden.value);
          input.value = p ? (p.name + (p.size ? ' — ' + p.size : '')) : '';
        } else {
          input.value = '';
        }
      }
      closeIngDropdown(s);
    }
  });
});

function setIngQty(btn, val) {
  const row = btn.closest('.ingredient-row');
  if (!row) return;
  const inp = row.querySelector('.ing-qty');
  if (inp) inp.value = val;
}

function setIngQtySmart(btn, pour) {
  const row = btn.closest('.ingredient-row');
  if (!row) return;
  const inp = row.querySelector('.ing-qty');
  const hidden = row.querySelector('.ing-product');
  if (!inp) return;
  const pid = hidden && hidden.value;
  const p = pid ? state.products.find(x => x.id === pid) : null;
  if (!p) {
    toast('Pick a product first — qty depends on units per case', 'error');
    return;
  }
  const ups = p.unitsPerSku || 1;
  let qty = 1;
  if (pour === 'whole')   qty = 1 / ups;
  else if (pour === 'shot')   qty = 1 / (ups * 24);
  else if (pour === 'double') qty = 2 / (ups * 24);
  else if (pour === 'half')   qty = 0.5 / ups;
  inp.value = formatQty(qty);
}

function closeRecipeDrawer() {
  closeDrawer('recipeModal');
}

function saveRecipe() {
  const tillItem = document.getElementById('rm-item').value.trim();
  if (!tillItem) { toast('Till item name is required', 'error'); return; }
  const variation = document.getElementById('rm-variation').value.trim() || 'Regular';
  const notes = document.getElementById('rm-notes').value.trim();

  const ingRows = document.querySelectorAll('#rm-ingredients .ingredient-row');
  const ingredients = [];
  ingRows.forEach(row => {
    const productId = row.querySelector('.ing-product').value.trim();
    const qty       = parseQtyExpr(row.querySelector('.ing-qty').value);
    if (!productId || !(qty > 0)) return;
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    ingredients.push({ productId: p.id, productName: p.name, qty });
  });

  if (!ingredients.length) { toast('Add at least one ingredient', 'error'); return; }

  if (!Array.isArray(appData.recipes)) appData.recipes = [];

  if (editingRecipeId) {
    const i = appData.recipes.findIndex(r => r.id === editingRecipeId);
    if (i >= 0) {
      // If user edited a draft auto-mapped recipe and didn't touch the notes,
      // clear the "Auto-mapped … review" tag so it stops showing the REVIEW badge.
      const prev = appData.recipes[i];
      let nextNotes = notes;
      if (!nextNotes && /^auto-mapped/i.test(prev.notes || '')) nextNotes = '';
      appData.recipes[i] = { ...prev, tillItem, tillVariation: variation, ingredients, notes: nextNotes, _unitModel: 'case' };
    }
  } else {
    // Check for duplicate (same tillItem + variation) and offer to replace
    const dup = appData.recipes.findIndex(r =>
      (r.tillItem || '').toLowerCase() === tillItem.toLowerCase() &&
      (r.tillVariation || 'Regular').toLowerCase() === variation.toLowerCase()
    );
    if (dup >= 0) {
      if (!confirm('A recipe for "' + tillItem + '" already exists. Replace it?')) return;
      appData.recipes[dup] = { ...appData.recipes[dup], tillItem, tillVariation: variation, ingredients, notes, _unitModel: 'case' };
    } else {
      appData.recipes.push({ id: uid(), tillItem, tillVariation: variation, ingredients, notes, _unitModel: 'case' });
    }
  }

  saveRecipesLibrary();
  renderRecipes();
  if (document.getElementById('panel-cogs').classList.contains('active')) renderCogs();
  closeRecipeDrawer();
  toast(editingRecipeId ? 'Recipe updated' : 'Recipe added', 'success');
}

function deleteRecipeFromDrawer() {
  if (!editingRecipeId) return;
  if (!confirm('Delete this recipe?')) return;
  appData.recipes = (appData.recipes || []).filter(r => r.id !== editingRecipeId);
  saveRecipesLibrary();
  renderRecipes();
  if (document.getElementById('panel-cogs').classList.contains('active')) renderCogs();
  closeRecipeDrawer();
  toast('Recipe deleted', 'success');
}

function deleteRecipe(id) {
  if (!confirm('Delete this recipe?')) return;
  appData.recipes = (appData.recipes || []).filter(r => r.id !== id);
  saveRecipesLibrary();
  renderRecipes();
  if (document.getElementById('panel-cogs').classList.contains('active')) renderCogs();
  toast('Recipe deleted', 'success');
}

// ── Smart till-item auto-mapper ──────────────────────────────────────────
// Given a till-item name and the current event's products, return a draft
// recipe (ingredients + notes) or null if no decent match can be inferred.
//
// Handles:
//   • Pour-size suffixes:  (Single), (Shot), (Double), (Pint), (Half Pint), (Can)
//   • Redbull / Bull mixer combos: Vodka Redbull, Tequila Peach Bull, Rumbull, …
//   • Compound shots:  Jagerbomb = Jagermeister + Redbull
//   • Supplier-hint stripping:  Cazcabel, Pimentae, Hard rock
//   • Falls back to token-overlap product search on the remaining name
function autoMatchTillItem(tillName, products) {
  if (!tillName) return null;
  // Skip obvious non-ingredient lines
  if (/^(Custom Amount|REFUSED|SOLD\b.*|Compulsory Cup|Case of water|Prosecco Glass)$/i.test(tillName.trim())) {
    return null;
  }

  // Recipe qty is now "fraction of one CASE/SKU". Given a pour kind and the
  // matched product's unitsPerSku, convert to a case-fraction.
  //   1 can/bottle out of an N-pack case → 1/N
  //   1 shot from a 24-shot bottle, in an N-bottle case → 1/(N×24)
  function qtyFor(pour, p) {
    const ups = (p && p.unitsPerSku) || 1;
    if (pour === 'whole')    return 1 / ups;          // one unit (can / bottle / pint)
    if (pour === 'half')     return 0.5 / ups;        // half pint of a draught
    if (pour === 'shot')     return 1 / (ups * 24);   // one shot from a 24-shot bottle
    if (pour === 'double')   return 2 / (ups * 24);
    return 1 / ups;
  }

  let name = String(tillName).trim();
  let pourKind = 'whole';
  let pourLabel = 'unit';
  const secondary = [];

  // 1) Extract pour-size suffix (parenthetical at end, optionally missing close-paren)
  let m;
  if ((m = name.match(/\(?(double|single|shot|half\s*pint|pint|can|bottle|draught)\)?\s*$/i))) {
    const sz = m[1].toLowerCase().replace(/\s+/g, '');
    if      (sz === 'double')                       { pourKind = 'double'; pourLabel = 'double shot'; }
    else if (sz === 'single' || sz === 'shot')      { pourKind = 'shot';   pourLabel = 'single shot'; }
    else if (sz === 'halfpint')                     { pourKind = 'half';   pourLabel = 'half pint'; }
    else if (sz === 'pint')                         { pourKind = 'whole';  pourLabel = 'pint'; }
    else if (sz === 'can' || sz === 'bottle')       { pourKind = 'whole';  pourLabel = sz; }
    else                                            { pourKind = 'whole';  pourLabel = sz; }
    name = name.replace(/\(?(double|single|shot|half\s*pint|pint|can|bottle|draught)\)?\s*$/i, '').trim();
  } else if (/\bShot\b/i.test(name)) {
    pourKind = 'shot'; pourLabel = 'single shot';
    name = name.replace(/\bShot\b/i, '').trim();
  }

  // 2) Strip trailing supplier hints from Square (Cazcabel, Pimentae, Hard rock, etc.)
  name = name.replace(/\b(Cazcabel|Pimentae|Hard\s*rock)\b/gi, '').replace(/\s+/g, ' ').trim();

  // Helper: token-overlap search against products. Requires ≥50% of query
  // tokens to appear in the product name.
  function normTokens(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  }
  function findBest(query) {
    const qTokens = normTokens(query);
    if (!qTokens.length) return null;
    let best = null, bestScore = 0;
    for (const p of products) {
      if (!p.name) continue;
      const pNorm = ' ' + p.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
      const pCompact = pNorm.replace(/\s+/g, '');
      let score = 0;
      for (const tok of qTokens) {
        const tokCompact = tok.replace(/\s+/g, '');
        if (pNorm.includes(' ' + tok)) score += 1;        // word-prefix match
        else if (pCompact.includes(tokCompact)) score += 1; // handles "redbull" ↔ "red bull"
        else if (pNorm.includes(tok))  score += 0.5;      // substring match
      }
      const required = Math.max(1, Math.floor(qTokens.length * 0.5));
      if (score >= required && score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  // 3) Special-case Jagerbomb (spirit + mixer combo)
  if (/jagerbomb/i.test(tillName)) {
    const jager = findBest('jagermeister');
    const rb    = findBest('redbull');
    const ings  = [];
    if (jager) ings.push({ productId: jager.id, productName: jager.name, qty: qtyFor('shot', jager) });
    if (rb)    ings.push({ productId: rb.id,    productName: rb.name,    qty: qtyFor('whole', rb) });
    return ings.length ? { ingredients: ings, notes: 'Auto-mapped (Jagerbomb) — review' } : null;
  }

  // 4) Detect Redbull / Bull mixer
  const bullRe = /\b(red\s*bull|redbull|rumbull|peach\s*bull|lime\s*bull|cherry\s*bull)\b/i;
  if (bullRe.test(name)) {
    let rbQuery = 'redbull';
    if (/peach\s*bull|redbull\s*peach/i.test(name)) rbQuery = 'redbull peach';
    else if (/sugar\s*free|sugarfree/i.test(name)) rbQuery = 'redbull sugarfree';
    const rb = findBest(rbQuery) || findBest('redbull');
    if (rb) secondary.push({ productId: rb.id, productName: rb.name, qty: qtyFor('whole', rb) });

    // Remove bull tokens + flavor adjectives that belong to the redbull
    name = name
      .replace(/\b(red\s*bull|redbull)\b/gi, ' ')
      .replace(/\brumbull\b/gi, ' rum ')               // "Rumbull" → "rum"
      .replace(/\b(peach\s*bull|lime\s*bull|cherry\s*bull)\b/gi, ' ')
      .replace(/\b(peach|tropical|cherry|citrus|zest|lime|sugarfree|sugar\s*free)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 5) Strip generic modifier words that don't help matching
  const cleaned = name.replace(/\bmixer\b/gi, ' ').replace(/\s+/g, ' ').trim();

  // 6) Find best primary product match on what's left
  if (!cleaned) {
    return secondary.length ? { ingredients: secondary, notes: 'Auto-mapped (review)' } : null;
  }

  const primary = findBest(cleaned);
  if (!primary) {
    // No primary product — only useful if we found a mixer
    return secondary.length ? { ingredients: secondary, notes: 'Auto-mapped (partial, primary spirit missing) — review' } : null;
  }

  const ingredients = [{ productId: primary.id, productName: primary.name, qty: qtyFor(pourKind, primary) }, ...secondary];
  const mixerNote = secondary.length ? ' + mixer' : '';
  return { ingredients, notes: 'Auto-mapped (' + pourLabel + mixerNote + ') — review' };
}

// Walk every till sale in the current event and create draft recipes for any
// item that doesn't already have one. Skips items with no plausible match.
function autoCreateRecipesFromTill(opts) {
  opts = opts || {};
  const sales = (state.tillSales && state.tillSales.rows) || [];
  if (!sales.length) {
    if (!opts.silent) toast('Import a till CSV first', 'error');
    return { created: 0, skipped: 0, already: 0 };
  }

  const existingKeys = new Set((appData.recipes || []).map(r =>
    ((r.tillItem || '') + '|' + (r.tillVariation || 'Regular')).toLowerCase()
  ));

  let created = 0;
  let skipped = 0;
  let already = 0;

  sales.forEach(s => {
    const key = ((s.name || '') + '|' + (s.variation || 'Regular')).toLowerCase();
    if (existingKeys.has(key)) { already++; return; }

    const match = autoMatchTillItem(s.name, state.products);
    if (!match) { skipped++; return; }

    appData.recipes.push({
      id: uid(),
      tillItem: s.name,
      tillVariation: s.variation || 'Regular',
      ingredients: match.ingredients,
      notes: match.notes || 'Auto-mapped — review',
      _unitModel: 'case',
    });
    existingKeys.add(key);
    created++;
  });

  if (created) {
    saveRecipesLibrary();
    renderRecipes();
    if (document.getElementById('panel-cogs').classList.contains('active')) renderCogs();
  }

  if (!opts.silent) {
    if (!created) {
      toast(skipped > 0 ? 'No new auto-matches (' + skipped + ' items had no recipe inference)' : 'No new auto-matches', 'success');
    } else {
      const note = skipped > 0 ? ', ' + skipped + ' left for manual mapping' : '';
      toast('Created ' + created + ' draft recipe' + (created === 1 ? '' : 's') + ' — fine-tune in Recipes' + note, 'success');
    }
  }

  return { created, skipped, already };
}

// ============================================================
// TILL SALES — CSV / TSV import
// ============================================================
function importTillFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = new Uint8Array(ev.target.result);
      const wb = XLSX.read(data, { type: 'array', raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

      const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
      const colMap = {
        name:      ['itemname','name','product','productname'],
        variation: ['itemvariation','variation','variant'],
        sku:       ['sku','skucode','code'],
        category:  ['category','cat'],
        itemsSold: ['itemssold','sold','qtysold','quantitysold','qty','count'],
        netSales:  ['netsales','net','netsalesgbp'],
        grossSales:['grosssales','gross','total','grosssalesgbp'],
        refunds:   ['refunds','refund'],
      };
      function findCol(rowKeys, field) {
        const variants = colMap[field];
        for (const k of rowKeys) {
          if (variants.includes(norm(k))) return k;
        }
        return null;
      }
      function money(v) {
        if (v == null) return 0;
        const s = String(v).replace(/[£$,\s]/g,'').trim();
        const n = parseFloat(s);
        return isFinite(n) ? n : 0;
      }

      if (!rows.length) {
        document.getElementById('cogsImportStatus').textContent = 'No rows found in file.';
        document.getElementById('cogsImportStatus').style.color = 'var(--danger)';
        return;
      }
      const keys = Object.keys(rows[0]);
      const nameCol = findCol(keys, 'name');
      if (!nameCol) {
        document.getElementById('cogsImportStatus').textContent = 'Could not find an "Item Name" column in the file.';
        document.getElementById('cogsImportStatus').style.color = 'var(--danger)';
        return;
      }

      const parsed = rows.map(r => {
        const name = String(r[nameCol] || '').trim();
        if (!name) return null;
        return {
          name,
          variation: String(r[findCol(keys,'variation')] || 'Regular').trim() || 'Regular',
          sku:       String(r[findCol(keys,'sku')] || '').trim().replace(/^"+|"+$/g,''),
          category:  String(r[findCol(keys,'category')] || '').trim(),
          itemsSold: parseFloat(r[findCol(keys,'itemsSold')]) || 0,
          netSales:  money(r[findCol(keys,'netSales')]),
          grossSales:money(r[findCol(keys,'grossSales')]),
        };
      }).filter(Boolean).filter(r => r.itemsSold > 0);

      if (!parsed.length) {
        document.getElementById('cogsImportStatus').textContent = 'No till lines with items sold > 0 found.';
        document.getElementById('cogsImportStatus').style.color = 'var(--danger)';
        return;
      }

      state.tillSales = {
        importedAt: new Date().toISOString(),
        fileName:   file.name,
        rows:       parsed,
      };
      save();
      renderCogs();
      const mapResult = autoCreateRecipesFromTill({ silent: true });
      if (mapResult.created > 0) {
        renderCogs();
        const manual = mapResult.skipped > 0 ? ' · ' + mapResult.skipped + ' need manual recipes' : '';
        toast('Imported ' + parsed.length + ' till lines · auto-mapped ' + mapResult.created + ' recipes' + manual + ' — fine-tune in Recipes', 'success');
      } else {
        toast('Imported ' + parsed.length + ' till lines — click Auto-map Till to create draft recipes', 'success');
      }
    } catch(err) {
      console.error(err);
      document.getElementById('cogsImportStatus').textContent = 'Could not read file: ' + err.message;
      document.getElementById('cogsImportStatus').style.color = 'var(--danger)';
    }
  };
  reader.readAsArrayBuffer(file);
}

function clearTillSales() {
  if (!confirm('Remove the imported till sales for this event?')) return;
  state.tillSales = null;
  save();
  renderCogs();
  toast('Till sales cleared', 'success');
}

// ============================================================
// MODIFIER SALES — CSV / TSV import (Square › Reports › Modifier Sales)
// ============================================================
// Square exports modifier reports as UTF-16 LE, tab-separated, with a £/$ in
// the sales columns. We decode the BOM ourselves so the columns parse cleanly
// regardless of how XLSX would otherwise misread the encoding.
function importModifierFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const statusEl = document.getElementById('cogsModImportStatus');
  const setStatus = (msg, ok) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = ok ? 'var(--muted-foreground)' : 'var(--danger)';
  };

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const buf = ev.target.result;
      const rows = parseModifierBuffer(buf);
      if (!rows.length) {
        setStatus('No modifier rows found in file.', false);
        return;
      }

      state.modifierSales = {
        importedAt: new Date().toISOString(),
        fileName:   file.name,
        rows,
      };
      save();
      renderCogs();
      toast('Imported ' + rows.length + ' modifier line' + (rows.length === 1 ? '' : 's'), 'success');
    } catch (err) {
      console.error(err);
      setStatus('Could not read file: ' + err.message, false);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Decode an ArrayBuffer that may be UTF-16 LE (Square default), UTF-16 BE,
// UTF-8 with BOM, or plain UTF-8 / ASCII. Returns parsed modifier rows.
function parseModifierBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let text;
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  } else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  } else if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    text = new TextDecoder('utf-8').decode(bytes.subarray(3));
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  // Strip any leftover BOM and normalise line endings
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  // Detect delimiter — Square uses tabs but accept commas just in case
  const firstLine = text.split('\n', 1)[0] || '';
  const delim = firstLine.includes('\t') ? '\t' : ',';

  // Lightweight CSV/TSV split that honours quoted fields
  function splitLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === delim && !inQ) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  const lines = text.split('\n').filter(l => l.trim().length);
  if (!lines.length) return [];

  const header = splitLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const idx = (...names) => {
    for (const n of names) {
      const k = n.toLowerCase().replace(/[^a-z0-9]/g, '');
      const i = header.indexOf(k);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iSet      = idx('modifierset','set');
  const iMod      = idx('modifier','name');
  const iNetQty   = idx('netqtysold','netqty','netquantity');
  const iNetSales = idx('netsales','net');
  const iQty      = idx('qtysold','qty','quantitysold');
  const iGross    = idx('grosssales','gross');
  const iRefQty   = idx('qtyrefunded','refundedqty');
  const iRefunds  = idx('refunds','refund');

  if (iSet < 0 || iMod < 0) {
    throw new Error('Could not find "Modifier Set" and "Modifier" columns');
  }

  const money = v => {
    if (v == null) return 0;
    const s = String(v).replace(/[£$,\s]/g, '').trim();
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  };
  const num = v => {
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitLine(lines[i]);
    const set = (c[iSet] || '').trim();
    const mod = (c[iMod] || '').trim();
    if (!set && !mod) continue;
    const netQty = iNetQty >= 0 ? num(c[iNetQty]) : 0;
    const qty    = iQty    >= 0 ? num(c[iQty])    : netQty;
    if (!netQty && !qty) continue;
    rows.push({
      set,
      modifier: mod,
      netQty:     netQty || qty,
      qty:        qty || netQty,
      netSales:   iNetSales >= 0 ? money(c[iNetSales]) : 0,
      grossSales: iGross    >= 0 ? money(c[iGross])    : 0,
      qtyRefunded: iRefQty  >= 0 ? num(c[iRefQty])     : 0,
      refunds:    iRefunds  >= 0 ? money(c[iRefunds])  : 0,
    });
  }
  return rows;
}

function clearModifierSales() {
  if (!confirm('Remove the imported modifier report for this event?')) return;
  state.modifierSales = null;
  save();
  renderCogs();
  toast('Modifier report cleared', 'success');
}

// Best-effort match a modifier name (e.g. "Coke", "Red Bull Original",
// "Ginger Beer") to a product in the current event. Returns the product or
// null. Mirrors the token-overlap rules used by autoMatchTillItem.
function matchModifierToProduct(modName, products) {
  if (!modName) return null;
  const stop = /^(no\s+mixer|none|n\/?a|bar\s+\d+.*|main\s+bar|aggressive|intoxicated)$/i;
  if (stop.test(modName.trim())) return null;

  // Normalise: "Red Bull " → "redbull", drop punctuation
  const cleaned = String(modName).toLowerCase()
    .replace(/red\s*bull/g, 'redbull')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const qTokens = cleaned.split(' ').filter(t => t.length > 1);
  if (!qTokens.length) return null;

  let best = null, bestScore = 0;
  for (const p of products) {
    if (!p.name) continue;
    const pNorm = ' ' + p.name.toLowerCase()
      .replace(/red\s*bull/g, 'redbull')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ') + ' ';
    const pCompact = pNorm.replace(/\s+/g, '');
    let score = 0;
    for (const tok of qTokens) {
      if (pNorm.includes(' ' + tok)) score += 1;
      else if (pCompact.includes(tok)) score += 1;
      else if (pNorm.includes(tok))    score += 0.5;
    }
    const required = Math.max(1, Math.floor(qTokens.length * 0.5));
    if (score >= required && score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

// ============================================================
// COGS — LEGACY RECIPE MIGRATION
// ============================================================
// Older recipes that used the "qty 1 = one whole can" pattern over-cost sales
// now that qty is a fraction of one case. This helper finds ingredients where
// qty >= 1 AND the product is a multi-unit case (unitsPerSku > 1), then
// rewrites qty to 1/unitsPerSku so each sale consumes one can/bottle of the
// case (i.e. preserves the original intent).
//
// We intentionally do NOT touch ingredients with qty < 1: those might already
// be correct case-fractions, or might be legacy spirit shot fractions that
// need a human eye to decide between (e.g. 1/24 on a 24-can pack is correct,
// 1/24 on a 6-bottle spirit case is a legacy shot — only the user knows).
function migrateLegacyRecipes() {
  if (!Array.isArray(appData.recipes) || !appData.recipes.length) {
    toast('No recipes to migrate', 'success');
    return;
  }
  const productById = {};
  const productByName = {};
  (state.products || []).forEach(p => {
    if (p.id)   productById[p.id] = p;
    if (p.name) productByName[p.name.toLowerCase()] = p;
  });

  const changes = [];
  (appData.recipes || []).forEach(r => {
    (r.ingredients || []).forEach(ing => {
      const p = (ing.productId && productById[ing.productId]) ||
                productByName[(ing.productName || '').toLowerCase()];
      if (!p) return;
      const ups = p.unitsPerSku || 0;
      if (ups > 1 && ing.qty >= 1) {
        const before = ing.qty;
        const after = before / ups;
        changes.push({ recipe: r, ingredient: ing, productName: p.name, ups, before, after });
      }
    });
  });

  if (!changes.length) {
    // Mark every recipe as migrated so the diagnostic stops nudging.
    (appData.recipes || []).forEach(r => { r._unitModel = 'case'; });
    saveRecipesLibrary();
    if (document.getElementById('panel-cogs') && document.getElementById('panel-cogs').classList.contains('active')) renderCogs();
    toast('No legacy recipes needed updating', 'success');
    return;
  }

  const preview = changes.slice(0, 5).map(c =>
    `• ${c.recipe.tillItem || '?'} — ${c.productName}: ${formatQty(c.before)} → ${formatQty(c.after)}`
  ).join('\n');
  const more = changes.length > 5 ? `\n…and ${changes.length - 5} more` : '';
  const ok = confirm(
    'Migrate ' + changes.length + ' ingredient' + (changes.length === 1 ? '' : 's') + ' to case-fraction qty?\n\n' +
    'This divides qty by units-per-case for any ingredient set to a whole case (qty ≥ 1 on a multi-unit pack).\n\n' +
    preview + more
  );
  if (!ok) return;

  changes.forEach(c => { c.ingredient.qty = c.after; });
  (appData.recipes || []).forEach(r => { r._unitModel = 'case'; });

  saveRecipesLibrary();
  renderRecipes();
  if (document.getElementById('panel-cogs') && document.getElementById('panel-cogs').classList.contains('active')) renderCogs();
  toast('Updated ' + changes.length + ' ingredient' + (changes.length === 1 ? '' : 's'), 'success');
}

// ============================================================
// COGS — CORE CALCULATION
function computeCogs(stateRef, recipes) {
  const tillRows = (stateRef.tillSales && stateRef.tillSales.rows) || [];

  // Build recipe index: lowercase "name|variation" -> recipe
  const recipeIdx = {};
  (recipes || []).forEach(r => {
    const k = ((r.tillItem || '') + '|' + (r.tillVariation || 'Regular')).toLowerCase();
    recipeIdx[k] = r;
    // Also index by item name only (variation-agnostic fallback)
    const k2 = (r.tillItem || '').toLowerCase() + '|*';
    if (!recipeIdx[k2]) recipeIdx[k2] = r;
  });

  // Build product indices: by id (preferred) and by lowercase name (fallback
  // for legacy recipes that pre-date the productId field).
  const productById = {};
  const productByName = {};
  stateRef.products.forEach(p => {
    if (p.id)   productById[p.id] = p;
    if (p.name) productByName[p.name.toLowerCase()] = p;
  });

  function costPerUnit(p) {
    if (!p) return 0;
    const ups = p.unitsPerSku || 0;
    if (!ups) return p.orderPrice || 0; // treat unitsPerSku=0 as "1 SKU = 1 unit"
    return (p.orderPrice || 0) / ups;
  }

  function casePrice(p) {
    return p ? (p.orderPrice || 0) : 0;
  }

  function perUnitPrice(p) {
    if (!p) return 0;
    const ups = p.unitsPerSku || 0;
    return ups > 0 ? (p.orderPrice || 0) / ups : (p.orderPrice || 0);
  }

  function productCostIssue(p) {
    if (!p) return 'missing';
    if (!(p.orderPrice > 0)) return 'no_price';
    return null;
  }

  // Recipe qty is now "fraction of one SKU/case" (1 = whole case, 1/24 = 1/24
  // of the case). A qty of 1 on a multi-unit case (e.g. 24-can case) almost
  // certainly came from the legacy "qty 1 = one whole can" model and would
  // grossly over-cost the till line.
  function isLegacyWholeUnitQty(qty, p) {
    if (!p || !qty) return false;
    const ups = p.unitsPerSku || 0;
    return ups > 1 && qty >= 1;
  }

  // Per-till-item rollup
  const perTillItem = [];
  const unmapped = [];
  const diagnostics = {
    missingProducts: {},   // name -> { name, units }
    zeroCostProducts: {},  // pid -> { p, issue, units }
    lowMarginItems: [],
    legacyQtyItems: [],    // till items with qty 1 on a multi-unit case (looks like legacy)
  };

  // Per-product aggregation
  const perProduct = {}; // pid -> { units, cogs }
  let totalRevenue = 0;
  let totalCogs    = 0;
  let unmappedRevenue = 0;

  tillRows.forEach(s => {
    totalRevenue += s.netSales || 0;
    const k1 = ((s.name || '') + '|' + (s.variation || 'Regular')).toLowerCase();
    const k2 = (s.name || '').toLowerCase() + '|*';
    const recipe = recipeIdx[k1] || recipeIdx[k2];
    if (!recipe) {
      unmapped.push(s);
      unmappedRevenue += s.netSales || 0;
      perTillItem.push({
        name: s.name, variation: s.variation, itemsSold: s.itemsSold,
        netSales: s.netSales, cogs: null, margin: null, marginPct: null, mapped: false,
      });
      return;
    }
    let rowCogs = 0;
    const rowIssues = [];
    const missingNames = [];
    const zeroCostNames = [];
    const legacyQtyNames = [];
    (recipe.ingredients || []).forEach(ing => {
      const p = (ing.productId && productById[ing.productId]) ||
                productByName[(ing.productName || '').toLowerCase()];
      const qty = ing.qty || 0;
      const itemsSold = s.itemsSold || 0;
      // qty is fraction of one case/SKU. cases consumed = itemsSold × qty
      const casesUsed = itemsSold * qty;
      const ups = (p && p.unitsPerSku) || 1;
      const unitsUsed = casesUsed * ups; // bottles/cans for display & variance
      const issue = productCostIssue(p);
      const cogs = casesUsed * casePrice(p);
      rowCogs += cogs;
      if (p && isLegacyWholeUnitQty(qty, p)) {
        legacyQtyNames.push(p.name);
      }
      if (!p) {
        const missingName = ing.productName || '(unnamed product)';
        missingNames.push(missingName);
        if (!diagnostics.missingProducts[missingName]) {
          diagnostics.missingProducts[missingName] = { name: missingName, units: 0 };
        }
        diagnostics.missingProducts[missingName].units += unitsUsed;
        const key = '__missing__:' + missingName;
        if (!perProduct[key]) perProduct[key] = { units: 0, cogs: 0, missing: true, name: missingName };
        perProduct[key].units += unitsUsed;
      } else {
        if (issue) {
          zeroCostNames.push(p.name);
          if (!diagnostics.zeroCostProducts[p.id]) {
            diagnostics.zeroCostProducts[p.id] = { p, issue, units: 0 };
          }
          diagnostics.zeroCostProducts[p.id].units += unitsUsed;
        }
        if (!perProduct[p.id]) perProduct[p.id] = { units: 0, cogs: 0 };
        perProduct[p.id].units += unitsUsed;
        perProduct[p.id].cogs  += cogs;
      }
    });
    if (missingNames.length) rowIssues.push({ type: 'missing', names: [...new Set(missingNames)] });
    if (zeroCostNames.length) rowIssues.push({ type: 'zero_cost', names: [...new Set(zeroCostNames)] });
    totalCogs += rowCogs;
    const net = s.netSales || 0;
    if (legacyQtyNames.length) {
      rowIssues.push({ type: 'legacy_qty', names: [...new Set(legacyQtyNames)] });
      diagnostics.legacyQtyItems.push({
        name: s.name, variation: s.variation, netSales: net, cogs: rowCogs,
        products: [...new Set(legacyQtyNames)],
      });
    }
    const margin = net - rowCogs;
    const marginPct = net > 0 ? (margin / net) * 100 : null;
    if (net >= 50 && marginPct != null && marginPct > 95) {
      rowIssues.push({ type: 'low_margin' });
      diagnostics.lowMarginItems.push({
        name: s.name, variation: s.variation, netSales: net, cogs: rowCogs, marginPct,
      });
    }
    perTillItem.push({
      name: s.name, variation: s.variation, itemsSold: s.itemsSold,
      netSales: net, cogs: rowCogs, margin, marginPct, mapped: true, issues: rowIssues,
    });
  });

  // Per-supplier rollup
  const perSupplier = {};
  Object.keys(perProduct).forEach(pid => {
    if (pid.startsWith('__missing__:')) return;
    const p = stateRef.products.find(x => x.id === pid);
    if (!p) return;
    const sup = p.supplier || 'Unknown';
    if (!perSupplier[sup]) perSupplier[sup] = { units: 0, cogs: 0 };
    perSupplier[sup].units += perProduct[pid].units;
    perSupplier[sup].cogs  += perProduct[pid].cogs;
  });

  return {
    perTillItem, perProduct, perSupplier, unmapped,
    diagnostics: {
      missingProducts: Object.values(diagnostics.missingProducts).sort((a, b) => b.units - a.units),
      zeroCostProducts: Object.values(diagnostics.zeroCostProducts).sort((a, b) => b.units - a.units),
      lowMarginItems: diagnostics.lowMarginItems.sort((a, b) => b.netSales - a.netSales),
      legacyQtyItems: diagnostics.legacyQtyItems.sort((a, b) => b.netSales - a.netSales),
    },
    totals: (function () {
      const mapped = perTillItem.filter(r => r.mapped && r.marginPct != null);
      const avgMarginPct = mapped.length
        ? mapped.reduce((s, r) => s + r.marginPct, 0) / mapped.length
        : 0;
      return {
        revenue: totalRevenue,
        cogs:    totalCogs,
        margin:  totalRevenue - totalCogs,
        marginPct: totalRevenue > 0 ? ((totalRevenue - totalCogs) / totalRevenue) * 100 : 0,
        avgMarginPct,
        unmappedRevenue,
        unmappedPct: totalRevenue > 0 ? (unmappedRevenue / totalRevenue) * 100 : 0,
      };
    })(),
  };
}

// ============================================================
// COGS — RENDER
// ============================================================
function getProductsWithPricingIssues() {
  const recipeIds = new Set();
  const recipeNames = new Set();
  (appData.recipes || []).forEach(r => {
    (r.ingredients || []).forEach(ing => {
      if (ing.productId) recipeIds.add(ing.productId);
      if (ing.productName) recipeNames.add(ing.productName.toLowerCase());
    });
  });
  const issues = new Map();
  (state.products || []).forEach(p => {
    const referenced = recipeIds.has(p.id) || recipeNames.has((p.name || '').toLowerCase());
    if (!referenced) return;
    if (!(p.orderPrice > 0)) issues.set(p.id, 'no price');
  });
  return issues;
}

function cogsIssueBadges(issues) {
  if (!issues || !issues.length) return '';
  return issues.map(issue => {
    if (issue.type === 'missing') {
      return `<span class="cogs-issue-badge" title="Not found in this event: ${escapeHtml(issue.names.join(', '))}">Missing product</span>`;
    }
    if (issue.type === 'zero_cost') {
      return `<span class="cogs-issue-badge" title="Zero or missing price: ${escapeHtml(issue.names.join(', '))}">No price</span>`;
    }
    if (issue.type === 'low_margin') {
      return `<span class="cogs-issue-badge" title="Margin above 95% — COGS likely under-reported">Low COGS</span>`;
    }
    if (issue.type === 'legacy_qty') {
      return `<span class="cogs-issue-badge" title="Qty ≥ 1 on a multi-unit case (${escapeHtml(issue.names.join(', '))}) — recipe qty is now a fraction of one case. Did you mean 1/${'<units>'}?">Legacy qty</span>`;
    }
    return '';
  }).join('');
}

function renderCogsDiagnostics(report) {
  const el = document.getElementById('cogsDiagnostics');
  if (!el) return;
  const d = report.diagnostics || {};
  const missing = d.missingProducts || [];
  const zeroCost = d.zeroCostProducts || [];
  const lowMargin = d.lowMarginItems || [];
  const legacyQty = d.legacyQtyItems || [];
  const missingUnits = missing.reduce((s, x) => s + (x.units || 0), 0);
  const lowMarginSales = lowMargin.reduce((s, x) => s + (x.netSales || 0), 0);
  const legacyQtySales = legacyQty.reduce((s, x) => s + (x.netSales || 0), 0);

  if (!missing.length && !zeroCost.length && !lowMargin.length && !legacyQty.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const bullets = [];
  if (missing.length) {
    bullets.push(`<li><strong>${missing.length} recipe ingredient${missing.length === 1 ? '' : 's'}</strong> reference product names not found in this event (${formatQty(missingUnits)} units untracked — £0 cost applied).</li>`);
  }
  if (zeroCost.length) {
    bullets.push(`<li><strong>${zeroCost.length} product${zeroCost.length === 1 ? '' : 's'}</strong> used in recipes have no order price set.</li>`);
  }
  if (lowMargin.length) {
    bullets.push(`<li><strong>${lowMargin.length} mapped till item${lowMargin.length === 1 ? '' : 's'}</strong> show &gt;95% margin (£${lowMarginSales.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sales) — likely missing or under-costed ingredients.</li>`);
  }
  if (legacyQty.length) {
    bullets.push(`<li><strong>${legacyQty.length} recipe${legacyQty.length === 1 ? '' : 's'}</strong> use qty ≥ 1 on a multi-unit case (£${legacyQtySales.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sales) — recipe qty is now a fraction of one case. <button class="btn btn-primary btn-sm" onclick="migrateLegacyRecipes()" style="margin-left:6px">Auto-fix legacy recipes</button></li>`);
  }

  el.style.display = '';
  el.innerHTML = `
    <div class="cogs-diagnostics">
      <div class="cogs-diagnostics-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        COGS data issues
      </div>
      <ul>${bullets.join('')}</ul>
      <p style="margin:8px 0 0;font-size:12px;color:var(--muted-foreground)">Check highlighted rows below. Fix product names/prices in Products, or edit recipes to match this event.</p>
    </div>
  `;
}

function renderCogs() {
  const statsEl    = document.getElementById('cogsStats');
  const prodBody   = document.getElementById('cogsProductBody');
  const tillBody   = document.getElementById('cogsTillBody');
  const supBody    = document.getElementById('cogsSupplierBody');
  const unmappedSec= document.getElementById('cogsUnmappedSection');
  const unmappedBd = document.getElementById('cogsUnmappedBody');
  const statusEl   = document.getElementById('cogsImportStatus');
  const modStatusEl= document.getElementById('cogsModImportStatus');
  const clearBtn   = document.getElementById('cogsClearBtn');
  const clearModBtn= document.getElementById('cogsClearModBtn');
  const autoBtn    = document.getElementById('cogsAutoMapBtn');
  if (!statsEl) return;

  const hasTill = !!(state.tillSales && state.tillSales.rows && state.tillSales.rows.length);
  const hasMod  = !!(state.modifierSales && state.modifierSales.rows && state.modifierSales.rows.length);

  if (statusEl) {
    if (hasTill) {
      const ts = new Date(state.tillSales.importedAt);
      const tsStr = isNaN(ts) ? '' : ts.toLocaleString('en-GB', {dateStyle:'medium', timeStyle:'short'});
      statusEl.textContent = 'Till: ' + state.tillSales.fileName + (tsStr ? ' · imported ' + tsStr : '') + ' · ' + state.tillSales.rows.length + ' till lines';
      statusEl.style.color = 'var(--muted-foreground)';
    } else {
      statusEl.textContent = 'No till data imported for this event yet. Upload your Square item sales CSV to start.';
      statusEl.style.color = 'var(--muted-foreground)';
    }
  }
  if (modStatusEl) {
    if (hasMod) {
      const ts = new Date(state.modifierSales.importedAt);
      const tsStr = isNaN(ts) ? '' : ts.toLocaleString('en-GB', {dateStyle:'medium', timeStyle:'short'});
      modStatusEl.textContent = 'Modifiers: ' + state.modifierSales.fileName + (tsStr ? ' · imported ' + tsStr : '') + ' · ' + state.modifierSales.rows.length + ' modifier lines';
      modStatusEl.style.color = 'var(--muted-foreground)';
    } else {
      modStatusEl.textContent = 'Tip: Square › Reports › Modifier Sales — exports a TSV of every mixer/Red Bull/ID flag rung in. Variance vs physical stock for items that never sell standalone.';
      modStatusEl.style.color = 'var(--muted-foreground)';
    }
  }
  if (clearBtn)    clearBtn.style.display    = hasTill ? '' : 'none';
  if (clearModBtn) clearModBtn.style.display = hasMod  ? '' : 'none';
  if (autoBtn)     autoBtn.style.display     = hasTill ? '' : 'none';

  renderModifierReport();

  if (!hasTill) {
    statsEl.innerHTML = '';
    const diagEl = document.getElementById('cogsDiagnostics');
    if (diagEl) { diagEl.style.display = 'none'; diagEl.innerHTML = ''; }
    if (prodBody) prodBody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">📊</div><p>Import a till CSV to see COGS broken down by product, item, and supplier.</p></div></td></tr>`;
    if (tillBody) tillBody.innerHTML = '';
    if (supBody)  supBody.innerHTML = '';
    if (unmappedSec) unmappedSec.style.display = 'none';
    return;
  }

  const report = computeCogs(state, appData.recipes || []);
  const t = report.totals;

  renderCogsDiagnostics(report);

  statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-label">Net Revenue</div><div class="stat-value">£${t.revenue.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div class="stat-sub">from imported till</div></div>
    <div class="stat-card"><div class="stat-label">Total COGS</div><div class="stat-value">£${t.cogs.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div class="stat-sub">cost of goods sold</div></div>
    <div class="stat-card"><div class="stat-label">Gross Margin</div><div class="stat-value">£${t.margin.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div class="stat-sub">${t.marginPct.toFixed(1)}% margin</div></div>
    <div class="stat-card"><div class="stat-label">Avg Margin %</div><div class="stat-value">${t.avgMarginPct.toFixed(1)}%</div><div class="stat-sub">average across mapped items</div></div>
  `;

  // Till-item mapping table: unmapped first (action queue), then mapped at the
  // bottom with a ✓ Mapped tag so the user can see their progress without
  // items vanishing the moment they finish a recipe.
  const mappingItems = report.perTillItem || [];
  if (mappingItems.length) {
    unmappedSec.style.display = '';

    // Recipe index for the "Edit Recipe" button on mapped rows.
    const recipeIdx = {};
    (appData.recipes || []).forEach(r => {
      const k = ((r.tillItem || '') + '|' + (r.tillVariation || 'Regular')).toLowerCase();
      recipeIdx[k] = r;
      const k2 = (r.tillItem || '').toLowerCase() + '|*';
      if (!recipeIdx[k2]) recipeIdx[k2] = r;
    });

    // Look up category from the original till rows (perTillItem doesn't carry it).
    const catByName = {};
    ((state.tillSales && state.tillSales.rows) || []).forEach(s => {
      const key = (s.name || '').toLowerCase() + '|' + (s.variation || 'Regular').toLowerCase();
      catByName[key] = s.category || '';
      const altKey = (s.name || '').toLowerCase() + '|*';
      if (!catByName[altKey]) catByName[altKey] = s.category || '';
    });

    const unmappedCount = mappingItems.filter(r => !r.mapped).length;
    const mappedCount   = mappingItems.length - unmappedCount;
    const titleEl = document.getElementById('cogsUnmappedTitle');
    const subEl   = document.getElementById('cogsUnmappedSubtitle');
    const autoBtnTop = document.getElementById('cogsUnmappedAutoBtn');
    if (titleEl) titleEl.textContent = unmappedCount > 0
      ? 'Till Item Mapping — ' + unmappedCount + ' to map'
      : 'Till Item Mapping — all ' + mappedCount + ' mapped';
    if (subEl) subEl.innerHTML = unmappedCount > 0
      ? 'Items needing a recipe show first. Once mapped, they drop to the bottom with a <strong>Mapped</strong> tag so you can track progress.'
      : 'Every till line has a recipe. Edit any below to fine-tune ingredients or pour sizes.';
    if (autoBtnTop) autoBtnTop.style.display = unmappedCount > 0 ? '' : 'none';

    const sorted = mappingItems.slice().sort((a, b) => {
      if (a.mapped !== b.mapped) return a.mapped ? 1 : -1; // unmapped first
      return (b.netSales || 0) - (a.netSales || 0);
    });

    unmappedBd.innerHTML = sorted.map(s => {
      const catKey = (s.name || '').toLowerCase() + '|' + (s.variation || 'Regular').toLowerCase();
      const altCatKey = (s.name || '').toLowerCase() + '|*';
      const category = catByName[catKey] || catByName[altCatKey] || '—';
      const sold = (s.itemsSold || 0).toLocaleString();
      const net  = '£' + (s.netSales || 0).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});

      if (s.mapped) {
        const recipeKey = ((s.name || '') + '|' + (s.variation || 'Regular')).toLowerCase();
        const recipeAltKey = (s.name || '').toLowerCase() + '|*';
        const recipe = recipeIdx[recipeKey] || recipeIdx[recipeAltKey];
        const editAction = recipe
          ? `<button class="btn btn-secondary btn-sm" onclick="openEditRecipe(${JSON.stringify(recipe.id).replace(/"/g,'&quot;')})">Edit Recipe</button>`
          : '<span style="font-size:11px;color:var(--muted-foreground)">—</span>';
        return `
          <tr style="background:#f0fdf4">
            <td style="font-weight:500">
              ${escapeHtml(s.name)}
              <span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;background:var(--success);color:#fff;padding:2px 7px;border-radius:3px;margin-left:6px;letter-spacing:0.4px;text-transform:uppercase;font-weight:700;vertical-align:middle">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Mapped
              </span>
            </td>
            <td style="color:var(--muted-foreground)">${escapeHtml(category)}</td>
            <td style="font-family:'DM Mono',monospace">${sold}</td>
            <td style="font-family:'DM Mono',monospace">${net}</td>
            <td>${editAction}</td>
          </tr>
        `;
      }
      return `
        <tr>
          <td style="font-weight:500">${escapeHtml(s.name)}</td>
          <td style="color:var(--muted-foreground)">${escapeHtml(category)}</td>
          <td style="font-family:'DM Mono',monospace">${sold}</td>
          <td style="font-family:'DM Mono',monospace">${net}</td>
          <td><button class="btn btn-primary btn-sm" onclick="openAddRecipe(${JSON.stringify(s.name).replace(/"/g,'&quot;')})">+ Create Recipe</button></td>
        </tr>
      `;
    }).join('');
  } else {
    unmappedSec.style.display = 'none';
  }

  // COGS by product
  const productRows = state.products
    .filter(p => p.name)
    .map(p => {
      const r = report.perProduct[p.id] || { units: 0, cogs: 0 };
      const physical = Math.max(0, getOpeningStock(p.id)
        - ((state.closing[p.id] || {}).fullCount || 0)
        - ((state.transfers || []).filter(t => t.productId === p.id).reduce((s,t) => s + (t.qty || 0), 0)));
      const priceIssue = !(p.orderPrice > 0) && r.units > 0;
      return { p, tillUnits: r.units, cogs: r.cogs, physical, priceIssue };
    })
    .filter(row => row.tillUnits > 0 || row.physical > 0)
    .sort((a,b) => (b.cogs - a.cogs));

  const missingRows = Object.entries(report.perProduct)
    .filter(([pid, r]) => pid.startsWith('__missing__:') && r.units > 0)
    .map(([, r]) => r)
    .sort((a, b) => b.units - a.units);

  if (!productRows.length && !missingRows.length) {
    prodBody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">🍹</div><p>No products consumed yet — make sure your recipes reference products that exist in this event.</p></div></td></tr>`;
  } else {
    const productHtml = productRows.map(({p, tillUnits, cogs, physical, priceIssue}) => {
      // tillUnits is in bottles/cans; physical is in cases — convert physical
      // to bottles/cans for an apples-to-apples variance.
      const ups = p.unitsPerSku || 1;
      const physicalUnits = physical * ups;
      const cpu = ups > 0 ? (p.orderPrice || 0) / ups : (p.orderPrice || 0);
      const variance = physicalUnits - tillUnits;
      const varPct = tillUnits > 0 ? (variance / tillUnits) * 100 : (physicalUnits > 0 ? 100 : 0);
      const absPct = Math.abs(varPct);
      const varClass = tillUnits === 0 ? '' : absPct < 5 ? 'variance-good' : absPct < 15 ? 'variance-warn' : 'variance-bad';
      const sign = variance > 0 ? '+' : '';
      const priceWarn = priceIssue
        ? `<span class="cogs-issue-badge" title="Set order price on this product">No price</span>`
        : '';
      return `
        <tr class="${priceIssue ? 'cogs-row-warn' : ''}">
          <td style="font-weight:500">${escapeHtml(p.name)}${priceWarn}</td>
          <td>${catBadge(p.category)}</td>
          <td style="color:var(--muted-foreground);font-size:12px">${escapeHtml(p.size || '—')}</td>
          <td style="font-family:'DM Mono',monospace">${formatQty(tillUnits)}</td>
          <td style="font-family:'DM Mono',monospace">£${cpu.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
          <td style="font-family:'DM Mono',monospace;font-weight:600">£${cogs.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
          <td style="font-family:'DM Mono',monospace">${formatQty(physicalUnits)}</td>
          <td class="${varClass}" style="font-family:'DM Mono',monospace">${sign}${formatQty(variance)}</td>
          <td class="${varClass}" style="font-family:'DM Mono',monospace">${tillUnits === 0 ? '—' : (sign + varPct.toFixed(1) + '%')}</td>
        </tr>
      `;
    }).join('');

    const missingHtml = missingRows.map(r => `
      <tr class="cogs-row-missing">
        <td style="font-weight:500">${escapeHtml(r.name || 'Unknown')}
          <span class="cogs-issue-badge" title="Add a product with this exact name in Products, or edit the recipe ingredient">Not in event</span>
        </td>
        <td>—</td>
        <td style="color:var(--muted-foreground);font-size:12px">—</td>
        <td style="font-family:'DM Mono',monospace">${formatQty(r.units)}</td>
        <td style="font-family:'DM Mono',monospace">—</td>
        <td style="font-family:'DM Mono',monospace;font-weight:600;color:var(--danger)">£0.00</td>
        <td>—</td><td>—</td><td>—</td>
      </tr>
    `).join('');

    const totalCogs = productRows.reduce((s, r) => s + r.cogs, 0);
    prodBody.innerHTML = productHtml + missingHtml + `
      <tr style="border-top:2px solid var(--foreground);background:var(--secondary)">
        <td colspan="5" style="font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-size:11px">Total COGS (matched products only)</td>
        <td style="font-family:'DM Mono',monospace;font-weight:800;font-size:15px">£${totalCogs.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td colspan="3"></td>
      </tr>
    `;
  }

  // COGS by till item
  const tillRows = report.perTillItem.slice().sort((a,b) => (b.netSales||0) - (a.netSales||0));
  tillBody.innerHTML = tillRows.map(r => {
    const issueBadges = cogsIssueBadges(r.issues);
    const rowClass = (r.issues && r.issues.length) ? 'cogs-row-warn' : '';
    if (!r.mapped) {
      return `
        <tr style="opacity:0.55">
          <td>${escapeHtml(r.name)} <span style="font-size:10px;background:var(--muted);color:var(--muted-foreground);padding:1px 6px;border-radius:3px;margin-left:4px">no recipe</span></td>
          <td style="font-family:'DM Mono',monospace">${r.itemsSold.toLocaleString()}</td>
          <td style="font-family:'DM Mono',monospace">£${(r.netSales||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
          <td>—</td><td>—</td><td>—</td>
        </tr>`;
    }
    return `
      <tr class="${rowClass}">
        <td style="font-weight:500">${escapeHtml(r.name)}${issueBadges}</td>
        <td style="font-family:'DM Mono',monospace">${r.itemsSold.toLocaleString()}</td>
        <td style="font-family:'DM Mono',monospace">£${(r.netSales||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td style="font-family:'DM Mono',monospace">£${(r.cogs||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td style="font-family:'DM Mono',monospace;font-weight:600">£${(r.margin||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td style="font-family:'DM Mono',monospace">${r.marginPct == null ? '—' : r.marginPct.toFixed(1) + '%'}</td>
      </tr>`;
  }).join('');

  // COGS by supplier
  const supRows = Object.entries(report.perSupplier).sort((a,b) => b[1].cogs - a[1].cogs);
  if (!supRows.length) {
    supBody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--muted-foreground);padding:20px">No supplier data — products in recipes must have a supplier set.</td></tr>`;
  } else {
    supBody.innerHTML = supRows.map(([sup, d]) => `
      <tr>
        <td style="font-weight:600">${escapeHtml(sup)}</td>
        <td style="font-family:'DM Mono',monospace">${formatQty(d.units)}</td>
        <td style="font-family:'DM Mono',monospace;font-weight:700">£${d.cogs.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      </tr>
    `).join('') + `
      <tr style="border-top:2px solid var(--foreground);background:var(--secondary)">
        <td style="font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-size:11px">Total</td>
        <td style="font-family:'DM Mono',monospace;font-weight:700">${formatQty(supRows.reduce((s,[,d]) => s + d.units, 0))}</td>
        <td style="font-family:'DM Mono',monospace;font-weight:800;font-size:15px">£${supRows.reduce((s,[,d]) => s + d.cogs, 0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      </tr>
    `;
  }
}

// ============================================================
// MODIFIER REPORT — RENDER
// ============================================================
// Builds two views from the imported Square modifier report:
//   1. Top-of-section chips: total qty per modifier set (Mixer, Redbull, ID…)
//   2. Per-modifier table with auto-matched product + physical-stock variance
//
// Variance lets you sanity-check the bar: if you rang 2,892 cokes but only
// 2,400 went out of the fridge, you're missing 492 cokes (or vice versa).
function renderModifierReport() {
  const sec        = document.getElementById('cogsModifierSection');
  const body       = document.getElementById('cogsModifierBody');
  const setTotals  = document.getElementById('cogsModSetTotals');
  if (!sec || !body) return;

  const hasMod = !!(state.modifierSales && state.modifierSales.rows && state.modifierSales.rows.length);
  if (!hasMod) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';

  const rows = state.modifierSales.rows;

  // ── Per-set totals (top-right chips) ─────────────────────────────
  const setAgg = {};
  rows.forEach(r => {
    const k = r.set || 'Other';
    if (!setAgg[k]) setAgg[k] = { qty: 0, sales: 0 };
    setAgg[k].qty   += r.netQty || 0;
    setAgg[k].sales += r.netSales || 0;
  });
  const setEntries = Object.entries(setAgg).sort((a,b) => b[1].qty - a[1].qty);
  if (setTotals) {
    setTotals.innerHTML = setEntries.map(([name, d]) => `
      <div style="background:var(--secondary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;min-width:110px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted-foreground);font-weight:700">${escapeHtml(name)}</div>
        <div style="font-family:'DM Mono',monospace;font-weight:700;font-size:15px">${(d.qty||0).toLocaleString()}</div>
        ${d.sales > 0 ? `<div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted-foreground)">£${d.sales.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>` : ''}
      </div>
    `).join('');
  }

  // ── Per-modifier rows ────────────────────────────────────────────
  // Sort by set then qty descending so related modifiers cluster together.
  const sorted = rows.slice().sort((a,b) => {
    if ((a.set||'') !== (b.set||'')) return (a.set||'').localeCompare(b.set||'');
    return (b.netQty||0) - (a.netQty||0);
  });

  let lastSet = null;
  body.innerHTML = sorted.map(r => {
    const product = matchModifierToProduct(r.modifier, state.products);
    const setLabel = (r.set || '') === lastSet
      ? '<span style="color:var(--muted-foreground)">↳</span>'
      : `<strong>${escapeHtml(r.set || '—')}</strong>`;
    lastSet = r.set || '';

    // Variance vs physical stock — only meaningful if we matched a product
    let physicalCell = '—', varCell = '—', pctCell = '—', varClass = '';
    let productLabel = '<span style="color:var(--muted-foreground);font-size:12px">— no match —</span>';
    if (product) {
      productLabel = `${escapeHtml(product.name)}${product.size ? ` <span style="color:var(--muted-foreground);font-size:11px">(${escapeHtml(product.size)})</span>` : ''}`;
      const opening   = getOpeningStock(product.id);
      const closing   = (state.closing[product.id] || {}).fullCount || 0;
      const transfers = (state.transfers || [])
        .filter(t => t.productId === product.id)
        .reduce((s,t) => s + (t.qty || 0), 0);
      const physical  = Math.max(0, opening - closing - transfers);
      const sold      = r.netQty || 0;
      const variance  = physical - sold;
      const varPct    = sold > 0 ? (variance / sold) * 100 : (physical > 0 ? 100 : 0);
      const absPct    = Math.abs(varPct);
      varClass    = sold === 0 ? '' : absPct < 5 ? 'variance-good' : absPct < 15 ? 'variance-warn' : 'variance-bad';
      const sign  = variance > 0 ? '+' : '';
      physicalCell = formatQty(physical);
      varCell      = sign + formatQty(variance);
      pctCell      = sold === 0 ? '—' : (sign + varPct.toFixed(1) + '%');
    }

    return `
      <tr>
        <td>${setLabel}</td>
        <td style="font-weight:500">${escapeHtml(r.modifier || '—')}</td>
        <td>${productLabel}</td>
        <td style="font-family:'DM Mono',monospace">${(r.netQty||0).toLocaleString()}</td>
        <td style="font-family:'DM Mono',monospace">${(r.netSales||0) > 0 ? '£' + r.netSales.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
        <td style="font-family:'DM Mono',monospace">${physicalCell}</td>
        <td class="${varClass}" style="font-family:'DM Mono',monospace">${varCell}</td>
        <td class="${varClass}" style="font-family:'DM Mono',monospace">${pctCell}</td>
      </tr>
    `;
  }).join('');
}
