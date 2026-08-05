const test = require('node:test');
const assert = require('node:assert/strict');
const { createDashboard, sendDetailReady } = require('./helpers/dashboard-dom');

test('current parent waits for embedded Detail readiness before selecting Network', async t => {
  const dashboard = createDashboard();
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();

  const frame = dashboard.document.querySelector('iframe[data-nezhaop-detail-frame]');
  assert.ok(frame, 'a current single-mounted detail page gets an embedded Detail frame');
  const info = dashboard.document.querySelector('.server-info');
  const tabSection = dashboard.document.querySelector('.tabs-section');
  const detailPanel = dashboard.document.querySelector('.detail-panel');
  assert.equal(frame.parentElement, info);
  assert.ok(tabSection.compareDocumentPosition(frame) & dashboard.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(frame.compareDocumentPosition(detailPanel) & dashboard.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(new URL(frame.src).searchParams.get('nezhaop_view'), 'detail');
  assert.equal(dashboard.getNetworkClicks(), 0, 'Network remains untouched while the child is pending');
  assert.notEqual(dashboard.document.querySelector('.tabs-section').style.display, 'none');
  assert.equal(frame.hidden, true);

  sendDetailReady(dashboard, frame, 640);
  await dashboard.settle();

  assert.equal(dashboard.getNetworkClicks(), 1);
  assert.ok(dashboard.document.querySelector('.network-panel'));
  assert.equal(dashboard.document.querySelector('.server-charts'), null);
  assert.equal(dashboard.document.querySelector('.tabs-section').style.display, 'none');
  assert.equal(frame.hidden, false);
  assert.equal(frame.style.height, '640px');
});

test('embedded detail marker prevents recursion, hides chrome, and reports readiness', async t => {
  const dashboard = createDashboard({
    url: 'https://dashboard.example/server/1?foo=bar&nezhaop_view=detail'
  });
  t.after(() => dashboard.close());
  const messages = [];
  dashboard.window.postMessage = message => messages.push(message);
  Object.defineProperty(dashboard.document.documentElement, 'scrollHeight', { value: 900 });
  Object.defineProperty(dashboard.document.querySelector('.detail-panel'), 'scrollHeight', { value: 321 });

  dashboard.evaluate();
  await dashboard.settle();

  assert.equal(dashboard.document.querySelectorAll('iframe[data-nezhaop-detail-frame]').length, 0);
  assert.equal(dashboard.getNetworkClicks(), 0, 'the child remains on the default Detail view');
  for (const selector of ['.app-header-root', '.overview-root', '.server-info-tab', 'footer']) {
    assert.equal(dashboard.document.querySelector(selector).style.display, 'none', `${selector} is hidden`);
  }
  assert.notEqual(dashboard.document.querySelector('.detail-panel').style.display, 'none');
  const readyMessage = messages.find(message => message.type === 'nezhaop:detail-ready');
  assert.equal(readyMessage.height, 321, 'height is based on the tight Detail wrapper, not viewport whitespace');
  const embeddedCss = dashboard.document.querySelector('style[data-nezhaop-style="detail-frame"]').textContent;
  assert.match(embeddedCss, /html\[data-nezhaop-view="detail"\]\s+main/);
  assert.match(embeddedCss, /html\[data-nezhaop-view="detail"\]\s+\.server-info/);

  const messageCount = messages.length;
  dashboard.triggerResize();
  await dashboard.settle();
  assert.ok(messages.length > messageCount, 'a resized Detail view reports a fresh height');
});

test('embedded detail child does not start the home traffic subsystem', async t => {
  const fetchLog = [];
  const intervalLog = [];
  const dashboard = createDashboard({
    url: 'https://dashboard.example/server/1?nezhaop_view=detail',
    fetchLog,
    intervalLog
  });
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();

  assert.deepEqual(fetchLog, []);
  assert.deepEqual(intervalLog, []);
  assert.ok(dashboard.window.__NEZHAOP_RUNTIME__);
  assert.equal(dashboard.document.documentElement.dataset.nezhaopView, 'detail');
});

test('current parent remains usable until both child Detail and Network control are ready', async t => {
  const dashboard = createDashboard();
  t.after(() => dashboard.close());
  const networkTab = dashboard.document.querySelector('[data-tab="network"]');
  networkTab.remove();

  dashboard.evaluate();
  await dashboard.settle();
  const frame = dashboard.document.querySelector('iframe[data-nezhaop-detail-frame]');
  sendDetailReady(dashboard, frame, 480);
  await dashboard.settle();

  assert.notEqual(dashboard.document.querySelector('.tabs-section').style.display, 'none');
  assert.equal(frame.hidden, true);
  assert.equal(dashboard.getNetworkClicks(), 0);

  dashboard.document.querySelector('.server-info-tab').append(networkTab);
  await dashboard.settle();
  assert.equal(dashboard.getNetworkClicks(), 1);
  assert.equal(frame.hidden, false);
});

test('parent rejects readiness messages from the wrong origin or source', async t => {
  const dashboard = createDashboard();
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();
  const frame = dashboard.document.querySelector('iframe[data-nezhaop-detail-frame]');
  const message = { type: 'nezhaop:detail-ready', height: 777 };

  dashboard.window.dispatchEvent(new dashboard.window.MessageEvent('message', {
    data: message,
    origin: 'https://attacker.example',
    source: frame.contentWindow
  }));
  dashboard.window.dispatchEvent(new dashboard.window.MessageEvent('message', {
    data: message,
    origin: dashboard.window.location.origin,
    source: dashboard.window
  }));
  await dashboard.settle();

  assert.equal(dashboard.getNetworkClicks(), 0);
  assert.equal(frame.hidden, true);
  assert.equal(frame.style.height, '');
});

test('repeated evaluation reuses one guarded runtime without duplicate resources', async t => {
  const observerLog = [];
  const intervalLog = [];
  const dashboard = createDashboard({ observerLog, intervalLog });
  t.after(() => dashboard.close());

  assert.doesNotThrow(() => dashboard.evaluate());
  await dashboard.settle();
  const runtime = dashboard.window.__NEZHAOP_RUNTIME__;
  const observerCount = observerLog.length;
  const intervalCount = intervalLog.length;

  assert.doesNotThrow(() => dashboard.evaluate());
  await dashboard.settle();

  assert.equal(dashboard.window.__NEZHAOP_RUNTIME__, runtime);
  assert.equal(observerLog.length, observerCount);
  assert.equal(intervalLog.length, intervalCount);
  assert.equal(dashboard.document.querySelectorAll('iframe[data-nezhaop-detail-frame]').length, 1);
  assert.equal(dashboard.document.querySelectorAll('style[data-nezhaop-style]').length, 1);
});

test('public stop clears all resources and allows a clean reevaluation', async t => {
  const dashboard = createDashboard();
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();
  const firstRuntime = dashboard.window.__NEZHAOP_RUNTIME__;
  const intervalCount = dashboard.getActiveIntervalCount();
  assert.ok(intervalCount > 0);

  firstRuntime.stop();
  assert.equal(dashboard.getActiveIntervalCount(), 0);
  assert.equal(dashboard.document.querySelectorAll('iframe[data-nezhaop-detail-frame]').length, 0);
  assert.equal(dashboard.document.querySelectorAll('style[data-nezhaop-style]').length, 0);

  dashboard.evaluate();
  await dashboard.settle();
  const secondRuntime = dashboard.window.__NEZHAOP_RUNTIME__;
  assert.notEqual(secondRuntime, firstRuntime);
  assert.equal(dashboard.getActiveIntervalCount(), intervalCount);
  assert.equal(dashboard.document.querySelectorAll('iframe[data-nezhaop-detail-frame]').length, 1);
  assert.equal(dashboard.document.querySelectorAll('style[data-nezhaop-style]').length, 1);
});

test('legacy dual-mounted frontend reveals both panels without an iframe', async t => {
  const dashboard = createDashboard({ legacy: true });
  t.after(() => dashboard.close());
  const networkTab = dashboard.document.querySelector('[data-tab="network"]');
  assert.equal(networkTab.tagName, 'DIV');
  assert.ok(networkTab.parentElement.classList.contains('tab-track'));

  dashboard.evaluate();
  await dashboard.settle();

  assert.equal(dashboard.document.querySelectorAll('iframe[data-nezhaop-detail-frame]').length, 0);
  assert.equal(dashboard.document.querySelector('.tabs-section').style.display, 'none');
  assert.equal(dashboard.getNetworkClicks(), 1);
  assert.equal(dashboard.document.querySelector('.detail-panel').style.display, 'block');
  assert.equal(dashboard.document.querySelector('.network-panel').style.display, 'block');

  dashboard.document.querySelector('.server-info').append(dashboard.document.createTextNode('changed'));
  await dashboard.settle();
  assert.equal(dashboard.getNetworkClicks(), 1, 'repeated scans do not click Network again');
});

test('client-side route changes remove stale frames and initialize the new server route', async t => {
  const dashboard = createDashboard();
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();
  const firstFrame = dashboard.document.querySelector('iframe[data-nezhaop-detail-frame]');
  sendDetailReady(dashboard, firstFrame, 500);
  await dashboard.settle();
  assert.equal(dashboard.document.querySelector('.tabs-section').style.display, 'none');

  dashboard.window.history.pushState({}, '', '/server/2');
  dashboard.replaceServerInfo({ view: 'network' });
  await dashboard.settle();
  const secondFrame = dashboard.document.querySelector('iframe[data-nezhaop-detail-frame]');

  assert.equal(firstFrame.isConnected, false);
  assert.ok(secondFrame);
  assert.notEqual(secondFrame, firstFrame);
  assert.match(secondFrame.src, /\/server\/2/);
  assert.equal(new URL(secondFrame.src).searchParams.get('nezhaop_view'), 'detail');
  assert.notEqual(dashboard.document.querySelector('.tabs-section').style.display, 'none');
  assert.equal(secondFrame.hidden, true, 'the new route waits for its own child Detail readiness');
  assert.equal(dashboard.getNetworkClicks(), 1, 'the new route is not switched before child readiness');

  dashboard.window.history.pushState({}, '', '/');
  await dashboard.settle();
  assert.equal(dashboard.document.querySelectorAll('iframe[data-nezhaop-detail-frame]').length, 0);
});

test('same-route server-info remount replaces pending state with exactly one current frame', async t => {
  const dashboard = createDashboard();
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();
  const firstFrame = dashboard.document.querySelector('iframe[data-nezhaop-detail-frame]');
  const nextInfo = dashboard.replaceServerInfo({ view: 'detail' });
  await dashboard.settle();

  const frames = dashboard.document.querySelectorAll('iframe[data-nezhaop-detail-frame]');
  assert.equal(firstFrame.isConnected, false);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].closest('.server-info'), nextInfo);
  assert.equal(dashboard.window.__NEZHAOP_RUNTIME__.detail.info, nextInfo);
  assert.equal(frames[0].hidden, true);
});

test('leaving a legacy detail route restores the frontend panel display state', async t => {
  const dashboard = createDashboard({ legacy: true });
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();
  assert.equal(dashboard.document.querySelector('.network-panel').style.display, 'block');

  dashboard.window.history.pushState({}, '', '/');
  await dashboard.settle();
  assert.equal(dashboard.document.querySelector('.detail-panel').style.display, 'block');
  assert.equal(dashboard.document.querySelector('.network-panel').style.display, 'none');
});
