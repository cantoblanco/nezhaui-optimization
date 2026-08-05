
(() => {
  'use strict';

  const RUNTIME_KEY = '__NEZHAOP_RUNTIME__';
  const existingRuntime = window[RUNTIME_KEY];
  if (existingRuntime) {
    existingRuntime.rescan();
    return;
  }

  const DETAIL_PARAM = 'nezhaop_view';
  const DETAIL_VALUE = 'detail';
  const DETAIL_MESSAGE = 'nezhaop:detail-ready';
  const runtime = {
    routeKey: '',
    detail: null,
    scanPending: false,
    stopped: false,
    rescan: scheduleDetailScan
  };
  window[RUNTIME_KEY] = runtime;
  document.documentElement.dataset.nezhaopRuntime = 'active';

  // ===== 自定义全局开关（为其他脚本提供）=====
  window.ShowNetTransfer = true;
  window.DisableAnimatedMan = false;
  window.ForceUseSvgFlag = true;

  function isServerDetailRoute() {
    return /^\/server\/[^/]+\/?$/.test(window.location.pathname);
  }

  function isEmbeddedDetail() {
    return new URLSearchParams(window.location.search).get(DETAIL_PARAM) === DETAIL_VALUE;
  }

  function getRouteKey() {
    return window.location.pathname + window.location.search;
  }

  function rememberAndHide(state, element) {
    if (!element || state.hidden.some(item => item.element === element)) return;
    state.hidden.push({ element, display: element.style.display });
    element.style.display = 'none';
  }

  function restoreHidden(state) {
    state.hidden.forEach(({ element, display }) => {
      if (element.isConnected) element.style.display = display;
    });
    state.hidden.length = 0;
  }

  function findNetworkTab(info) {
    const wrap = info && info.querySelector('.server-info-tab');
    if (!wrap) return null;
    const tabs = Array.from(wrap.querySelectorAll('button, [role="tab"], [class*="cursor-pointer"]'));
    return tabs.find(tab => /Network|网络/i.test(tab.textContent || '')) || tabs[1] || null;
  }

  function getTabSection(info) {
    const wrap = info && info.querySelector('.server-info-tab');
    return wrap && (wrap.closest('section') || wrap);
  }

  function getLegacyPanels(info, charts) {
    return Array.from(new Set(charts.map(chart => {
      let panel = chart;
      while (panel.parentElement && panel.parentElement !== info) panel = panel.parentElement;
      return panel.parentElement === info ? panel : chart;
    })));
  }

  function revealLegacyPanels(state) {
    state.panels.forEach(panel => {
      panel.style.display = 'block';
    });
  }

  function initializeLegacy(info, charts) {
    const panels = getLegacyPanels(info, charts);
    const state = {
      mode: 'legacy',
      routeKey: runtime.routeKey,
      info,
      hidden: [],
      panels,
      panelDisplays: panels.map(panel => ({ panel, display: panel.style.display }))
    };
    runtime.detail = state;
    rememberAndHide(state, getTabSection(info));
    const tab = findNetworkTab(info);
    if (tab) tab.click();
    revealLegacyPanels(state);
  }

  function createDetailFrame(info) {
    const frameUrl = new URL(window.location.href);
    frameUrl.searchParams.set(DETAIL_PARAM, DETAIL_VALUE);
    const frame = document.createElement('iframe');
    frame.dataset.nezhaopDetailFrame = '1';
    frame.title = 'Server detail charts';
    frame.src = frameUrl.href;
    frame.hidden = true;
    frame.style.width = '100%';
    frame.style.border = '0';
    frame.style.overflow = 'hidden';
    info.insertAdjacentElement('afterend', frame);
    return frame;
  }

  function initializeParent(info) {
    runtime.detail = {
      mode: 'parent',
      routeKey: runtime.routeKey,
      info,
      frame: createDetailFrame(info),
      hidden: [],
      ready: false,
      clicked: false
    };
  }

  function hideEmbeddedChrome(state) {
    document.querySelectorAll('header, footer, .server-name').forEach(element => rememberAndHide(state, element));
    document.querySelectorAll('.server-info-tab').forEach(element => {
      rememberAndHide(state, element);
      rememberAndHide(state, element.closest('section'));
    });
  }

  function measureDetailHeight() {
    const root = document.documentElement;
    const body = document.body;
    const info = document.querySelector('.server-info');
    const charts = document.querySelector('.server-charts');
    return Math.max(
      root ? root.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      info ? info.scrollHeight : 0,
      charts ? Math.ceil(charts.getBoundingClientRect().bottom) : 0,
      1
    );
  }

  function reportEmbeddedReady() {
    window.parent.postMessage({ type: DETAIL_MESSAGE, height: measureDetailHeight() }, window.location.origin);
  }

  function initializeEmbedded() {
    const state = {
      mode: 'embedded',
      routeKey: runtime.routeKey,
      hidden: []
    };
    runtime.detail = state;
    document.documentElement.dataset.nezhaopView = DETAIL_VALUE;
    hideEmbeddedChrome(state);
    if (document.querySelector('.server-charts')) {
      if (typeof ResizeObserver === 'function') {
        state.resizeObserver = new ResizeObserver(reportEmbeddedReady);
        state.resizeObserver.observe(document.documentElement);
      }
      reportEmbeddedReady();
    }
  }

  function cleanupDetail() {
    const state = runtime.detail;
    if (!state) return;
    restoreHidden(state);
    if (state.panelDisplays) {
      state.panelDisplays.forEach(({ panel, display }) => {
        if (panel.isConnected) panel.style.display = display;
      });
    }
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.frame) state.frame.remove();
    delete document.documentElement.dataset.nezhaopView;
    runtime.detail = null;
  }

  function scanDetailPage() {
    runtime.scanPending = false;
    if (runtime.stopped) return;

    const nextRoute = getRouteKey();
    if (nextRoute !== runtime.routeKey) {
      cleanupDetail();
      runtime.routeKey = nextRoute;
    }

    if (!isServerDetailRoute()) {
      cleanupDetail();
      return;
    }

    const info = document.querySelector('.server-info');
    if (!info) return;
    const charts = Array.from(info.querySelectorAll('.server-charts'));
    if (!charts.length) return;

    const state = runtime.detail;
    if (state && state.routeKey === runtime.routeKey) {
      if (state.mode === 'legacy') revealLegacyPanels(state);
      if (state.mode === 'embedded') {
        hideEmbeddedChrome(state);
        reportEmbeddedReady();
      }
      if (state.mode === 'parent' && state.ready) {
        if (state.info !== info) {
          state.info = info;
          state.clicked = false;
        }
        activateParent(state);
      }
      return;
    }

    if (isEmbeddedDetail()) initializeEmbedded();
    else if (charts.length >= 2) initializeLegacy(info, charts);
    else initializeParent(info);
  }

  function scheduleDetailScan() {
    if (runtime.stopped || runtime.scanPending) return;
    runtime.scanPending = true;
    Promise.resolve().then(scanDetailPage);
  }

  function onDetailMessage(event) {
    const state = runtime.detail;
    if (!state || state.mode !== 'parent' || event.origin !== window.location.origin) return;
    if (event.source !== state.frame.contentWindow || !event.data || event.data.type !== DETAIL_MESSAGE) return;
    const height = Math.max(1, Number(event.data.height) || 1);
    state.frame.style.height = Math.ceil(height) + 'px';
    state.ready = true;
    activateParent(state);
  }

  function activateParent(state) {
    const networkTab = findNetworkTab(state.info);
    if (!networkTab) return;
    rememberAndHide(state, getTabSection(state.info));
    if (!state.clicked) {
      state.clicked = true;
      networkTab.click();
    }
    state.frame.hidden = false;
  }

  let decorationFrame = null;
  const decorationTimers = [];

  function ensureTrafficStyles() {
    if (document.querySelector('#traffic-progress-style')) return;
    const style = document.createElement('style');
    style.id = 'traffic-progress-style';
    style.textContent = `
      .traffic-progress-normal   { background: linear-gradient(90deg, #10b981 0%, #059669 100%) !important; }
      .traffic-progress-warning  { background: linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%) !important; }
      .traffic-progress-danger   { background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%) !important; }
      .traffic-progress-critical { background: linear-gradient(90deg, #6b7280 0%, #4b5563 100%) !important; }
    `;
    document.head.appendChild(style);
  }

  function refreshDecorations() {
    decorationFrame = null;
    document.querySelectorAll('.server-info h3.font-semibold.tracking-tight').forEach(element => {
      if (element.textContent.trim()) element.style.display = 'none';
    });
    ensureTrafficStyles();
    document.querySelectorAll('.new-inserted-element .progress-bar').forEach(bar => {
      const card = bar.closest('.w-full') || bar.parentElement;
      if (!card) return;
      const percentageElement = card.querySelector('.percentage-value, .text-xs.font-medium.text-neutral-600');
      const match = (percentageElement ? percentageElement.textContent : card.textContent).match(/(\d+(?:\.\d+)?)%/);
      if (!match) return;
      const percentage = Number(match[1]);
      bar.classList.remove('traffic-progress-normal', 'traffic-progress-warning', 'traffic-progress-danger', 'traffic-progress-critical');
      if (percentage >= 100) bar.classList.add('traffic-progress-critical');
      else if (percentage >= 90) bar.classList.add('traffic-progress-danger');
      else if (percentage >= 70) bar.classList.add('traffic-progress-warning');
      else bar.classList.add('traffic-progress-normal');
    });
  }

  function scheduleDecorations() {
    if (decorationFrame !== null) return;
    decorationFrame = requestAnimationFrame(refreshDecorations);
  }

  const detailObserver = new MutationObserver(() => {
    scheduleDetailScan();
    scheduleDecorations();
  });
  detailObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('message', onDetailMessage);
  window.addEventListener('popstate', scheduleDetailScan);

  const originalHistoryMethods = {};
  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    originalHistoryMethods[method] = original;
    history[method] = function(...args) {
      const result = original.apply(this, args);
      scheduleDetailScan();
      return result;
    };
  });

  const detailStyle = document.createElement('style');
  detailStyle.setAttribute('data-nezhaop-style', 'detail-frame');
  detailStyle.textContent = 'iframe[data-nezhaop-detail-frame] { display: block; } iframe[data-nezhaop-detail-frame][hidden] { display: none; }';
  document.head.appendChild(detailStyle);
  scheduleDetailScan();
  scheduleDecorations();
  decorationTimers.push(setTimeout(scheduleDecorations, 1000));
  decorationTimers.push(setTimeout(scheduleDecorations, 3000));

/* =========================================================
 * TrafficScript — Combined & Fixed (2025-06-17)
 * - 修复 const 重赋值
 * - 轮播防重/可重启
 * - 切换元素内存清理
 * - 进度条百分比限幅
 * - CSS 选择器收敛避免误伤
 * - 日期输出 YYYY-MM-DD
 * - 大数百分比�����稳健
 * - 时区可配置
 * - 周期刷新可重启（新配置生效）
 * =======================================================*/
const SCRIPT_VERSION = 'v20250617';

/* ============= 样式注入模块 ============= */
// 更精确：只有带 data-hide="1" 的容器才隐藏其直系 div，且不隐藏 .new-inserted-element
(function injectCustomCSS() {
  const style = document.createElement('style');
  style.textContent = `
    .mt-4.w-full.mx-auto[data-hide="1"] > div:not(.new-inserted-element) {
      display: none;
    }
  `;
  document.head.appendChild(style);
})();

/* ============= 工具函数模块 ============= */
const utils = (() => {
  function formatFileSize(bytes) {
    if (bytes === 0) return { value: '0', unit: 'B' };
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let size = Number(bytes);
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return {
      value: size.toFixed(unitIndex === 0 ? 0 : 2),
      unit: units[unitIndex]
    };
  }

  // 更稳健的大数百分比计算
  function calculatePercentage(used, total) {
    const u = Number(used);
    const t = Number(total);
    if (!isFinite(u) || !isFinite(t) || t <= 0) return '0.00';
    // 对数量级极大时进行对数量级降尺度，减少精度损失
    const mag = Math.max(0, Math.floor(Math.log10(Math.max(u, t))) - 12);
    const scale = Math.pow(10, mag);
    const pct = (u / scale) / (t / scale) * 100;
    return (isFinite(pct) ? pct : 0).toFixed(2);
  }

  // 输出 YYYY-MM-DD
  function formatDate(dateString) {
    const d = new Date(dateString);
    if (isNaN(d)) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function safeSetTextContent(parent, selector, text) {
    const el = parent.querySelector(selector);
    if (el) el.textContent = text;
  }

  // 0~100 百分比的 HSL 渐变（绿→橙→红）
  function getHslGradientColor(percentage) {
    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
    const lerp = (start, end, t) => start + (end - start) * t;
    const p = clamp(Number(percentage), 0, 100);
    let h, s, l;

    if (p <= 35) {
      const t = p / 35;
      h = lerp(142, 32, t);  // 绿色到橙色
      s = lerp(69, 85, t);
      l = lerp(45, 55, t);
    } else if (p <= 85) {
      const t = (p - 35) / 50;
      h = lerp(32, 0, t);    // 橙色到红色
      s = lerp(85, 75, t);
      l = lerp(55, 50, t);
    } else {
      const t = (p - 85) / 15;
      h = 0;                 // 红色加深
      s = 75;
      l = lerp(50, 45, t);
    }
    return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
  }

  function fadeOutIn(element, newContent, duration = 500) {
    element.style.transition = `opacity ${duration / 2}ms`;
    element.style.opacity = '0';
    setTimeout(() => {
      element.innerHTML = newContent;
      element.style.transition = `opacity ${duration / 2}ms`;
      element.style.opacity = '1';
    }, duration / 2);
  }

  function pickCycleValue(value, serverId) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value[serverId];
    }
    return value;
  }

  return {
    formatFileSize,
    calculatePercentage,
    formatDate,
    safeSetTextContent,
    getHslGradientColor,
    fadeOutIn,
    pickCycleValue
  };
})();

/* ============= 流量统计渲染模块 ============= */
const trafficRenderer = (() => {
  const toggleElements = [];  // { el: HTMLElement, contents: string[] }
  let toggleTimer = null;

  function renderTrafficStats(trafficData, config) {
    const serverMap = new Map();

    // 聚合每台服务器的数据
    for (const cycleId in trafficData) {
      const cycle = trafficData[cycleId];
      if (!cycle.server_name || !cycle.transfer) continue;
      for (const serverId in cycle.server_name) {
        const serverName = cycle.server_name[serverId];
        const transfer = cycle.transfer[serverId];
        const max = utils.pickCycleValue(cycle.max, serverId);
        const from = utils.pickCycleValue(cycle.from, serverId);
        const to = utils.pickCycleValue(cycle.to, serverId);
        const next_update = utils.pickCycleValue(cycle.next_update, serverId);

        if (serverName && transfer !== undefined && max && from && to) {
          serverMap.set(serverName, {
            id: serverId,
            transfer,
            max,
            name: cycle.name,
            from,
            to,
            next_update
          });
        }
      }
    }

    serverMap.forEach((serverData, serverName) => {
      // 定位到当前服务器的展示 section
      const targetElement = Array.from(document.querySelectorAll('section.grid.items-center.gap-2'))
        .find(section => section.querySelector('p')?.textContent.trim() === serverName.trim());
      if (!targetElement) return;

      // 格式化
      const usedFormatted = utils.formatFileSize(serverData.transfer);
      const totalFormatted = utils.formatFileSize(serverData.max);
      const percentage = utils.calculatePercentage(serverData.transfer, serverData.max);
      const pctClamped = Math.max(0, Math.min(100, Number(percentage) || 0));
      const fromFormatted = utils.formatDate(serverData.from);
      const toFormatted = utils.formatDate(serverData.to);
      const nextUpdateFormatted = serverData.next_update
        ? new Date(serverData.next_update).toLocaleString("zh-CN", { timeZone: config.timeZone || 'Asia/Shanghai' })
        : '';
      const uniqueClassName = 'traffic-stats-for-server-' + serverData.id;
      const progressColor = utils.getHslGradientColor(pctClamped);
      const containerDiv = targetElement.closest('div');
      if (!containerDiv) return;

      const log = (...args) => { if (config.enableLog) console.log('[renderTrafficStats]', ...args); };

      // 已存在则更新
      const existing = Array.from(containerDiv.querySelectorAll('.new-inserted-element'))
        .find(el => el.classList.contains(uniqueClassName));

      if (!config.showTrafficStats) {
        if (existing) {
          // 同步清理轮播元素
          for (let i = toggleElements.length - 1; i >= 0; i--) {
            if (toggleElements[i].el && existing.contains(toggleElements[i].el)) {
              toggleElements.splice(i, 1);
            }
          }
          existing.remove();
          log(`移除流量条目: ${serverName}`);
        }
        return;
      }

      if (existing) {
        utils.safeSetTextContent(existing, '.used-traffic', usedFormatted.value);
        utils.safeSetTextContent(existing, '.used-unit', usedFormatted.unit);
        utils.safeSetTextContent(existing, '.total-traffic', totalFormatted.value);
        utils.safeSetTextContent(existing, '.total-unit', totalFormatted.unit);
        utils.safeSetTextContent(existing, '.from-date', fromFormatted);
        utils.safeSetTextContent(existing, '.to-date', toFormatted);
        utils.safeSetTextContent(existing, '.percentage-value', pctClamped + '%');
        utils.safeSetTextContent(existing, '.next-update', nextUpdateFormatted ? `next update: ${nextUpdateFormatted}` : '');

        const progressBar = existing.querySelector('.progress-bar');
        if (progressBar) {
          progressBar.style.width = pctClamped + '%';
          progressBar.style.backgroundColor = progressColor;
        }
        log(`更新流量条目: ${serverName}`);
      } else {
        // 新建
        let oldSection = null;
        if (config.insertAfter) {
          oldSection = containerDiv.querySelector('section.flex.items-center.w-full.justify-between.gap-1')
            || containerDiv.querySelector('section.grid.items-center.gap-3');
        } else {
          oldSection = containerDiv.querySelector('section.grid.items-center.gap-3');
        }
        if (!oldSection) return;

        const defaultTimeInfoHTML = `
          <span class="from-date">${fromFormatted}</span>
          <span class="text-neutral-500 dark:text-neutral-400">-</span>
          <span class="to-date">${toFormatted}</span>
        `;
        const contents = [
          defaultTimeInfoHTML,
          `<span class="text-[10px] font-medium text-neutral-800 dark:text-neutral-200 percentage-value">${pctClamped}%</span>`,
          nextUpdateFormatted ? `<span class="text-[10px] font-medium text-neutral-600 dark:text-neutral-300">${nextUpdateFormatted}</span>` : defaultTimeInfoHTML
        ];

        const newElement = document.createElement('div');
        newElement.classList.add('space-y-1.5', 'new-inserted-element', uniqueClassName);
        newElement.style.width = '100%';
        newElement.innerHTML = `
          <div class="flex items-center justify-between">
            <div class="flex items-baseline gap-1">
              <span class="text-[10px] font-medium text-neutral-800 dark:text-neutral-200 used-traffic">${usedFormatted.value}</span>
              <span class="text-[10px] font-medium text-neutral-800 dark:text-neutral-200 used-unit">${usedFormatted.unit}</span>
              <span class="text-[10px] text-neutral-500 dark:text-neutral-400">/ </span>
              <span class="text-[10px] text-neutral-500 dark:text-neutral-400 total-traffic">${totalFormatted.value}</span>
              <span class="text-[10px] text-neutral-500 dark:text-neutral-400 total-unit">${totalFormatted.unit}</span>
            </div>
            <div class="text-[10px] font-medium text-neutral-600 dark:text-neutral-300 time-info" style="opacity:1; transition: opacity 0.3s;">
              ${defaultTimeInfoHTML}
            </div>
          </div>
          <div class="relative h-1.5">
            <div class="absolute inset-0 bg-neutral-100 dark:bg-neutral-800 rounded-full"></div>
            <div class="absolute inset-0 bg-emerald-500 rounded-full transition-all duration-300 progress-bar"
                 style="width: ${pctClamped}%; max-width: 100%; background-color: ${progressColor};"></div>
          </div>
        `;

        oldSection.after(newElement);
        log(`插入新流量条目: ${serverName}`);

        if (config.toggleInterval > 0) {
          const timeInfoElement = newElement.querySelector('.time-info');
          if (timeInfoElement) {
            toggleElements.push({ el: timeInfoElement, contents });
          }
        }
      }
    });
  }

  // 防重/可重启的轮播
  function startToggleCycle(toggleInterval, duration) {
    if (toggleTimer) {
      clearInterval(toggleTimer);
      toggleTimer = null;
    }
    if (toggleInterval <= 0) return;

    let toggleIndex = 0;
    toggleTimer = setInterval(() => {
      toggleIndex++;
      // 清理已不在文档中的元素
      for (let i = toggleElements.length - 1; i >= 0; i--) {
        if (!document.body.contains(toggleElements[i].el)) {
          toggleElements.splice(i, 1);
        }
      }
      toggleElements.forEach(({ el, contents }) => {
        if (!document.body.contains(el)) return;
        const index = toggleIndex % contents.length;
        utils.fadeOutIn(el, contents[index], duration);
      });
    }, toggleInterval);
  }

  function stopToggleCycle() {
    if (toggleTimer) {
      clearInterval(toggleTimer);
      toggleTimer = null;
    }
  }

  return {
    renderTrafficStats,
    startToggleCycle,
    stopToggleCycle
  };
})();

/* ============= 数据请求与缓存模块 ============= */
const trafficDataManager = (() => {
  let trafficCache = null;

  function fetchTrafficData(apiUrl, config, callback) {
    const now = Date.now();
    if (trafficCache && (now - trafficCache.timestamp < config.interval)) {
      if (config.enableLog) console.log('[fetchTrafficData] 使用缓存数据');
      callback(trafficCache.data);
      return;
    }

    if (config.enableLog) console.log('[fetchTrafficData] 请求新数据...');
    fetch(apiUrl)
      .then(res => res.json())
      .then(data => {
        if (!data || data.success === false) {
          if (config.enableLog) console.warn('[fetchTrafficData] 请求成功但数据异常');
          return;
        }
        const trafficData = data.data?.cycle_transfer_stats || data.cycle_transfer_stats || {};
        if (config.enableLog) console.log('[fetchTrafficData] 成功获取新数据');
        trafficCache = { timestamp: now, data: trafficData };
        callback(trafficData);
      })
      .catch(err => {
        if (config.enableLog) console.error('[fetchTrafficData] 请求失败:', err);
      });
  }

  return { fetchTrafficData };
})();

/* ============= DOM 变化监听模块 ============= */
const domObserver = (() => {
  const TARGET_SELECTOR = 'section.server-card-list, section.server-inline-list';
  let currentSection = null;
  let childObserver = null;

  function onDomChildListChange(onChangeCallback) {
    onChangeCallback();
  }

  function observeSection(section, onChangeCallback) {
    if (childObserver) childObserver.disconnect();
    currentSection = section;
    childObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
          onDomChildListChange(onChangeCallback);
          break;
        }
      }
    });
    // 如果列表项可能深层插入，可将 subtree 改为 true
    childObserver.observe(currentSection, { childList: true, subtree: false });
    onChangeCallback();
  }

  function startSectionDetector(onChangeCallback) {
    const sectionDetector = new MutationObserver(() => {
      const section = document.querySelector(TARGET_SELECTOR);
      if (section && section !== currentSection) {
        observeSection(section, onChangeCallback);
      }
    });
    const root = document.querySelector('main') || document.body;
    sectionDetector.observe(root, { childList: true, subtree: true });
    return sectionDetector;
  }

  function disconnectAll(sectionDetector) {
    if (childObserver) childObserver.disconnect();
    if (sectionDetector) sectionDetector.disconnect();
  }

  return { startSectionDetector, disconnectAll };
})();

/* ============= 主程序入口 ============= */
(function main() {
  const defaultConfig = {
    showTrafficStats: true,
    insertAfter: true,
    interval: 60000,        // 周期刷新间隔(ms)
    toggleInterval: 5000,   // 文案轮播间隔(ms)
    duration: 500,          // 轮播动画时长(ms)
    apiUrl: '/api/v1/service',
    enableLog: false,
    timeZone: 'Asia/Shanghai'
  };

  // 可重载配置
  let config = Object.assign({}, defaultConfig, window.TrafficScriptConfig || {});
  if (config.enableLog) {
    console.log(`[TrafficScript] 版本: ${SCRIPT_VERSION}`);
    console.log('[TrafficScript] 最终配置如下:', config);
  }

  function updateTrafficStats() {
    trafficDataManager.fetchTrafficData(config.apiUrl, config, trafficData => {
      trafficRenderer.renderTrafficStats(trafficData, config);
    });
  }

  // 周期刷新（可重启以应用新 interval）
  let trafficTimer = null;
  function startPeriodicRefresh() {
    if (trafficTimer) return;
    if (config.enableLog) console.log('[main] 启动周期刷新任务');
    trafficTimer = setInterval(updateTrafficStats, config.interval);
  }
  function stopPeriodicRefresh() {
    if (trafficTimer) {
      clearInterval(trafficTimer);
      trafficTimer = null;
    }
  }
  function restartPeriodicRefresh() {
    stopPeriodicRefresh();
    startPeriodicRefresh();
  }

  function onDomChange() {
    if (config.enableLog) console.log('[main] DOM变化，刷新流量数据');
    updateTrafficStats();
    if (!trafficTimer) startPeriodicRefresh();
  }

  // 启动轮播与监听
  trafficRenderer.startToggleCycle(config.toggleInterval, config.duration);
  const sectionDetector = domObserver.startSectionDetector(onDomChange);
  onDomChange();

  // 100ms 后检测并应用可能晚到的用户配置
  setTimeout(() => {
    const newConfig = Object.assign({}, defaultConfig, window.TrafficScriptConfig || {});
    if (JSON.stringify(newConfig) !== JSON.stringify(config)) {
      if (config.enableLog) console.log('[main] 100ms后检测到新配置，更新配置并重启任务');
      config = newConfig;
      // 重启周期刷新（应用新 interval）
      restartPeriodicRefresh();
      // 重启轮播（应用新 toggleInterval/duration）
      trafficRenderer.startToggleCycle(config.toggleInterval, config.duration);
      // 立即刷新
      updateTrafficStats();
    } else {
      if (config.enableLog) console.log('[main] 100ms后无新配置，保持原配置');
    }
  }, 100);

  // 页面卸载清理
  window.addEventListener('beforeunload', () => {
    domObserver.disconnectAll(sectionDetector);
    stopPeriodicRefresh();
    trafficRenderer.stopToggleCycle();
  });
})();

  function stopRuntime() {
    if (runtime.stopped) return;
    runtime.stopped = true;
    cleanupDetail();
    detailObserver.disconnect();
    window.removeEventListener('message', onDetailMessage);
    window.removeEventListener('popstate', scheduleDetailScan);
    Object.keys(originalHistoryMethods).forEach(method => {
      history[method] = originalHistoryMethods[method];
    });
    if (decorationFrame !== null) cancelAnimationFrame(decorationFrame);
    decorationTimers.forEach(timer => clearTimeout(timer));
  }

  runtime.stop = stopRuntime;
  window.addEventListener('beforeunload', stopRuntime, { once: true });
})();



