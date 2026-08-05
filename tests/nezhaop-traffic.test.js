const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDashboard,
  createTrafficDashboard,
  listMarkup
} = require('./helpers/dashboard-dom');

function getListObservers(observerLog) {
  return observerLog.filter(observer => observer.observeHistory.some(({ target }) => (
    target.matches?.('.server-card-list, .server-inline-list')
  )));
}

test('current card and inline layouts render scalar and per-server map cycle data once', async t => {
  const intervalCallbackLog = [];
  const trafficData = {
    scalar: {
      name: 'scalar cycle',
      server_name: { 1: 'card server' },
      transfer: { 1: 512 },
      max: 1024,
      from: '2026-01-01',
      to: '2026-01-31',
      next_update: '2027-01-01T00:00:00Z'
    },
    mapped: {
      name: 'mapped cycle',
      server_name: { 2: 'inline server' },
      transfer: { 2: 1024 },
      max: { 2: 2048 },
      from: { 2: '2026-02-01' },
      to: { 2: '2026-02-28' },
      next_update: { 2: '2028-02-01T00:00:00Z' }
    }
  };
  const dashboard = createTrafficDashboard({
    trafficData,
    trafficConfig: { toggleInterval: 5000 },
    intervalCallbackLog
  });
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();

  const cardRoot = dashboard.document.querySelector('.server-card-list');
  const inlineRoot = dashboard.document.querySelector('.server-inline-list');
  assert.equal(cardRoot.querySelectorAll('[data-nezhaop-cycle-row]').length, 1);
  assert.equal(inlineRoot.querySelectorAll('[data-nezhaop-cycle-row]').length, 1);

  const cardRow = cardRoot.querySelector('[data-nezhaop-cycle-row="1"]');
  const inlineRow = inlineRoot.querySelector('[data-nezhaop-cycle-row="2"]');
  assert.ok(cardRow, 'the card server gets its own marked row');
  assert.ok(inlineRow, 'the inline server gets its own marked row');
  assert.equal(cardRoot.querySelector('.card-transfer-layout').nextElementSibling, cardRow);
  assert.equal(inlineRoot.querySelector('.inline-metric-layout').nextElementSibling, inlineRow);
  assert.equal(inlineRow.nextElementSibling, inlineRoot.querySelector('.inline-plan-layout'));
  assert.equal(cardRow.querySelector('.total-traffic').textContent, '1.00');
  assert.equal(cardRow.querySelector('.total-unit').textContent, 'KB');
  assert.equal(inlineRow.querySelector('.total-traffic').textContent, '2.00');
  assert.equal(inlineRow.querySelector('.total-unit').textContent, 'KB');
  assert.equal(cardRow.querySelector('.from-date').textContent, '2026-01-01');
  assert.equal(inlineRow.querySelector('.to-date').textContent, '2026-02-28');
  assert.equal(cardRow.querySelector('[data-nezhaop-percent]').textContent, '50%');
  assert.equal(inlineRow.querySelector('[data-nezhaop-progress]').style.width, '50%');

  const toggle = intervalCallbackLog.find(entry => entry.delay === 5000);
  assert.ok(toggle, 'cycle detail rotation remains enabled');
  toggle.callback();
  toggle.callback();
  await dashboard.settle();
  assert.match(cardRow.querySelector('.time-info').textContent, /2027/);
  assert.match(inlineRow.querySelector('.time-info').textContent, /2028/);
});

test('percentage is clamped and a nested card mutation updates the row in place once', async t => {
  const fetchLog = [];
  const trafficData = {
    cycle: {
      server_name: { 1: 'card server' },
      transfer: { 1: 200 },
      max: 100,
      from: '2026-03-01',
      to: '2026-03-31'
    }
  };
  const dashboard = createTrafficDashboard({
    lists: [{ layout: 'card', servers: ['card server'] }],
    trafficData,
    fetchLog
  });
  t.after(() => dashboard.close());
  let now = 0;
  dashboard.window.Date.now = () => (now += 700000);

  dashboard.evaluate();
  await dashboard.settle();
  const root = dashboard.document.querySelector('.server-card-list');
  const row = root.querySelector('[data-nezhaop-cycle-row="1"]');
  assert.equal(row.querySelector('[data-nezhaop-percent]').textContent, '100%');
  assert.equal(row.querySelector('[data-nezhaop-progress]').style.width, '100%');
  assert.ok(row.querySelector('[data-nezhaop-progress]').classList.contains('traffic-progress-critical'));

  const fetchCount = fetchLog.length;
  trafficData.cycle.transfer[1] = -50;
  const heading = root.querySelector('.server-heading-layout');
  heading.append(dashboard.document.createElement('span'));
  heading.append(dashboard.document.createElement('span'));
  await dashboard.settle();

  assert.equal(fetchLog.length - fetchCount, 1, 'simultaneous mutation signals are throttled to one reconciliation');
  assert.equal(root.querySelector('[data-nezhaop-cycle-row="1"]'), row);
  assert.equal(root.querySelectorAll('[data-nezhaop-cycle-row="1"]').length, 1);
  assert.equal(row.querySelector('[data-nezhaop-percent]').textContent, '0%');
  assert.equal(row.querySelector('[data-nezhaop-progress]').style.width, '0%');
  assert.ok(row.querySelector('[data-nezhaop-progress]').classList.contains('traffic-progress-normal'));
});

test('all current and future list roots are observed and stale roots are disconnected', async t => {
  const observerLog = [];
  const dashboard = createTrafficDashboard({ observerLog });
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();

  const cardRoot = dashboard.document.querySelector('.server-card-list');
  const inlineRoot = dashboard.document.querySelector('.server-inline-list');
  let listObservers = getListObservers(observerLog);
  assert.equal(listObservers.length, 2);
  for (const observer of listObservers) {
    const record = observer.observeHistory.find(({ target }) => target === cardRoot || target === inlineRoot);
    assert.deepEqual(record.options, { childList: true, subtree: true });
  }

  const cardObserver = listObservers.find(observer => (
    observer.observeHistory.some(({ target }) => target === cardRoot)
  ));
  const inlineObserver = listObservers.find(observer => (
    observer.observeHistory.some(({ target }) => target === inlineRoot)
  ));
  cardRoot.remove();
  await dashboard.settle();
  assert.ok(cardObserver.disconnectCount > 0, 'the detached card root observer is disconnected');
  assert.equal(inlineObserver.disconnectCount, 0, 'the still-current inline root remains observed');

  const template = dashboard.document.createElement('template');
  template.innerHTML = listMarkup({ layout: 'card', servers: ['future server'] }).trim();
  const futureRoot = template.content.firstElementChild;
  dashboard.document.querySelector('main').append(futureRoot);
  await dashboard.settle();

  listObservers = getListObservers(observerLog);
  const futureObserver = listObservers.find(observer => (
    observer.observeHistory.some(({ target }) => target === futureRoot)
  ));
  assert.ok(futureObserver, 'a root added after startup is observed immediately');
  assert.deepEqual(futureObserver.observeHistory.at(-1).options, { childList: true, subtree: true });

  const replacementMain = dashboard.document.createElement('main');
  replacementMain.innerHTML = listMarkup({ layout: 'inline', servers: ['replacement server'] });
  dashboard.document.querySelector('main').replaceWith(replacementMain);
  const replacementRoot = replacementMain.querySelector('.server-inline-list');
  await dashboard.settle();

  const replacementObserver = getListObservers(observerLog).find(observer => (
    observer.observeHistory.some(({ target }) => target === replacementRoot)
  ));
  assert.ok(replacementObserver, 'a list inside a replaced main root is detected');
  assert.ok(inlineObserver.disconnectCount > 0, 'list observers from the replaced main root are disconnected');
  assert.ok(futureObserver.disconnectCount > 0, 'all other stale list observers are disconnected too');

  dashboard.window.__NEZHAOP_RUNTIME__.stop();
  assert.ok(replacementObserver.disconnectCount > 0, 'runtime.stop disconnects the final current list observer');
});

test('showTrafficStats=false removes an existing script-owned cycle row', async t => {
  const dashboard = createTrafficDashboard({
    lists: [{ layout: 'card', servers: ['card server'] }],
    trafficData: {
      cycle: {
        server_name: { 1: 'card server' },
        transfer: { 1: 10 },
        max: 100,
        from: '2026-04-01',
        to: '2026-04-30'
      }
    }
  });
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();
  assert.equal(dashboard.document.querySelectorAll('[data-nezhaop-cycle-row]').length, 1);

  dashboard.window.TrafficScriptConfig.showTrafficStats = false;
  await dashboard.settle(125);
  assert.equal(dashboard.document.querySelectorAll('[data-nezhaop-cycle-row]').length, 0);
});

test('runtime.stop invalidates and aborts a delayed traffic request before it can render', async t => {
  let resolveFetch;
  const fetchOptionsLog = [];
  const delayedResponse = new Promise(resolve => {
    resolveFetch = resolve;
  });
  const dashboard = createTrafficDashboard({
    lists: [{ layout: 'card', servers: ['card server'] }],
    fetchResponse: () => delayedResponse,
    fetchOptionsLog
  });
  t.after(() => dashboard.close());

  dashboard.evaluate();
  dashboard.window.__NEZHAOP_RUNTIME__.stop();
  resolveFetch({
    data: {
      cycle_transfer_stats: {
        delayed: {
          server_name: { 1: 'card server' },
          transfer: { 1: 50 },
          max: 100,
          from: '2026-05-01',
          to: '2026-05-31'
        }
      }
    }
  });
  await dashboard.settle();

  assert.equal(dashboard.document.querySelectorAll('[data-nezhaop-cycle-row]').length, 0);
  assert.equal(fetchOptionsLog.length, 1);
  assert.equal(fetchOptionsLog[0].signal.aborted, true);
});

test('a newer traffic request generation cannot be overwritten by an older delayed response', async t => {
  const resolvers = [];
  const fetchOptionsLog = [];
  const dashboard = createTrafficDashboard({
    lists: [{ layout: 'card', servers: ['card server'] }],
    fetchResponse: () => new Promise(resolve => resolvers.push(resolve)),
    fetchOptionsLog
  });
  t.after(() => dashboard.close());

  dashboard.evaluate();
  assert.equal(resolvers.length, 1);
  dashboard.document.querySelector('.server-heading-layout')
    .append(dashboard.document.createElement('span'));
  await dashboard.settle();
  assert.equal(resolvers.length, 2);
  assert.equal(fetchOptionsLog[0].signal.aborted, true);

  const response = transfer => ({
    data: {
      cycle_transfer_stats: {
        generation: {
          server_name: { 1: 'card server' },
          transfer: { 1: transfer },
          max: 100,
          from: '2026-06-01',
          to: '2026-06-30'
        }
      }
    }
  });
  resolvers[1](response(80));
  await dashboard.settle();
  const row = dashboard.document.querySelector('[data-nezhaop-cycle-row="1"]');
  assert.equal(row.querySelector('[data-nezhaop-percent]').textContent, '80%');

  resolvers[0](response(10));
  await dashboard.settle();
  assert.equal(dashboard.document.querySelector('[data-nezhaop-cycle-row="1"]'), row);
  assert.equal(row.querySelector('[data-nezhaop-percent]').textContent, '80%');
});

test('an externally removed managed row is restored once without a fetch storm', async t => {
  const fetchLog = [];
  const dashboard = createTrafficDashboard({
    lists: [{ layout: 'card', servers: ['card server'] }],
    trafficData: {
      cycle: {
        server_name: { 1: 'card server' },
        transfer: { 1: 25 },
        max: 100,
        from: '2026-07-01',
        to: '2026-07-31'
      }
    },
    fetchLog
  });
  t.after(() => dashboard.close());
  let now = 0;
  dashboard.window.Date.now = () => (now += 700000);

  dashboard.evaluate();
  await dashboard.settle();
  const removedRow = dashboard.document.querySelector('[data-nezhaop-cycle-row="1"]');
  const fetchCount = fetchLog.length;
  removedRow.remove();
  await dashboard.settle(50);

  const rows = dashboard.document.querySelectorAll('[data-nezhaop-cycle-row="1"]');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0], removedRow);
  assert.equal(fetchLog.length - fetchCount, 1);
  await dashboard.settle(50);
  assert.equal(fetchLog.length - fetchCount, 1, 'restoring the script-owned row does not retrigger reconciliation');
  assert.equal(dashboard.document.querySelectorAll('[data-nezhaop-cycle-row="1"]').length, 1);
});

test('embedded detail mode starts no traffic fetches, intervals, or list observers', async t => {
  const fetchLog = [];
  const intervalLog = [];
  const observerLog = [];
  const dashboard = createDashboard({
    url: 'https://dashboard.example/server/1?nezhaop_view=detail',
    extraMarkup: listMarkup({ layout: 'card', servers: ['embedded decoy'] }),
    fetchLog,
    intervalLog,
    observerLog
  });
  t.after(() => dashboard.close());

  dashboard.evaluate();
  await dashboard.settle();

  assert.deepEqual(fetchLog, []);
  assert.deepEqual(intervalLog, []);
  assert.deepEqual(getListObservers(observerLog), []);
});
