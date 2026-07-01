const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.ok(html.includes('data-tab="processGovernance"'), 'process governance tab should exist');
const processGovernanceTab = html.match(/<button class="tab" data-tab="processGovernance" data-roles="([^"]+)">流程治理<\/button>/);
assert.ok(processGovernanceTab, 'process governance tab should declare role visibility');
assert.ok(
  processGovernanceTab[1].split(',').includes('submitter'),
  'process governance tab should be visible to submitters because every department member must confirm their own DCM/BBM results'
);
assert.ok(html.includes('id="processGovernancePanel"'), 'process governance panel should exist');
assert.ok(!html.includes('id="pgTaskEntryPanel"'), 'process governance main area should not duplicate task-entry cards from the workflow sidebar');
assert.ok(!html.includes('id="pgWorkspaceChoices"'), 'process governance main area should not show duplicate existing/new workspace choices before work items');
assert.ok(!html.includes('id="pgExistingWizard"'), 'existing process guidance should live in the workflow sidebar, not above the work queue');
assert.ok(html.includes('data-workflow-actions-title'), 'workflow sidebar action title should be configurable per page');
assert.ok(html.includes('function renderProcessGovernanceWorkflowActions'), 'process governance should render task entry buttons in the workflow sidebar');
assert.ok(html.includes('你现在要处理什么？'), 'process governance workflow sidebar should ask the task question');
assert.ok(html.includes('.workflow-shell.pg-task-focused .workflow-body > .toolbar'), 'process governance task-focused mode should remove the duplicate main toolbar before work items');
assert.ok(html.includes('data-pg-task-entry'), 'process governance workflow actions should render direct task-entry buttons');
assert.ok(html.includes("key: 'inputBaselineReview'"), 'process governance should expose a direct task entry for issue confirmation');
assert.ok(html.includes("key: 'quality'"), 'process governance should expose a direct task entry for closure work');
assert.ok(html.includes("key: 'map'"), 'process governance should expose a direct task entry for map lookup');
assert.ok(html.includes("key: 'documentStructure'"), 'process governance should expose a direct task entry for document structured output');
assert.ok(html.includes('开始确认'), 'process governance should offer plain first-action copy for issue confirmation');
assert.ok(html.includes('pg-guidance-deferred'), 'process governance guidance controls should be visually deferred until a governance object is selected');
assert.ok(html.includes('function processGovernanceGuidanceEnabledForView(view)'), 'process governance should explicitly gate guidance by subtab');
assert.ok(html.includes("PROCESS_GOVERNANCE_GUIDANCE_VIEWS"), 'process governance should keep a guidance-enabled view allowlist');
assert.ok(html.includes('function resetProcessGovernanceGuidanceContext()'), 'process governance should reset stale guidance context when switching away from object-focused views');
assert.ok(html.includes('看本部门有哪些问题') && html.includes('确认关闭'), 'workflow guidance should still explain the existing-process closure path');
assert.ok(html.includes('id="pgDesignWizard"'), 'document structured output should show a design wizard');
[
  '制度说明',
  '目的范围',
  '术语',
  '流程与行为',
  '跨部门承接',
  '附表结构',
  '结构化预览',
  'Markdown 草案'
].forEach(label => {
  assert.ok(html.includes(label), `document structured output wizard should include step ${label}`);
});
[
  'id="pgDesignStepProgress"',
  'data-process-design-step-nav',
  'data-process-design-step-panel',
  'id="pgDesignPrevStepBtn"',
  'id="pgDesignNextStepBtn"',
  'function processDesignWizardStepIndex',
  'function renderProcessDesignStepProgress',
  'function goProcessDesignWizardStep'
].forEach(needle => assert.ok(html.includes(needle), `document structured output should include step navigation hook ${needle}`));
assert.ok(html.includes('process-design-step-panel pg-hidden'), 'document structured output should hide inactive step panels');
assert.ok(html.includes('class="outcome-card"'), 'process governance should render reusable outcome feedback cards');
assert.ok(html.includes('/api/process-design/summary'), 'process governance should load process design summary');
assert.ok(html.includes('/api/process-design/drafts'), 'process governance should create process design drafts through API');
[
  'function loadProcessDesignDraftDetail',
  'function saveProcessDesignDocumentProfileFromWizard',
  'function saveProcessDesignTermFromWizard',
  'function saveProcessDesignProcessFromWizard',
  'function saveProcessDesignBehaviorFromWizard',
  'function startProcessDesignTermEdit',
  'function startProcessDesignProcessEdit',
  'function startProcessDesignStepEdit',
  'function cancelProcessDesignEdit',
  'function processDesignDraftEditable',
  'function applyProcessDesignReadOnlyState',
  'function saveProcessDesignHandoffFromWizard',
  'function saveProcessDesignFormFromWizard',
  'function saveProcessDesignFormTableFromWizard',
  'function saveProcessDesignTableFieldFromWizard',
  'function saveProcessDesignFieldFromWizard',
  'function saveProcessDesignEvidenceFromWizard',
  'function exportProcessDesignMarkdownFromWizard',
  'function submitProcessDesignDraftFromWizard',
  'function publishProcessDesignDraftFromWizard',
  'function renderProcessDesignDraftDetail',
  '/api/process-design/drafts/',
  '/document-profile',
  '/terms',
  '/processes',
  '/steps',
  '/behavior-detail',
  '/cross-dept-handoffs',
  '/forms',
  '/tables',
  '/form-tables/',
  '/fields',
  '/evidence',
  '/markdown',
  '/risks',
  '/outcome-preview',
  '/submit',
  '/api/process-design/review-tasks/',
  '/decision',
  '/publish',
  'data-process-design-draft-open',
  'id="saveProcessDesignDocumentProfileBtn"',
  'id="saveProcessDesignTermBtn"',
  'id="saveProcessDesignProcessBtn"',
  'id="saveProcessDesignBehaviorBtn"',
  'id="cancelProcessDesignEditBtn"',
  'id="newProcessDesignItemBtn"',
  'id="saveProcessDesignHandoffBtn"',
  'id="saveProcessDesignFormBtn"',
  'id="saveProcessDesignFormTableBtn"',
  'id="saveProcessDesignTableFieldBtn"',
  'id="saveProcessDesignFieldBtn"',
  'id="saveProcessDesignEvidenceBtn"',
  'id="exportProcessDesignMarkdownBtn"',
  'id="submitProcessDesignDraftBtn"',
  'id="publishProcessDesignDraftBtn"'
].forEach(needle => assert.ok(html.includes(needle), `process design frontend should include ${needle}`));
assert.ok(!html.includes('id="saveProcessDesignStepBtn"'), 'business behavior should no longer use a separate step save button');
assert.ok(!html.includes('id="saveProcessDesignBehaviorDetailBtn"'), 'business behavior should no longer use a separate behavior-detail save button');
assert.ok(html.includes('id="pgDesignProcessForm"'), 'document structured output should use a process detail form before behavior entry');
assert.ok(html.includes('/api/process-design/process-taxonomy'), 'process design should load L1/L2 options from existing mapping relationships');
assert.ok(html.includes('<select id="pgDesignProcessL1Name"'), 'L1 capability should be selected from existing mapping relationships');
assert.ok(html.includes('<select id="pgDesignProcessL2Name"'), 'L2 business capability should be selected from existing mapping relationships');
assert.ok(!html.includes('L1 能力<input id="pgDesignProcessL1Name"'), 'L1 capability should not be a free text input');
assert.ok(!html.includes('L2 流程域<input id="pgDesignProcessL2Name"'), 'L2 business capability should not be a free text input');
[
  'function loadProcessDesignTaxonomy',
  'function renderProcessDesignTaxonomyOptions',
  'function assertProcessDesignTaxonomySelection',
  'data-process-design-taxonomy-notice',
  '暂不开放新增能力域或业务能力'
].forEach(needle => assert.ok(html.includes(needle), `process design taxonomy selection should include ${needle}`));
assert.ok(html.includes('id="pgDesignStepProcessSelect"'), 'business behavior entry should choose the process it belongs to');
assert.ok(html.includes('id="pgDesignTermList"'), 'term entry should show an inline detail list so users can add more than one term');
assert.ok(html.includes('id="pgDesignProcessList"'), 'process entry should show an inline detail list so one document can contain multiple processes');
assert.ok(html.includes('id="pgDesignBehaviorList"'), 'behavior entry should show an inline detail list so each process can contain multiple behaviors');
assert.ok(html.includes('function renderProcessDesignInlineLists'), 'process design should refresh inline detail lists after every save');
[
  'process-design-list-item editing',
  'data-process-design-edit',
  'data-process-design-delete',
  'data-process-design-void',
  'data-process-design-delete-mode',
  '保存术语修改',
  '保存流程修改',
  '保存业务行为修改',
  '取消编辑',
  '新增下一条',
  '当前状态只读，需要退回修改或新建变更版本'
].forEach(needle => assert.ok(html.includes(needle), `process design editable detail list should include ${needle}`));
assert.ok(html.includes('id="pgDesignProcessType"') && html.includes('<select id="pgDesignProcessType"'), 'process type should be an enum select');
assert.ok(html.includes('<select id="pgDesignTableFieldType"') && html.includes('<select id="pgDesignFieldType"'), 'field type inputs should be enum selects');
assert.ok(html.includes('<select id="pgDesignEvidenceType"'), 'evidence type should be an enum select');
assert.ok(!html.includes('id="pgDesignHandoffTargetProcessCode"'), 'source department should not manually edit returned handoff process code');
assert.ok(!html.includes('id="pgDesignHandoffTargetProcessName"'), 'source department should not manually edit returned handoff process name');
assert.ok(!html.includes('id="pgDesignHandoffTargetBehaviorCode"'), 'source department should not manually edit returned handoff behavior code');
assert.ok(!html.includes('id="pgDesignHandoffTargetBehaviorName"'), 'source department should not manually edit returned handoff behavior name');
assert.ok(!html.includes('id="pgDesignTableNo"'), 'form table number should be generated by the backend, not typed in the page');
assert.ok(!html.includes('id="pgDesignTableFieldNo"'), 'form field number should be generated by the backend, not typed in the page');
assert.ok(html.includes('function validateProcessDesignNoSpaceFields'), 'process design frontend should validate field values without spaces before saving');
assert.ok(html.includes('function renderProcessDesignWorkspace'), 'process governance should render new process design workspace');
assert.ok(html.includes('function renderProcessDesignOutcomeCard'), 'process governance should render outcome feedback from real counts');
assert.ok(html.includes('id="pgSubtabs"'), 'process governance should expose a subtab navigation container');
assert.ok(html.includes('function processGovernanceViewFromRoute(route)'), 'process governance should map routes to page subtabs');
assert.ok(html.includes('function renderProcessGovernanceSubtabs(activeView)'), 'process governance should render page subtabs');
assert.ok(html.includes('function applyProcessGovernanceSubtab(activeView)'), 'process governance should hide non-active subtab sections');
assert.ok(html.includes("queryParts.set('view', params.pgView || params.qualityView)") && html.includes("queryParts.set('needs_review', params.inputBaselineReviewKey)"), 'list navigation should preserve process governance deep-link query parameters');
assert.ok(html.includes('PROCESS_GOVERNANCE_VIEW_PRODUCTS'), 'process governance should declare governed data-product view loaders');
assert.ok(html.includes('pgViewCache:{}') && html.includes('pgViewRequests:{}'), 'process governance should keep per-view session caches and request guards');
assert.ok(html.includes('function processGovernanceLoadKey(view, filters)'), 'process governance should build stable per-view cache keys');
assert.ok(html.includes('async function loadProcessGovernanceView(view, options)'), 'process governance should lazy-load the active subtab view');
assert.ok(html.includes('function renderProcessGovernanceView(view, payload, route)'), 'process governance should render one loaded governance view at a time');
assert.ok(html.includes('function clearProcessGovernanceViewCache(reason)'), 'process governance should clear session-only caches when scope changes');
['总览', '文档结构化输出', '待确认问题', '流程图谱', '证据来源', '映射工作', '治理闭环'].forEach(label => {
  assert.ok(html.includes(label), `process governance should include subtab ${label}`);
});
['overview', 'documentStructure', 'inputBaselineReview', 'map', 'evidence', 'mapping', 'quality'].forEach(view => {
  assert.ok(html.includes(`data-pg-view="${view}"`), `process governance should assign sections to ${view}`);
});
assert.ok(html.includes('/api/process-governance/sankey'), 'process governance sankey API should be called');
assert.ok(html.includes('/api/process-governance/a1'), 'process governance A1 API should be called');
assert.ok(html.includes('/api/process-governance/cross-dept'), 'process governance risk API should be called');
assert.ok(html.includes('/api/process-governance/quality'), 'process governance quality API should be called');
assert.ok(html.includes('/api/process-governance/quality-cases'), 'process governance quality cases API should be called');
assert.ok(html.includes('/api/process-governance/quality-cases/') && html.includes('/assign'), 'quality case frontend should call assign API');
assert.ok(html.includes('/api/process-governance/mapping-workspace'), 'process governance mapping workspace API should be called');
assert.ok(html.includes('/api/process-governance/mapping-todos'), 'process governance mapping todos API should be called');
assert.ok(html.includes('/api/process-governance/mapping-todos/') && html.includes('/assign'), 'mapping todo frontend should call assign API');
assert.ok(html.includes('/api/org/persons/assignable'), 'process governance assignment should use assignable persons API');
[
  'function renderProcessGovernanceAssigneePicker',
  'function assignProcessGovernanceQualityCase',
  'function assignProcessGovernanceMappingTodo',
  'data-quality-case-assign',
  'data-mapping-todo-assign'
].forEach(needle => assert.ok(html.includes(needle), `process governance assignment frontend should include ${needle}`));
assert.ok(html.includes('/api/process-governance/source-files'), 'process governance source file API should be called');
assert.ok(html.includes('/api/process-governance/mdm-requirements'), 'process governance MDM requirements API should be called');
assert.ok(html.includes('/api/process-governance/evidence'), 'process governance evidence API should be called');
assert.ok(html.includes('/api/process-governance/issue-pool/queues'), 'process governance issue pool queue API should be called');
assert.ok(html.includes('/api/process-governance/issue-pool/issues'), 'process governance issue pool issue API should be called');
assert.ok(html.includes('function renderProcessGovernanceIssueQueues'), 'process governance should render human action queues for issue pool');
assert.ok(html.includes('function renderProcessGovernanceIssueDetail'), 'process governance should render one 5W2H issue card on demand');
assert.ok(html.includes('function renderProcessGovernancePriorityIssue'), 'process governance should surface the first actionable issue before broad status blocks');
[
  'process_governance_issue',
  'process_mapping_todo',
  'process_governance_a1',
  'data-pg-record-id',
  'function setActiveGovernanceObjectFocus',
  'related_entity_type',
  'related_entity_id'
].forEach(needle => assert.ok(html.includes(needle), `guidance binding should include stable object hook ${needle}`));
const inputBaselineSectionStart = html.indexOf('id="pgInputBaselineReviewSection"');
const inputBaselineSectionEnd = html.indexOf('id="pgSourceCoverageSection"', inputBaselineSectionStart);
const inputBaselineSection = html.slice(inputBaselineSectionStart, inputBaselineSectionEnd);
assert.ok(
  inputBaselineSection.indexOf('id="pgInputBaselineReviewRows"') < inputBaselineSection.indexOf('class="pg-work-help"'),
  'input baseline review should show the actionable queue before explanatory help'
);
assert.ok(html.includes('function renderProcessGovernance()'), 'process governance renderer should exist');
assert.ok(html.includes('function renderProcessGovernanceSankey(data)'), 'process governance sankey renderer should exist');
assert.ok(html.includes('safeDisposeProcessGovernanceSankeyChart'), 'process governance sankey renderer should safely dispose broken chart instances');
assert.ok(html.includes('chart.setOption(processGovernanceSankeyOption(data), true)'), 'process governance sankey should replace options without tearing down the DOM each time');
assert.ok(html.includes('id="pgCurrentScope"'), 'process governance should show the active department scope outside the map view');
assert.ok(html.includes('id="pgClearDeptScopeBtn"'), 'process governance should let users clear a cross-view department scope');
assert.ok(html.includes('function renderProcessGovernanceScopeNotice'), 'process governance should render a reusable scope notice');
assert.ok(html.includes("stats.sourceFiles && stats.sourceFiles.byStatus || {}"), 'process governance overview should use source-file summary metrics from current snapshot');
assert.ok(html.includes("stats.mdmRequirements && stats.mdmRequirements.total || 0"), 'process governance overview should use MDM requirement summary metrics from current snapshot');
assert.ok(html.includes("stats.evidenceRefs && stats.evidenceRefs.total || 0"), 'process governance overview should use evidence reference summary metrics from current snapshot');
assert.ok(html.includes('id="loginForm"'), 'login inputs should be wrapped in a form for browser password handling');
assert.ok(html.includes('<link rel="icon" href="/logo.png">'), 'MDM page should declare a favicon to avoid noisy 404s');
assert.ok(html.includes('PROCESS_GOVERNANCE_QUALITY_VISIBLE_LIMIT = 80'), 'process governance quality tables should cap visible rows for page performance');
assert.ok(html.includes('processGovernanceVisibleRows(items, PROCESS_GOVERNANCE_QUALITY_VISIBLE_LIMIT'), 'process governance quality renderers should use capped visible rows');
const pgRenderStart = html.indexOf('async function renderProcessGovernance()');
const pgRenderEnd = html.indexOf('// ===== Capability Preview Sankey =====', pgRenderStart);
const pgRenderSnippet = html.slice(pgRenderStart, pgRenderEnd);
assert.ok(!pgRenderSnippet.includes('Promise.all(['), 'process governance shell renderer should not eagerly load every governance view');
assert.ok(pgRenderSnippet.includes('loadProcessGovernanceView(activePgView'), 'process governance shell renderer should load only the active subtab');
assert.ok(pgRenderSnippet.includes('processGovernanceGuidanceEnabledForView(activePgView)'), 'process governance shell renderer should hide guidance on non-object subtabs');
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
assert.ok(html.includes('var currentRoleCodes = roleCodesOfCurrentUser()'), 'role visibility should use all current role codes, not only the legacy base role');
assert.ok(html.includes('function canViewAllProcessGovernanceClient()'), 'process governance should have a client-side global-scope guard');
assert.ok(html.includes('function ensureProcessGovernanceDepartmentScope()'), 'process governance should force non-management users into their own department scope');
assert.ok(html.includes("var currentUser = await api('/api/org/me')"), 'authenticated app activation should hydrate the full current user profile');
assert.ok(html.includes('function currentUserDepartmentName()'), 'process governance should resolve the current user department through a reusable helper');
assert.ok(html.includes('state.pgSelectedDept = currentUserDepartmentName()'), 'non-management process governance scope should default to the current user department');
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
assert.ok(html.includes('待确认的问题'), 'input baseline review should be named in plain business language');
assert.ok(html.includes('这里不是已确认流程映射库'), 'input baseline review should explain that rows are not official mappings');
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
assert.ok(html.includes('正在加载待确认的问题'), 'input baseline review should show an explicit initial loading state');
assert.ok(html.includes('待确认问题加载失败，请刷新流程治理'), 'input baseline review should show a clear failure state');
assert.ok(html.includes('function renderInputBaselineReviewMappingTodoFallback'), 'input baseline review should fall back to current mapping todos when no input baseline review extraction exists');
assert.ok(html.includes('payload.mappingTodos'), 'input baseline review view should receive mapping todo data for the empty-reviewItem fallback');
assert.ok(html.includes('去映射待办处理'), 'input baseline review empty state should guide users to the mapping todo work queue');
assert.ok(html.includes('哪里有问题'), 'input baseline review detail should use plain problem wording');
assert.ok(html.includes('在哪发现的'), 'input baseline review detail should use plain source wording');
assert.ok(html.includes('是哪种问题'), 'input baseline review detail should use plain issue wording');
assert.ok(html.includes('证据有没有问题'), 'input baseline review detail should use plain evidence wording');
assert.ok(html.includes('请你确认'), 'input baseline review detail should use plain action wording');
assert.ok(html.includes('这是不是个问题'), 'input baseline review decision copy should ask users to confirm the problem');
assert.ok(html.includes('证据有没有问题'), 'input baseline review evidence copy should ask users to confirm evidence quality');
assert.ok(html.includes('要不要修改原文'), 'input baseline review should ask users to decide whether source files need changes');
assert.ok(html.includes('是哪种问题'), 'input baseline review detail should name issue types plainly');
assert.ok(html.includes('function renderInputBaselineReviewList'), 'input baseline review should render a list of problems before opening one problem');
assert.ok(html.includes('function renderInputBaselineReviewDetailPage'), 'input baseline review should render one problem per detail page');
assert.ok(html.includes('pgView: query.view'), 'process governance route should expose pgView from the hash query');
assert.ok(html.includes('inputBaselineReviewKey: query.reviewItem'), 'process governance route should understand input baseline review detail links');
assert.ok(html.includes("return '#/processGovernance?view=inputBaselineReview'"), 'input baseline review back navigation should stay on the input baseline review view');
assert.ok(html.includes("route.pgView === 'inputBaselineReview' && route.inputBaselineReviewKey"), 'input baseline review detail rendering should use process governance route view');
assert.ok(html.includes('data-reviewItem-open'), 'input baseline review list should open a single-problem confirmation page');
assert.ok(html.includes('class="input-baseline-review-detail"'), 'input baseline review detail page should have a dedicated readable layout');
assert.ok(html.includes('input-baseline-review-confirmation'), 'input baseline review confirmation controls should be below the problem body');
assert.ok(html.includes('class="input-baseline-review-card"'), 'input baseline review list should use readable problem cards');
assert.ok(html.includes('.input-baseline-review-detail-grid'), 'input baseline review detail should lay out problem evidence before confirmation controls');
assert.ok(html.includes('data-reviewItem-back'), 'input baseline review detail page should provide a return-to-list action');
assert.ok(html.includes('#processGovernancePanel {') && html.includes('max-width: none'), 'process governance panel should use the full available workspace');
assert.ok(html.includes('.pg-review-grid') && html.includes('min-width: 0'), 'input baseline review confirmation grid should not force a wider minimum than the action column');
const reviewSourceExcerptCss = html.slice(html.indexOf('.reviewItem-source-excerpt {'), html.indexOf('.tag.green {'));
assert.ok(!reviewSourceExcerptCss.includes('-webkit-line-clamp'), 'input baseline review source excerpts should not be visually clamped');
assert.ok(reviewSourceExcerptCss.includes('white-space: normal') && reviewSourceExcerptCss.includes('overflow-wrap: anywhere'), 'input baseline review source excerpts should wrap naturally');
assert.ok(html.includes('function inputBaselineReviewExcerptText(row)'), 'input baseline review should extract source excerpt text for the source cell');
assert.ok(html.includes('(row.source_excerpts && row.source_excerpts[0] && row.source_excerpts[0].raw_text)'), 'input baseline review source excerpt should use source_excerpts[0].raw_text');
assert.ok(html.includes('未匹配到原文摘录，请按来源文件核对原文'), 'input baseline review should tell users when no source excerpt is matched');
assert.ok(html.includes('class="reviewItem-source-excerpt"'), 'input baseline review should render source excerpts inside the source cell');
assert.ok(!html.includes('<th>问题类型</th>'), 'input baseline review should not expose issue type as a table header');
assert.ok(!html.includes('<th>问题内容</th>'), 'input baseline review should not expose reviewItem content as a table header');
assert.ok(!html.includes('<th>定义充分性</th>'), 'input baseline review should not expose definition sufficiency as a table header');
assert.ok(!html.includes('<th>来源锚点</th>'), 'input baseline review should not expose source anchor as a table header');
assert.ok(!html.includes('线索复核') && !html.includes('这条线索') && !html.includes('暂无待确认线索'), 'input baseline review should not expose clue-style internal wording');
assert.ok(!html.includes('是哪类问题') && !html.includes('保存复核'), 'input baseline review should use confirmation wording instead of review jargon');
assert.ok(!html.includes('回源') && !html.includes('回到原文修改'), 'process governance should say 修改原文 instead of 回源');
assert.ok(html.includes('待确认主数据对象'), 'process governance should name MDM reviewItems as reviewItems');
assert.ok(html.includes('pg-mdm-guide'), 'MDM reviewItem section should include visual guidance');
assert.ok(html.includes('待确认对象') && html.includes('关键字段') && html.includes('证据引用') && html.includes('治理要求'), 'MDM reviewItem guidance should show the review path');
assert.ok(html.includes('证据链'), 'process governance should name evidence chain view');
assert.ok(html.includes('修改原文文件后重新导入'), 'process governance should guide users to update source files instead of editing docs/norms in MDM');
assert.ok(
  html.includes('qualityView: query.view') && html.includes('finding: query.finding') && html.includes('caseId: query.case') && html.includes('mappingTodoId: query.todo') &&
    html.includes('inputBaselineReview:') && html.includes('mappingTodos:') && html.includes('qualityCases:'),
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
