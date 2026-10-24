/*
 * Nezha UI Optimization — v20261024.1
 * Drop-in replacement for cantoblanco/nezhaui-optimization/nezhaop.js.
 * Target: official nezha-dash-v2 v2.5.1 / v2.6.0, Dashboard v2.4.1.
 * No build step or external dependency is required.
 *
 * Native Detail / Network / Online tabs remain available. Combined view is
 * optional and loads its second application only when requested.
 *
 * Optional settings, placed BEFORE this script in Dashboard custom_code:
 * window.TrafficScriptConfig = {
 *   showTrafficStats: true, interval: 60000, toggleInterval: 5000,
 *   duration: 250, insertAfter: true, timeZone: 'Asia/Shanghai',
 *   hideNativeCycleCards: true, enableLog: false,
 *   detailMode: 'native', showCombinedButton: true
 * };
 * Set detailMode: 'combined' to restore automatic combined Detail + Network.
 * Runtime changes: window.__NEZHAOP_RUNTIME__.configure({ ...settings });
 * Full cleanup: window.__NEZHAOP_RUNTIME__.stop();
 *
 * Identity: explicit DOM IDs / links first, guarded React serverInfo props
 * second, unique names last. React internals are optional and read-only;
 * ambiguous cards are skipped instead of receiving another server's data.
 */
(() => {
  'use strict';

  const VERSION = 'v20261024.1';
  const RUNTIME_KEY = '__NEZHAOP_RUNTIME__';
  const previous = window[RUNTIME_KEY];
  if (previous && previous.version === VERSION && !previous.stopped) {
    previous.configure();
    previous.rescan();
    return;
  }
  if (previous && typeof previous.stop === 'function') {
    previous.stop();
    document.querySelectorAll('[data-nezhaop-cycle-row]').forEach(row => row.remove());
  }

  const OWN = 'data-nezhaop-owned';
  const ROW = '[data-nezhaop-cycle-key]';
  const LIST = 'section.server-card-list, section.server-inline-list';
  const DETAIL_PARAM = 'nezhaop_view';
  const DETAIL_VALUE = 'detail';
  const DETAIL_MESSAGE = 'nezhaop:detail-ready';
  const embedded = new URLSearchParams(location.search).get(DETAIL_PARAM) === DETAIL_VALUE;
  const defaults = {
    showTrafficStats: true,
    insertAfter: true,
    interval: 60000,
    toggleInterval: 5000,
    duration: 250,
    apiUrl: '/api/v1/service',
    enableLog: false,
    timeZone: 'Asia/Shanghai',
    hideNativeCycleCards: true,
    detailMode: 'native',
    showCombinedButton: true,
    combinedTimeout: 20000,
    requestTimeout: 15000
  };
  let config;
  let overrides = {};
  let observer;
  let scanTimer = null;
  let refreshTimer = null;
  let rotationTimer = null;
  let configDiscoveryTimer = null;
  let request = null;
  let requestGeneration = 0;
  let nextFetchAt = 0;
  let cached = null;
  let updatedAt = 0;
  let stale = false;
  let rotation = 0;
  let detail = null;
  let routeKey = '';
  const rowStates = new Map();
  const hiddenNative = new Map();
  const globalChanges = [];
  const formatters = new Map();
  const historyChanges = [];
  const runtime = {
    version: VERSION,
    stopped: false,
    rescan: scheduleScan,
    configure,
    stop: stopRuntime
  };
  window[RUNTIME_KEY] = runtime;
  document.documentElement.dataset.nezhaopRuntime = VERSION;

  function log(...args) {
    if (config && config.enableLog) console.warn('[nezhaop ' + VERSION + ']', ...args);
  }

  function setText(element, value) {
    const text = String(value == null ? '' : value);
    if (element.textContent !== text) element.textContent = text;
  }

  function owned(element) {
    element.setAttribute(OWN, '1');
    return element;
  }

  function validId(value) {
    const id = value == null ? '' : String(value);
    return /^\d+$/.test(id) ? id : null;
  }

  function cycleKey(cycleId, serverId) {
    return JSON.stringify([String(cycleId), String(serverId)]);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function pick(value, id) {
    return isObject(value) ? value[id] : value;
  }

  function positiveSetting(value, fallback, minimum) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(minimum, n) : fallback;
  }

  function configure(values) {
    if (runtime.stopped) return;
    if (isObject(values)) overrides = Object.assign({}, overrides, values);
    const old = config;
    config = Object.assign({}, defaults, window.TrafficScriptConfig || {}, overrides);
    config.interval = positiveSetting(config.interval, defaults.interval, 1000);
    config.toggleInterval = positiveSetting(config.toggleInterval, defaults.toggleInterval, 0);
    config.duration = positiveSetting(config.duration, defaults.duration, 0);
    config.combinedTimeout = positiveSetting(config.combinedTimeout, defaults.combinedTimeout, 1000);
    config.requestTimeout = positiveSetting(config.requestTimeout, defaults.requestTimeout, 1000);
    config.detailMode = config.detailMode === 'combined' ? 'combined' : 'native';
    try {
      const url = new URL(config.apiUrl, location.href);
      if (url.origin !== location.origin) throw new Error('apiUrl must have the Dashboard origin');
      config.apiUrl = url.pathname + url.search;
    } catch (error) {
      config.apiUrl = defaults.apiUrl;
      log(error.message);
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: config.timeZone }).format();
    } catch (_) {
      config.timeZone = 'UTC';
    }
    formatters.clear();
    if (old && old.apiUrl !== config.apiUrl) {
      cancelRequest();
      cached = null;
      stale = false;
      clearTrafficRows();
      restoreNative();
    }
    if (!old || old.interval !== config.interval || old.apiUrl !== config.apiUrl) {
      nextFetchAt = 0;
      stopRefresh();
    }
    if (rotationTimer !== null) clearInterval(rotationTimer);
    rotationTimer = null;
    if (!embedded && config.toggleInterval > 0 && config.showTrafficStats) {
      rotationTimer = setInterval(() => {
        if (runtime.stopped || document.hidden) return;
        rotation += 1;
        rowStates.forEach(state => updateRotation(state));
      }, config.toggleInterval);
    }
    if (detail && old && old.detailMode !== config.detailMode) {
      if (config.detailMode === 'combined') startCombined(detail);
      else leaveCombined(detail);
    }
    scheduleScan();
  }

  function defaultGlobal(key, value) {
    if (typeof window[key] !== 'undefined') return;
    const oldValue = window[key];
    window[key] = value;
    globalChanges.push({ key, value, oldValue });
  }

  defaultGlobal('ShowNetTransfer', true);
  defaultGlobal('DisableAnimatedMan', false);
  defaultGlobal('ForceUseSvgFlag', true);

  const style = owned(document.createElement('style'));
  style.id = 'nezhaop-styles';
  style.textContent = `
    [data-nezhaop-cycle-key] { box-sizing:border-box; width:100%; min-width:0;
      flex:0 0 auto; text-align:left; line-height:1.45; padding-top:3px; }
    .nezhaop-cycle-head,.nezhaop-cycle-values { display:flex; align-items:center;
      justify-content:space-between; gap:8px; min-width:0; font-size:10px; }
    .nezhaop-cycle-label { font-weight:600; overflow:hidden; text-overflow:ellipsis;
      white-space:nowrap; max-width:55%; }
    .nezhaop-cycle-time { opacity:.7; white-space:nowrap; text-align:right; }
    .nezhaop-cycle-values { margin:2px 0 4px; font-variant-numeric:tabular-nums; }
    .nezhaop-cycle-ratio { opacity:.8; }
    .nezhaop-cycle-track { height:6px; overflow:hidden; border-radius:999px;
      background:rgba(128,128,128,.18); }
    .nezhaop-cycle-bar { height:100%; border-radius:inherit; transition:width .25s;
      background:linear-gradient(90deg,#10b981,#059669); }
    .nezhaop-cycle-bar[data-level="warning"] { background:linear-gradient(90deg,#fbbf24,#f59e0b); }
    .nezhaop-cycle-bar[data-level="danger"] { background:linear-gradient(90deg,#ef4444,#dc2626); }
    .nezhaop-cycle-bar[data-level="critical"] { background:linear-gradient(90deg,#6b7280,#4b5563); }
    [data-nezhaop-stale="1"] .nezhaop-cycle-track { opacity:.55; }
    [data-nezhaop-stale="1"] .nezhaop-cycle-label::after { content:' · stale'; color:#d97706; }
    .nezhaop-offline-traffic { width:100%; min-width:0; box-sizing:border-box;
      display:flex; flex-direction:column; gap:6px; flex-basis:100%; }
    .nezhaop-combined-button { flex:0 0 auto; margin-left:8px; padding:5px 9px;
      font:inherit; font-size:11px; color:inherit; border:1px solid rgba(128,128,128,.35);
      border-radius:999px; background:transparent; cursor:pointer; white-space:nowrap; }
    .nezhaop-combined-button[aria-pressed="true"] { background:rgba(128,128,128,.16); }
    iframe[data-nezhaop-detail-frame] { width:100%; border:0; display:block; }
    iframe[data-nezhaop-detail-frame][hidden] { display:none; }
    html[data-nezhaop-view="detail"],html[data-nezhaop-view="detail"] body { min-height:0!important; }
    html[data-nezhaop-view="detail"] main { min-height:0!important; padding:0!important; }
    html[data-nezhaop-view="detail"] .server-info { gap:0!important; max-width:none!important; }
    @media (prefers-reduced-motion:reduce) { .nezhaop-cycle-bar { transition:none; } }
  `;
  (document.head || document.documentElement).appendChild(style);

  // Read-only compatibility bridge. A missing/future React implementation is
  // harmless: callers still have DOM IDs and conservative unique-name fallback.
  function inspectReact(element, visit) {
    if (!element) return null;
    try {
      const keys = Object.getOwnPropertyNames(element);
      const propsKey = keys.find(key => key.startsWith('__reactProps$'));
      if (propsKey) {
        const result = visit(element[propsKey], null);
        if (result != null) return result;
      }
      const fiberKey = keys.find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
      let fiber = fiberKey && element[fiberKey];
      for (let depth = 0; fiber && depth < 18; depth += 1, fiber = fiber.return) {
        const result = visit(fiber.memoizedProps || fiber.pendingProps, fiber);
        if (result != null) return result;
      }
    } catch (error) {
      log('Could not read card identity:', error.message);
    }
    return null;
  }

  function cardId(card) {
    const direct = validId(card.getAttribute('data-server-id')) || validId(card.getAttribute('data-id'));
    if (direct) return direct;
    const link = card.querySelector('a[href]');
    if (link) {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        const match = url.origin === location.origin && url.pathname.match(/^\/server\/(\d+)\/?$/);
        if (match) return match[1];
      } catch (_) { /* Not a server link. */ }
    }
    return inspectReact(card, props => validId(props && props.serverInfo && props.serverInfo.id));
  }

  function getCards() {
    const cards = [];
    document.querySelectorAll(LIST).forEach(root => {
      Array.from(root.children).forEach(item => {
        if (item.hasAttribute(OWN)) return;
        // Official inline online cards have a section around the actual Card.
        const card = item.tagName === 'SECTION'
          ? Array.from(item.children).find(child => child.tagName === 'DIV') || item
          : item;
        const heading = Array.from(card.children).find(child => (
          child.tagName === 'SECTION' && child.querySelector('p') && !child.hasAttribute(OWN)
        ));
        const name = heading && heading.querySelector('p');
        if (name) cards.push({ card, name: name.textContent.trim(), id: cardId(card) });
      });
    });
    return cards;
  }

  function normalizeCycles(data) {
    const rows = [];
    if (!isObject(data)) return rows;
    Object.entries(data).forEach(([cycleId, cycle]) => {
      if (!isObject(cycle) || !isObject(cycle.server_name) || !isObject(cycle.transfer)) return;
      Object.entries(cycle.server_name).forEach(([serverId, name]) => {
        if (!validId(serverId) || typeof name !== 'string') return;
        const transfer = Number(cycle.transfer[serverId]);
        const max = Number(pick(cycle.max, serverId));
        const from = pick(cycle.from, serverId);
        const to = pick(cycle.to, serverId);
        if (!Number.isFinite(transfer) || transfer < 0 || !Number.isFinite(max) || max <= 0) return;
        if (typeof from !== 'string' || typeof to !== 'string' || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) return;
        rows.push({ key: cycleKey(cycleId, serverId), cycleId, serverId, serverName: name.trim(),
          name: typeof cycle.name === 'string' ? cycle.name : String(cycleId),
          transfer, max, from, to, nextUpdate: pick(cycle.next_update, serverId) });
      });
    });
    return rows;
  }

  function formatBytes(value) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    let size = value;
    let i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i += 1; }
    return size.toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
  }

  function dateText(value, withTime) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const key = withTime ? 'datetime' : 'date';
    let formatter = formatters.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', Object.assign({
        timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
      }, withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}));
      formatters.set(key, formatter);
    }
    const parts = {};
    formatter.formatToParts(date).forEach(part => { parts[part.type] = part.value; });
    return parts.year + '-' + parts.month + '-' + parts.day +
      (withTime ? ' ' + parts.hour + ':' + parts.minute : '');
  }

  function percentage(value) {
    return value.toFixed(2).replace(/\.?0+$/, '') + '%';
  }

  function makeRow(data) {
    const row = owned(document.createElement('div'));
    row.className = 'new-inserted-element traffic-stats-for-server-' + data.serverId;
    row.dataset.nezhaopCycleKey = data.key;
    row.dataset.nezhaopCycleRow = data.serverId;
    row.dataset.nezhaopCycleId = data.cycleId;
    // This is a constant template. All server/API text is assigned using textContent.
    row.innerHTML = '<div class="nezhaop-cycle-head"><span class="nezhaop-cycle-label"></span>' +
      '<span class="nezhaop-cycle-time time-info"></span></div>' +
      '<div class="nezhaop-cycle-values"><span class="nezhaop-cycle-amount"></span>' +
      '<span class="nezhaop-cycle-ratio percentage-value" data-nezhaop-percent></span></div>' +
      '<div class="nezhaop-cycle-track"><div class="nezhaop-cycle-bar progress-bar" data-nezhaop-progress></div></div>';
    const state = { row, data, label: row.querySelector('.nezhaop-cycle-label'),
      amount: row.querySelector('.nezhaop-cycle-amount'), ratio: row.querySelector('.nezhaop-cycle-ratio'),
      time: row.querySelector('.nezhaop-cycle-time'), bar: row.querySelector('.nezhaop-cycle-bar'), signature: '' };
    rowStates.set(row, state);
    return state;
  }

  function updateRotation(state) {
    const texts = [state.dates, state.percent];
    if (state.nextUpdate) texts.push(state.nextUpdate);
    setText(state.time, texts[config.toggleInterval > 0 ? rotation % texts.length : 0] || '');
  }

  function updateRow(state, data) {
    state.data = data;
    const signature = JSON.stringify([data, config.timeZone, config.duration, stale, updatedAt]);
    if (signature === state.signature) return;
    state.signature = signature;
    const pct = data.transfer / data.max * 100;
    state.percent = percentage(pct);
    state.dates = dateText(data.from, false) + ' – ' + dateText(data.to, false);
    state.nextUpdate = data.nextUpdate ? dateText(data.nextUpdate, true) : '';
    setText(state.label, data.name);
    setText(state.amount, formatBytes(data.transfer) + ' / ' + formatBytes(data.max));
    setText(state.ratio, state.percent);
    state.bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    state.bar.style.transitionDuration = config.duration + 'ms';
    state.bar.dataset.level = pct >= 100 ? 'critical' : pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'normal';
    const track = state.bar.parentElement;
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', data.name);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.min(100, Math.max(0, pct))));
    track.setAttribute('aria-valuetext', state.percent + ' (' + formatBytes(data.transfer) + ' / ' + formatBytes(data.max) + ')');
    state.row.dataset.nezhaopStale = stale ? '1' : '0';
    state.row.title = data.name + '\n' + state.dates + ' [' + config.timeZone + ']' +
      (state.nextUpdate ? '\nNext update: ' + state.nextUpdate : '') +
      '\nUpdated: ' + dateText(updatedAt, true) + (stale ? ' · stale' : '');
    updateRotation(state);
  }

  function getTrafficHost(card) {
    const metrics = Array.from(card.querySelectorAll('section')).find(section => {
      if (section.closest('[' + OWN + ']')) return false;
      const children = Array.from(section.children);
      return children.length >= 3 && children.every(child => child.tagName === 'DIV') &&
        (section.className.includes('grid-cols-') || children.some(child => child.querySelector('p')));
    });
    if (metrics) {
      let anchor = metrics;
      if (config.insertAfter) {
        const next = metrics.nextElementSibling;
        // Native total upload/download badges, never PlanInfo's <p> badges.
        if (next && next.tagName === 'SECTION' && next.children.length >= 2 &&
            Array.from(next.children).every(child => child.tagName !== 'P')) anchor = next;
      }
      return { host: metrics.parentElement, anchor };
    }
    let host = card.querySelector('.nezhaop-offline-traffic');
    if (!host) {
      host = owned(document.createElement('div'));
      host.className = 'nezhaop-offline-traffic';
      // Put offline bars in the name column: inline cards remain a single row.
      const heading = Array.from(card.children).find(child => child.tagName === 'SECTION' && child.querySelector('p'));
      const name = heading && heading.querySelector('p');
      const nameColumn = name && name.parentElement;
      if (card.closest('.server-inline-list') && nameColumn) nameColumn.appendChild(host);
      else card.appendChild(host);
    }
    return { host, anchor: null };
  }

  function removeRow(row) {
    rowStates.delete(row);
    row.remove();
  }

  function clearTrafficRows() {
    rowStates.forEach((_, row) => row.remove());
    rowStates.clear();
    document.querySelectorAll(ROW + ', .nezhaop-offline-traffic').forEach(node => node.remove());
  }

  function restoreNative() {
    hiddenNative.forEach((display, element) => {
      if (element.isConnected) element.style.display = display;
    });
    hiddenNative.clear();
  }

  function syncNativeCards(renderedKeys, rows) {
    const hide = new Set();
    if (config.hideNativeCycleCards && !stale) {
      document.querySelectorAll('.mt-4.w-full.mx-auto').forEach(root => {
        Array.from(root.children).filter(child => child.tagName === 'DIV').forEach(wrapper => {
          const grid = Array.from(wrapper.children).find(child => child.tagName === 'SECTION' && child.classList.contains('grid'));
          if (!grid || !grid.children.length) return;
          Array.from(grid.children).forEach(card => {
            const match = inspectReact(card, (props, fiber) => {
              if (!props || !Array.isArray(props.serverStats) || !props.serverStats.length) return null;
              const serverIds = props.serverStats.map(stat => validId(stat.serverId));
              if (serverIds.some(id => !id)) return null;
              // Official CycleTransferStatsClient's React key is cycleId-serverId.
              const key = fiber && fiber.key != null ? String(fiber.key) : '';
              return serverIds.every(id => rows.some(row => row.serverId === id &&
                key === row.cycleId + '-' + id && renderedKeys.has(row.key)));
            });
            if (match === true) hide.add(card);
          });
          if (Array.from(grid.children).every(card => hide.has(card))) hide.add(wrapper);
        });
      });
    }
    hiddenNative.forEach((display, element) => {
      if (!hide.has(element)) {
        if (element.isConnected) element.style.display = display;
        hiddenNative.delete(element);
      }
    });
    hide.forEach(element => {
      if (!hiddenNative.has(element)) hiddenNative.set(element, element.style.display);
      if (element.style.display !== 'none') element.style.display = 'none';
    });
  }

  function renderTraffic() {
    if (embedded || !config.showTrafficStats || !cached) {
      clearTrafficRows();
      restoreNative();
      return;
    }
    const rows = normalizeCycles(cached);
    const cards = getCards();
    const idsByName = new Map();
    const cardsByName = new Map();
    rows.forEach(row => {
      if (!idsByName.has(row.serverName)) idsByName.set(row.serverName, new Set());
      idsByName.get(row.serverName).add(row.serverId);
    });
    cards.forEach(card => cardsByName.set(card.name, (cardsByName.get(card.name) || 0) + 1));
    const desired = new Map();
    const renderedKeys = new Set();
    cards.forEach(target => {
      let id = target.id;
      if (!id) {
        const candidates = idsByName.get(target.name);
        if (candidates && candidates.size === 1 && cardsByName.get(target.name) === 1) id = candidates.values().next().value;
      }
      const relevant = id ? rows.filter(row => row.serverId === id) : [];
      if (relevant.length) desired.set(target.card, relevant);
    });
    // Clean all obsolete rows before inserting. React can remount/move cards.
    document.querySelectorAll(ROW).forEach(row => {
      const target = cards.find(item => item.card.contains(row));
      const relevant = target && desired.get(target.card);
      if (!relevant || !relevant.some(data => data.key === row.dataset.nezhaopCycleKey)) removeRow(row);
    });
    desired.forEach((dataRows, card) => {
      const placement = getTrafficHost(card);
      let anchor = placement.anchor;
      dataRows.forEach(data => {
        const matches = Array.from(card.querySelectorAll(ROW)).filter(row => row.dataset.nezhaopCycleKey === data.key);
        let row = matches.shift();
        matches.forEach(removeRow);
        let state = row && rowStates.get(row);
        if (!state) { if (row) removeRow(row); state = makeRow(data); row = state.row; }
        updateRow(state, data);
        if (anchor) {
          if (anchor.nextElementSibling !== row) anchor.after(row);
        } else if (row.parentElement !== placement.host) placement.host.appendChild(row);
        anchor = row;
        renderedKeys.add(data.key);
      });
    });
    rowStates.forEach((_, row) => { if (!row.isConnected) rowStates.delete(row); });
    document.querySelectorAll('.nezhaop-offline-traffic').forEach(host => {
      if (!host.children.length) host.remove();
    });
    syncNativeCards(renderedKeys, rows);
  }

  function stopRefresh() {
    if (refreshTimer !== null) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  function cancelRequest() {
    requestGeneration += 1;
    if (request) {
      if (request.controller) request.controller.abort();
      clearTimeout(request.timeout);
      request = null;
    }
  }

  function trafficActive() {
    return !embedded && config.showTrafficStats && Boolean(document.querySelector(LIST));
  }

  async function fetchTraffic() {
    if (runtime.stopped || !trafficActive() || document.hidden || request || Date.now() < nextFetchAt) return;
    const generation = ++requestGeneration;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const current = { controller, timeout: null };
    request = current;
    nextFetchAt = Date.now() + config.interval;
    current.timeout = setTimeout(() => {
      if (request !== current) return;
      if (controller) controller.abort();
      request = null;
      requestGeneration += 1;
      stale = true;
      nextFetchAt = Date.now() + Math.min(config.interval, 10000);
      renderTraffic();
      log('Traffic request timed out');
    }, config.requestTimeout);
    try {
      const response = await fetch(config.apiUrl, controller ? { signal: controller.signal, credentials: 'same-origin' } : { credentials: 'same-origin' });
      let body;
      try { body = await response.json(); }
      catch (error) { error.status = response.status; throw error; }
      if (runtime.stopped || generation !== requestGeneration) return;
      if (response.ok === false || !isObject(body) || body.success === false || body.error) {
        const error = new Error((body && body.error) || 'Traffic API request failed');
        error.status = response.status;
        throw error;
      }
      if (body.data !== undefined && !isObject(body.data)) throw new Error('Invalid Traffic API data envelope');
      const envelope = isObject(body.data) ? body.data : body;
      const data = envelope.cycle_transfer_stats == null ? {} : envelope.cycle_transfer_stats;
      if (!isObject(data)) throw new Error('Invalid cycle_transfer_stats payload');
      cached = data;
      updatedAt = Date.now();
      stale = false;
      renderTraffic();
    } catch (error) {
      if (runtime.stopped || generation !== requestGeneration) return;
      if (error.status === 401 || error.status === 403 || /unauthorized|permission denied/i.test(error.message || '')) {
        cached = null;
        clearTrafficRows();
        restoreNative();
      } else {
        stale = true;
        renderTraffic();
      }
      nextFetchAt = Date.now() + Math.min(config.interval, 10000);
      log(error.message);
    } finally {
      clearTimeout(current.timeout);
      if (request === current) request = null;
    }
  }

  // Detail enhancement. Native tabs are never hidden in the parent page.
  function tabsOf(info) {
    const wrap = info && info.querySelector('.server-info-tab');
    return wrap ? Array.from(wrap.querySelectorAll('button, [role="tab"], [class*="cursor-pointer"]'))
      .filter(tab => !tab.hasAttribute(OWN) && !tab.parentElement.closest('[role="tab"], button, [class*="cursor-pointer"]')) : [];
  }

  function tabSection(info) {
    const wrap = info && info.querySelector('.server-info-tab');
    return wrap && (wrap.closest('section') || wrap);
  }

  function contentWrappers(info) {
    const section = tabSection(info);
    if (!section || section.parentElement !== info) return [];
    const children = Array.from(info.children);
    return children.slice(children.indexOf(section) + 1).filter(child => !child.hasAttribute(OWN));
  }

  function rememberHidden(state, element) {
    if (!element) return;
    if (!state.hidden.has(element)) state.hidden.set(element, element.style.display);
    if (element.style.display !== 'none') element.style.display = 'none';
  }

  function restoreHidden(state) {
    state.hidden.forEach((display, element) => { if (element.isConnected) element.style.display = display; });
    state.hidden.clear();
  }

  function combinedLabel(state) {
    const chinese = /^zh/i.test(document.documentElement.lang || navigator.language || '');
    return state.pending ? (chinese ? '加载中…' : 'Loading…') : state.merged
      ? (chinese ? '退出合并' : 'Exit combined') : (chinese ? '合并视图' : 'Combined');
  }

  function updateButton(state) {
    if (!state.button) return;
    setText(state.button, combinedLabel(state));
    state.button.setAttribute('aria-pressed', String(Boolean(state.merged)));
    state.button.setAttribute('aria-busy', String(Boolean(state.pending)));
    state.button.title = 'Detail + Network';
  }

  function leaveCombined(state) {
    if (!state) return;
    clearTimeout(state.timeout);
    state.timeout = null;
    if (state.frame) state.frame.remove();
    state.frame = null;
    state.pending = false;
    state.merged = false;
    if (state.panels) state.panels.forEach(({ panel, display }) => { if (panel.isConnected) panel.style.display = display; });
    state.panels = null;
    updateButton(state);
  }

  function startCombined(state) {
    if (runtime.stopped || state.pending || state.merged || !state.info.isConnected) return;
    const network = tabsOf(state.info)[1];
    if (!network) return;
    const wrappers = contentWrappers(state.info);
    const legacy = wrappers.length === 2 && wrappers.some(wrapper => wrapper.querySelector('.server-charts')) &&
      wrappers.every(wrapper => ['none', 'block'].includes(wrapper.style.display));
    if (legacy) {
      state.panels = wrappers.map(panel => ({ panel, display: panel.style.display }));
      state.internalClick = true;
      try { network.click(); } finally { state.internalClick = false; }
      state.merged = true;
      wrappers.forEach(panel => { panel.style.display = 'block'; });
      updateButton(state);
      return;
    }
    const frame = owned(document.createElement('iframe'));
    const url = new URL(location.href);
    url.searchParams.set(DETAIL_PARAM, DETAIL_VALUE);
    frame.dataset.nezhaopDetailFrame = '1';
    frame.title = 'Server detail charts';
    frame.src = url.href;
    frame.hidden = true;
    state.frame = frame;
    state.pending = true;
    tabSection(state.info).insertAdjacentElement('afterend', frame);
    state.timeout = setTimeout(() => {
      if (detail !== state || state.frame !== frame || !state.pending) return;
      leaveCombined(state);
      if (state.button) state.button.title = 'Combined view could not load. Click to retry; native tabs remain available.';
    }, config.combinedTimeout);
    updateButton(state);
  }

  function detailMessage(event) {
    const state = detail;
    if (!state || !state.frame || event.origin !== location.origin || event.source !== state.frame.contentWindow ||
        !event.data || event.data.type !== DETAIL_MESSAGE) return;
    const height = Number(event.data.height);
    if (!Number.isFinite(height) || height <= 0) return;
    const network = tabsOf(state.info)[1];
    if (!network) return;
    state.frame.style.height = Math.min(100000, Math.ceil(height)) + 'px';
    if (!state.merged) {
      state.internalClick = true;
      try { network.click(); } finally { state.internalClick = false; }
      clearTimeout(state.timeout);
      state.timeout = null;
      state.pending = false;
      state.merged = true;
      state.frame.hidden = false;
      updateButton(state);
    }
  }

  function reportEmbedded() {
    const state = detail;
    if (!embedded || !state || runtime.stopped) return;
    const wrapper = contentWrappers(state.info).find(child => child.matches('.server-charts') || child.querySelector('.server-charts'));
    if (!wrapper) return;
    if (state.resizeTarget !== wrapper && typeof ResizeObserver === 'function') {
      if (state.resizeObserver) state.resizeObserver.disconnect();
      state.resizeObserver = new ResizeObserver(reportEmbedded);
      state.resizeObserver.observe(wrapper);
      state.resizeTarget = wrapper;
    }
    const height = Math.max(wrapper.scrollHeight, Math.ceil(wrapper.getBoundingClientRect().height), 1);
    if (state.height !== height) {
      state.height = height;
      window.parent.postMessage({ type: DETAIL_MESSAGE, height }, location.origin);
    }
  }

  function cleanupDetail() {
    if (!detail) return;
    const state = detail;
    leaveCombined(state);
    restoreHidden(state);
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.section && state.onTabClick) state.section.removeEventListener('click', state.onTabClick, true);
    if (state.button) state.button.remove();
    detail = null;
    delete document.documentElement.dataset.nezhaopView;
  }

  function scanDetail() {
    const nextRoute = location.pathname + location.search;
    const info = /^\/server\/[^/]+\/?$/.test(location.pathname) && document.querySelector('.server-info');
    const section = info && tabSection(info);
    if (nextRoute !== routeKey || !info || !section || (detail && (detail.info !== info || detail.section !== section))) cleanupDetail();
    routeKey = nextRoute;
    if (!info || !section) return;
    if (!detail) {
      const state = { info, section, hidden: new Map(), frame: null, button: null, pending: false, merged: false };
      detail = state;
      if (!embedded) {
        state.onTabClick = event => {
          if (state.internalClick || !event.target || !event.target.closest) return;
          const wrap = event.target.closest('.server-info-tab');
          if (wrap && state.info.contains(wrap)) leaveCombined(state);
        };
        section.addEventListener('click', state.onTabClick, true);
      }
    }
    const state = detail;
    if (embedded) {
      document.documentElement.dataset.nezhaopView = DETAIL_VALUE;
      document.querySelectorAll('header, footer').forEach(node => rememberHidden(state, node));
      const header = document.querySelector('.header-top');
      rememberHidden(state, header && header.parentElement);
      const name = info.querySelector('.server-name');
      let overview = name;
      while (overview && overview.parentElement !== info) overview = overview.parentElement;
      rememberHidden(state, overview);
      rememberHidden(state, section);
      reportEmbedded();
      return;
    }
    if (config.showCombinedButton || config.detailMode === 'combined') {
      if (!state.button || !state.button.isConnected) {
        const button = owned(document.createElement('button'));
        button.type = 'button';
        button.className = 'nezhaop-combined-button';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          if (state.merged || state.pending) leaveCombined(state);
          else startCombined(state);
        });
        section.appendChild(button);
        state.button = button;
        updateButton(state);
      }
    } else if (state.button) { state.button.remove(); state.button = null; }
    if (!state.autoApplied) {
      state.autoApplied = true;
      if (config.detailMode === 'combined') startCombined(state);
    }
    if (state.merged && state.panels) state.panels.forEach(({ panel }) => {
      if (panel.isConnected && panel.style.display !== 'block') panel.style.display = 'block';
    });
  }

  function scan() {
    scanTimer = null;
    if (runtime.stopped) return;
    scanDetail();
    if (trafficActive()) {
      renderTraffic();
      if (refreshTimer === null) refreshTimer = setInterval(fetchTraffic, Math.min(config.interval, 10000));
      void fetchTraffic();
    } else {
      stopRefresh();
      if (request) cancelRequest();
      clearTrafficRows();
      restoreNative();
    }
  }

  function scheduleScan() {
    if (runtime.stopped || scanTimer !== null) return;
    scanTimer = setTimeout(scan, 30);
  }

  function configEvent() { configure(); }
  function visible() { if (!document.hidden) scheduleScan(); }
  function stopRuntime() {
    if (runtime.stopped) return;
    runtime.stopped = true;
    if (observer) observer.disconnect();
    if (scanTimer !== null) clearTimeout(scanTimer);
    if (rotationTimer !== null) clearInterval(rotationTimer);
    if (configDiscoveryTimer !== null) clearTimeout(configDiscoveryTimer);
    stopRefresh();
    cancelRequest();
    cleanupDetail();
    clearTrafficRows();
    restoreNative();
    style.remove();
    window.removeEventListener('message', detailMessage);
    window.removeEventListener('popstate', scheduleScan);
    window.removeEventListener('nezhaop:config', configEvent);
    window.removeEventListener('beforeunload', stopRuntime);
    document.removeEventListener('visibilitychange', visible);
    historyChanges.forEach(({ method, original, wrapper }) => {
      if (history[method] === wrapper) history[method] = original;
    });
    globalChanges.forEach(({ key, value, oldValue }) => { if (window[key] === value) window[key] = oldValue; });
    delete document.documentElement.dataset.nezhaopRuntime;
    if (window[RUNTIME_KEY] === runtime) delete window[RUNTIME_KEY];
  }

  configure();
  // Preserve the previous script's support for config declared just after its tag.
  configDiscoveryTimer = setTimeout(() => { configDiscoveryTimer = null; configure(); }, 150);
  observer = new MutationObserver(mutations => {
    if (runtime.stopped) return;
    const relevant = mutations.some(mutation => {
      const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
      if (target && target.closest('[' + OWN + ']')) return false;
      // Ignore our own insertions/text rotations, but restore rows removed by React.
      if (Array.from(mutation.removedNodes).some(node => node.nodeType === 1 &&
          (node.matches(ROW) || node.querySelector(ROW)))) return true;
      return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
        node.nodeType === 1 && !node.hasAttribute(OWN));
    });
    if (relevant) scheduleScan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('message', detailMessage);
  window.addEventListener('popstate', scheduleScan);
  window.addEventListener('nezhaop:config', configEvent);
  window.addEventListener('beforeunload', stopRuntime);
  document.addEventListener('visibilitychange', visible);
  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    const wrapper = function(...args) {
      const result = original.apply(this, args);
      scheduleScan();
      return result;
    };
    history[method] = wrapper;
    historyChanges.push({ method, original, wrapper });
  });
  scheduleScan();
})();
