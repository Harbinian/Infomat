const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const requiredTokens = [
  'id="pgGuidanceList"',
  'id="pgGuidanceDetailPanel"',
  'id="pgGuidanceEventTimeline"',
  'id="pgGuidancePersonPicker"',
  'id="pgGuidanceDelegateForm"',
  'id="pgGuidanceExecutorForm"',
  'id="pgGuidanceDisabledReason"',
  '/api/org/persons/assignable',
  '/api/process-governance/guidance/',
  'assign-executor',
  'delegations/',
  'renderGuidanceWorkspace',
  'loadGuidanceEvents',
  'loadAssignableGuidancePersons',
  'assignGuidanceExecutor',
  'revokeGuidanceDelegation'
];

for (const token of requiredTokens) {
  assert.ok(html.includes(token), `guidance workspace frontend missing token: ${token}`);
}

assert.ok(!html.includes('window.prompt('), 'guidance workspace must not use prompt');

console.log('Guidance workspace frontend test passed');
