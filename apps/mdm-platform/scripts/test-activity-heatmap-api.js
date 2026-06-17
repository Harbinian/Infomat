const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const APP_ROOT = path.join(__dirname, '..');
const PORT = 3124;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'pass1234';
const TEST_PREFIX = 'TEST_ACTIVITY_';

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
        try { parsed = data ? JSON.parse(data) : {}; } catch { /* keep raw */ }
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
    } catch {
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

function dateOffset(daysAgo) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function at(daysAgo, time) {
  return `${dateOffset(daysAgo)} ${time}`;
}

function getRoleId(code) {
  const role = db.prepare('SELECT role_id FROM roles WHERE role_code=?').get(code);
  assert(role, `缺少角色编码: ${code}`);
  return role.role_id;
}

function createUser(employeeNo, name, departmentId, legacyRole, roleCodes) {
  const userId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, employeeNo, departmentId, `${TEST_PREFIX}岗位`, legacyRole, hashPassword(PASSWORD)).lastInsertRowid;

  const insertRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
  roleCodes.forEach(code => insertRole.run(userId, getRoleId(code)));
  return userId;
}

function seedData() {
  const deptA = db.prepare("INSERT INTO departments (name, code, department_type) VALUES (?, ?, '业务')")
    .run(`${TEST_PREFIX}经营发展部`, `${TEST_PREFIX}DEPT_A`).lastInsertRowid;
  const deptB = db.prepare("INSERT INTO departments (name, code, department_type) VALUES (?, ?, '业务')")
    .run(`${TEST_PREFIX}工程技术部`, `${TEST_PREFIX}DEPT_B`).lastInsertRowid;

  const activeUser = createUser(`${TEST_PREFIX}ACTIVE`, '治理活跃用户', deptA, 'owner', ['business_contact']);
  const quietUser = createUser(`${TEST_PREFIX}QUIET`, '普通查看用户', deptB, 'submitter', ['submitter']);
  const adminUser = createUser(`${TEST_PREFIX}ADMIN`, '治理管理员', deptA, 'admin', ['admin']);
  const qualityUser = createUser(`${TEST_PREFIX}QUALITY`, '数据质量员', deptA, 'reviewer', ['data_quality']);

  const capId = db.prepare("INSERT INTO capabilities (name, level, owner_dept_id, status) VALUES (?, 'L1', ?, 'approved')")
    .run(`${TEST_PREFIX}能力`, deptA).lastInsertRowid;
  const processId = db.prepare("INSERT INTO processes (name, capability_id, owner_dept_id, status) VALUES (?, ?, ?, 'approved')")
    .run(`${TEST_PREFIX}流程`, capId, deptA).lastInsertRowid;
  const mappingId = db.prepare(`
    INSERT INTO mappings (process_id, description, owner_dept_id, status, current_step, submitted_by, submitted_at)
    VALUES (?, ?, ?, 'published', 5, ?, ?)
  `).run(processId, `${TEST_PREFIX}映射`, deptA, activeUser, at(1, '09:00:00')).lastInsertRowid;

  db.prepare("INSERT INTO approval_history (mapping_id, step, operator_user_id, action, created_at) VALUES (?, 1, ?, 'submit', ?)")
    .run(mappingId, activeUser, at(1, '09:10:00'));
  db.prepare("INSERT INTO approval_history (mapping_id, step, operator_user_id, action, created_at) VALUES (?, 2, ?, 'approve', ?)")
    .run(mappingId, qualityUser, at(1, '10:00:00'));
  db.prepare("INSERT INTO version_log (entity_type, entity_id, operation, operated_by, operated_at) VALUES ('mapping', ?, 'update', ?, ?)")
    .run(mappingId, activeUser, at(1, '11:00:00'));
  db.prepare("INSERT INTO version_log (entity_type, entity_id, operation, operated_by, operated_at) VALUES ('mapping', ?, 'create', ?, ?)")
    .run(mappingId, activeUser, at(1, '11:20:00'));

  db.prepare(`
    INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, content, urgency, status, done_at, created_at)
    VALUES (?, ?, 'general', ?, ?, 'medium', 'done', ?, ?)
  `).run(deptB, deptA, mappingId, `${TEST_PREFIX}通用治理待办`, at(1, '12:00:00'), at(3, '08:00:00'));

  const snapshotId = db.prepare(`
    INSERT INTO process_governance_snapshots (source_json_path, source_hash, generated_at, stats_json, status)
    VALUES ('test-activity.json', ?, ?, ?, 'active')
  `).run(`${TEST_PREFIX}hash`, dateOffset(1), JSON.stringify({})).lastInsertRowid;
  const qualityCaseId = db.prepare(`
    INSERT INTO process_governance_quality_cases
      (finding_key, first_snapshot_id, latest_snapshot_id, severity, area, source_file, message, dept_name, status, priority)
    VALUES (?, ?, ?, 'BLOCK', 'BBM', 'test.md', ?, ?, 'open', 'high')
  `).run(`${TEST_PREFIX}quality`, snapshotId, snapshotId, `${TEST_PREFIX}质量问题`, `${TEST_PREFIX}经营发展部`).lastInsertRowid;
  db.prepare(`
    INSERT INTO process_governance_quality_case_events (case_id, event_type, actor_user_id, note, created_at)
    VALUES (?, 'commented', ?, '补充整改说明', ?)
  `).run(qualityCaseId, activeUser, at(1, '13:00:00'));
  db.prepare(`
    INSERT INTO process_governance_quality_case_events (case_id, event_type, actor_user_id, note, created_at)
    VALUES (?, 'import_created', NULL, '系统导入', ?)
  `).run(qualityCaseId, at(1, '13:30:00'));

  const mappingRecordId = db.prepare(`
    INSERT INTO process_mapping_records
      (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, l3_name, source_file)
    VALUES (?, 'l3', ?, ?, ?, ?, 'test.md')
  `).run(`${TEST_PREFIX}record`, snapshotId, snapshotId, `${TEST_PREFIX}经营发展部`, `${TEST_PREFIX}L3`).lastInsertRowid;
  const mappingTodoId = db.prepare(`
    INSERT INTO process_mapping_todos
      (todo_key, mapping_record_id, todo_type, first_snapshot_id, latest_snapshot_id, dept_name, message, status, priority)
    VALUES (?, ?, 'verification', ?, ?, ?, ?, 'open', 'medium')
  `).run(`${TEST_PREFIX}todo`, mappingRecordId, snapshotId, snapshotId, `${TEST_PREFIX}经营发展部`, `${TEST_PREFIX}映射待办`).lastInsertRowid;
  db.prepare(`
    INSERT INTO process_mapping_todo_events (todo_id, event_type, actor_user_id, note, created_at)
    VALUES (?, 'submitted', ?, '已提交处理说明', ?)
  `).run(mappingTodoId, activeUser, at(1, '14:00:00'));

  db.prepare(`
    INSERT INTO terms (term, term_type_code, definition, status, created_by, created_at, approved_by, approved_at)
    VALUES (?, 'noun', '测试定义', 'approved', ?, ?, ?, ?)
  `).run(`${TEST_PREFIX}术语`, activeUser, at(1, '09:30:00'), qualityUser, at(1, '15:00:00'));

  db.prepare(`
    INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status, resolved_by, resolved_at, created_at)
    VALUES (?, ?, 'A', ?, 'B', 'error', 'resolved', ?, ?, ?)
  `).run(`${TEST_PREFIX}冲突`, deptA, deptB, activeUser, at(1, '16:00:00'), at(4, '08:00:00'));

  return { deptA, deptB, activeUser, quietUser, adminUser, qualityUser };
}

function findDay(payload, date) {
  return payload.dates.find(day => day.date === date);
}

async function main() {
  let child;

  try {
    const seeded = seedData();
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: APP_ROOT,
      env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'activity-heatmap-api-test' },
      stdio: 'ignore'
    });
    await waitForServer(child);

    const unauth = await request('GET', '/api/activity/heatmap?scope=me&days=90');
    assert(unauth.status === 401, `未登录访问应返回 401，实际 ${unauth.status}`);

    const activeCookie = await login(`${TEST_PREFIX}ACTIVE`);
    const quietCookie = await login(`${TEST_PREFIX}QUIET`);
    const adminCookie = await login(`${TEST_PREFIX}ADMIN`);
    const qualityCookie = await login(`${TEST_PREFIX}QUALITY`);

    const me = await request('GET', '/api/activity/heatmap?scope=me&days=90', null, activeCookie);
    assert(me.status === 200, `本人治理活跃接口失败: ${me.status} ${JSON.stringify(me.body)}`);
    assert(me.body.scope === 'me', '本人视图应保留 scope=me');
    assert(me.body.days === 90, '本人视图应保留 days=90');
    assert(Array.isArray(me.body.dates) && me.body.dates.length === 90, '应返回完整 90 天日期序列');
    const activeDay = findDay(me.body, dateOffset(1));
    assert(activeDay, '应包含昨天的活跃日期');
    assert(activeDay.count >= 6, `昨天应累计多个有效治理动作，实际 ${activeDay && activeDay.count}`);
    assert(activeDay.level === 3, `6 次以上应为亮色等级 3，实际 ${activeDay && activeDay.level}`);
    assert(activeDay.sources.process_mapping_todo >= 1, '应统计流程映射待办事件');
    assert(activeDay.sources.process_quality >= 1, '应统计流程治理质量事件');
    assert(activeDay.sources.mapping_review >= 1, '应统计映射提交/审核历史');
    assert(activeDay.sources.mapping_version >= 1, '应统计版本日志动作');
    assert(activeDay.sources.terminology >= 1, '应统计术语创建/审核动作');
    assert(activeDay.sources.conflict >= 1, '应统计冲突解决动作');
    assert(!activeDay.sources.login, '不应统计登录活跃');
    assert(me.body.summary.totalActions === me.body.dates.reduce((sum, day) => sum + day.count, 0), '汇总总数应等于日期累计');
    assert(me.body.summary.activeDays >= 1, '应返回活跃天数');

    const quietAll = await request('GET', '/api/activity/heatmap?scope=all&days=90', null, quietCookie);
    assert(quietAll.status === 403, `普通用户请求全量视图应返回 403，实际 ${quietAll.status}`);

    const adminAll = await request('GET', '/api/activity/heatmap?scope=all&days=180', null, adminCookie);
    assert(adminAll.status === 200, `管理员全量视图失败: ${adminAll.status} ${JSON.stringify(adminAll.body)}`);
    assert(adminAll.body.scope === 'all', '管理员视图应保留 scope=all');
    assert(adminAll.body.days === 180, '管理员视图应保留 days=180');
    assert(findDay(adminAll.body, dateOffset(1)).sources.todo_done >= 1, '管理视图应按部门统计通用待办完成');
    assert(adminAll.body.users.some(user => user.userId === seeded.activeUser && user.count >= 6), '管理员视图应包含人员参与汇总');
    assert(adminAll.body.departments.some(dept => dept.departmentId === seeded.deptA && dept.count >= 6), '管理员视图应包含部门参与汇总');

    const deptOnly = await request(`GET`, `/api/activity/heatmap?scope=all&days=180&department_id=${seeded.deptB}`, null, adminCookie);
    assert(deptOnly.status === 200, `部门筛选视图失败: ${deptOnly.status}`);
    assert(deptOnly.body.summary.totalActions === 0, `无治理动作部门应返回 0，实际 ${deptOnly.body.summary.totalActions}`);
    assert(deptOnly.body.dates.length === 180 && deptOnly.body.dates.every(day => day.count === 0), '无数据部门仍应返回完整日期序列');

    const userOnly = await request(`GET`, `/api/activity/heatmap?scope=all&days=180&user_id=${seeded.activeUser}`, null, adminCookie);
    assert(userOnly.status === 200, `人员筛选视图失败: ${userOnly.status}`);
    assert(userOnly.body.users.length === 1 && userOnly.body.users[0].userId === seeded.activeUser, '人员筛选应只返回指定人员');

    const qualityAll = await request('GET', '/api/activity/heatmap?scope=all&days=180', null, qualityCookie);
    assert(qualityAll.status === 200, '数据质量员应可查看管理视图');

    console.log('Activity heatmap API test passed');
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
