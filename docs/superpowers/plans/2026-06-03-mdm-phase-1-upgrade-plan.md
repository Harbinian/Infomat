# MDM 一期升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 MDM 平台在一期内升级为可安全承接流程治理快照、A1 明细、跨部门风险、字段台账衔接和长期蓝图沉淀的平台。

**Architecture:** 先修复数据库路径隔离和测试安全，再新增流程治理快照模型与导入脚本，随后提供只读 API 与平台内视图，最后把字段台账与流程治理快照关联并沉淀一期长期蓝图。PMO 静态驾驶舱继续使用 `docs/company-sankey-data.json` 和 HTML 内嵌快照，暂不切换到登录态 MDM API。

**Tech Stack:** Node.js, Express.js, better-sqlite3, vanilla HTML/CSS/JS, SQLite, Markdown/JSON fixture tests.

**Spec:** `docs/superpowers/specs/2026-06-03-mdm-phase-1-upgrade-design.md`

---

## Scope Check

本计划覆盖 MDM 一期升级的完整闭环，但执行顺序保持保守：

1. 任何会清库的验证都必须先迁移到隔离 SQLite 文件。
2. 流程治理数据先以快照方式进入 MDM，不直接写入 `mappings` 审批表。
3. 只读 API 和平台内视图先落地，确认工作流和回写能力不在本计划中打开。
4. PMO 静态驾驶舱继续保留现有链路，本计划只提供未来可替代的技术基础。

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `apps/mdm-platform/server/db.js` | 支持 `MDM_DB_PATH`，新增流程治理表和字段台账关联列 |
| Create | `apps/mdm-platform/scripts/testHelpers/isolatedDb.js` | 为路由测试提供临时数据库路径与清理函数 |
| Modify | `apps/mdm-platform/scripts/test-*.js` | 让所有会重置数据的测试使用隔离库 |
| Modify | `apps/mdm-platform/package.json` | 增加流程治理相关测试与导入命令 |
| Create | `apps/mdm-platform/scripts/test-db-path-isolation.js` | 验证数据库路径隔离 |
| Create | `apps/mdm-platform/scripts/test-process-governance-schema.js` | 验证新增表结构 |
| Create | `apps/mdm-platform/scripts/test-process-governance-import.js` | 验证快照、节点、关系、A1 和跨部门数据导入 |
| Create | `apps/mdm-platform/scripts/test-process-governance-api.js` | 验证只读 API 契约 |
| Create | `apps/mdm-platform/scripts/test-process-governance-frontend.js` | 验证平台内流程治理页面挂钩 |
| Create | `apps/mdm-platform/scripts/fixtures/process-governance-snapshot.json` | 小型流程治理 JSON fixture |
| Create | `apps/mdm-platform/scripts/fixtures/process-governance-a1.md` | 小型 A1 Markdown fixture |
| Create | `apps/mdm-platform/scripts/lib/processGovernanceImport.js` | JSON/Markdown 导入、hash、节点分类和快照写入 |
| Create | `apps/mdm-platform/scripts/import-process-governance.js` | 从当前仓库真源导入流程治理快照 |
| Create | `apps/mdm-platform/scripts/check-process-governance.js` | 校验 MDM 快照与 JSON 统计一致 |
| Create | `apps/mdm-platform/scripts/sync-process-governance-org.js` | 同步流程治理部门口径，归档非流程治理部门 |
| Create | `apps/mdm-platform/server/routes/processGovernance.js` | 只读流程治理 API |
| Modify | `apps/mdm-platform/server/index.js` | 注册 `/api/process-governance` |
| Modify | `apps/mdm-platform/public/index.html` | 新增“流程治理”入口和只读视图 |
| Modify | `apps/mdm-platform/scripts/test-frontend-assets.js` | 验证新增前端入口和 API hook |
| Create | `docs/superpowers/specs/2026-06-03-mdm-phase-1-long-term-blueprint.md` | 一期长期蓝图沉淀 |
| Modify | `apps/mdm-platform/README.md` | 增加升级后的命令和安全说明 |

---

### Task 1: Database Path Isolation

**Files:**
- Create: `apps/mdm-platform/scripts/test-db-path-isolation.js`
- Modify: `apps/mdm-platform/server/db.js`
- Modify: `apps/mdm-platform/package.json`

- [ ] **Step 1: Write the failing isolation test**

Create `apps/mdm-platform/scripts/test-db-path-isolation.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-db-path-'));
const tempDb = path.join(tempDir, 'isolated-platform.db');

const child = spawnSync(process.execPath, ['-e', `
  const db = require('./server/db');
  db.prepare('CREATE TABLE IF NOT EXISTS isolation_probe (id INTEGER PRIMARY KEY)').run();
  db.prepare('INSERT INTO isolation_probe DEFAULT VALUES').run();
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM isolation_probe').get();
  console.log(JSON.stringify({ dbPath: db.__dbPath, count: row.cnt }));
`], {
  cwd: root,
  env: { ...process.env, MDM_DB_PATH: tempDb },
  encoding: 'utf8'
});

assert.strictEqual(child.status, 0, child.stderr);
const payload = JSON.parse(child.stdout.trim());
assert.strictEqual(path.resolve(payload.dbPath), path.resolve(tempDb));
assert.strictEqual(payload.count, 1);
assert.ok(fs.existsSync(tempDb), 'isolated db file should be created');

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('DB path isolation test passed');
```

- [ ] **Step 2: Register the test script**

Modify `apps/mdm-platform/package.json` scripts:

```json
"test:db-path": "node scripts/test-db-path-isolation.js"
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
cd apps/mdm-platform
npm run test:db-path
```

Expected: FAIL because `db.__dbPath` is not exposed and `server/db.js` ignores `MDM_DB_PATH`.

- [ ] **Step 4: Implement environment-based database path**

Modify the top of `apps/mdm-platform/server/db.js` from:

```js
const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'platform.db'));
```

to:

```js
const defaultDataDir = path.join(__dirname, '../data');
const dbPath = process.env.MDM_DB_PATH
  ? path.resolve(process.env.MDM_DB_PATH)
  : path.join(defaultDataDir, 'platform.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.__dbPath = dbPath;
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd apps/mdm-platform
npm run test:db-path
```

Expected: PASS with `DB path isolation test passed`.

- [ ] **Step 6: Commit**

```bash
git add apps/mdm-platform/server/db.js apps/mdm-platform/package.json apps/mdm-platform/scripts/test-db-path-isolation.js
git commit -m "test(mdm): isolate sqlite database path"
```

---

### Task 2: Move Destructive Tests To Isolated Databases

**Files:**
- Create: `apps/mdm-platform/scripts/testHelpers/isolatedDb.js`
- Modify: `apps/mdm-platform/scripts/test-catalog-routes.js`
- Modify: `apps/mdm-platform/scripts/test-conflict-routes.js`
- Modify: `apps/mdm-platform/scripts/test-delete-routes.js`
- Modify: `apps/mdm-platform/scripts/test-export-route.js`
- Modify: `apps/mdm-platform/scripts/test-import-route.js`
- Modify: `apps/mdm-platform/scripts/test-mapping-routes.js`
- Modify: `apps/mdm-platform/scripts/test-org-route.js`
- Modify: `apps/mdm-platform/scripts/test-security-routes.js`
- Modify: `apps/mdm-platform/scripts/test-term-version-routes.js`
- Modify: `apps/mdm-platform/scripts/test-views-sankey-filters.js`

- [ ] **Step 1: Create the helper**

Create `apps/mdm-platform/scripts/testHelpers/isolatedDb.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');

const testName = path.basename(process.argv[1] || 'mdm-test', '.js').replace(/[^a-zA-Z0-9_-]/g, '-');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${testName}-`));
const testDbPath = path.join(tempDir, 'platform-test.db');

process.env.MDM_DB_PATH = testDbPath;

function cleanupDb() {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

module.exports = { testDbPath, cleanupDb };
```

- [ ] **Step 2: Update route tests to set the database before requiring db**

In every listed test except `test-delete-routes.js`, insert this before `const db = require('../server/db');`:

```js
const { cleanupDb } = require('./testHelpers/isolatedDb');
```

Then change the final cleanup from:

```js
resetData();
```

to:

```js
resetData();
cleanupDb();
```

If a file has more than one final cleanup path, call `cleanupDb()` after the last `resetData()` in the `finally` block.

- [ ] **Step 3: Update the delete-route test**

Modify the top of `apps/mdm-platform/scripts/test-delete-routes.js` from:

```js
const fs = require('fs');
const path = require('path');

const PORT = 3219;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbPath = path.join(__dirname, '..', 'data', 'platform.db');

if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = require('../server/db');
```

to:

```js
const path = require('path');
const { cleanupDb, testDbPath } = require('./testHelpers/isolatedDb');

const PORT = 3219;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const db = require('../server/db');
```

Then add this assertion immediately after requiring `db`:

```js
if (path.resolve(db.__dbPath) !== path.resolve(testDbPath)) {
  throw new Error('delete route test is not using the isolated database');
}
```

Call `cleanupDb()` at the end of the `finally` block.

- [ ] **Step 4: Run representative tests**

Run:

```bash
cd apps/mdm-platform
npm run test:views
npm run test:mappings
npm run test:delete
```

Expected: all pass and `apps/mdm-platform/data/platform.db` is not deleted.

- [ ] **Step 5: Run all MDM route tests**

Run:

```bash
cd apps/mdm-platform
npm run test:org
npm run test:catalog
npm run test:mappings
npm run test:conflicts
npm run test:terms
npm run test:export
npm run test:import
npm run test:security
npm run test:views
npm run test:delete
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mdm-platform/scripts/testHelpers/isolatedDb.js apps/mdm-platform/scripts/test-catalog-routes.js apps/mdm-platform/scripts/test-conflict-routes.js apps/mdm-platform/scripts/test-delete-routes.js apps/mdm-platform/scripts/test-export-route.js apps/mdm-platform/scripts/test-import-route.js apps/mdm-platform/scripts/test-mapping-routes.js apps/mdm-platform/scripts/test-org-route.js apps/mdm-platform/scripts/test-security-routes.js apps/mdm-platform/scripts/test-term-version-routes.js apps/mdm-platform/scripts/test-views-sankey-filters.js
git commit -m "test(mdm): run destructive tests on isolated sqlite files"
```

---

### Task 3: Align MDM Organization Scope With Process Governance

**Files:**
- Create: `apps/mdm-platform/scripts/sync-process-governance-org.js`
- Create: `apps/mdm-platform/scripts/test-process-governance-org-sync.js`
- Modify: `apps/mdm-platform/package.json`
- Modify: `apps/mdm-platform/scripts/seed-demo-data.js`
- Modify: `apps/mdm-platform/scripts/setup-mdm-project-users.js`

- [ ] **Step 1: Write the org sync test**

Create `apps/mdm-platform/scripts/test-process-governance-org-sync.js`:

```js
const assert = require('assert');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { syncProcessGovernanceOrg } = require('./sync-process-governance-org');

db.prepare("INSERT INTO departments (name, code, status, department_type) VALUES ('公司领导', 'DEPT_GSLD', 'active', '其他')").run();
db.prepare("INSERT INTO departments (name, code, status, department_type) VALUES ('信息化部', 'IT', 'active', '其他')").run();

syncProcessGovernanceOrg({ db });

const active = db.prepare("SELECT name FROM departments WHERE status='active' ORDER BY sort_order, name").all().map(row => row.name);
assert.deepStrictEqual(active, [
  '工程技术部',
  '质量管理部',
  '财务部',
  '行政人事部',
  '经营发展部',
  '物资保障部',
  '项目管理部',
  '复材车间',
  '运维安环部'
]);

const archived = db.prepare("SELECT name FROM departments WHERE status='archived' ORDER BY name").all().map(row => row.name);
assert.deepStrictEqual(archived, ['公司领导', '信息化部']);

cleanupDb();
console.log('Process governance org sync test passed');
```

- [ ] **Step 2: Implement the sync script**

Create `apps/mdm-platform/scripts/sync-process-governance-org.js`:

```js
const db = require('../server/db');

const PROCESS_GOVERNANCE_DEPARTMENTS = [
  { name: '工程技术部', code: 'DEPT_GCJS', domain: '总经理直辖域', type: '业务', sort: 10 },
  { name: '质量管理部', code: 'DEPT_ZLGL', domain: '总经理直辖域', type: '职能', sort: 20 },
  { name: '财务部', code: 'DEPT_CW', domain: '总经理直辖域', type: '职能', sort: 30 },
  { name: '行政人事部', code: 'DEPT_XZRS', domain: '经营域', type: '职能', sort: 40 },
  { name: '经营发展部', code: 'DEPT_JYFZ', domain: '经营域', type: '业务', sort: 50 },
  { name: '物资保障部', code: 'DEPT_WZBZ', domain: '经营域', type: '业务', sort: 60 },
  { name: '项目管理部', code: 'DEPT_XMGL', domain: '生产域', type: '业务', sort: 70 },
  { name: '复材车间', code: 'DEPT_FCCJ', domain: '生产域', type: '生产', sort: 80 },
  { name: '运维安环部', code: 'DEPT_YWAH', domain: '生产域', type: '职能', sort: 90 }
];

function syncProcessGovernanceOrg(options = {}) {
  const database = options.db || db;
  const expectedNames = new Set(PROCESS_GOVERNANCE_DEPARTMENTS.map(item => item.name));

  const insertDept = database.prepare(`
    INSERT INTO departments (name, code, department_type, sort_order, status, source_system, external_id)
    VALUES (?, ?, ?, ?, 'active', 'PROCESS_GOVERNANCE', ?)
  `);
  const updateDept = database.prepare(`
    UPDATE departments
    SET code=?, department_type=?, sort_order=?, status='active', source_system='PROCESS_GOVERNANCE', external_id=?, updated_at=datetime('now')
    WHERE name=?
  `);

  const tx = database.transaction(() => {
    for (const item of PROCESS_GOVERNANCE_DEPARTMENTS) {
      const existing = database.prepare('SELECT id FROM departments WHERE name=?').get(item.name);
      if (existing) {
        updateDept.run(item.code, item.type, item.sort, item.domain, item.name);
      } else {
        insertDept.run(item.name, item.code, item.type, item.sort, item.domain);
      }
    }

    const rows = database.prepare("SELECT id, name FROM departments WHERE status='active'").all();
    for (const row of rows) {
      if (!expectedNames.has(row.name)) {
        database.prepare("UPDATE departments SET status='archived', updated_at=datetime('now') WHERE id=?").run(row.id);
      }
    }
  });

  tx();
}

if (require.main === module) {
  syncProcessGovernanceOrg();
  console.log('Process governance organization scope synchronized');
}

module.exports = { PROCESS_GOVERNANCE_DEPARTMENTS, syncProcessGovernanceOrg };
```

- [ ] **Step 3: Register scripts**

Modify `apps/mdm-platform/package.json` scripts:

```json
"sync:process-org": "node scripts/sync-process-governance-org.js",
"test:process-org": "node scripts/test-process-governance-org-sync.js"
```

- [ ] **Step 4: Guard demo seed scripts**

At the top of `apps/mdm-platform/scripts/seed-demo-data.js`, after the existing requires, add:

```js
if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('seed-demo-data.js is demo-only. Set ALLOW_DEMO_SEED=true to run it intentionally.');
  process.exit(1);
}
```

At the top of `apps/mdm-platform/scripts/setup-mdm-project-users.js`, after the existing requires, add:

```js
if (process.env.ALLOW_PROJECT_USER_SETUP !== 'true') {
  console.error('setup-mdm-project-users.js uses project-roster scope. Set ALLOW_PROJECT_USER_SETUP=true to run it intentionally.');
  process.exit(1);
}
```

- [ ] **Step 5: Run verification**

Run:

```bash
cd apps/mdm-platform
npm run test:process-org
```

Expected: PASS with `Process governance org sync test passed`.

- [ ] **Step 6: Commit**

```bash
git add apps/mdm-platform/package.json apps/mdm-platform/scripts/sync-process-governance-org.js apps/mdm-platform/scripts/test-process-governance-org-sync.js apps/mdm-platform/scripts/seed-demo-data.js apps/mdm-platform/scripts/setup-mdm-project-users.js
git commit -m "feat(mdm): align organization scope for process governance"
```

---

### Task 4: Add Process Governance Schema

**Files:**
- Create: `apps/mdm-platform/scripts/test-process-governance-schema.js`
- Modify: `apps/mdm-platform/server/db.js`
- Modify: `apps/mdm-platform/package.json`

- [ ] **Step 1: Write the schema test**

Create `apps/mdm-platform/scripts/test-process-governance-schema.js`:

```js
const assert = require('assert');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');

function tableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => row.name);
}

[
  'process_governance_snapshots',
  'process_governance_nodes',
  'process_governance_edges',
  'process_a1_items',
  'process_cross_dept_interactions',
  'process_interaction_chains'
].forEach(tableName => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  assert.ok(row, `${tableName} should exist`);
});

assert.ok(tableColumns('process_governance_snapshots').includes('source_hash'));
assert.ok(tableColumns('process_governance_nodes').includes('node_type'));
assert.ok(tableColumns('process_governance_edges').includes('edge_type'));
assert.ok(tableColumns('process_a1_items').includes('a1_code'));
assert.ok(tableColumns('process_cross_dept_interactions').includes('confirm_status'));
assert.ok(tableColumns('process_interaction_chains').includes('breaks_json'));
assert.ok(tableColumns('field_entries').includes('process_governance_node_key'));
assert.ok(tableColumns('field_entries').includes('process_governance_a1_code'));

cleanupDb();
console.log('Process governance schema test passed');
```

- [ ] **Step 2: Add the schema**

In `apps/mdm-platform/server/db.js`, after the existing core MDM tables and before RBAC seed logic, add:

```js
db.exec(`
CREATE TABLE IF NOT EXISTS process_governance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_json_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  generated_at TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  imported_by INTEGER REFERENCES users(id),
  stats_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS process_governance_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN ('root','domain','department','l2','l3','a1','system')),
  name TEXT NOT NULL,
  domain_name TEXT,
  dept_name TEXT,
  parent_key TEXT,
  source_file TEXT,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(snapshot_id, node_key)
);

CREATE TABLE IF NOT EXISTS process_governance_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  target_key TEXT NOT NULL,
  edge_type TEXT NOT NULL CHECK(edge_type IN ('root_domain','domain_dept','dept_l2','l2_l3','l3_a1','l3_system','a1_system')),
  value REAL NOT NULL DEFAULT 1,
  source_file TEXT,
  UNIQUE(snapshot_id, source_key, target_key, edge_type)
);

CREATE TABLE IF NOT EXISTS process_a1_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  a1_code TEXT,
  dept_name TEXT,
  l3_name TEXT,
  behavior TEXT NOT NULL,
  execution_role TEXT,
  approval_type TEXT,
  input_source_dept TEXT,
  output_target_dept TEXT,
  suggested_systems TEXT,
  verification_note TEXT,
  source_file TEXT
);

CREATE TABLE IF NOT EXISTS process_cross_dept_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  source_dept TEXT,
  target_dept TEXT,
  a1_code TEXT,
  refs INTEGER DEFAULT 0,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('high','medium','low')),
  confirm_status TEXT NOT NULL CHECK(confirm_status IN ('confirmed','pending','needs_review','not_mapped')),
  description TEXT,
  source_report TEXT
);

CREATE TABLE IF NOT EXISTS process_interaction_chains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('complete','partial','broken')),
  breaks_json TEXT,
  source_report TEXT
);
`);
```

Then add idempotent column migrations:

```js
function ensureColumn(tableName, columnName, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${tableName})`).all().some(row => row.name === columnName);
  if (!exists) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
}

ensureColumn('field_entries', 'process_governance_node_key', 'process_governance_node_key TEXT');
ensureColumn('field_entries', 'process_governance_a1_code', 'process_governance_a1_code TEXT');
```

If `ensureColumn` already exists in `db.js`, reuse the existing helper name and do not add a duplicate.

- [ ] **Step 3: Register the schema test**

Modify `apps/mdm-platform/package.json` scripts:

```json
"test:process-schema": "node scripts/test-process-governance-schema.js"
```

- [ ] **Step 4: Run the schema test**

Run:

```bash
cd apps/mdm-platform
npm run test:process-schema
```

Expected: PASS with `Process governance schema test passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/mdm-platform/server/db.js apps/mdm-platform/package.json apps/mdm-platform/scripts/test-process-governance-schema.js
git commit -m "feat(mdm): add process governance schema"
```

---

### Task 5: Import Process Governance Snapshot

**Files:**
- Create: `apps/mdm-platform/scripts/fixtures/process-governance-snapshot.json`
- Create: `apps/mdm-platform/scripts/fixtures/process-governance-a1.md`
- Create: `apps/mdm-platform/scripts/lib/processGovernanceImport.js`
- Create: `apps/mdm-platform/scripts/import-process-governance.js`
- Create: `apps/mdm-platform/scripts/check-process-governance.js`
- Create: `apps/mdm-platform/scripts/test-process-governance-import.js`
- Modify: `apps/mdm-platform/package.json`

- [ ] **Step 1: Create the JSON fixture**

Create `apps/mdm-platform/scripts/fixtures/process-governance-snapshot.json`:

```json
{
  "nodes": [
    { "name": "昌兴复材" },
    { "name": "经营域" },
    { "name": "经营发展部" },
    { "name": "合同管理" },
    { "name": "销售订单评审和执行管理" },
    { "name": "接收订单并组织评审" },
    { "name": "OA" },
    { "name": "ERP" }
  ],
  "links": [
    { "source": "昌兴复材", "target": "经营域", "value": 1 },
    { "source": "经营域", "target": "经营发展部", "value": 1 },
    { "source": "经营发展部", "target": "合同管理", "value": 1 },
    { "source": "合同管理", "target": "销售订单评审和执行管理", "value": 1 },
    { "source": "销售订单评审和执行管理", "target": "接收订单并组织评审", "value": 1 },
    { "source": "接收订单并组织评审", "target": "OA", "value": 1 },
    { "source": "销售订单评审和执行管理", "target": "ERP", "value": 1 }
  ],
  "systems": ["ERP", "OA"],
  "stats": {
    "mappings": 1,
    "a1": 1,
    "departmentsWithData": 1,
    "departmentsEmpty": 8
  },
  "crossDept": {
    "stats": {
      "totalChecked": 1,
      "confirmed": 0,
      "pendingConfirm": 1,
      "highRisk": 1,
      "mediumRisk": 0
    },
    "risks": [
      {
        "source": "经营发展部",
        "target": "工程技术部",
        "a1": "JY-L3-01-A1-001",
        "refs": 1,
        "risk": "high",
        "status": "未映射-无文档",
        "desc": "订单评审需要技术条款输入，目标侧流程待补全。"
      }
    ],
    "interactionChains": [
      {
        "name": "订单评审链",
        "status": "partial",
        "breaks": ["工程技术部: 技术条款评审节点待补全"]
      }
    ],
    "source": "docs/norms/流程治理/跨部门完整性检查报告.md"
  }
}
```

- [ ] **Step 2: Create the A1 Markdown fixture**

Create `apps/mdm-platform/scripts/fixtures/process-governance-a1.md`:

```markdown
# 经营发展部部门-能力-流程-系统映射关系

## 业务行为（A1）映射

##### 业务流程（L3）-001 销售订单评审和执行管理

| A1编号 | 业务行为 | 执行角色 | 审批类型 | 输入来源部门 | 输出目标部门 | 应用系统 | 核验提醒 |
|---|---|---|---|---|---|---|---|
| JY-L3-01-A1-001 | 接收订单并组织评审 | 合同管理员 | 审批 | 项目管理部 | 工程技术部 | OA / ERP | 核对技术条款输入 |
```

- [ ] **Step 3: Write the failing import test**

Create `apps/mdm-platform/scripts/test-process-governance-import.js`:

```js
const assert = require('assert');
const path = require('path');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const snapshotPath = path.join(__dirname, 'fixtures', 'process-governance-snapshot.json');
const a1Path = path.join(__dirname, 'fixtures', 'process-governance-a1.md');

const snapshotId = importProcessGovernanceSnapshot({
  db,
  sourceJsonPath: snapshotPath,
  a1MarkdownPaths: [a1Path],
  importedBy: null,
  note: 'fixture import'
});

assert.ok(snapshotId > 0);

const snapshot = db.prepare('SELECT * FROM process_governance_snapshots WHERE id=?').get(snapshotId);
assert.strictEqual(snapshot.status, 'active');
assert.ok(snapshot.source_hash.length >= 32);
assert.ok(JSON.parse(snapshot.stats_json).mappings === 1);

const nodeTypes = db.prepare(`
  SELECT node_type, COUNT(*) AS cnt
  FROM process_governance_nodes
  WHERE snapshot_id=?
  GROUP BY node_type
`).all(snapshotId).reduce((acc, row) => {
  acc[row.node_type] = row.cnt;
  return acc;
}, {});

assert.strictEqual(nodeTypes.root, 1);
assert.strictEqual(nodeTypes.domain, 1);
assert.strictEqual(nodeTypes.department, 1);
assert.strictEqual(nodeTypes.l2, 1);
assert.strictEqual(nodeTypes.l3, 1);
assert.strictEqual(nodeTypes.a1, 1);
assert.strictEqual(nodeTypes.system, 2);

const a1 = db.prepare('SELECT * FROM process_a1_items WHERE snapshot_id=?').get(snapshotId);
assert.strictEqual(a1.a1_code, 'JY-L3-01-A1-001');
assert.strictEqual(a1.output_target_dept, '工程技术部');
assert.strictEqual(JSON.parse(a1.suggested_systems).join(','), 'OA,ERP');

const risk = db.prepare('SELECT * FROM process_cross_dept_interactions WHERE snapshot_id=?').get(snapshotId);
assert.strictEqual(risk.risk_level, 'high');
assert.strictEqual(risk.confirm_status, 'not_mapped');

const chain = db.prepare('SELECT * FROM process_interaction_chains WHERE snapshot_id=?').get(snapshotId);
assert.strictEqual(chain.name, '订单评审链');
assert.deepStrictEqual(JSON.parse(chain.breaks_json), ['工程技术部: 技术条款评审节点待补全']);

cleanupDb();
console.log('Process governance import test passed');
```

- [ ] **Step 4: Implement the import library**

Create `apps/mdm-platform/scripts/lib/processGovernanceImport.js`:

```js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DOMAIN_NAMES = new Set(['总经理直辖域', '经营域', '生产域']);
const DEPT_DOMAIN = {
  工程技术部: '总经理直辖域',
  质量管理部: '总经理直辖域',
  财务部: '总经理直辖域',
  行政人事部: '经营域',
  经营发展部: '经营域',
  物资保障部: '经营域',
  项目管理部: '生产域',
  复材车间: '生产域',
  运维安环部: '生产域'
};

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function splitMarkdownRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function normalizeSystems(value) {
  return String(value || '')
    .split(/[、,，/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseA1Markdown(text, sourceFile) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let currentL3 = '';
  let header = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#####') && trimmed.includes('业务流程')) {
      currentL3 = trimmed.replace(/^#+\s*/, '').replace(/业务流程（L3）[-\d\s]*/, '').trim();
      header = null;
      continue;
    }
    if (!trimmed.startsWith('|')) continue;
    const cells = splitMarkdownRow(trimmed);
    if (cells.some(cell => /^-+$/.test(cell.replace(/:/g, '')))) continue;
    if (cells.includes('A1编号') || cells.includes('业务行为')) {
      header = cells;
      continue;
    }
    if (!header) continue;

    const get = name => {
      const index = header.indexOf(name);
      return index >= 0 ? cells[index] || '' : '';
    };

    const behavior = get('业务行为');
    if (!behavior) continue;

    rows.push({
      a1_code: get('A1编号'),
      l3_name: currentL3,
      behavior,
      execution_role: get('执行角色'),
      approval_type: get('审批类型'),
      input_source_dept: get('输入来源部门'),
      output_target_dept: get('输出目标部门'),
      suggested_systems: normalizeSystems(get('应用系统')),
      verification_note: get('核验提醒'),
      source_file: sourceFile
    });
  }

  return rows;
}

function deriveNodeTypes(data) {
  const systems = new Set(data.systems || []);
  const outgoing = new Map();
  for (const link of data.links || []) {
    if (!outgoing.has(link.source)) outgoing.set(link.source, []);
    outgoing.get(link.source).push(link.target);
  }

  const depth = new Map();
  const queue = ['昌兴复材'];
  depth.set('昌兴复材', 0);
  while (queue.length > 0) {
    const current = queue.shift();
    const nextDepth = depth.get(current) + 1;
    for (const target of outgoing.get(current) || []) {
      if (!depth.has(target) || nextDepth < depth.get(target)) {
        depth.set(target, nextDepth);
        queue.push(target);
      }
    }
  }

  const result = new Map();
  for (const node of data.nodes || []) {
    const name = node.name;
    if (name === '昌兴复材') result.set(name, 'root');
    else if (DOMAIN_NAMES.has(name)) result.set(name, 'domain');
    else if (Object.prototype.hasOwnProperty.call(DEPT_DOMAIN, name)) result.set(name, 'department');
    else if (systems.has(name)) result.set(name, 'system');
    else if ((depth.get(name) || 0) === 3) result.set(name, 'l2');
    else if ((depth.get(name) || 0) === 4) result.set(name, 'l3');
    else result.set(name, 'a1');
  }
  return result;
}

function edgeType(sourceType, targetType) {
  const key = `${sourceType}_${targetType}`;
  const map = {
    root_domain: 'root_domain',
    domain_department: 'domain_dept',
    department_l2: 'dept_l2',
    l2_l3: 'l2_l3',
    l3_a1: 'l3_a1',
    l3_system: 'l3_system',
    a1_system: 'a1_system'
  };
  return map[key] || 'l3_a1';
}

function confirmStatusFromRiskStatus(status) {
  const text = String(status || '');
  if (text.includes('无文档') || text.includes('未映射')) return 'not_mapped';
  if (text.includes('待确认')) return 'pending';
  if (text.includes('待复核')) return 'needs_review';
  return 'confirmed';
}

function importProcessGovernanceSnapshot(options) {
  const database = options.db;
  const sourceJsonPath = path.resolve(options.sourceJsonPath);
  const raw = fs.readFileSync(sourceJsonPath, 'utf8');
  const data = JSON.parse(raw);
  const sourceHash = sha256(raw);
  const nodeTypes = deriveNodeTypes(data);

  const tx = database.transaction(() => {
    database.prepare("UPDATE process_governance_snapshots SET status='archived' WHERE status='active'").run();

    const result = database.prepare(`
      INSERT INTO process_governance_snapshots (source_json_path, source_hash, generated_at, imported_by, stats_json, status, note)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).run(
      sourceJsonPath,
      sourceHash,
      data.generatedAt || null,
      options.importedBy || null,
      JSON.stringify({ ...data.stats, crossDept: data.crossDept ? data.crossDept.stats : {} }),
      options.note || null
    );

    const snapshotId = result.lastInsertRowid;
    const insertNode = database.prepare(`
      INSERT INTO process_governance_nodes
        (snapshot_id, node_key, node_type, name, domain_name, dept_name, parent_key, source_file, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEdge = database.prepare(`
      INSERT INTO process_governance_edges
        (snapshot_id, source_key, target_key, edge_type, value, source_file)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const parentByTarget = new Map();
    for (const link of data.links || []) parentByTarget.set(link.target, link.source);

    (data.nodes || []).forEach((node, index) => {
      const type = nodeTypes.get(node.name);
      const domainName = type === 'domain' ? node.name : type === 'department' ? DEPT_DOMAIN[node.name] || null : null;
      const deptName = type === 'department' ? node.name : null;
      insertNode.run(snapshotId, node.name, type, node.name, domainName, deptName, parentByTarget.get(node.name) || null, sourceJsonPath, index + 1);
    });

    for (const link of data.links || []) {
      const sourceType = nodeTypes.get(link.source);
      const targetType = nodeTypes.get(link.target);
      insertEdge.run(snapshotId, link.source, link.target, edgeType(sourceType, targetType), Number(link.value) || 1, sourceJsonPath);
    }

    const insertA1 = database.prepare(`
      INSERT INTO process_a1_items
        (snapshot_id, a1_code, dept_name, l3_name, behavior, execution_role, approval_type, input_source_dept, output_target_dept, suggested_systems, verification_note, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const markdownPath of options.a1MarkdownPaths || []) {
      const markdownRaw = fs.readFileSync(markdownPath, 'utf8');
      const deptMatch = path.basename(markdownPath).match(/^(.+?)部门-/);
      const deptName = deptMatch ? deptMatch[1] : null;
      for (const item of parseA1Markdown(markdownRaw, markdownPath)) {
        insertA1.run(snapshotId, item.a1_code || null, deptName, item.l3_name, item.behavior, item.execution_role || null, item.approval_type || null, item.input_source_dept || null, item.output_target_dept || null, JSON.stringify(item.suggested_systems), item.verification_note || null, item.source_file);
      }
    }

    const insertRisk = database.prepare(`
      INSERT INTO process_cross_dept_interactions
        (snapshot_id, source_dept, target_dept, a1_code, refs, risk_level, confirm_status, description, source_report)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const risk of data.crossDept && data.crossDept.risks ? data.crossDept.risks : []) {
      insertRisk.run(snapshotId, risk.source || null, risk.target || null, risk.a1 || null, Number(risk.refs) || 0, risk.risk, confirmStatusFromRiskStatus(risk.status), risk.desc || null, data.crossDept.source || null);
    }

    const insertChain = database.prepare(`
      INSERT INTO process_interaction_chains (snapshot_id, name, status, breaks_json, source_report)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const chain of data.crossDept && data.crossDept.interactionChains ? data.crossDept.interactionChains : []) {
      insertChain.run(snapshotId, chain.name, chain.status, JSON.stringify(chain.breaks || []), data.crossDept.source || null);
    }

    return snapshotId;
  });

  return tx();
}

module.exports = { importProcessGovernanceSnapshot, parseA1Markdown, deriveNodeTypes };
```

- [ ] **Step 5: Create the import command**

Create `apps/mdm-platform/scripts/import-process-governance.js`:

```js
const path = require('path');
const fs = require('fs');
const db = require('../server/db');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceJsonPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'docs', 'company-sankey-data.json');
const normsDir = path.join(repoRoot, 'docs', 'norms');
const a1MarkdownPaths = fs.readdirSync(normsDir)
  .filter(name => name.endsWith('部门-能力-流程-系统映射关系.md'))
  .map(name => path.join(normsDir, name));

const snapshotId = importProcessGovernanceSnapshot({
  db,
  sourceJsonPath,
  a1MarkdownPaths,
  importedBy: null,
  note: 'process governance import'
});

console.log(JSON.stringify({ importedSnapshotId: snapshotId }, null, 2));
```

- [ ] **Step 6: Create the check command**

Create `apps/mdm-platform/scripts/check-process-governance.js`:

```js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const db = require('../server/db');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceJsonPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'docs', 'company-sankey-data.json');
const data = JSON.parse(fs.readFileSync(sourceJsonPath, 'utf8'));

const snapshot = db.prepare("SELECT * FROM process_governance_snapshots WHERE status='active' ORDER BY id DESC LIMIT 1").get();
assert.ok(snapshot, 'active process governance snapshot should exist');
const stats = JSON.parse(snapshot.stats_json);
assert.strictEqual(stats.mappings, data.stats.mappings);
assert.strictEqual(stats.a1, data.stats.a1);
assert.strictEqual(stats.crossDept.totalChecked, data.crossDept.stats.totalChecked);
assert.strictEqual(stats.crossDept.pendingConfirm, data.crossDept.stats.pendingConfirm);
assert.strictEqual(stats.crossDept.highRisk, data.crossDept.stats.highRisk);

const badRisk = db.prepare(`
  SELECT risk_level FROM process_cross_dept_interactions
  WHERE snapshot_id=? AND risk_level NOT IN ('high','medium','low')
`).get(snapshot.id);
assert.strictEqual(badRisk, undefined);

console.log('Process governance snapshot check passed');
```

- [ ] **Step 7: Register scripts**

Modify `apps/mdm-platform/package.json` scripts:

```json
"import:process-governance": "node scripts/import-process-governance.js",
"check:process-governance": "node scripts/check-process-governance.js",
"test:process-import": "node scripts/test-process-governance-import.js"
```

- [ ] **Step 8: Run import tests**

Run:

```bash
cd apps/mdm-platform
npm run test:process-import
```

Expected: PASS with `Process governance import test passed`.

- [ ] **Step 9: Run import against current repository data**

Run:

```bash
cd apps/mdm-platform
npm run import:process-governance
npm run check:process-governance
```

Expected: JSON output with `importedSnapshotId`, then `Process governance snapshot check passed`.

- [ ] **Step 10: Commit**

```bash
git add apps/mdm-platform/package.json apps/mdm-platform/scripts/fixtures/process-governance-snapshot.json apps/mdm-platform/scripts/fixtures/process-governance-a1.md apps/mdm-platform/scripts/lib/processGovernanceImport.js apps/mdm-platform/scripts/import-process-governance.js apps/mdm-platform/scripts/check-process-governance.js apps/mdm-platform/scripts/test-process-governance-import.js
git commit -m "feat(mdm): import process governance snapshots"
```

---

### Task 6: Add Read-Only Process Governance API

**Files:**
- Create: `apps/mdm-platform/server/routes/processGovernance.js`
- Create: `apps/mdm-platform/scripts/test-process-governance-api.js`
- Modify: `apps/mdm-platform/server/index.js`
- Modify: `apps/mdm-platform/package.json`

- [ ] **Step 1: Write the API test**

Create `apps/mdm-platform/scripts/test-process-governance-api.js`:

```js
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const PORT = 3226;
const BASE_URL = `http://127.0.0.1:${PORT}`;

db.prepare("INSERT INTO users (name, employee_no, post, role, password_hash) VALUES (?, ?, ?, ?, ?)").run('系统管理员', 'ADMIN001', '系统管理员', 'admin', hashPassword('admin123'));

importProcessGovernanceSnapshot({
  db,
  sourceJsonPath: path.join(__dirname, 'fixtures', 'process-governance-snapshot.json'),
  a1MarkdownPaths: [path.join(__dirname, 'fixtures', 'process-governance-a1.md')],
  importedBy: null,
  note: 'api fixture'
});

function waitForServer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const tick = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) return resolve();
      } catch (error) {
        if (Date.now() > deadline) return reject(error);
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

async function request(routePath, options = {}, cookie = '') {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  };
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
  const body = await res.json();
  return { res, body };
}

async function stopServer(server) {
  return new Promise(resolve => {
    server.once('exit', resolve);
    server.kill();
    setTimeout(resolve, 2000);
  });
}

async function main() {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'process-governance-api-test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();
    const unauthorized = await request('/api/process-governance/current');
    assert.strictEqual(unauthorized.res.status, 401);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];

    const sankey = await request('/api/process-governance/sankey', {}, cookie);
    assert.strictEqual(sankey.res.status, 200);
    assert.strictEqual(sankey.body.stats.mappings, 1);
    assert.strictEqual(sankey.body.systems.join(','), 'ERP,OA');
    assert.strictEqual(sankey.body.crossDept.stats.highRisk, 1);
    assert.ok(sankey.body.nodes.some(node => node.name === '经营发展部'));

    const a1 = await request('/api/process-governance/a1?dept=经营发展部', {}, cookie);
    assert.strictEqual(a1.res.status, 200);
    assert.strictEqual(a1.body.items[0].a1_code, 'JY-L3-01-A1-001');

    const risks = await request('/api/process-governance/cross-dept?risk=high', {}, cookie);
    assert.strictEqual(risks.res.status, 200);
    assert.strictEqual(risks.body.items[0].target_dept, '工程技术部');

    console.log('Process governance API test passed');
  } finally {
    await stopServer(server);
    cleanupDb();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Implement the route**

Create `apps/mdm-platform/server/routes/processGovernance.js`:

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function activeSnapshot() {
  return db.prepare("SELECT * FROM process_governance_snapshots WHERE status='active' ORDER BY id DESC LIMIT 1").get();
}

function noSnapshot(res) {
  return res.json({ snapshots: [], nodes: [], links: [], systems: [], stats: {}, crossDept: { stats: {}, risks: [], interactionChains: [] } });
}

function snapshotStats(snapshot) {
  return snapshot ? JSON.parse(snapshot.stats_json || '{}') : {};
}

router.get('/snapshots', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, source_json_path, source_hash, imported_at, status, note
    FROM process_governance_snapshots
    ORDER BY id DESC
  `).all();
  res.json(rows);
});

router.get('/current', requireAuth, (req, res) => {
  const snapshot = activeSnapshot();
  if (!snapshot) return res.json({});
  res.json({
    id: snapshot.id,
    source_json_path: snapshot.source_json_path,
    source_hash: snapshot.source_hash,
    imported_at: snapshot.imported_at,
    status: snapshot.status,
    stats: snapshotStats(snapshot)
  });
});

router.get('/sankey', requireAuth, (req, res) => {
  const snapshot = activeSnapshot();
  if (!snapshot) return noSnapshot(res);

  const nodes = db.prepare(`
    SELECT node_key AS name, name AS label, node_type, domain_name, dept_name
    FROM process_governance_nodes
    WHERE snapshot_id=?
    ORDER BY sort_order, id
  `).all(snapshot.id);

  const links = db.prepare(`
    SELECT source_key AS source, target_key AS target, value
    FROM process_governance_edges
    WHERE snapshot_id=?
    ORDER BY id
  `).all(snapshot.id);

  const systems = nodes.filter(node => node.node_type === 'system').map(node => node.name).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const stats = snapshotStats(snapshot);
  const risks = db.prepare(`
    SELECT source_dept AS source, target_dept AS target, a1_code AS a1, refs, risk_level AS risk, confirm_status AS status, description AS desc
    FROM process_cross_dept_interactions
    WHERE snapshot_id=?
    ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id
  `).all(snapshot.id);
  const chains = db.prepare(`
    SELECT name, status, breaks_json
    FROM process_interaction_chains
    WHERE snapshot_id=?
    ORDER BY id
  `).all(snapshot.id).map(row => ({ name: row.name, status: row.status, breaks: JSON.parse(row.breaks_json || '[]') }));

  res.json({
    nodes,
    links,
    systems,
    stats: {
      mappings: stats.mappings || 0,
      a1: stats.a1 || 0,
      departmentsWithData: stats.departmentsWithData || 0,
      departmentsEmpty: stats.departmentsEmpty || 0
    },
    crossDept: {
      stats: stats.crossDept || {},
      risks,
      interactionChains: chains,
      source: risks.length > 0 ? db.prepare('SELECT source_report FROM process_cross_dept_interactions WHERE snapshot_id=? LIMIT 1').get(snapshot.id).source_report : null
    }
  });
});

router.get('/a1', requireAuth, (req, res) => {
  const snapshot = activeSnapshot();
  if (!snapshot) return res.json({ items: [] });
  const params = [snapshot.id];
  let sql = 'SELECT * FROM process_a1_items WHERE snapshot_id=?';
  if (req.query.dept) {
    sql += ' AND dept_name=?';
    params.push(req.query.dept);
  }
  if (req.query.l3) {
    sql += ' AND l3_name=?';
    params.push(req.query.l3);
  }
  sql += ' ORDER BY dept_name, l3_name, a1_code, id';
  res.json({ items: db.prepare(sql).all(...params) });
});

router.get('/cross-dept', requireAuth, (req, res) => {
  const snapshot = activeSnapshot();
  if (!snapshot) return res.json({ items: [] });
  const params = [snapshot.id];
  let sql = 'SELECT * FROM process_cross_dept_interactions WHERE snapshot_id=?';
  if (req.query.risk) {
    sql += ' AND risk_level=?';
    params.push(req.query.risk);
  }
  if (req.query.status) {
    sql += ' AND confirm_status=?';
    params.push(req.query.status);
  }
  sql += " ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id";
  res.json({ items: db.prepare(sql).all(...params) });
});

router.get('/chains', requireAuth, (req, res) => {
  const snapshot = activeSnapshot();
  if (!snapshot) return res.json({ items: [] });
  const items = db.prepare('SELECT * FROM process_interaction_chains WHERE snapshot_id=? ORDER BY id').all(snapshot.id)
    .map(row => ({ ...row, breaks: JSON.parse(row.breaks_json || '[]') }));
  res.json({ items });
});

module.exports = router;
```

- [ ] **Step 3: Register the route**

Modify `apps/mdm-platform/server/index.js`:

```js
registerRouteIfExists('/api/process-governance', 'processGovernance');
```

Place it near existing `/api/views` registration.

- [ ] **Step 4: Register the test script**

Modify `apps/mdm-platform/package.json` scripts:

```json
"test:process-api": "node scripts/test-process-governance-api.js"
```

- [ ] **Step 5: Run the API test**

Run:

```bash
cd apps/mdm-platform
npm run test:process-api
```

Expected: PASS with `Process governance API test passed`.

- [ ] **Step 6: Commit**

```bash
git add apps/mdm-platform/server/routes/processGovernance.js apps/mdm-platform/server/index.js apps/mdm-platform/package.json apps/mdm-platform/scripts/test-process-governance-api.js
git commit -m "feat(mdm): expose process governance read api"
```

---

### Task 7: Add Platform Process Governance View

**Files:**
- Modify: `apps/mdm-platform/public/index.html`
- Modify: `apps/mdm-platform/scripts/test-frontend-assets.js`
- Create: `apps/mdm-platform/scripts/test-process-governance-frontend.js`
- Modify: `apps/mdm-platform/package.json`

- [ ] **Step 1: Write the frontend hook test**

Create `apps/mdm-platform/scripts/test-process-governance-frontend.js`:

```js
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
assert.ok(!html.includes('承载最多'), 'frontend copy should avoid evaluative system wording');
assert.ok(!html.includes('系统最忙'), 'frontend copy should avoid evaluative system wording');
assert.ok(!html.includes('主用系统'), 'frontend copy should avoid evaluative system wording');

console.log('Process governance frontend hook test passed');
```

- [ ] **Step 2: Add the tab**

In `apps/mdm-platform/public/index.html`, add this tab after “业务地图”:

```html
<button class="tab" data-tab="processGovernance" data-roles="owner,reviewer,admin">流程治理</button>
```

- [ ] **Step 3: Add the panel markup**

Add this section after the existing business map panel:

```html
<section class="panel" id="processGovernancePanel">
  <div class="section-hd">
    <h1>流程治理</h1>
    <div class="toolbar">
      <select id="pgRiskFilter" style="width: 140px; height: 36px; padding: 0 12px;">
        <option value="">全部风险</option>
        <option value="high">高风险</option>
        <option value="medium">中风险</option>
        <option value="low">低风险</option>
      </select>
      <button class="btn secondary" id="refreshProcessGovernanceBtn">刷新</button>
    </div>
  </div>
  <div class="grid">
    <div class="metric"><div class="num" id="pgMetricL3">0</div><div class="lbl">流程数</div></div>
    <div class="metric"><div class="num" id="pgMetricA1">0</div><div class="lbl">A1 行为</div></div>
    <div class="metric"><div class="num" id="pgMetricCross">0</div><div class="lbl">跨部门检查</div></div>
    <div class="metric"><div class="num" id="pgMetricRisk">0</div><div class="lbl">高风险项</div></div>
  </div>
  <div class="card">
    <h2>A1 明细</h2>
    <div class="table-container">
      <table><thead><tr><th>A1编号</th><th>部门</th><th>流程</th><th>业务行为</th><th>输入来源</th><th>输出目标</th><th>建议落位应用</th></tr></thead><tbody id="pgA1Rows"></tbody></table>
    </div>
  </div>
  <div class="card">
    <h2>跨部门风险</h2>
    <div class="table-container">
      <table><thead><tr><th>来源</th><th>目标</th><th>A1</th><th>引用</th><th>风险</th><th>状态</th><th>说明</th></tr></thead><tbody id="pgRiskRows"></tbody></table>
    </div>
  </div>
</section>
```

- [ ] **Step 4: Add frontend state and renderer**

In the main script, add:

```js
async function renderProcessGovernance() {
  var panel = document.getElementById('processGovernancePanel');
  if (!panel) return;

  try {
    var riskValue = document.getElementById('pgRiskFilter') ? document.getElementById('pgRiskFilter').value : '';
    var sankey = await api('/api/process-governance/sankey');
    var a1 = await api('/api/process-governance/a1');
    var riskQuery = riskValue ? '?risk=' + encodeURIComponent(riskValue) : '';
    var risks = await api('/api/process-governance/cross-dept' + riskQuery);

    document.getElementById('pgMetricL3').textContent = sankey.stats && sankey.stats.mappings ? sankey.stats.mappings : 0;
    document.getElementById('pgMetricA1').textContent = sankey.stats && sankey.stats.a1 ? sankey.stats.a1 : 0;
    document.getElementById('pgMetricCross').textContent = sankey.crossDept && sankey.crossDept.stats && sankey.crossDept.stats.totalChecked ? sankey.crossDept.stats.totalChecked : 0;
    document.getElementById('pgMetricRisk').textContent = sankey.crossDept && sankey.crossDept.stats && sankey.crossDept.stats.highRisk ? sankey.crossDept.stats.highRisk : 0;

    var a1Rows = (a1.items || []).slice(0, 80);
    document.getElementById('pgA1Rows').innerHTML = a1Rows.length
      ? a1Rows.map(function(row) {
          var systems = '';
          try { systems = JSON.parse(row.suggested_systems || '[]').join(', '); } catch (error) { systems = row.suggested_systems || ''; }
          return '<tr><td>' + safeText(row.a1_code) + '</td><td>' + safeText(row.dept_name) + '</td><td>' + safeText(row.l3_name) + '</td><td>' + safeText(row.behavior) + '</td><td>' + safeText(row.input_source_dept) + '</td><td>' + safeText(row.output_target_dept) + '</td><td>' + safeText(systems) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="7" class="empty">暂无 A1 明细</td></tr>';

    var riskRows = risks.items || [];
    document.getElementById('pgRiskRows').innerHTML = riskRows.length
      ? riskRows.map(function(row) {
          return '<tr><td>' + safeText(row.source_dept) + '</td><td>' + safeText(row.target_dept) + '</td><td>' + safeText(row.a1_code) + '</td><td>' + safeText(row.refs) + '</td><td>' + safeText(row.risk_level) + '</td><td>' + safeText(row.confirm_status) + '</td><td>' + safeText(row.description) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="7" class="empty">暂无跨部门风险项</td></tr>';
  } catch (error) {
    panel.innerHTML = '<div class="empty">流程治理数据暂不可用</div>';
  }
}
```

In `renderListPanel`, add:

```js
case 'processGovernance': renderProcessGovernance(); break;
```

In the startup event binding area, add:

```js
if (document.getElementById('pgRiskFilter')) {
  document.getElementById('pgRiskFilter').onchange = renderProcessGovernance;
}
if (document.getElementById('refreshProcessGovernanceBtn')) {
  document.getElementById('refreshProcessGovernanceBtn').onclick = renderProcessGovernance;
}
```

- [ ] **Step 5: Update frontend asset test**

Modify `apps/mdm-platform/scripts/test-frontend-assets.js` by adding these labels and hooks to the existing arrays:

```js
'流程治理'
```

and:

```js
'/api/process-governance/sankey',
'/api/process-governance/a1',
'/api/process-governance/cross-dept',
'function renderProcessGovernance()'
```

- [ ] **Step 6: Register and run frontend tests**

Modify `apps/mdm-platform/package.json` scripts:

```json
"test:process-frontend": "node scripts/test-process-governance-frontend.js"
```

Run:

```bash
cd apps/mdm-platform
npm run test:frontend
npm run test:process-frontend
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add apps/mdm-platform/public/index.html apps/mdm-platform/scripts/test-frontend-assets.js apps/mdm-platform/scripts/test-process-governance-frontend.js apps/mdm-platform/package.json
git commit -m "feat(mdm): add process governance read-only view"
```

---

### Task 8: Link Field Entries To Process Governance

**Files:**
- Create: `apps/mdm-platform/scripts/test-process-governance-field-links.js`
- Modify: `apps/mdm-platform/server/routes/fieldEntries.js`
- Modify: `apps/mdm-platform/server/routes/export.js`
- Modify: `apps/mdm-platform/package.json`

- [ ] **Step 1: Write the field-link test**

Create `apps/mdm-platform/scripts/test-process-governance-field-links.js`:

```js
const assert = require('assert');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const dept = db.prepare("INSERT INTO departments (name, code, status) VALUES ('经营发展部', 'DEPT_JYFZ', 'active')").run().lastInsertRowid;
const user = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run('管理员', 'ADMIN001', dept, '管理员', 'admin', hashPassword('admin123')).lastInsertRowid;
const cap = db.prepare("INSERT INTO capabilities (name, level, owner_dept_id, status, created_by) VALUES ('合同管理', 'L2', ?, 'approved', ?)").run(dept, user).lastInsertRowid;
const proc = db.prepare("INSERT INTO processes (name, capability_id, owner_dept_id, status, created_by) VALUES ('销售订单评审和执行管理', ?, ?, 'approved', ?)").run(cap, dept, user).lastInsertRowid;
const mapping = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by) VALUES (?, ?, 'draft', ?)").run(proc, dept, user).lastInsertRowid;

const fieldId = db.prepare(`
  INSERT INTO field_entries
    (mapping_id, field_name_cn, data_object, process_governance_node_key, process_governance_a1_code, submitted_by)
  VALUES (?, '订单编号', '销售订单', '销售订单评审和执行管理', 'JY-L3-01-A1-001', ?)
`).run(mapping, user).lastInsertRowid;

const field = db.prepare('SELECT process_governance_node_key, process_governance_a1_code FROM field_entries WHERE id=?').get(fieldId);
assert.strictEqual(field.process_governance_node_key, '销售订单评审和执行管理');
assert.strictEqual(field.process_governance_a1_code, 'JY-L3-01-A1-001');

cleanupDb();
console.log('Process governance field link test passed');
```

- [ ] **Step 2: Accept link fields in field create/update**

In `apps/mdm-platform/server/routes/fieldEntries.js`, change:

```js
const ALL_FIELD_ENTRY_FIELDS = ['field_name_cn', 'field_name_en', 'data_object', 'field_type', 'consume_systems', 'sync_mode', 'note'];
const SUBMITTER_WRITABLE = ['data_object', 'note'];
```

to:

```js
const ALL_FIELD_ENTRY_FIELDS = ['field_name_cn', 'field_name_en', 'data_object', 'field_type', 'consume_systems', 'sync_mode', 'note', 'process_governance_node_key', 'process_governance_a1_code'];
const SUBMITTER_WRITABLE = ['data_object', 'note', 'process_governance_node_key', 'process_governance_a1_code'];
```

Update the create route destructuring:

```js
const { mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, process_governance_node_key, process_governance_a1_code } = req.body;
```

Update the insert SQL columns:

```sql
(mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, process_governance_node_key, process_governance_a1_code, submitted_by, submitted_at)
```

Update the values:

```js
values.process_governance_node_key || null,
values.process_governance_a1_code || null,
req.session.userId
```

For non-admin create values, include:

```js
process_governance_node_key,
process_governance_a1_code
```

- [ ] **Step 3: Add export columns**

In `apps/mdm-platform/server/routes/export.js`, add two worksheet columns to the field ledger:

```js
{ header: '流程治理节点', key: 'process_governance_node_key', width: 24 },
{ header: 'A1编号', key: 'process_governance_a1_code', width: 18 }
```

Add row values:

```js
process_governance_node_key: field.process_governance_node_key || '',
process_governance_a1_code: field.process_governance_a1_code || ''
```

- [ ] **Step 4: Register and run the field-link test**

Modify `apps/mdm-platform/package.json` scripts:

```json
"test:process-field-links": "node scripts/test-process-governance-field-links.js"
```

Run:

```bash
cd apps/mdm-platform
npm run test:process-field-links
npm run test:import
npm run test:export
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mdm-platform/server/routes/fieldEntries.js apps/mdm-platform/server/routes/export.js apps/mdm-platform/package.json apps/mdm-platform/scripts/test-process-governance-field-links.js
git commit -m "feat(mdm): link field ledger to process governance"
```

---

### Task 9: Write Phase 1 Long-Term Blueprint

**Files:**
- Create: `docs/superpowers/specs/2026-06-03-mdm-phase-1-long-term-blueprint.md`

- [ ] **Step 1: Create the blueprint document**

Create `docs/superpowers/specs/2026-06-03-mdm-phase-1-long-term-blueprint.md`:

```markdown
# MDM 一期长期蓝图

> 编制日期：2026-06-03
> 定位：MDM 一期升级后的长期建设路线输入。

## 1. 蓝图边界

本蓝图属于 MDM 一期交付物。它不要求一期完成 ERP、MES、OA、PLM 的全部联调，但要求在一期内明确主数据域、待确认黄金源、接口路线、数据质量机制和后续里程碑。

## 2. 待确认主数据域

| 主数据域 | 当前依据 | 一期处理 |
|---|---|---|
| 组织 | `docs/organization/组织架构和部门职责.md` | 对齐 9 个流程治理部门和 3 个域 |
| 人员 | `docs/organization/花名册.md` | 保持平台用户与组织维表关系 |
| 物料 | `docs/主数据编码规范.md`、`docs/U8编码规则汇总.md` | 作为后续 ERP/MES/PLM 联动重点 |
| 供应商 | 经营发展部、物资保障部流程 | 建立字段台账和待确认黄金源 |
| 客户 | 经营发展部流程 | 建立合同、订单和交付相关待确认字段 |
| 项目 | 项目管理部流程 | 关联计划、风险、交付、成本流程 |
| 产品 | MDM 平台产品主数据模块 | 继续保留现有产品族、产品、分类节点能力 |
| 工装 | 项目管理部、物资保障部流程 | 作为 PLM/MES/ERP 交互待确认域 |
| 设备 | 运维安环部流程 | 作为 MES/ERP 交互待确认域 |
| 质量记录 | 质量管理部流程 | 作为 MES/PLM/OA 交互待确认域 |

## 3. 待确认黄金源路线

| 数据对象 | 待确认来源 | 待确认消费方 | 一期动作 |
|---|---|---|---|
| 组织与人员 | MDM 平台、花名册 | OA、ERP、MES、PLM | 先在 MDM 内治理口径 |
| 物料 | PLM、ERP | ERP、MES、PLM | 建立字段台账和编码规则对照 |
| 项目 | 项目管理流程、ERP | ERP、MES、OA | 识别项目编号、计划、成本字段 |
| 工装 | PLM、ERP、MES | PLM、ERP、MES | 识别工装台账和状态流转字段 |
| 设备 | MES、ERP | MES、ERP | 识别设备台账、备件、维修字段 |
| 质量记录 | MES、PLM、OA | MES、PLM、OA | 识别质量记录、检验、不合格字段 |

黄金源结论必须通过字段台账与数据 owner 确认，流程建议落位不能自动认定黄金源。

## 4. 接口路线

一期只形成待确认接口清单：

| 接口方向 | 业务依据 | 后续关注 |
|---|---|---|
| MDM -> OA | 组织、人员、角色、流程待办 | 权限同步、统一待办 |
| MDM -> ERP | 组织、物料、供应商、项目、成本字段 | 编码一致性、主数据分发 |
| MDM -> MES | 物料、工装、设备、质量记录 | 生产执行数据一致性 |
| MDM -> PLM | 物料、BOM、工艺、工装 | 设计制造数据一致性 |
| MDM -> 集成总线 | 主数据分发与变更事件 | 事件模型、幂等、审计 |

## 5. 数据质量机制

一期建立以下机制：

- 字段台账标准化：中文名、英文名、数据对象、类型、同步方式。
- 术语冲突识别：同名异义、近似术语、禁用词。
- 黄金源冲突识别：同一字段多个权威系统待确认不一致。
- 流程上下文关联：字段可以引用 L3 或 A1。
- 快照一致性校验：MDM 快照与 `docs/company-sankey-data.json` 统计一致。

## 6. 后续里程碑

| 里程碑 | 通过条件 |
|---|---|
| M1 平台安全升级 | 测试库隔离，现有路由测试可安全运行 |
| M2 流程治理快照 | MDM 可导入当前流程治理 JSON，并通过一致性校验 |
| M3 A1 与跨部门视图 | 平台内可查询 A1、跨部门风险、交互链 |
| M4 字段台账衔接 | 字段台账可关联 L3/A1 |
| M5 蓝图评审 | 主数据域、待确认黄金源、接口路线和数据质量机制完成评审 |
```

- [ ] **Step 2: Verify blueprint wording**

Run:

```bash
rg -n "二期|承载最多|最忙|主用系统" docs/superpowers/specs/2026-06-03-mdm-phase-1-long-term-blueprint.md
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-03-mdm-phase-1-long-term-blueprint.md
git commit -m "docs: add MDM phase 1 long-term blueprint"
```

---

### Task 10: Final Verification And Documentation

**Files:**
- Modify: `apps/mdm-platform/README.md`
- Modify: `apps/mdm-platform/package.json`

- [ ] **Step 1: Add aggregate test script**

Modify `apps/mdm-platform/package.json` scripts:

```json
"test:process-governance": "node scripts/test-db-path-isolation.js && node scripts/test-process-governance-org-sync.js && node scripts/test-process-governance-schema.js && node scripts/test-process-governance-import.js && node scripts/test-process-governance-api.js && node scripts/test-process-governance-frontend.js && node scripts/test-process-governance-field-links.js"
```

- [ ] **Step 2: Update README**

Add this section to `apps/mdm-platform/README.md` after “常用命令”:

````markdown
## MDM 一期升级命令

流程治理升级链路：

```bash
npm run test:db-path
npm run test:process-governance
npm run sync:process-org
npm run import:process-governance
npm run check:process-governance
```

数据库安全约定：

- 默认数据库仍为 `apps/mdm-platform/data/platform.db`。
- 测试必须通过 `MDM_DB_PATH` 使用隔离 SQLite 文件。
- 不直接运行会删除共享数据库的旧式测试逻辑。
- `seed-demo-data.js` 和 `setup-mdm-project-users.js` 需要显式环境变量才可运行。

流程治理口径：

- 组织真源为 `docs/organization/组织架构和部门职责.md`。
- 流程输入基线为 `docs/norms/{部门}部门-能力-流程-系统映射关系.md`。
- 快照来源为 `docs/company-sankey-data.json`。
- PMO 静态驾驶舱仍通过 parser 和内嵌快照运行。
````

- [ ] **Step 3: Run full verification**

Run:

```bash
node scripts/parse-sankey-data.mjs
node scripts/check-dashboard-data.mjs
cd apps/mdm-platform
npm run test:process-governance
npm run test:frontend
npm run import:process-governance
npm run check:process-governance
```

Expected:

```text
Dashboard data check passed.
DB path isolation test passed
Process governance org sync test passed
Process governance schema test passed
Process governance import test passed
Process governance API test passed
Process governance frontend hook test passed
Process governance field link test passed
Frontend assets test passed
Process governance snapshot check passed
```

- [ ] **Step 4: Confirm MDM code syntax**

Run:

```bash
cd apps/mdm-platform
node --check server/db.js
node --check server/index.js
node --check server/routes/processGovernance.js
node --check scripts/lib/processGovernanceImport.js
node --check scripts/import-process-governance.js
node --check scripts/check-process-governance.js
```

Expected: no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mdm-platform/package.json apps/mdm-platform/README.md
git commit -m "docs(mdm): document phase 1 process governance upgrade"
```

---

## Implementation Order

Execute tasks in this order:

1. Task 1: Database Path Isolation
2. Task 2: Move Destructive Tests To Isolated Databases
3. Task 3: Align MDM Organization Scope With Process Governance
4. Task 4: Add Process Governance Schema
5. Task 5: Import Process Governance Snapshot
6. Task 6: Add Read-Only Process Governance API
7. Task 7: Add Platform Process Governance View
8. Task 8: Link Field Entries To Process Governance
9. Task 9: Write Phase 1 Long-Term Blueprint
10. Task 10: Final Verification And Documentation

Do not start Task 5 until Task 1 and Task 2 pass. Do not run full MDM route tests until database isolation is complete.

---

## Self-Review

Spec coverage:

- Platform safety and isolated tests: Tasks 1 and 2.
- Organization scope and old seed downgrade: Task 3.
- Snapshot, nodes, edges, A1, cross-department interactions, chains: Tasks 4 and 5.
- Read-only API contract: Task 6.
- Platform read-only view: Task 7.
- Field ledger and golden source entry point: Task 8.
- Long-term blueprint: Task 9.
- Verification and documentation: Task 10.

Placeholder scan:

- The plan contains no unresolved placeholder sections.
- Every code task includes file paths, code blocks, commands, and expected results.

Type consistency:

- Route path is consistently `/api/process-governance`.
- Snapshot table names are consistently `process_governance_*`.
- Field link columns are consistently `process_governance_node_key` and `process_governance_a1_code`.
- Risk enum is consistently `high|medium|low`.
- Confirmation enum is consistently `confirmed|pending|needs_review|not_mapped`.
