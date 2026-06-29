const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const templatePath = path.join(root, 'public', 'template.xlsx');

async function main() {
  assert.ok(fs.existsSync(indexPath), 'public/index.html should exist');
  const html = fs.readFileSync(indexPath, 'utf8');

  [
    '角色工作台',
    '统计看板',
    '报送管理',
    '待办收到',
    '评审记录',
    '术语词典',
    '冲突管理',
    '流程治理',
    '角色使用说明'
  ].forEach(label => assert.ok(html.includes(label), `missing tab label ${label}`));

  [
    'echarts.min.js',
    '@keyframes fadeIn',
    '@keyframes slideUp',
    '@keyframes blink',
    '@keyframes pulse',
    '/api/org/me',
    '/api/org/session',
    '/api/mappings',
    '/api/data-map/contexts',
    '/api/field-entries',
    '/api/todos',
    '/api/conflicts',
    '/api/terminology',
    '/api/terminology/processes',
    '/api/terminology/types',
    '/api/import/field-entries',
    '/api/export/excel',
    '/api/views/sankey',
    '/api/process-governance/sankey',
    '/api/process-governance/a1',
    '/api/process-governance/cross-dept',
    '/api/process-governance/input-baseline-review/runs',
    '/api/role-workbench',
    '/api/activity/heatmap',
    '/api/page-workflows',
    'data-tab="roleWorkbench"',
    'id="roleWorkbench"',
    'function renderRoleWorkbench()',
    'function renderRoleWorkbenchSankey(data)',
    'function renderRoleWorkbenchGuide',
    'id="roleWorkbenchMode"',
    'id="roleWorkbenchNextActions"',
    'id="roleWorkbenchSankey"',
    'id="roleWorkbenchActivityHeatmap"',
    '我现在该做什么',
    '我的治理活跃',
    '治理活跃',
    '参与热力',
    'function renderActivityHeatmap',
    'function loadRoleWorkbenchActivity',
    'function loadDashboardActivity',
    'function activityLevel',
    'function renderActivityDayDetail',
    'data-activity-date',
    'id="dashboardActivityHeatmap"',
    'id="dashboardActivityScope"',
    'id="dashboardActivityDepartment"',
    'id="dashboardActivityUser"',
    'id="departmentActivitySummary"',
    'id="userActivitySummary"',
    '项目工作角色',
    '基础权限角色',
    '角色目标',
    '第一步入口',
    '典型样例',
    '常见误区',
    '完成标准',
    '用户管理',
    '账号入库',
    'id="rbacUserManagement"',
    'function renderUserManagement()',
    'function showUserEditor',
    'function saveUserFromManagement',
    'function resetUserDefaultPassword',
    '基础权限角色',
    '项目工作角色',
    '首次登录密码',
    '当前批量导入仅给已存在用户分配角色',
    '组织架构来自',
    '组织架构和部门职责.md',
    '不支持手动新增',
    '业务对接人收到字段确认待办后',
    '数据质量员发现同一字段存在不同待确认黄金源时',
    '工作组组长看到本工作组有跨部门衔接风险时',
    '项目组长看到本部门有跨部门衔接风险时',
    'function renderProcessGovernance()',
    'id="pgWorkspaceChoices"',
    '治理已有流程',
    '创建新流程',
    'id="pgExistingWizard"',
    'id="pgDesignWizard"',
    'class="outcome-card"',
    '/api/process-design/summary',
    '/api/process-design/drafts',
    'function renderProcessDesignWorkspace',
    'function renderProcessDesignOutcomeCard',
    'id="pgSubtabs"',
    'function processGovernanceViewFromRoute(route)',
    'function renderProcessGovernanceSubtabs(activeView)',
    'function applyProcessGovernanceSubtab(activeView)',
    'PROCESS_GOVERNANCE_VIEW_PRODUCTS',
    'pgViewCache:{}',
    'pgViewRequests:{}',
    'function processGovernanceLoadKey(view, filters)',
    'async function loadProcessGovernanceView(view, options)',
    'function renderProcessGovernanceView(view, payload, route)',
    'function clearProcessGovernanceViewCache(reason)',
    'data-pg-view="overview"',
    'data-pg-view="inputBaselineReview"',
    'data-pg-view="map"',
    'data-pg-view="evidence"',
    'data-pg-view="mapping"',
    'data-pg-view="quality"',
    'function renderProcessGovernanceInputBaselineReview',
    'function renderInputBaselineReviewList',
    'function renderInputBaselineReviewDetailPage',
    '待确认的问题',
    '总览',
    '待确认问题',
    '流程图谱',
    '证据来源',
    '映射工作',
    '治理闭环',
    'function saveProcessGovernanceInputBaselineReview',
    "method: 'PUT'",
    'data-review-field',
    'data-reviewItem-open',
    'data-reviewItem-back',
    'input-baseline-review-confirmation',
    'issue_type',
    'definition_status',
    'normalized_note',
    'function renderRoleGuide()',
    'function renderRoleGuideCard(role)',
    'function loadPageWorkflow(tab, route)',
    'function renderWorkflowShell(config, bodyHtml)',
    'function renderEntityForm(type, id, mode)',
    'function loadTermGovernanceProcesses',
    'function renderTermProcessOptions',
    'function loadTermTypes',
    'function renderTermTypeOptions',
    'function loadDataMapContexts',
    'function renderDataMapContextOptions',
    'function createDataMapContext',
    'id="dataMapContextSelect"',
    '数据地图上下文',
    'id="termType"',
    '术语类型',
    '岗位词',
    '输入词',
    '输出词',
    '请选择本部门映射关系线上的流程',
    '所属组织',
    '任职岗位',
    "optionsSource: 'orgUnits'",
    "optionsSource: 'positions'",
    "dependsOn: 'org_unit_id'",
    'function loadEntityFieldOptions',
    'function bindEntityFieldDependencies',
    'function runPageTask',
    'class="workflow-shell"',
    'class="workflow-sidebar"',
    '我现在该做什么',
    '本页工作流',
    "role.group === 'project'",
    "role.group === 'basic'",
    'data.nodes.find(function(n) { return n.name === params.name; })',
    'template.xlsx'
  ].forEach(needle => assert.ok(html.includes(needle), `missing frontend hook ${needle}`));

  assert.ok(!html.includes('admin123'), 'login page must not expose a default password');
  assert.ok(!html.includes('init1234'), 'frontend must not expose or submit a fixed default password');
  assert.ok(!html.includes('000000'), 'frontend must not expose or describe 000000 as a first-login password');
  assert.ok(!html.includes('value="ADMIN001"'), 'login page must not prefill the default admin employee number');
  assert.ok(html.includes('function escapeHtml'), 'frontend should expose a shared HTML escaping helper');
  assert.ok(html.includes('function safeText'), 'frontend should route service-provided display text through escaping');
  assert.ok(!html.includes('系统最忙'), 'frontend copy should avoid evaluative system wording');
  assert.ok(!html.includes('承载最多'), 'frontend copy should avoid evaluative system wording');
  assert.ok(!html.includes('主用系统'), 'frontend copy should avoid evaluative system wording');
  assert.ok(!html.includes('出勤'), 'governance activity copy should not use attendance wording');
  function countOccurrences(needle) {
    return html.split(needle).length - 1;
  }
  [
    'id="roleWorkbenchActivityHeatmap"',
    'id="roleWorkbenchActivityDetail"',
    'id="dashboardActivityHeatmap"',
    'id="dashboardActivityScope"',
    'id="dashboardActivityDepartment"',
    'id="dashboardActivityUser"',
    'id="departmentActivitySummary"',
    'id="userActivitySummary"',
    'function activityLevel',
    'function loadRoleWorkbenchActivity',
    'function loadDashboardActivity'
  ].forEach(needle => assert.strictEqual(countOccurrences(needle), 1, `frontend should contain exactly one ${needle}`));
  [
    'class="panel compact-panel"',
    'class="action-metrics"',
    'class="action-metric primary"',
    'class="compact-toolbar"',
    'dense-split',
    'class="compact-form-panel"',
    'class="compact-table-panel"',
    'data-action-metric="todos-pending"',
    'data-action-metric="terms-pending"',
    'data-action-metric="conflicts-open"',
    'data-action-metric="data-map-fields"',
    'data-action-metric="quality-attention"',
    'function renderActionMetrics'
  ].forEach(needle => assert.ok(html.includes(needle), `missing compact layout hook ${needle}`));
  [
    'className = \'detail-sticky-head\'',
    'function visibleDetailTableContainers',
    '.panel.on .table-container, .panel.on .tw, .page.on .table-container, .page.on .tw',
    'function activeDetailTableContainer',
    'function scheduleDetailStickyTableHeader',
    "window.addEventListener('scroll', scheduleDetailStickyTableHeader, true)"
  ].forEach(needle => assert.ok(html.includes(needle), `missing detail table sticky header hook ${needle}`));
  assert.ok(!html.includes('prompt('), 'maintenance create/edit flows should use routed forms instead of native prompts');
  assert.ok(!html.includes('data-correction-fragment'), 'input baseline review must not restore click-to-concat correction fragments');
  assert.ok(!html.includes('点选标签生成修正意见'), 'input baseline review must not restore click-to-concat correction copy');
  [
    '<th>问题类型</th>',
    '<th>问题内容</th>',
    '<th>定义充分性</th>',
    '<th>来源锚点</th>',
    '问题类型：',
    '待确认的流程线索',
    '线索复核',
    '这条线索',
    '暂无待确认线索',
    '<th>在哪里发现</th>',
    '<th>问题在哪</th>',
    '<th>哪类问题</th>',
    '<th>证据怎么看</th>',
    '是哪类问题',
    '保存复核',
    '回源',
    '回到原文修改',
    '回到已确认流程映射文件修改',
    '回到哪个部门映射文件'
  ].forEach(needle => assert.ok(!html.includes(needle), `input baseline review should not expose internal wording ${needle}`));
  [
    '在哪发现的',
    '哪里有问题',
    '是哪种问题',
    '证据有没有问题',
    '请你确认',
    '这里不是已确认流程映射库',
    '每一条问题先说清楚',
    '这是不是个问题',
    '证据有没有问题',
    '要不要修改原文',
    '修改原文文件后重新导入',
    'class="input-baseline-review-detail"',
    'input-baseline-review-confirmation'
  ].forEach(needle => assert.ok(html.includes(needle), `input baseline review should use plain wording ${needle}`));
  assert.ok(html.includes('.table-container thead th') && html.includes('position: sticky') && html.includes('top: 0'), 'detail table headers should stay visible while scrolling');
  assert.ok(html.includes('.table-container th, .table-container td') && html.includes('border-right'), 'detail table cells should show vertical grid lines');
  assert.ok(html.includes('border-collapse: separate') && html.includes('border-spacing: 0'), 'detail tables should use separate borders for visible cells and sticky headers');
  assert.ok(!html.includes('id="ouNewBtn"'), 'organization structure should not expose a manual create button');
  assert.ok(!html.includes('+ 新增组织'), 'organization structure should not show manual create copy');
  assert.ok(!html.includes("type:'orgUnit',id:'new'"), 'organization structure should not route to a manual create form');
  assert.ok(!html.includes('class="panel role-workbench on"'), 'role workbench must not be the static default panel because hash routes should decide the first visible page');
  assert.ok(html.includes('async function activateAuthenticatedApp'), 'authenticated startup should use a shared route-first boot helper');
  assert.ok(html.includes("api('/api/org/session'"), 'startup session check should use the non-401 session endpoint');
  assert.ok(html.includes("api('/api/org/session', { silentUnauthorized: true })"), 'startup session check should not show an expired-login toast');
  assert.ok(html.includes('/api/csrf-token'), 'frontend should load a CSRF token for authenticated write requests');
  assert.ok(html.includes('X-CSRF-Token'), 'frontend should attach CSRF token header to unsafe API requests');
  assert.ok(!html.includes('onclick="selectUserForRoles('), 'user role search results must not pass server text through inline onclick handlers');
  assert.ok(html.includes('class="user-role-result"'), 'user role search results should use delegated click handling');
  assert.ok(html.includes('data-user-id'), 'user role search results should bind the selected user through data attributes');
  assert.ok(html.includes('function resetSessionUi'), 'login screen should reset stale authenticated header state');
  assert.ok(html.includes("$('sessionUserName').textContent = '未登录'"), 'login screen should clear stale user identity text');
  const startupSnippetStart = html.indexOf('async function activateAuthenticatedApp');
  const startupSnippet = html.slice(startupSnippetStart, startupSnippetStart + 1200);
  assert.ok(
    startupSnippet.indexOf('renderRouteFromHash();') !== -1 &&
    startupSnippet.indexOf('await loadAllSafely();') !== -1 &&
    startupSnippet.indexOf('renderRouteFromHash();') < startupSnippet.indexOf('await loadAllSafely();'),
    'authenticated startup should render the current hash route before loading broad dashboard data'
  );
  assert.ok(html.includes('function loadAllSafely'), 'broad data loading should not block hash-route rendering');
  assert.ok(html.includes('links.length === 0'), 'role workbench sankey should handle empty-link data without drawing a broken chart');
  assert.ok(html.includes('暂无职责链路数据'), 'role workbench sankey should show a clear empty state when no links exist');
  const assignDialogStart = html.indexOf('async function openAssignOwnerDialog');
  const assignDialogSnippet = html.slice(assignDialogStart, assignDialogStart + 1000);
  assert.ok(assignDialogSnippet.includes("/api/org/users/assignable"), 'conflict assignment should use the minimal assignable user directory');
  assert.ok(!assignDialogSnippet.includes("/api/org/users'"), 'conflict assignment must not read the admin-only full user directory');
  const resetPasswordStart = html.indexOf('async function resetUserDefaultPassword');
  const resetPasswordSnippet = html.slice(resetPasswordStart, resetPasswordStart + 900);
  assert.ok(resetPasswordSnippet.includes('/api/org/users/'), 'password reset should call the user password endpoint');
  assert.ok(!resetPasswordSnippet.includes('password:'), 'password reset must let the server generate a one-time password');
  assert.ok(html.includes('initial_password'), 'user management should display the one-time password returned by the server');
  assert.ok(!html.includes("showToast('账号已入库，首次登录密码：'"), 'user create must not show the initial password in a toast');
  assert.ok(!html.includes("showToast(result && result.initial_password ? '首次登录密码：'"), 'password reset must not show the initial password in a toast');
  assert.ok(
    html.includes("var listHash = '#/' + (params.tab || 'dashboard');") &&
      html.includes("location.hash = listHash + (queryString ? '?' + queryString : '');"),
    'list navigation should use hash routes with #/ to avoid browser anchor auto-scroll'
  );
  assert.ok(
    !html.includes("location.hash = params.tab || 'dashboard';"),
    'list navigation must not use bare hash ids because they trigger anchor auto-scroll'
  );

  assert.ok(html.includes('function populateSankeyDeptFilter()'), 'business map should populate the department filter through a stable helper');
  assert.ok(html.includes('deptEl.dataset.departmentSignature'), 'department filter should avoid clearing selected departments on every render');
  assert.ok(html.includes('formatter: function(params) {'), 'sankey node labels should render display labels while keeping stable node keys');
  assert.ok(html.includes('nodeLabels[p.data.source]'), 'sankey edge tooltip should show display labels for stable node keys');
  const businessSankeyTooltipStart = html.indexOf('formatter: function(p) {');
  const businessSankeyTooltip = html.slice(businessSankeyTooltipStart, businessSankeyTooltipStart + 600);
  assert.ok(!businessSankeyTooltip.includes('return nodeLabels[p.data.source] +'), 'business sankey edge tooltip must escape service-provided labels');
  assert.ok(businessSankeyTooltip.includes('safeText(nodeLabels[p.data.source]'), 'business sankey edge tooltip should escape source labels');
  assert.ok(businessSankeyTooltip.includes('safeText(node.label || p.name'), 'business sankey node tooltip should escape node labels');

  assert.ok(fs.existsSync(templatePath), 'public/template.xlsx should exist');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const sheet = workbook.getWorksheet('字段台账');
  assert.ok(sheet, 'template should include 字段台账 worksheet');

  const headers = sheet.getRow(1).values.slice(1);
  assert.deepStrictEqual(headers, ['数据对象', '字段说明', '中文字段名', '英文字段名', '字段类型', '消费系统', '同步方式']);
  assert.strictEqual(sheet.getRow(2).getCell(1).value, '客户');
  assert.ok(String(sheet.getRow(3).getCell(2).value || '').includes('仅数据对象和字段说明'));

  const guide = workbook.getWorksheet('填写说明');
  assert.ok(guide, 'template should include 填写说明 worksheet');
  assert.ok(String(guide.getRow(1).getCell(1).value || '').includes('MDM 字段台账导入模板'));

  console.log('Frontend assets test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
