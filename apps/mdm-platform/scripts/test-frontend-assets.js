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
    '/api/mappings',
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
    '/api/role-workbench',
    '/api/page-workflows',
    'data-tab="roleWorkbench"',
    'id="roleWorkbench"',
    'function renderRoleWorkbench()',
    'function renderRoleWorkbenchSankey(data)',
    'function renderRoleWorkbenchGuide',
    'id="roleWorkbenchMode"',
    'id="roleWorkbenchNextActions"',
    'id="roleWorkbenchSankey"',
    '我现在该做什么',
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
    '初始密码为 init1234',
    '当前批量导入仅给已存在用户分配角色',
    '组织架构来自',
    '组织架构和部门职责.md',
    '不支持手动新增',
    '业务对接人收到字段确认待办后',
    '数据质量员发现同一字段存在不同黄金源候选时',
    '项目组长看到本部门有跨部门衔接风险时',
    'function renderProcessGovernance()',
    'function renderRoleGuide()',
    'function renderRoleGuideCard(role)',
    'function loadPageWorkflow(tab, route)',
    'function renderWorkflowShell(config, bodyHtml)',
    'function renderEntityForm(type, id, mode)',
    'function loadTermGovernanceProcesses',
    'function renderTermProcessOptions',
    'function loadTermTypes',
    'function renderTermTypeOptions',
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
  assert.ok(!html.includes('value="ADMIN001"'), 'login page must not prefill the default admin employee number');
  assert.ok(html.includes('function escapeHtml'), 'frontend should expose a shared HTML escaping helper');
  assert.ok(html.includes('function safeText'), 'frontend should route service-provided display text through escaping');
  assert.ok(!html.includes('系统最忙'), 'frontend copy should avoid evaluative system wording');
  assert.ok(!html.includes('承载最多'), 'frontend copy should avoid evaluative system wording');
  assert.ok(!html.includes('主用系统'), 'frontend copy should avoid evaluative system wording');
  assert.ok(!html.includes('prompt('), 'maintenance create/edit flows should use routed forms instead of native prompts');
  assert.ok(!html.includes('id="ouNewBtn"'), 'organization structure should not expose a manual create button');
  assert.ok(!html.includes('+ 新增组织'), 'organization structure should not show manual create copy');
  assert.ok(!html.includes("type:'orgUnit',id:'new'"), 'organization structure should not route to a manual create form');
  assert.ok(!html.includes('class="panel role-workbench on"'), 'role workbench must not be the static default panel because hash routes should decide the first visible page');
  assert.ok(html.includes('async function activateAuthenticatedApp'), 'authenticated startup should use a shared route-first boot helper');
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
  assert.ok(
    html.includes("location.hash = '#/' + (params.tab || 'dashboard');"),
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
