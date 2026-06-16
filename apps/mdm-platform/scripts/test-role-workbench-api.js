const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const APP_ROOT = path.join(__dirname, '..');
const PORT = 3117;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'pass1234';
const TEST_PREFIX = 'TEST_ROLE_WB_';

function request(method, urlPath, body, cookie) {
  const url = new URL(urlPath, BASE);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (cookie) options.headers.Cookie = cookie;

  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch (error) { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForServer(child) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    if (child.exitCode !== null) throw new Error(`测试服务提前退出: ${child.exitCode}`);
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) return;
    } catch (error) {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('测试服务启动超时');
}

async function login(employeeNo) {
  const res = await request('POST', '/api/org/login', { employee_no: employeeNo, password: PASSWORD });
  if (res.status !== 200) throw new Error(`登录失败 ${employeeNo}: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'];
  if (!cookie || cookie.length === 0) throw new Error(`登录未返回 Cookie: ${employeeNo}`);
  return cookie.map(value => value.split(';')[0]).join('; ');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getRoleId(code) {
  const role = db.prepare('SELECT role_id FROM roles WHERE role_code=?').get(code);
  assert(role, `缺少项目角色编码: ${code}`);
  return role.role_id;
}

function createUser(employeeNo, name, departmentId, legacyRole, roleCodes) {
  const userId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, employeeNo, departmentId, `${TEST_PREFIX}岗位`, legacyRole, hashPassword(PASSWORD)).lastInsertRowid;

  const insertRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
  for (const code of roleCodes) insertRole.run(userId, getRoleId(code));
  return userId;
}

function seedProcessGovernance(deptName) {
  const snapshotId = db.prepare(`
    INSERT INTO process_governance_snapshots (source_json_path, source_hash, generated_at, stats_json, status, note)
    VALUES ('test-role-workbench.json', ?, '2026-06-09', ?, 'active', ?)
  `).run(`${TEST_PREFIX}hash`, JSON.stringify({ mappings: 1, a1: 1, departmentsWithData: 1, departmentsEmpty: 0 }), `${TEST_PREFIX}快照`).lastInsertRowid;

  const insertNode = db.prepare(`
    INSERT INTO process_governance_nodes
      (snapshot_id, node_key, node_type, name, domain_name, dept_name, parent_key, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertNode.run(snapshotId, '昌兴复材', 'root', '昌兴复材', null, null, null, 1);
  insertNode.run(snapshotId, '经营域', 'domain', '经营域', '经营域', null, '昌兴复材', 2);
  insertNode.run(snapshotId, deptName, 'department', deptName, '经营域', deptName, '经营域', 3);
  insertNode.run(snapshotId, `${TEST_PREFIX}L2`, 'l2', '订单管理能力', '经营域', deptName, deptName, 4);
  insertNode.run(snapshotId, `${TEST_PREFIX}L3`, 'l3', '销售订单评审流程', '经营域', deptName, `${TEST_PREFIX}L2`, 5);
  insertNode.run(snapshotId, `${TEST_PREFIX}A1`, 'a1', '接收订单并组织评审', '经营域', deptName, `${TEST_PREFIX}L3`, 6);
  insertNode.run(snapshotId, `${TEST_PREFIX}L3_GUIDE`, 'l3', '订单履约复盘流程', '经营域', deptName, `${TEST_PREFIX}L2`, 7);
  insertNode.run(snapshotId, `${TEST_PREFIX}A1_GUIDE`, 'a1', '复盘订单履约数据', '经营域', deptName, `${TEST_PREFIX}L3_GUIDE`, 8);

  const insertEdge = db.prepare(`
    INSERT INTO process_governance_edges
      (snapshot_id, source_key, target_key, edge_type, value)
    VALUES (?, ?, ?, ?, 1)
  `);
  insertEdge.run(snapshotId, '昌兴复材', '经营域', 'root_domain');
  insertEdge.run(snapshotId, '经营域', deptName, 'domain_dept');
  insertEdge.run(snapshotId, deptName, `${TEST_PREFIX}L2`, 'dept_l2');
  insertEdge.run(snapshotId, `${TEST_PREFIX}L2`, `${TEST_PREFIX}L3`, 'l2_l3');
  insertEdge.run(snapshotId, `${TEST_PREFIX}L3`, `${TEST_PREFIX}A1`, 'l3_a1');
  insertEdge.run(snapshotId, `${TEST_PREFIX}L2`, `${TEST_PREFIX}L3_GUIDE`, 'l2_l3');
  insertEdge.run(snapshotId, `${TEST_PREFIX}L3_GUIDE`, `${TEST_PREFIX}A1_GUIDE`, 'l3_a1');

  db.prepare(`
    INSERT INTO process_a1_items
      (snapshot_id, a1_code, dept_name, l3_name, behavior, execution_role, approval_type,
       input_source_dept, output_target_dept, suggested_systems, verification_note, source_file)
    VALUES (?, ?, ?, ?, ?, '合同管理员', '审批', '项目管理部', '工程技术部', ?, '核对技术条款输入', 'test.md')
  `).run(snapshotId, `${TEST_PREFIX}A1`, deptName, '销售订单评审流程', '接收订单并组织评审', JSON.stringify(['OA', 'ERP']));

  db.prepare(`
    INSERT INTO process_a1_items
      (snapshot_id, a1_code, dept_name, l3_name, behavior, execution_role, approval_type,
       input_source_dept, output_target_dept, suggested_systems, verification_note, source_file)
    VALUES (?, ?, ?, ?, ?, '合同管理员', '记录', '经营发展部', '项目管理部', ?, '全量职责模式用于查看非待办责任链路', 'test.md')
  `).run(snapshotId, `${TEST_PREFIX}A1_GUIDE`, deptName, '订单履约复盘流程', '复盘订单履约数据', JSON.stringify(['ERP']));

  const findingId = db.prepare(`
    INSERT INTO process_governance_quality_findings
      (snapshot_id, severity, area, source_file, source_line, message, suggestion, dept_name, finding_key)
    VALUES (?, 'BLOCK', 'BBM', ?, 88, ?, '回源补充核验提醒后重新导入 MDM 快照', ?, ?)
  `).run(
    snapshotId,
    `docs/norms/${deptName}部门-能力-流程-系统映射关系.md`,
    `${TEST_PREFIX}流程治理质量问题`,
    deptName,
    `${TEST_PREFIX}quality-finding`
  ).lastInsertRowid;

  db.prepare(`
    INSERT INTO process_governance_quality_cases
      (finding_key, first_snapshot_id, latest_snapshot_id, latest_finding_id, severity, area, source_file,
       source_line, message, suggestion, dept_name, status, priority)
    VALUES (?, ?, ?, ?, 'BLOCK', 'BBM', ?, 88, ?, '回源补充核验提醒后重新导入 MDM 快照', ?, 'open', 'high')
  `).run(
    `${TEST_PREFIX}quality-finding`,
    snapshotId,
    snapshotId,
    findingId,
    `docs/norms/${deptName}部门-能力-流程-系统映射关系.md`,
    `${TEST_PREFIX}流程治理质量问题`,
    deptName
  );

  const mappingRecordId = db.prepare(`
    INSERT INTO process_mapping_records
      (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, l2_name, l3_name,
       a1_code, behavior, source_file, status)
    VALUES (?, 'a1', ?, ?, ?, '订单管理能力', '销售订单评审流程', ?, '接收订单并组织评审', 'test.md', 'active')
  `).run(`${TEST_PREFIX}mapping-record`, snapshotId, snapshotId, deptName, `${TEST_PREFIX}A1`).lastInsertRowid;

  db.prepare(`
    INSERT INTO process_mapping_todos
      (todo_key, mapping_record_id, todo_type, first_snapshot_id, latest_snapshot_id, dept_name,
       target_dept_name, a1_code, source_file, message, suggestion, status, priority)
    VALUES (?, ?, 'verification', ?, ?, ?, NULL, ?, 'test.md', ?, '回源补充核验提醒后重新导入', 'open', 'medium')
  `).run(
    `${TEST_PREFIX}mapping-todo`,
    mappingRecordId,
    snapshotId,
    snapshotId,
    deptName,
    `${TEST_PREFIX}A1`,
    `${TEST_PREFIX}桑基图核验提醒待办`
  );

  db.prepare(`
    INSERT INTO process_mapping_todos
      (todo_key, mapping_record_id, todo_type, first_snapshot_id, latest_snapshot_id, dept_name,
       target_dept_name, a1_code, source_file, message, suggestion, status, priority)
    VALUES (?, ?, 'cross_dept', ?, ?, ?, ?, ?, 'test.md', ?, '由工作组组长协调输入输出部门确认', 'open', 'high')
  `).run(
    `${TEST_PREFIX}cross-dept-todo`,
    mappingRecordId,
    snapshotId,
    snapshotId,
    deptName,
    '工程技术部',
    `${TEST_PREFIX}A1`,
    `${TEST_PREFIX}跨部门衔接待办`
  );
}

function seedData() {
  const deptId = db.prepare(`
    INSERT INTO departments (name, code, department_type)
    VALUES (?, ?, '业务')
  `).run(`${TEST_PREFIX}经营发展部`, `${TEST_PREFIX}DEPT`).lastInsertRowid;

  const otherDeptId = db.prepare(`
    INSERT INTO departments (name, code, department_type)
    VALUES (?, ?, '业务')
  `).run(`${TEST_PREFIX}工程技术部`, `${TEST_PREFIX}DEPT_B`).lastInsertRowid;

  const multiRoleUserId = createUser(`${TEST_PREFIX}MULTI`, '多角色用户', deptId, 'owner', ['business_contact', 'data_quality']);
  createUser(`${TEST_PREFIX}DECISION`, '决策组用户', deptId, 'reviewer', ['decision_group']);
  createUser(`${TEST_PREFIX}QUIET`, '无待办用户', deptId, 'owner', ['project_lead']);
  createUser(`${TEST_PREFIX}WORKGROUP`, '工作组组长用户', deptId, 'owner', ['workgroup_lead']);

  seedProcessGovernance(`${TEST_PREFIX}经营发展部`);

  const capId = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status)
    VALUES (?, 'L1', ?, 'approved')
  `).run(`${TEST_PREFIX}能力`, deptId).lastInsertRowid;
  const processId = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES (?, ?, ?, 'approved')
  `).run(`${TEST_PREFIX}流程`, capId, deptId).lastInsertRowid;
  const mappingId = db.prepare(`
    INSERT INTO mappings (process_id, description, owner_dept_id, status, current_step, submitted_by)
    VALUES (?, ?, ?, 'submitted', 2, ?)
  `).run(processId, `${TEST_PREFIX}待确认映射`, deptId, multiRoleUserId).lastInsertRowid;
  const fieldId = db.prepare(`
    INSERT INTO field_entries
      (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note,
       process_governance_a1_code)
    VALUES (?, '订单号', 'order_no', '订单主数据', '编码', 'ERP', '批量', '业务样例字段', ?)
  `).run(mappingId, `${TEST_PREFIX}A1`).lastInsertRowid;

  db.prepare(`
    INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, urgency, due_date)
    VALUES (?, ?, 'field_confirm', ?, ?, ?, 'high', '2026-06-12')
  `).run(otherDeptId, deptId, mappingId, fieldId, `${TEST_PREFIX}字段确认：确认订单号是否在 A1 中产生或消费`);

  db.prepare(`
    INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status, escalated)
    VALUES (?, ?, 'A', ?, 'B', 'blocking', 'escalated', 1)
  `).run(`${TEST_PREFIX}升级术语`, deptId, otherDeptId);
}

function assertRoleGuide(role) {
  assert(role.goal, `${role.code} 缺少角色目标`);
  assert(role.firstEntry, `${role.code} 缺少第一步入口`);
  assert(role.sample, `${role.code} 缺少典型样例`);
  assert(role.pitfall, `${role.code} 缺少常见误区`);
  assert(role.doneCriteria, `${role.code} 缺少完成标准`);
  assert(Array.isArray(role.workflow) && role.workflow.length > 0, `${role.code} 缺少工作流步骤`);
}

async function main() {
  let child;

  try {
    seedData();
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: APP_ROOT,
      env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'role-workbench-api-test' },
      stdio: 'ignore'
    });

    await waitForServer(child);

    const unauth = await request('GET', '/api/role-workbench');
    assert(unauth.status === 401, `未登录访问角色工作台应返回 401，实际 ${unauth.status}`);

    const multiCookie = await login(`${TEST_PREFIX}MULTI`);
    const me = await request('GET', '/api/org/me', null, multiCookie);
    assert(me.status === 200, `/api/org/me 失败: ${me.status}`);
    const roleCodes = me.body.roleCodes || [];
    assert(roleCodes.includes('business_contact'), '当前用户应返回 business_contact 角色编码');
    assert(roleCodes.includes('data_quality'), '当前用户应返回 data_quality 角色编码');
    assert(Array.isArray(me.body.rbacRoles) && me.body.rbacRoles.length >= 2, '当前用户应返回 RBAC 角色名称');

    const todoWorkbench = await request('GET', '/api/role-workbench?mode=todo', null, multiCookie);
    assert(todoWorkbench.status === 200, `角色工作台失败: ${todoWorkbench.status}`);
    assert(todoWorkbench.body.mode === 'todo', '默认待办模式应被保留在响应里');
    assert(Array.isArray(todoWorkbench.body.nextActions), '应返回下一步动作');
    assert(todoWorkbench.body.nextActions.length >= 1 && todoWorkbench.body.nextActions.length <= 3, '下一步动作应为 1 到 3 项');
    assert(todoWorkbench.body.nextActions[0].title && todoWorkbench.body.nextActions[0].target, '下一步动作应包含标题和跳转目标');
    assert(Array.isArray(todoWorkbench.body.workItems) && todoWorkbench.body.workItems.some(item => item.type === 'field_confirm'), '应返回字段确认待办');
    assert(todoWorkbench.body.workItems.some(item => item.type === 'process_quality'), '应返回流程治理质量问题待办');
    const qualityItem = todoWorkbench.body.workItems.find(item => item.type === 'process_quality');
    assert(qualityItem.roleHint === 'data_quality', '质量问题默认应提示数据质量角色处理');
    assert(String(qualityItem.target).includes('#/processGovernance?view=qualityCases&case='), '质量问题应跳转到流程治理闭环视图');
    assert(String(qualityItem.id).startsWith('process-quality-case:'), '质量问题待办应绑定治理问题单');
    assert(todoWorkbench.body.workItems.some(item => item.type === 'process_mapping_todo'), '应返回流程映射待办');
    const mappingTodoItem = todoWorkbench.body.workItems.find(item => item.type === 'process_mapping_todo' && item.area === 'verification');
    assert(mappingTodoItem.roleHint === 'business_contact', '核验类映射待办默认应提示业务对接人处理');
    assert(String(mappingTodoItem.target).includes('#/processGovernance?view=mappingTodos&todo='), '映射待办应跳转到流程治理映射待办视图');
    const crossDeptTodoItem = todoWorkbench.body.workItems.find(item => item.type === 'process_mapping_todo' && item.area === 'cross_dept');
    assert(crossDeptTodoItem && crossDeptTodoItem.roleHint === 'workgroup_lead', '跨部门衔接待办应提示工作组组长处理');

    const ownedRoles = todoWorkbench.body.roles.filter(role => role.owned);
    assert(ownedRoles.some(role => role.code === 'business_contact'), '工作台应标记业务对接人角色');
    assert(ownedRoles.some(role => role.code === 'data_quality'), '工作台应标记数据质量员角色');
    ownedRoles.forEach(assertRoleGuide);

    const allRoleCodes = todoWorkbench.body.roles.map(role => role.code);
    ['it_lead', 'project_lead', 'workgroup_lead', 'business_contact', 'data_quality', 'decision_group', 'submitter', 'owner', 'reviewer', 'admin']
      .forEach(code => assert(allRoleCodes.includes(code), `工作台缺少角色说明: ${code}`));
    const projectGroup = todoWorkbench.body.roleGroups.find(group => group.key === 'project');
    assert(projectGroup && projectGroup.roles.some(role => role.code === 'workgroup_lead'), '工作组组长应归入项目工作角色');

    const sankey = todoWorkbench.body.sankey;
    assert(sankey && sankey.nodes.length > 0 && sankey.links.length > 0, '角色桑基图不应为空');
    ['role', 'capability', 'l3', 'a1', 'entry'].forEach(type => {
      assert(sankey.nodes.some(node => node.type === type), `桑基图缺少 ${type} 节点`);
    });
    sankey.nodes.forEach(node => {
      assert(node.sample, `${node.label || node.id} 缺少点击后的样例说明`);
      assert(node.target, `${node.label || node.id} 缺少点击后的处理入口`);
    });
    assert(sankey.links.some(link => link.source.startsWith('role:') && link.target.startsWith('capability:')), '角色应连到业务能力');
    assert(sankey.links.some(link => link.target.startsWith('entry:')), 'A1 应连到处理入口');
    assert(!sankey.nodes.some(node => node.id === `a1:${TEST_PREFIX}A1_GUIDE`), '待办优先模式不应混入无待办责任链路');

    const allMode = await request('GET', '/api/role-workbench?mode=all', null, multiCookie);
    assert(allMode.status === 200, `全量职责模式失败: ${allMode.status}`);
    assert(allMode.body.mode === 'all', '全量职责模式应被保留在响应里');
    assert(allMode.body.sankey.nodes.length >= todoWorkbench.body.sankey.nodes.length, '全量职责模式不应少于待办模式节点');
    assert(allMode.body.sankey.nodes.some(node => node.id === `a1:${TEST_PREFIX}A1_GUIDE`), '全量职责模式应包含无待办责任链路');
    assert(allMode.body.workItems.some(item => item.type === 'guidance' && item.roleHint === 'business_contact'), '全量职责模式应包含业务对接人角色说明入口');
    assert(allMode.body.sankey.nodes.some(node => node.id === 'entry:business_contact'), '全量职责桑基图应保留业务对接人处理入口');

    const decisionCookie = await login(`${TEST_PREFIX}DECISION`);
    const decisionWorkbench = await request('GET', '/api/role-workbench?mode=todo', null, decisionCookie);
    assert(decisionWorkbench.status === 200, `决策组工作台失败: ${decisionWorkbench.status}`);
    assert(decisionWorkbench.body.workItems.some(item => item.type === 'escalated_conflict'), '决策组应看到升级事项');
    assert(decisionWorkbench.body.nextActions.some(item => String(item.title).includes('升级') || String(item.title).includes('终裁')), '决策组下一步应提示升级/终裁');

    const quietCookie = await login(`${TEST_PREFIX}QUIET`);
    const quietWorkbench = await request('GET', '/api/role-workbench?mode=todo', null, quietCookie);
    assert(quietWorkbench.status === 200, `无待办工作台失败: ${quietWorkbench.status}`);
    assert(quietWorkbench.body.workItems.some(item => item.type === 'process_quality'), '本部门项目组长应看到本部门流程质量问题');
    assert(quietWorkbench.body.workItems.some(item => item.type === 'process_mapping_todo'), '本部门项目组长应看到本部门流程映射待办');
    assert(quietWorkbench.body.nextActions.length >= 1, '无字段待办用户也应有下一步指引');
    assert(quietWorkbench.body.nextActions[0].sample, '无字段待办下一步动作也应给出样例');

    const workgroupCookie = await login(`${TEST_PREFIX}WORKGROUP`);
    const workgroupWorkbench = await request('GET', '/api/role-workbench?mode=todo', null, workgroupCookie);
    assert(workgroupWorkbench.status === 200, `工作组组长工作台失败: ${workgroupWorkbench.status}`);
    const workgroupOwnedRoles = workgroupWorkbench.body.roles.filter(role => role.owned);
    assert(workgroupOwnedRoles.some(role => role.code === 'workgroup_lead'), '工作台应标记工作组组长角色');
    workgroupOwnedRoles.forEach(assertRoleGuide);
    assert(workgroupWorkbench.body.workItems.some(item => item.type === 'process_quality'), '工作组组长应看到本工作组流程质量问题');
    assert(workgroupWorkbench.body.workItems.some(item => item.type === 'process_mapping_todo'), '工作组组长应看到本工作组流程映射待办');
    assert(workgroupWorkbench.body.nextActions.some(item => item.roleCode === 'workgroup_lead' || item.roleCode === 'business_contact' || item.roleCode === 'data_quality'), '工作组组长下一步应关联项目工作角色');

    console.log('Role workbench API test passed');
  } finally {
    await stopServer(child);
    try {
      db.close();
    } finally {
      cleanupDb();
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
