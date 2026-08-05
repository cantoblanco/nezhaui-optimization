const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('nezhaop.js', 'utf8');

assert.match(
  source,
  /server-info-tab/,
  'network tab selection should use the stable .server-info-tab wrapper'
);

assert.doesNotMatch(
  source,
  /max-w-\\\[200px\\\]|py-\\\[8px\\\]|font-\\\[600\\\]/,
  'network tab selection should not depend on old exact Tailwind classes'
);

assert.doesNotMatch(
  source,
  /div:nth-child\(3\)|div:nth-child\(4\)/,
  'detail/network panels should not depend on old child indexes'
);

assert.match(
  source,
  /function\s+pickCycleValue/,
  'cycle traffic fields should support scalar and per-server map values'
);

assert.match(source, /__NEZHAOP_RUNTIME__/, 'the browser file should expose a global runtime guard');
assert.match(source, /data-nezhaop-detail-frame/, 'the detail iframe should have a stable data marker');
assert.match(source, /data-nezhaop-style/, 'injected runtime styles should have a stable data marker');
assert.match(source, /nezhaop_view/, 'the embedded Detail URL should use a query marker');

assert.doesNotMatch(
  source,
  /function\s+(?:getServerInfoPanels|forceBothVisible|tryClickNetworkTab)/,
  'obsolete dual-panel helpers should be removed'
);
