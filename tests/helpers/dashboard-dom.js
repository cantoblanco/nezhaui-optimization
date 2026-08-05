const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const scriptSource = fs.readFileSync(path.join(__dirname, '..', '..', 'nezhaop.js'), 'utf8');

function detailPage({ legacy = false } = {}) {
  const charts = legacy
    ? `
      <div class="detail-panel"><section class="server-charts" data-view="detail">detail chart</section></div>
      <div class="network-panel" style="display:none">network chart</div>`
    : '<section class="detail-panel"><section class="server-charts" data-view="detail">detail chart</section></section>';

  return `<!doctype html>
    <html>
      <head></head>
      <body>
        <div id="root">
          <main>
            <div class="app-header-root">
              <section class="header-top">dashboard header</section>
              <section class="header-timer">dashboard timer</section>
            </div>
            <div class="server-info">
              <div class="overview-root">
                <div class="server-name">server one</div>
                <section class="overview-metrics">status and metrics</section>
              </div>
              <section class="tabs-section">
                <div class="server-info-tab">
                  <button class="cursor-pointer" data-tab="detail">Detail</button>
                  <button class="cursor-pointer" data-tab="network">Network</button>
                </div>
              </section>
              ${charts}
            </div>
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
    resizeLog = []
  } = options;
  const dom = new JSDOM(detailPage({ legacy }), {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;

  window.fetch = async () => ({ json: async () => ({ data: { cycle_transfer_stats: {} } }) });

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
  window.setInterval = (callback, delay, ...args) => {
    const id = nativeSetInterval(callback, delay, ...args);
    intervalLog.push(id);
    return id;
  };

  const networkTab = window.document.querySelector('[data-tab="network"]');
  let networkClicks = 0;
  networkTab.addEventListener('click', () => {
    networkClicks += 1;
    if (legacy) return;
    const charts = window.document.querySelector('.server-charts');
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
