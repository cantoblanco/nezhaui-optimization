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
