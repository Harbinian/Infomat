const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.ok(
  html.includes('data-permission="guidance:create"'),
  'management guidance create entry should declare guidance:create permission'
);
assert.ok(
  html.includes('applyPermissionControlledActions'),
  'frontend should apply permission-based action visibility'
);
assert.ok(
  html.includes('data-disabled-reason'),
  'visible but unavailable actions should be able to show a disabled reason'
);
assert.ok(
  html.includes('finalResponsiblePerson') && html.includes('currentHandlerPerson'),
  'frontend should reserve separate responsibility labels for final responsible person and current handler'
);
assert.ok(
  html.includes('/api/process-governance/guidance'),
  'frontend should call the guidance business-object API rather than storing guidance in notes'
);

console.log('Person permission frontend contract test passed');
