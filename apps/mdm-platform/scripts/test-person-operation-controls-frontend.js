const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const requiredTokens = [
  'data-permission="guidance:create"',
  'data-permission="guidance:respond"',
  'data-permission="guidance:final_confirm"',
  'data-requires-guidance-state',
  'data-requires-responsibility="finalResponsible"',
  'data-requires-responsibility="currentHandler"',
  'applyGuidanceAffordances',
  'guidanceActions',
  'finalResponsiblePerson',
  'currentHandlerPerson',
  'delegatePerson',
  'executorPerson'
];

for (const token of requiredTokens) {
  assert.ok(html.includes(token), `frontend guidance operation contract missing: ${token}`);
}

assert.ok(!html.includes('window.prompt('), 'guidance actions must not use prompt');

console.log('Person operation controls frontend test passed');
