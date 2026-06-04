const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.ok(html.includes('data-tab="processGovernance"'), 'process governance tab should exist');
assert.ok(html.includes('id="processGovernancePanel"'), 'process governance panel should exist');
assert.ok(html.includes('/api/process-governance/sankey'), 'process governance sankey API should be called');
assert.ok(html.includes('/api/process-governance/a1'), 'process governance A1 API should be called');
assert.ok(html.includes('/api/process-governance/cross-dept'), 'process governance risk API should be called');
assert.ok(html.includes('function renderProcessGovernance()'), 'process governance renderer should exist');
assert.ok(html.includes('function renderProcessGovernanceSankey(data)'), 'process governance sankey renderer should exist');
assert.ok(!html.includes('承载最多'), 'frontend copy should avoid evaluative system wording');
assert.ok(!html.includes('系统最忙'), 'frontend copy should avoid evaluative system wording');
assert.ok(!html.includes('主用系统'), 'frontend copy should avoid evaluative system wording');

console.log('Process governance frontend hook test passed');
