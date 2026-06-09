const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.ok(html.includes('data-tab="processGovernance"'), 'process governance tab should exist');
assert.ok(html.includes('id="processGovernancePanel"'), 'process governance panel should exist');
assert.ok(html.includes('/api/process-governance/sankey'), 'process governance sankey API should be called');
assert.ok(html.includes('/api/process-governance/a1'), 'process governance A1 API should be called');
assert.ok(html.includes('/api/process-governance/cross-dept'), 'process governance risk API should be called');
assert.ok(html.includes('/api/process-governance/quality'), 'process governance quality API should be called');
assert.ok(html.includes('function renderProcessGovernance()'), 'process governance renderer should exist');
assert.ok(html.includes('function renderProcessGovernanceSankey(data)'), 'process governance sankey renderer should exist');
assert.ok(html.includes('id="pgQualityRows"'), 'process governance should render quality finding rows');
assert.ok(html.includes('id="pgQualitySeverityFilter"'), 'process governance should expose quality severity filter');
assert.ok(html.includes('id="pgQualityAreaFilter"'), 'process governance should expose quality area filter');
assert.ok(html.includes('id="pgMetricQualityBlock"'), 'process governance should show BLOCK quality metric');
assert.ok(html.includes('docs/organization/组织架构和部门职责.md'), 'process governance should show the current organization source path');
assert.ok(html.includes('docs/norms/{部门}部门-能力-流程-系统映射关系.md'), 'process governance should show the process source path');
assert.ok(html.includes('function renderProcessGovernanceQuality'), 'process governance should render quality findings');
assert.ok(
  html.includes('qualityView: query.view') && html.includes('finding: query.finding'),
  'process governance should understand quality deep links'
);
assert.ok(html.includes('id="pgDeptFilters"'), 'process governance should expose department tag filters');
assert.ok(html.includes('pgSelectedDept'), 'process governance should track selected department scope');
assert.ok(html.includes('function renderProcessGovernanceDeptTags'), 'process governance should render department tags');
assert.ok(html.includes('function filterProcessGovernanceSankeyByDept'), 'process governance sankey should support department filtering');
assert.ok(html.includes('data-pg-dept'), 'department tags should use stable department attributes');
assert.ok(
  html.includes('processGovernanceA1MatchesDept(row, dept.name)'),
  'department tag counts should use the same A1 matching rule as department filtering'
);
assert.ok(
  html.includes("String(row.input_source_dept || '').includes(deptName)") &&
  html.includes("String(row.output_target_dept || '').includes(deptName)"),
  'department A1 matching should include multi-department input/output fields'
);
assert.ok(
  html.includes("document.getElementById('pgMetricA1').textContent = a1Rows.length") &&
  html.includes("document.getElementById('pgMetricL3').textContent = selectedL3Count") &&
  html.includes("document.getElementById('pgMetricCross').textContent = riskRows.length"),
  'process governance metrics should use the same filtered rows as the detail tables'
);
assert.ok(html.includes('function renderRouteFromHash'), 'app should render the current hash route after session restore');
assert.ok(html.includes('renderRouteFromHash();'), 'session restore should honor direct process governance links');
assert.ok(!html.includes('承载最多'), 'frontend copy should avoid evaluative system wording');
assert.ok(!html.includes('系统最忙'), 'frontend copy should avoid evaluative system wording');
assert.ok(!html.includes('主用系统'), 'frontend copy should avoid evaluative system wording');

console.log('Process governance frontend hook test passed');
