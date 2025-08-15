
(() => {
  'use strict';

  // ===== 配置区（尽量集中修改）=====
  const SEL = {
    root: '#root',
    button: '#root > div > main > div.mx-auto.w-full.max-w-5xl.px-0.flex.flex-col.gap-4.server-info > section > div.flex.justify-center.w-full.max-w-\\[200px\\] > div > div > div.relative.cursor-pointer.rounded-3xl.px-2\\.5.py-\\[8px\\].text-\\[13px\\].font-\\[600\\].transition-all.duration-500.text-stone-400.dark\\:text-stone-500',
    section: '#root > div > main > div.mx-auto.w-full.max-w-5xl.px-0.flex.flex-col.gap-4.server-info > section',
    div3:    '#root > div > main > div.mx-auto.w-full.max-w-5xl.px-0.flex.flex-col.gap-4.server-info > div:nth-child(3)',
    div4:    '#root > div > main > div.mx-auto.w-full.max-w-5xl.px-0.flex.flex-col.gap-4.server-info > div:nth-child(4)',
    h3hide:  'h3.font-semibold.tracking-tight',
    // 进度条区域：保持与现状一致；如后续 DOM 变更，优先考虑给容器加 data-* 再改这里
    progressBar: '.bg-emerald-500',
    // 在父卡片内查找服务器名/百分比
    cardName:   '.text-sm.font-medium.text-neutral-800',
    cardPercent:'.text-xs.font-medium.text-neutral-600',
    cardRoot:   '.w-full'
  };

  // ===== 自定义全局开关（为其他脚本提供）=====
  window.ShowNetTransfer = true;     // 是否展示网络传输
  window.DisableAnimatedMan = false;    // 关闭动画人物
  window.ForceUseSvgFlag = true;       // 强制使用 SVG

  // ===== 工具函数 =====
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const isVisible = (el) => !!el && getComputedStyle(el).display !== 'none';
  const rafThrottle = (fn) => {
    let scheduled = false;
    return (...args) => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        fn(...args);
      });
    };
  };

  // ===== 状态 =====
  let hasClicked = false;
  let anyDivVisible = false;

  // ===== DOM 操作 =====
  function forceBothVisible() {
    const d3 = qs(SEL.div3);
    const d4 = qs(SEL.div4);
    if (d3) d3.style.display = 'block';
    if (d4) d4.style.display = 'block';
  }

  function hideSection() {
    const section = qs(SEL.section);
    if (section) section.style.display = 'none';
  }

  function tryClickButton() {
    const btn = qs(SEL.button);
    if (btn && !hasClicked) {
      btn.click();
      hasClicked = true;
      setTimeout(forceBothVisible, 500);
    }
  }

  const hideDynamicH3 = () => {
    qsa(SEL.h3hide).forEach(el => {
      if (el.textContent.trim() !== '') el.style.display = 'none';
    });
  };

  // ===== 进度条颜色逻辑（基于类覆盖而非内联样式）=====
  function ensureTrafficStyles() {
    if (qs('#traffic-progress-style')) return;
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

  function setBarClass(bar, cls) {
    bar.classList.remove('traffic-progress-normal','traffic-progress-warning','traffic-progress-danger','traffic-progress-critical');
    bar.classList.add(cls);
  }

  function parsePercentFromCard(card) {
    // 优先从特定元素读取；找不到则在卡片文本内兜底匹配
    const el = qs(SEL.cardPercent, card);
    let text = el ? el.textContent : card.textContent;
    const m = text && text.match(/(\d+(?:\.\d+)?)%/);
    return m ? parseFloat(m[1]) : NaN;
  }

  function updateTrafficProgressColors() {
    ensureTrafficStyles();
    const bars = qsa(SEL.progressBar);
    bars.forEach(bar => {
      // 找最近的父卡片
      const card = bar.closest(SEL.cardRoot) || bar.parentElement;
      if (!card) return;
      const pct = parsePercentFromCard(card);
      if (isNaN(pct)) return;

      if (pct >= 100)      setBarClass(bar, 'traffic-progress-critical'); // 灰
      else if (pct >= 90)  setBarClass(bar, 'traffic-progress-danger');   // 红
      else if (pct >= 70)  setBarClass(bar, 'traffic-progress-warning');  // 黄
      else                 setBarClass(bar, 'traffic-progress-normal');   // 绿
    });
  }

  const scheduleUpdateTraffic = rafThrottle(updateTrafficProgressColors);

  // ===== 观察器（带节流）=====
  const onMutate = rafThrottle(() => {
    const d3 = qs(SEL.div3);
    const d4 = qs(SEL.div4);

    const v3 = isVisible(d3);
    const v4 = isVisible(d4);
    const nowAnyVisible = v3 || v4;

    if (nowAnyVisible && !anyDivVisible) {
      hideSection();
      tryClickButton();
    } else if (!nowAnyVisible && anyDivVisible) {
      hasClicked = false; // 允许下次再点一次
    }
    anyDivVisible = nowAnyVisible;

    if (d3 && d4 && (!v3 || !v4)) {
      forceBothVisible();
    }

    hideDynamicH3();
    scheduleUpdateTraffic();
  });

  function attachObserver() {
    const root = qs(SEL.root);
    if (!root) return;
    const observer = new MutationObserver(onMutate);
    observer.observe(root, {
      childList: true,
      attributes: true,
      subtree: true,
      attributeFilter: ['style','class']
    });
  }

  // ===== 初始化 =====
  function init() {
    // 首次执行一次，避免 observer 未触发时状态不一致
    forceBothVisible();
    hideSection();
    hideDynamicH3();
    updateTrafficProgressColors();

    // 延时兜底，针对延迟渲染的组件
    setTimeout(updateTrafficProgressColors, 1000);
    setTimeout(updateTrafficProgressColors, 3000);

    attachObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

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

  return {
    formatFileSize,
    calculatePercentage,
    formatDate,
    safeSetTextContent,
    getHslGradientColor,
    fadeOutIn
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
        const max = cycle.max;
        const from = cycle.from;
        const to = cycle.to;
        const next_update = cycle.next_update ? cycle.next_update[serverId] : undefined;

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



