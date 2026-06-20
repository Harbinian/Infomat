const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.ok(html.includes('data-tab="processGovernance"'), 'process governance tab should exist');
assert.ok(html.includes('id="processGovernancePanel"'), 'process governance panel should exist');
assert.ok(html.includes('id="pgSubtabs"'), 'process governance should expose a subtab navigation container');
assert.ok(html.includes('function processGovernanceViewFromRoute(route)'), 'process governance should map routes to page subtabs');
assert.ok(html.includes('function renderProcessGovernanceSubtabs(activeView)'), 'process governance should render page subtabs');
assert.ok(html.includes('function applyProcessGovernanceSubtab(activeView)'), 'process governance should hide non-active subtab sections');
assert.ok(html.includes("queryParts.set('view', params.pgView || params.qualityView)") && html.includes("queryParts.set('candidate', params.candidateReviewKey)"), 'list navigation should preserve process governance deep-link query parameters');
assert.ok(html.includes('PROCESS_GOVERNANCE_VIEW_PRODUCTS'), 'process governance should declare governed data-product view loaders');
assert.ok(html.includes('pgViewCache:{}') && html.includes('pgViewRequests:{}'), 'process governance should keep per-view session caches and request guards');
assert.ok(html.includes('function processGovernanceLoadKey(view, filters)'), 'process governance should build stable per-view cache keys');
assert.ok(html.includes('async function loadProcessGovernanceView(view, options)'), 'process governance should lazy-load the active subtab view');
assert.ok(html.includes('function renderProcessGovernanceView(view, payload, route)'), 'process governance should render one loaded governance view at a time');
assert.ok(html.includes('function clearProcessGovernanceViewCache(reason)'), 'process governance should clear session-only caches when scope changes');
['总览', '待确认问题', '流程图谱', '证据来源', '映射工作', '治理闭环'].forEach(label => {
  assert.ok(html.includes(label), `process governance should include subtab ${label}`);
});
['overview', 'candidateReview', 'map', 'evidence', 'mapping', 'quality'].forEach(view => {
  assert.ok(html.includes(`data-pg-view="${view}"`), `process governance should assign sections to ${view}`);
});
assert.ok(html.includes('/api/process-governance/sankey'), 'process governance sankey API should be called');
assert.ok(html.includes('/api/process-governance/a1'), 'process governance A1 API should be called');
assert.ok(html.includes('/api/process-governance/cross-dept'), 'process governance risk API should be called');
assert.ok(html.includes('/api/process-governance/quality'), 'process governance quality API should be called');
assert.ok(html.includes('/api/process-governance/quality-cases'), 'process governance quality cases API should be called');
assert.ok(html.includes('/api/process-governance/mapping-workspace'), 'process governance mapping workspace API should be called');
assert.ok(html.includes('/api/process-governance/mapping-todos'), 'process governance mapping todos API should be called');
assert.ok(html.includes('/api/process-governance/source-files'), 'process governance source file API should be called');
assert.ok(html.includes('/api/process-governance/mdm-requirements'), 'process governance MDM requirements API should be called');
assert.ok(html.includes('/api/process-governance/evidence'), 'process governance evidence API should be called');
assert.ok(html.includes('function renderProcessGovernance()'), 'process governance renderer should exist');
assert.ok(html.includes('function renderProcessGovernanceSankey(data)'), 'process governance sankey renderer should exist');
const pgRenderStart = html.indexOf('async function renderProcessGovernance()');
const pgRenderEnd = html.indexOf('// ===== Capability Preview Sankey =====', pgRenderStart);
const pgRenderSnippet = html.slice(pgRenderStart, pgRenderEnd);
assert.ok(!pgRenderSnippet.includes('Promise.all(['), 'process governance shell renderer should not eagerly load every governance view');
assert.ok(pgRenderSnippet.includes('loadProcessGovernanceView(activePgView'), 'process governance shell renderer should load only the active subtab');
assert.ok(!pgRenderSnippet.includes('renderProcessGovernanceSankey('), 'process governance shell renderer should not initialize the map chart outside the map subtab');
assert.ok(pgRenderSnippet.includes('if (error && error.status === 401) return;'), 'process governance should let the login flow handle expired sessions without extra console errors');
const pgMapViewStart = html.indexOf('function renderProcessGovernanceMapView');
const pgMapViewEnd = html.indexOf('function renderProcessGovernanceEvidenceView', pgMapViewStart);
const pgMapViewSnippet = html.slice(pgMapViewStart, pgMapViewEnd);
assert.ok(pgMapViewSnippet.includes('renderProcessGovernanceSankey(renderedSankey)'), 'process governance map view should own Sankey rendering');
assert.ok(html.includes('id="pgQualityRows"'), 'process governance should render quality finding rows');
assert.ok(html.includes('id="pgQualityCaseRows"'), 'process governance should render governance case rows');
assert.ok(html.includes('id="pgMappingWorkspaceRows"'), 'process governance should render mapping workspace rows');
assert.ok(html.includes('id="pgMappingTodoRows"'), 'process governance should render mapping todo rows');
assert.ok(html.includes('id="pgSourceCoverageRows"'), 'process governance should render source coverage rows');
assert.ok(html.includes('id="pgMdmRequirementRows"'), 'process governance should render MDM requirement rows');
assert.ok(html.includes('id="pgEvidenceRows"'), 'process governance should render evidence rows');
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
assert.ok(html.includes('id="pgMetricSourceIncluded"'), 'process governance should show included source file metric');
assert.ok(html.includes('id="pgMetricSourceReview"'), 'process governance should show source review metric');
assert.ok(html.includes('id="pgMetricMdmRequirements"'), 'process governance should show MDM requirement metric');
assert.ok(html.includes('id="pgMetricEvidenceRefs"'), 'process governance should show evidence reference metric');
assert.ok(html.includes('docs/organization/组织架构和部门职责.md'), 'process governance should show the current organization source path');
assert.ok(html.includes('docs/norms/{部门}部门-能力-流程-系统映射关系.md'), 'process governance should show the process source path');
assert.ok(html.includes('function renderProcessGovernanceQuality'), 'process governance should render quality findings');
assert.ok(html.includes('function renderProcessGovernanceQualityCases'), 'process governance should render quality cases');
assert.ok(html.includes('function renderProcessGovernanceMappingWorkspace'), 'process governance should render mapping workspace');
assert.ok(html.includes('function renderProcessGovernanceMappingTodos'), 'process governance should render mapping todos');
assert.ok(html.includes('function renderProcessGovernanceSourceCoverage'), 'process governance should render source coverage');
assert.ok(html.includes('function renderProcessGovernanceMdmRequirements'), 'process governance should render MDM requirements');
assert.ok(html.includes('function renderProcessGovernanceEvidence'), 'process governance should render evidence refs');
assert.ok(html.includes('源文件覆盖'), 'process governance should name source coverage without creating a second truth');
assert.ok(html.includes('id="pgSourceCoverageSearch"'), 'source coverage should expose keyword filtering');
assert.ok(html.includes('id="pgSourceCoverageStatusFilter"'), 'source coverage should expose status filtering');
assert.ok(html.includes('id="pgSourceCoverageDeptFilter"'), 'source coverage should expose department filtering');
assert.ok(html.includes('id="pgSourceCoverageTypeFilter"'), 'source coverage should expose asset type filtering');
assert.ok(html.includes('function processGovernanceSourceCoverageMatches'), 'source coverage should filter rows before rendering');
assert.ok(html.includes('function populateProcessGovernanceSourceCoverageFilters'), 'source coverage should populate filter options from current data');
assert.ok(html.includes('pg-source-status'), 'source coverage status tags should use compact non-wrapping styling');
assert.ok(html.includes('SOURCE_COVERAGE_VISIBLE_LIMIT = 20'), 'source coverage should only render 20 rows for page performance');
assert.ok(html.includes('refreshFilters: false'), 'source coverage should not rebuild filter options on every filter keystroke');
const sourceCoverageRenderStart = html.indexOf('function renderProcessGovernanceSourceCoverage');
const sourceCoverageRenderEnd = html.indexOf('function renderProcessGovernanceMdmRequirements');
const sourceCoverageRenderSnippet = html.slice(sourceCoverageRenderStart, sourceCoverageRenderEnd);
assert.ok(sourceCoverageRenderSnippet.includes('覆盖记录'), 'source coverage meta should describe rows as coverage records');
assert.ok(!sourceCoverageRenderSnippet.includes('/ 共 '), 'source coverage meta should not present a questionable global total');
assert.ok(html.includes('待确认的问题'), 'candidate review should be named in plain business language');
assert.ok(html.includes('这里不是正式映射库'), 'candidate review should explain that rows are not official mappings');
assert.ok(
  html.includes("case 'processGovernance': runPageTask(function() { return renderProcessGovernance(); }, '流程治理加载失败'); break;"),
  'process governance list route should use the unified page task runner'
);
assert.ok(html.includes('processGovernanceRenderRequestId:0'), 'process governance should track render request order');
assert.ok(html.includes('function isCurrentProcessGovernanceRender(requestId)'), 'process governance should expose a current-render guard');
assert.ok(html.includes('var requestId = ++state.processGovernanceRenderRequestId'), 'process governance should create a new request id per render');
assert.ok(
  html.includes('if (!isCurrentProcessGovernanceRender(requestId)) return;'),
  'process governance should ignore stale render responses'
);
assert.ok(html.includes('正在加载待确认的问题'), 'candidate review should show an explicit initial loading state');
assert.ok(html.includes('待确认问题加载失败，请刷新流程治理'), 'candidate review should show a clear failure state');
assert.ok(html.includes('哪里有问题'), 'candidate review detail should use plain problem wording');
assert.ok(html.includes('在哪发现的'), 'candidate review detail should use plain source wording');
assert.ok(html.includes('是哪种问题'), 'candidate review detail should use plain issue wording');
assert.ok(html.includes('证据有没有问题'), 'candidate review detail should use plain evidence wording');
assert.ok(html.includes('请你确认'), 'candidate review detail should use plain action wording');
assert.ok(html.includes('这是不是个问题'), 'candidate review decision copy should ask users to confirm the problem');
assert.ok(html.includes('证据有没有问题'), 'candidate review evidence copy should ask users to confirm evidence quality');
assert.ok(html.includes('要不要修改原文'), 'candidate review should ask users to decide whether source files need changes');
assert.ok(html.includes('是哪种问题'), 'candidate review detail should name issue types plainly');
assert.ok(html.includes('function renderCandidateReviewList'), 'candidate review should render a list of problems before opening one problem');
assert.ok(html.includes('function renderCandidateReviewDetailPage'), 'candidate review should render one problem per detail page');
assert.ok(html.includes('pgView: query.view'), 'process governance route should expose pgView from the hash query');
assert.ok(html.includes('candidateReviewKey: query.candidate'), 'process governance route should understand candidate review detail links');
assert.ok(html.includes('data-candidate-open'), 'candidate review list should open a single-problem confirmation page');
assert.ok(html.includes('class="candidate-review-detail"'), 'candidate review detail page should have a dedicated readable layout');
assert.ok(html.includes('candidate-review-confirmation'), 'candidate review confirmation controls should be below the problem body');
assert.ok(html.includes('class="candidate-review-card"'), 'candidate review list should use readable problem cards');
assert.ok(html.includes('.candidate-review-detail-grid'), 'candidate review detail should lay out problem evidence before confirmation controls');
assert.ok(html.includes('data-candidate-back'), 'candidate review detail page should provide a return-to-list action');
assert.ok(html.includes('#processGovernancePanel {') && html.includes('max-width: none'), 'process governance panel should use the full available workspace');
assert.ok(html.includes('.pg-review-grid') && html.includes('min-width: 0'), 'candidate review confirmation grid should not force a wider minimum than the action column');
const candidateSourceExcerptCss = html.slice(html.indexOf('.candidate-source-excerpt {'), html.indexOf('.tag.green {'));
assert.ok(!candidateSourceExcerptCss.includes('-webkit-line-clamp'), 'candidate review source excerpts should not be visually clamped');
assert.ok(candidateSourceExcerptCss.includes('white-space: normal') && candidateSourceExcerptCss.includes('overflow-wrap: anywhere'), 'candidate review source excerpts should wrap naturally');
assert.ok(html.includes('function candidateReviewExcerptText(row)'), 'candidate review should extract source excerpt text for the source cell');
assert.ok(html.includes('(row.source_excerpts && row.source_excerpts[0] && row.source_excerpts[0].raw_text)'), 'candidate review source excerpt should use source_excerpts[0].raw_text');
assert.ok(html.includes('未匹配到原文摘录，请按来源文件核对原文'), 'candidate review should tell users when no source excerpt is matched');
assert.ok(html.includes('class="candidate-source-excerpt"'), 'candidate review should render source excerpts inside the source cell');
assert.ok(!html.includes('<th>候选类型</th>'), 'candidate review should not expose candidate type as a table header');
assert.ok(!html.includes('<th>候选内容</th>'), 'candidate review should not expose candidate content as a table header');
assert.ok(!html.includes('<th>定义充分性</th>'), 'candidate review should not expose definition sufficiency as a table header');
assert.ok(!html.includes('<th>来源锚点</th>'), 'candidate review should not expose source anchor as a table header');
assert.ok(!html.includes('线索复核') && !html.includes('这条线索') && !html.includes('暂无待确认线索'), 'candidate review should not expose clue-style internal wording');
assert.ok(!html.includes('是哪类问题') && !html.includes('保存复核'), 'candidate review should use confirmation wording instead of review jargon');
assert.ok(!html.includes('回源') && !html.includes('回到原文修改'), 'process governance should say 修改原文 instead of 回源');
assert.ok(html.includes('主数据对象候选'), 'process governance should name MDM candidates as candidates');
assert.ok(html.includes('pg-mdm-guide'), 'MDM candidate section should include visual guidance');
assert.ok(html.includes('候选对象') && html.includes('关键字段') && html.includes('证据引用') && html.includes('治理要求'), 'MDM candidate guidance should show the review path');
assert.ok(html.includes('证据链'), 'process governance should name evidence chain view');
assert.ok(html.includes('修改原文文件后重新导入'), 'process governance should guide users to update source files instead of editing docs/norms in MDM');
assert.ok(
  html.includes('qualityView: query.view') && html.includes('finding: query.finding') && html.includes('caseId: query.case') && html.includes('mappingTodoId: query.todo') &&
    html.includes('candidateReview:') && html.includes('mappingTodos:') && html.includes('qualityCases:'),
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
const sourceFilterMatch = html.match(/function processGovernanceSourceCoverageMatches\(row, filters\) \{[\s\S]*?\n    \}/);
assert.ok(sourceFilterMatch, 'source coverage filter helper should be extractable');
const sourceFilterContext = {};
vm.runInNewContext(`${sourceFilterMatch[0]}; this.processGovernanceSourceCoverageMatches = processGovernanceSourceCoverageMatches;`, sourceFilterContext);
const sourceRows = [
  { process_status: '纳入', dept_name: '经营发展部', asset_type: 'Procedure', file_no: 'GLB-001', file_path: 'docs/norms/经营发展部制度.md', process_reason: '流程依据' },
  { process_status: '排除', dept_name: '财务部', asset_type: 'Reference', file_no: 'REF-001', file_path: 'docs/norms/财务部参考.md', process_reason: '参考副本' }
];
assert.deepStrictEqual(
  sourceRows.filter(row => sourceFilterContext.processGovernanceSourceCoverageMatches(row, { status: '纳入', query: '经营' })).map(row => row.file_no),
  ['GLB-001'],
  'source coverage filters should match status and keyword before rendering'
);
assert.strictEqual(
  sourceFilterContext.processGovernanceSourceCoverageMatches(sourceRows[0], { dept: '财务部' }),
  false,
  'source coverage department filter should exclude other departments'
);
const processGovernanceRenderGuardMatch = html.match(/function isCurrentProcessGovernanceRender\(requestId\) \{[\s\S]*?\n    \}/);
assert.ok(processGovernanceRenderGuardMatch, 'process governance current-render guard should be extractable');
const processGovernanceRenderGuardContext = { state: { processGovernanceRenderRequestId: 2 } };
vm.runInNewContext(`${processGovernanceRenderGuardMatch[0]}; this.isCurrentProcessGovernanceRender = isCurrentProcessGovernanceRender;`, processGovernanceRenderGuardContext);
assert.strictEqual(
  processGovernanceRenderGuardContext.isCurrentProcessGovernanceRender(2),
  true,
  'latest process governance request should be allowed to render'
);
assert.strictEqual(
  processGovernanceRenderGuardContext.isCurrentProcessGovernanceRender(1),
  false,
  'older process governance request should not be allowed to render over newer data'
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
