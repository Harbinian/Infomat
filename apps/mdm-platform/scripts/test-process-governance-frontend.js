const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.ok(html.includes('data-tab="processGovernance"'), 'process governance tab should exist');
assert.ok(html.includes('id="processGovernancePanel"'), 'process governance panel should exist');
assert.ok(html.includes('/api/process-governance/sankey'), 'process governance sankey API should be called');
assert.ok(html.includes('/api/process-governance/a1'), 'process governance A1 API should be called');
assert.ok(html.includes('/api/process-governance/cross-dept'), 'process governance risk API should be called');
assert.ok(html.includes('/api/process-governance/quality'), 'process governance quality API should be called');
assert.ok(html.includes('/api/process-governance/quality-cases'), 'process governance quality cases API should be called');
assert.ok(html.includes('/api/process-governance/mapping-workspace'), 'process governance mapping workspace API should be called');
assert.ok(html.includes('/api/process-governance/mapping-todos'), 'process governance mapping todos API should be called');
assert.ok(html.includes('function renderProcessGovernance()'), 'process governance renderer should exist');
assert.ok(html.includes('function renderProcessGovernanceSankey(data)'), 'process governance sankey renderer should exist');
assert.ok(html.includes('id="pgQualityRows"'), 'process governance should render quality finding rows');
assert.ok(html.includes('id="pgQualityCaseRows"'), 'process governance should render governance case rows');
assert.ok(html.includes('id="pgMappingWorkspaceRows"'), 'process governance should render mapping workspace rows');
assert.ok(html.includes('id="pgMappingTodoRows"'), 'process governance should render mapping todo rows');
assert.ok(html.includes('id="pgQualitySeverityFilter"'), 'process governance should expose quality severity filter');
assert.ok(html.includes('id="pgQualityAreaFilter"'), 'process governance should expose quality area filter');
assert.ok(html.includes('id="pgQualityCaseStatusFilter"'), 'process governance should expose quality case status filter');
assert.ok(html.includes('id="pgQualityCaseOwnerFilter"'), 'process governance should expose quality case owner filter');
assert.ok(html.includes('id="pgMappingTodoTypeFilter"'), 'process governance should expose mapping todo type filter');
assert.ok(html.includes('id="pgMappingTodoStatusFilter"'), 'process governance should expose mapping todo status filter');
assert.ok(html.includes('id="pgMetricQualityBlock"'), 'process governance should show BLOCK quality metric');
assert.ok(html.includes('id="pgMetricQualityCaseOpen"'), 'process governance should show open quality case metric');
assert.ok(html.includes('id="pgMetricMappingRecords"'), 'process governance should show mapping workspace metric');
assert.ok(html.includes('id="pgMetricMappingTodos"'), 'process governance should show mapping todo metric');
assert.ok(html.includes('docs/organization/组织架构和部门职责.md'), 'process governance should show the current organization source path');
assert.ok(html.includes('docs/norms/{部门}部门-能力-流程-系统映射关系.md'), 'process governance should show the process source path');
assert.ok(html.includes('function renderProcessGovernanceQuality'), 'process governance should render quality findings');
assert.ok(html.includes('function renderProcessGovernanceQualityCases'), 'process governance should render quality cases');
assert.ok(html.includes('function renderProcessGovernanceMappingWorkspace'), 'process governance should render mapping workspace');
assert.ok(html.includes('function renderProcessGovernanceMappingTodos'), 'process governance should render mapping todos');
assert.ok(html.includes('回源文件整改后重新导入'), 'process governance should guide users back to source files instead of editing docs/norms in MDM');
assert.ok(
  html.includes('qualityView: query.view') && html.includes('finding: query.finding') && html.includes('caseId: query.case') && html.includes('mappingTodoId: query.todo'),
  'process governance should understand quality and mapping deep links'
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
assert.ok(html.includes('function pruneProcessGovernanceSankeyToCapability'), 'process governance sankey should prune non-capability context before rendering');
assert.ok(
  html.includes("['root', 'domain', 'department']") &&
  html.includes("hiddenTypes.has(node.node_type)"),
  'process governance sankey should hide company, management-domain, and department nodes'
);
assert.ok(
  html.includes('var renderedSankey = pruneProcessGovernanceSankeyToCapability(filteredSankey)') &&
  html.includes('renderProcessGovernanceSankey(renderedSankey)'),
  'process governance sankey should render from capability level after department filtering'
);
const pruneMatch = html.match(/function pruneProcessGovernanceSankeyToCapability\(data\) \{[\s\S]*?\n    \}/);
assert.ok(pruneMatch, 'process governance sankey pruning helper should be extractable');
const pruneContext = {};
vm.runInNewContext(`${pruneMatch[0]}; this.pruneProcessGovernanceSankeyToCapability = pruneProcessGovernanceSankeyToCapability;`, pruneContext);
const pruned = pruneContext.pruneProcessGovernanceSankeyToCapability({
  nodes: [
    { name: '昌兴复材', node_type: 'root' },
    { name: '经营域', node_type: 'domain' },
    { name: '经营发展部', node_type: 'department' },
    { name: '合同管理', node_type: 'l2' },
    { name: '销售订单评审和执行管理', node_type: 'l3' },
    { name: '接收订单并组织评审', node_type: 'a1' },
    { name: 'OA', node_type: 'system' }
  ],
  links: [
    { source: '昌兴复材', target: '经营域', value: 1 },
    { source: '经营域', target: '经营发展部', value: 1 },
    { source: '经营发展部', target: '合同管理', value: 1 },
    { source: '合同管理', target: '销售订单评审和执行管理', value: 1 },
    { source: '销售订单评审和执行管理', target: '接收订单并组织评审', value: 1 },
    { source: '接收订单并组织评审', target: 'OA', value: 1 }
  ]
});
assert.deepStrictEqual(pruned.nodes.map(node => node.name), ['合同管理', '销售订单评审和执行管理', '接收订单并组织评审', 'OA']);
assert.deepStrictEqual(pruned.links.map(link => `${link.source}->${link.target}`), [
  '合同管理->销售订单评审和执行管理',
  '销售订单评审和执行管理->接收订单并组织评审',
  '接收订单并组织评审->OA'
]);
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
