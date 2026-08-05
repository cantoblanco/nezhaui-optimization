const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const scriptSource = fs.readFileSync(path.join(__dirname, '..', '..', 'nezhaop.js'), 'utf8');

function serverInfoMarkup({ legacy = false, view = 'detail' } = {}) {
  const content = legacy
    ? `
      <div class="detail-panel" style="display:${view === 'detail' ? 'block' : 'none'}"><section class="server-charts" data-view="detail">detail chart</section></div>
      <div class="network-panel" style="display:${view === 'network' ? 'block' : 'none'}">network chart</div>`
    : view === 'detail'
      ? '<section class="detail-panel"><section class="server-charts" data-view="detail">detail chart</section></section>'
      : '<div class="network-panel">network chart</div>';

  return `
    <div class="server-info" data-frontend="${legacy ? 'legacy' : 'current'}" style="gap:16px;max-width:1024px">
      <div class="overview-root">
        <div class="server-name">server one</div>
        <section class="overview-metrics">status and metrics</section>
      </div>
      <section class="tabs-section">
        <div class="server-info-tab">
          <div class="tab-track">
            <div class="relative cursor-pointer" data-tab="detail"><div><p>Detail</p></div></div>
            <div class="relative cursor-pointer" data-tab="network"><div><p>Network</p></div></div>
          </div>
        </div>
      </section>
      ${content}
    </div>`;
}

function detailPage({ legacy = false } = {}) {

  return `<!doctype html>
    <html>
      <head></head>
      <body>
        <div id="root">
          <main class="app-main" style="min-height:800px;padding:40px">
            <div class="app-header-root">
              <section class="header-top">dashboard header</section>
              <section class="header-timer">dashboard timer</section>
            </div>
            ${serverInfoMarkup({ legacy })}
          </main>
        </div>
        <footer>dashboard footer</footer>
      </body>
    </html>`;
}

function createDashboard(options = {}) {
  const {
    url = 'https://dashboard.example/server/1',
    legacy = false,
    observerLog = [],
    intervalLog = [],
    resizeLog = [],
    fetchLog = []
  } = options;
  const dom = new JSDOM(detailPage({ legacy }), {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;

  window.fetch = async url => {
    fetchLog.push(url);
    return { json: async () => ({ data: { cycle_transfer_stats: {} } }) };
  };

  const NativeMutationObserver = window.MutationObserver;
  window.MutationObserver = class TrackedMutationObserver extends NativeMutationObserver {
    constructor(callback) {
      super(callback);
      observerLog.push(this);
    }
  };

  window.ResizeObserver = class TrackedResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      resizeLog.push(this);
    }

    observe(target) {
      this.targets.add(target);
    }

    disconnect() {
      this.targets.clear();
    }
  };

  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const activeIntervals = new Set();
  window.setInterval = (callback, delay, ...args) => {
    const id = nativeSetInterval(callback, delay, ...args);
    intervalLog.push(id);
    activeIntervals.add(id);
    return id;
  };
  window.clearInterval = id => {
    activeIntervals.delete(id);
    return nativeClearInterval(id);
  };

  let networkClicks = 0;
  window.document.addEventListener('click', event => {
    const networkTab = event.target.closest('[data-tab="network"]');
    if (!networkTab) return;
    networkClicks += 1;
    const info = networkTab.closest('.server-info');
    if (info.dataset.frontend === 'legacy') {
      info.querySelector('.detail-panel').style.display = 'none';
      info.querySelector('.network-panel').style.display = 'block';
      return;
    }
    const charts = info.querySelector('.server-charts');
    if (charts) {
      const networkRoot = window.document.createElement('div');
      networkRoot.className = 'network-panel';
      networkRoot.textContent = 'network chart';
      charts.closest('.detail-panel').replaceWith(networkRoot);
    }
  });

  return {
    dom,
    window,
    document: window.document,
    evaluate() {
      return window.eval(scriptSource);
    },
    getNetworkClicks() {
      return networkClicks;
    },
    getActiveIntervalCount() {
      return activeIntervals.size;
    },
    replaceServerInfo(replacement = {}) {
      const template = window.document.createElement('template');
      template.innerHTML = serverInfoMarkup({ legacy, ...replacement }).trim();
      const nextInfo = template.content.firstElementChild;
      window.document.querySelector('.server-info').replaceWith(nextInfo);
      return nextInfo;
    },
    triggerResize() {
      resizeLog.forEach(observer => {
        if (observer.targets.size) observer.callback([]);
      });
    },
    async settle() {
      await new Promise(resolve => window.setTimeout(resolve, 25));
    },
    close() {
      window.dispatchEvent(new window.Event('beforeunload'));
      window.close();
    }
  };
}

function sendDetailReady(dashboard, frame, height = 640) {
  const { window } = dashboard;
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { type: 'nezhaop:detail-ready', height },
    origin: window.location.origin,
    source: frame.contentWindow
  }));
}

module.exports = {
  createDashboard,
  sendDetailReady
};
