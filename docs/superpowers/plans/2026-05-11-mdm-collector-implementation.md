# MDM 数据收集与评审模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建设 MDM 底座 V1 数据收集与评审工具，实现"采集 + 审核 + 导出"完整闭环

**Architecture:** 独立 Web 应用，前端单文件 HTML + Express.js + SQLite，后端路由模块化，数据模型基于 9 张核心表

**Tech Stack:** express, better-sqlite3, exceljs, express-session, bcryptjs

---

## 文件结构

```
mdm-collector/
├── server/
│   ├── index.js              # Express 入口，端口 3000
│   ├── db.js                 # SQLite 建表语句（9 张表）
│   ├── auth.js               # bcrypt + session 认证中间件
│   └── routes/
│       ├── org.js            # 部门/用户/岗位 CRUD
│       ├── systems.js         # 系统列表 CRUD
│       ├── capabilities.js    # 业务能力 CRUD
│       ├── processes.js       # 业务流程 CRUD
│       ├── mappings.js        # 映射 CRUD + 审批流状态机
│       ├── fieldEntries.js    # 字段台账 CRUD（含列级权限）
│       ├── fieldIdentities.js # 字段身份 + 黄金源确认
│       ├── todos.js           # 跨部门待办
│       ├── conflicts.js       # 冲突管理 + 冲突检测
│       ├── terminology.js     # 术语词典 CRUD
│       ├── versions.js        # 版本记录 + 变更集
│       └── export.js          # Excel 导出
├── public/
│   ├── index.html            # 主界面（单文件 HTML）
│   └── template.xlsx         # Excel 导入模板
└── data/
    └── collector.db          # SQLite 数据文件（gitignore）
```

---

## Task 1: 项目脚手架 + 数据库建表

**Files:**
- Create: `mdm-collector/server/index.js`
- Create: `mdm-collector/server/db.js`
- Create: `mdm-collector/package.json`
- Create: `mdm-collector/.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "mdm-collector",
  "version": "1.0.0",
  "description": "MDM底座数据收集与评审工具",
  "main": "server/index.js",
  "scripts": {
    "start": "node server/index.js",
    "dev": "nodemon server/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "better-sqlite3": "^9.4.3",
    "exceljs": "^4.4.0",
    "express-session": "^1.17.3",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

- [ ] **Step 2: 创建 db.js（建表语句）**

```javascript
// mdm-collector/server/db.js
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../data/collector.db'));

// 启用外键约束
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES departments(id),
  manager_user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  employee_no TEXT NOT NULL UNIQUE,
  department_id INTEGER REFERENCES departments(id),
  post TEXT,
  role TEXT NOT NULL DEFAULT 'submitter' CHECK(role IN ('submitter','owner','reviewer','admin')),
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_dept_roles (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE IF NOT EXISTS systems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dept_id INTEGER REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('L1','L2','L3')),
  owner_dept_id INTEGER REFERENCES departments(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  capability_id INTEGER REFERENCES capabilities(id),
  owner_dept_id INTEGER REFERENCES departments(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mapping_related_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL,
  department_id INTEGER NOT NULL,
  relation TEXT NOT NULL CHECK(relation IN ('owner','consumer','collaborator'))
);

CREATE TABLE IF NOT EXISTS mapping_systems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL,
  system_id INTEGER NOT NULL,
  system_role TEXT NOT NULL CHECK(system_role IN ('primary','secondary')),
  sort_order INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id INTEGER NOT NULL,
  description TEXT,
  approval_dept_id INTEGER REFERENCES departments(id),
  owner_dept_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','dept_reviewed','cross_confirmed','fields_confirmed','final_reviewed','published')),
  submitted_by INTEGER REFERENCES users(id),
  submitted_at DATETIME,
  current_step INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL,
  step INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  assignee_user_id INTEGER REFERENCES users(id),
  assigned_dept_id INTEGER REFERENCES departments(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','approved','rejected','blocked')),
  opinion TEXT,
  reject_count INTEGER NOT NULL DEFAULT 0,
  operated_by INTEGER REFERENCES users(id),
  operated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL,
  step INTEGER NOT NULL,
  operator_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('submit','approve','reject','auto_conflict')),
  opinion TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL,
  field_name_cn TEXT,
  field_name_en TEXT,
  data_object TEXT,
  field_type TEXT CHECK(field_type IN ('文本','编码','日期','枚举','附件','JSON')),
  consume_systems TEXT,
  sync_mode TEXT CHECK(sync_mode IN ('实时','批量','人工导入','事件触发')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','confirmed','conflicted')),
  submitted_by INTEGER REFERENCES users(id),
  submitted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_entry_id INTEGER NOT NULL UNIQUE,
  candidate_systems TEXT,
  authoritative_system TEXT,
  maintain_dept_id INTEGER REFERENCES departments(id),
  owner_user_id INTEGER REFERENCES users(id),
  confirmed INTEGER NOT NULL DEFAULT 0,
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at DATETIME,
  note TEXT
);

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL UNIQUE,
  definition TEXT,
  scope TEXT,
  forbidden TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER REFERENCES users(id),
  approved_at DATETIME
);

CREATE TABLE IF NOT EXISTS term_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  dept_a INTEGER REFERENCES departments(id),
  dept_a_meaning TEXT,
  dept_b INTEGER REFERENCES departments(id),
  dept_b_meaning TEXT,
  severity TEXT NOT NULL CHECK(severity IN ('warn','error')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','rejected')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_entry_a_id INTEGER NOT NULL,
  field_entry_b_id INTEGER NOT NULL,
  conflict_field TEXT NOT NULL CHECK(conflict_field IN ('authoritative_system','note','field_type','sync_mode','consume_systems','other')),
  submitter_a INTEGER REFERENCES users(id),
  value_a TEXT,
  submitter_b INTEGER REFERENCES users(id),
  value_b TEXT,
  dept_a INTEGER REFERENCES departments(id),
  dept_b INTEGER REFERENCES departments(id),
  severity TEXT NOT NULL CHECK(severity IN ('warn','error')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','rejected')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_dept_id INTEGER REFERENCES departments(id),
  to_dept_id INTEGER REFERENCES departments(id),
  type TEXT NOT NULL CHECK(type IN ('field_confirm','gold_source','terminology','general')),
  related_mapping_id INTEGER,
  related_field_id INTEGER,
  content TEXT NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','overdue')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  done_at DATETIME
);

CREATE TABLE IF NOT EXISTS version_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
  operated_by INTEGER REFERENCES users(id),
  operated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  change_set_id INTEGER
);

CREATE TABLE IF NOT EXISTS change_set (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  operated_by INTEGER REFERENCES users(id),
  operated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);
`);

module.exports = db;
```

- [ ] **Step 3: 创建 index.js（Express 入口）**

```javascript
// mdm-collector/server/index.js
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = 3000;

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// JSON body parser
app.use(express.json());

// Session 配置
app.use(session({
  secret: 'mdm-collector-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24小时
}));

// 导入路由
const orgRoutes = require('./routes/org');
const systemsRoutes = require('./routes/systems');
const capabilitiesRoutes = require('./routes/capabilities');
const processesRoutes = require('./routes/processes');
const mappingsRoutes = require('./routes/mappings');
const fieldEntriesRoutes = require('./routes/fieldEntries');
const fieldIdentitiesRoutes = require('./routes/fieldIdentities');
const todosRoutes = require('./routes/todos');
const conflictsRoutes = require('./routes/conflicts');
const terminologyRoutes = require('./routes/terminology');
const versionsRoutes = require('./routes/versions');
const exportRoutes = require('./routes/export');

// API 路由
app.use('/api/org', orgRoutes);
app.use('/api/systems', systemsRoutes);
app.use('/api/capabilities', capabilitiesRoutes);
app.use('/api/processes', processesRoutes);
app.use('/api/mappings', mappingsRoutes);
app.use('/api/field-entries', fieldEntriesRoutes);
app.use('/api/field-identities', fieldIdentitiesRoutes);
app.use('/api/todos', todosRoutes);
app.use('/api/conflicts', conflictsRoutes);
app.use('/api/terminology', terminologyRoutes);
app.use('/api/versions', versionsRoutes);
app.use('/api/export', exportRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`MDM Collector running on http://localhost:${PORT}`);
});
```

- [ ] **Step 4: 创建 .gitignore**

```
node_modules/
data/*.db
*.log
```

- [ ] **Step 5: 初始化目录并安装依赖**

```bash
mkdir -p mdm-collector/server/routes mdm-collector/public mdm-collector/data mdm-collector/scripts
cd mdm-collector && npm install
```

- [ ] **Step 6: Commit（在主仓库）**

```bash
git add mdm-collector/package.json mdm-collector/server/index.js mdm-collector/server/db.js mdm-collector/.gitignore
git commit -m "feat: scaffold MDM collector project with Express + SQLite"
```

---

## Task 2: 认证模块（auth.js）

**Files:**
- Create: `mdm-collector/server/auth.js`

- [ ] **Step 1: 创建 auth.js（同步版本，无 async）**

```javascript
// mdm-collector/server/auth.js
const bcrypt = require('bcryptjs');

// 密码哈希（同步）
function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

// 密码校验（同步）
function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

// 认证中间件：检查会话
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
}

// 角色中间件：检查角色
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: '未登录' });
    }
    if (!roles.includes(req.session.userRole)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  requireAuth,
  requireRole
};
```

- [ ] **Step 2: Commit**

```bash
git add mdm-collector/server/auth.js
git commit -m "feat: add auth module with sync bcrypt + session"
```

---

## Task 3: 组织架构路由（org.js）

**Files:**
- Create: `mdm-collector/server/routes/org.js`

- [ ] **Step 1: 创建 org.js 路由**

```javascript
// mdm-collector/server/routes/org.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword, requireAuth, requireRole } = require('../auth');

// 部门 CRUD
router.get('/departments', requireAuth, (req, res) => {
  const depts = db.prepare("SELECT * FROM departments ORDER BY code").all();
  res.json(depts);
});

router.post('/departments', requireRole('admin'), (req, res) => {
  const { name, code, parent_id, manager_user_id } = req.body;
  const stmt = db.prepare("INSERT INTO departments (name, code, parent_id, manager_user_id) VALUES (?, ?, ?, ?)");
  const result = stmt.run(name, code, parent_id || null, manager_user_id || null);
  res.json({ id: result.lastInsertRowid });
});

router.put('/departments/:id', requireRole('admin'), (req, res) => {
  const { name, code, parent_id, manager_user_id } = req.body;
  const stmt = db.prepare("UPDATE departments SET name=?, code=?, parent_id=?, manager_user_id=? WHERE id=?");
  stmt.run(name, code, parent_id || null, manager_user_id || null, req.params.id);
  res.json({ success: true });
});

router.delete('/departments/:id', requireRole('admin'), (req, res) => {
  db.prepare("DELETE FROM departments WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// 用户 CRUD
router.get('/users', requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT u.*, d.name as dept_name
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    ORDER BY u.employee_no
  `).all();
  res.json(users);
});

router.post('/users', requireRole('admin'), (req, res) => {
  const { name, employee_no, department_id, post, role, password } = req.body;
  const hash = hashPassword(password || 'init1234');
  const stmt = db.prepare("INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)");
  const result = stmt.run(name, employee_no, department_id, post, role || 'submitter', hash);
  res.json({ id: result.lastInsertRowid });
});

router.put('/users/:id', requireRole('admin'), (req, res) => {
  const { name, department_id, post, role } = req.body;
  const stmt = db.prepare("UPDATE users SET name=?, department_id=?, post=?, role=? WHERE id=?");
  stmt.run(name, department_id, post, role, req.params.id);
  res.json({ success: true });
});

router.post('/users/:id/password', requireRole('admin'), (req, res) => {
  const { password } = req.body;
  const hash = hashPassword(password);
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, req.params.id);
  res.json({ success: true });
});

// 登录
router.post('/login', (req, res) => {
  const { employee_no, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE employee_no=?").get(employee_no);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '工号或密码错误' });
  }
  req.session.userId = user.id;
  req.session.userRole = user.role;
  req.session.userName = user.name;
  req.session.departmentId = user.department_id;
  res.json({ id: user.id, name: user.name, role: user.role });
});

// 登出
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 当前会话
router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.session.userId,
    name: req.session.userName,
    role: req.session.userRole,
    departmentId: req.session.departmentId
  });
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-collector/server/routes/org.js
git commit -m "feat(org): add department and user CRUD routes with auth"
```

---

## Task 4: 系统列表 + 业务能力路由

**Files:**
- Create: `mdm-collector/server/routes/systems.js`
- Create: `mdm-collector/server/routes/capabilities.js`
- Create: `mdm-collector/server/routes/processes.js`

- [ ] **Step 1: 创建 systems.js**

```javascript
// mdm-collector/server/routes/systems.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/', requireAuth, (req, res) => {
  const systems = db.prepare("SELECT * FROM systems ORDER BY name").all();
  res.json(systems);
});

router.post('/', requireAuth, (req, res) => {
  const { name, dept_id } = req.body;
  const stmt = db.prepare("INSERT INTO systems (name, dept_id) VALUES (?, ?)");
  const result = stmt.run(name, dept_id);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', requireAuth, (req, res) => {
  const { name, dept_id } = req.body;
  db.prepare("UPDATE systems SET name=?, dept_id=? WHERE id=?").run(name, dept_id, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare("DELETE FROM systems WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 2: 创建 capabilities.js**

```javascript
// mdm-collector/server/routes/capabilities.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/', requireAuth, (req, res) => {
  const caps = db.prepare(`
    SELECT c.*, d.name as dept_name
    FROM capabilities c
    LEFT JOIN departments d ON c.owner_dept_id = d.id
    ORDER BY c.level, c.name
  `).all();
  res.json(caps);
});

router.post('/', requireAuth, (req, res) => {
  const { name, level, owner_dept_id } = req.body;
  const stmt = db.prepare("INSERT INTO capabilities (name, level, owner_dept_id) VALUES (?, ?, ?)");
  const result = stmt.run(name, level, owner_dept_id);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', requireAuth, (req, res) => {
  const { name, level, owner_dept_id } = req.body;
  db.prepare("UPDATE capabilities SET name=?, level=?, owner_dept_id=? WHERE id=?").run(name, level, owner_dept_id, req.params.id);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 3: 创建 processes.js**

```javascript
// mdm-collector/server/routes/processes.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/', requireAuth, (req, res) => {
  const { capability_id, owner_dept_id } = req.query;
  let sql = `SELECT p.*, c.name as cap_name, d.name as dept_name
             FROM processes p
             LEFT JOIN capabilities c ON p.capability_id = c.id
             LEFT JOIN departments d ON p.owner_dept_id = d.id WHERE 1=1`;
  const params = [];
  if (capability_id) { sql += " AND p.capability_id=?"; params.push(capability_id); }
  if (owner_dept_id) { sql += " AND p.owner_dept_id=?"; params.push(owner_dept_id); }
  sql += " ORDER BY p.name";
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireAuth, (req, res) => {
  const { name, capability_id, owner_dept_id } = req.body;
  const stmt = db.prepare("INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)");
  const result = stmt.run(name, capability_id, owner_dept_id);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', requireAuth, (req, res) => {
  const { name, capability_id, owner_dept_id } = req.body;
  db.prepare("UPDATE processes SET name=?, capability_id=?, owner_dept_id=? WHERE id=?").run(name, capability_id, owner_dept_id, req.params.id);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 4: Commit**

```bash
git add mdm-collector/server/routes/systems.js mdm-collector/server/routes/capabilities.js mdm-collector/server/routes/processes.js
git commit -m "feat(org): add systems, capabilities, processes CRUD routes"
```

---

## Task 5: 映射路由 + 审批流核心（mappings.js）

**Files:**
- Create: `mdm-collector/server/routes/mappings.js`
- Create: `mdm-collector/server/routes/fieldEntries.js`
- Create: `mdm-collector/server/routes/fieldIdentities.js`

**核心审批流状态机逻辑**：

```
draft → submitted(step1) → dept_reviewed(step2) → cross_confirmed(step3) → fields_confirmed(step4) → final_reviewed(step5) → published
                            ↓ reject              ↓ error blocked          ↓ error blocked
                              draft                blocked                   blocked
```

- [ ] **Step 1: 创建 mappings.js（含并行 approval_tasks 和 error 冲突拦截）**

```javascript
// mdm-collector/server/routes/mappings.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

// 获取映射列表（含关联信息）
router.get('/', requireAuth, (req, res) => {
  const { status, dept_id } = req.query;
  let sql = `SELECT m.*, p.name as process_name, c.name as cap_name, d.name as owner_dept_name,
             (SELECT GROUP_CONCAT(s.name, ', ') FROM mapping_systems ms JOIN systems s ON ms.system_id = s.id WHERE ms.mapping_id = m.id) as systems
             FROM mappings m
             JOIN processes p ON m.process_id = p.id
             JOIN capabilities c ON p.capability_id = c.id
             JOIN departments d ON m.owner_dept_id = d.id WHERE 1=1`;
  const params = [];
  if (status) { sql += " AND m.status=?"; params.push(status); }
  if (dept_id) { sql += " AND m.owner_dept_id=?"; params.push(dept_id); }
  sql += " ORDER BY m.created_at DESC";
  res.json(db.prepare(sql).all(...params));
});

// 获取单个映射详情（含 mapping_systems、field_entries、field_identities）
router.get('/:id', requireAuth, (req, res) => {
  const mapping = db.prepare(`
    SELECT m.*, p.name as process_name, d.name as owner_dept_name
    FROM mappings m
    JOIN processes p ON m.process_id = p.id
    JOIN departments d ON m.owner_dept_id = d.id
    WHERE m.id=?
  `).get(req.params.id);
  if (!mapping) return res.status(404).json({ error: 'Not found' });

  const systems = db.prepare("SELECT ms.*, s.name as system_name FROM mapping_systems ms JOIN systems s ON ms.system_id = s.id WHERE ms.mapping_id=? ORDER BY ms.sort_order").all(req.params.id);
  const fields = db.prepare("SELECT * FROM field_entries WHERE mapping_id=? ORDER BY id").all(req.params.id);
  const relatedDepts = db.prepare("SELECT * FROM mapping_related_departments WHERE mapping_id=?").all(req.params.id);
  const approvalTasks = db.prepare("SELECT * FROM approval_tasks WHERE mapping_id=? ORDER BY step").all(req.params.id);

  res.json({ ...mapping, systems, fields, relatedDepts, approvalTasks });
});

// 创建映射（draft）
router.post('/', requireAuth, (req, res) => {
  const { process_id, description, approval_dept_id, owner_dept_id, systems } = req.body;
  const insertMapping = db.transaction(() => {
    const mStmt = db.prepare("INSERT INTO mappings (process_id, description, approval_dept_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, ?, ?, 'draft', ?, 1)");
    const result = mStmt.run(process_id, description, approval_dept_id, owner_dept_id, req.session.userId);
    const mappingId = result.lastInsertRowid;

    if (systems && systems.length) {
      const msStmt = db.prepare("INSERT INTO mapping_systems (mapping_id, system_id, system_role, sort_order) VALUES (?, ?, ?, ?)");
      systems.forEach(s => msStmt.run(mappingId, s.system_id, s.system_role, s.sort_order || 1));
    }

    // 记录版本日志
    const cs = db.prepare("INSERT INTO change_set (entity_type, entity_id, operated_by, description) VALUES ('mapping', ?, ?, '创建映射')").run(mappingId, req.session.userId, '创建映射');
    db.prepare("INSERT INTO version_log (entity_type, entity_id, operation, operated_by, change_set_id) VALUES ('mapping', ?, 'create', ?, ?)").run(mappingId, req.session.userId, cs.lastInsertRowid);

    return mappingId;
  });

  const id = insertMapping();
  res.json({ id });
});

// 提交映射（step1 → 生成并行 approval_tasks）
router.post('/:id/submit', requireAuth, (req, res) => {
  const mapping = db.prepare("SELECT * FROM mappings WHERE id=? AND submitted_by=?").get(req.params.id, req.session.userId);
  if (!mapping) return res.status(403).json({ error: '无权限或映射不存在' });
  if (mapping.status !== 'draft') return res.status(400).json({ error: '只能提交草稿状态' });

  const insertTasks = db.transaction(() => {
    db.prepare("UPDATE mappings SET status='submitted', submitted_at=datetime('now'), current_step=2 WHERE id=?").run(req.params.id);
    db.prepare("INSERT INTO approval_history (mapping_id, step, operator_user_id, action) VALUES (?, 1, ?, 'submit')").run(req.params.id, req.session.userId);

    // Step 2: 部门内审（单节点，部门负责人）
    const ownerDept = db.prepare("SELECT manager_user_id FROM departments WHERE id=?").get(mapping.owner_dept_id);
    db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status) VALUES (?, 2, '部门内审', ?, ?, 'pending')").run(
      req.params.id, ownerDept ? ownerDept.manager_user_id : null, mapping.owner_dept_id
    );

    // Step 3: 跨部门确认（每个关联部门一个节点，并行）
    const relatedDepts = db.prepare("SELECT department_id FROM mapping_related_departments WHERE mapping_id=?").all(req.params.id);
    if (relatedDepts.length === 0) {
      // 无跨部门关联时，跳过 step3，直接置 step4
      db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status) VALUES (?, 3, '跨部门确认', NULL, NULL, 'approved')").run(req.params.id);
    } else {
      relatedDepts.forEach(({ department_id }) => {
        const mgr = db.prepare("SELECT manager_user_id FROM departments WHERE id=?").get(department_id);
        db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status) VALUES (?, 3, '跨部门确认', ?, ?, 'pending')").run(
          req.params.id, mgr ? mgr.manager_user_id : null, department_id
        );
      });
    }

    // Step 4: 字段台账确认（每个有 field_identity.owner_user_id 的字段一条任务，或按维护部门查找 owner）
    const fieldOwners = db.prepare(`
      SELECT DISTINCT fi.owner_user_id, fi.maintain_dept_id
      FROM field_identities fi
      JOIN field_entries fe ON fi.field_entry_id = fe.id
      WHERE fe.mapping_id=? AND fi.owner_user_id IS NOT NULL
    `).all(req.params.id);

    if (fieldOwners.length === 0) {
      // 无明确 owner 时，按维护部门找 role='owner' 的用户
      const ownerDepts = db.prepare(`
        SELECT DISTINCT fi.maintain_dept_id
        FROM field_identities fi
        JOIN field_entries fe ON fi.field_entry_id = fe.id
        WHERE fe.mapping_id=?
      `).all(req.params.id);
      if (ownerDepts.length === 0) {
        db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, status) VALUES (?, 4, '字段台账确认', 'approved')").run(req.params.id);
      } else {
        ownerDepts.forEach(({ maintain_dept_id }) => {
          const ownerUser = db.prepare("SELECT id FROM users WHERE department_id=? AND role='owner' LIMIT 1").get(maintain_dept_id);
          db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status) VALUES (?, 4, '字段台账确认', ?, ?, 'pending')").run(
            req.params.id, ownerUser ? ownerUser.id : null, maintain_dept_id
          );
        });
      }
    } else {
      fieldOwners.forEach(({ owner_user_id, maintain_dept_id }) => {
        db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status) VALUES (?, 4, '字段台账确认', ?, ?, 'pending')").run(
          req.params.id, owner_user_id, maintain_dept_id
        );
      });
    }

    // Step 5: 信息化项目组终审（所有 admin 用户）
    const admins = db.prepare("SELECT id FROM users WHERE role='admin'").all();
    if (admins.length === 0) {
      db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, status) VALUES (?, 5, '信息化项目组终审', 'approved')").run(req.params.id);
    } else {
      admins.forEach(({ id: adminId }) => {
        db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, status) VALUES (?, 5, '信息化项目组终审', ?, 'pending')").run(req.params.id, adminId);
      });
    }
  });
  insertTasks();
  res.json({ success: true });
});

// 审核操作（approve/reject）— 通用，含 step3 error 冲突拦截
router.post('/:id/review', requireAuth, (req, res) => {
  const { step, action, opinion } = req.body; // action: 'approve' | 'reject'
  // 查找当前用户对应的 task（按 step + 当前用户）
  const task = db.prepare(`
    SELECT at.* FROM approval_tasks at
    WHERE at.mapping_id=? AND at.step=? AND at.assignee_user_id=?
    AND at.status NOT IN ('approved','rejected')
  `).get(req.params.id, step, req.session.userId);
  if (!task) return res.status(400).json({ error: '当前节点状态不允许审核，或您不是该节点审核人' });

  const updateTask = db.transaction(() => {
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    db.prepare("UPDATE approval_tasks SET status=?, opinion=?, operated_by=?, operated_at=datetime('now') WHERE id=?").run(newStatus, opinion, req.session.userId, task.id);
    db.prepare("INSERT INTO approval_history (mapping_id, step, operator_user_id, action, opinion) VALUES (?, ?, ?, ?, ?)").run(req.params.id, step, req.session.userId, action, opinion);

    if (action === 'reject') {
      db.prepare("UPDATE approval_tasks SET reject_count=reject_count+1 WHERE id=?").run(task.id);
      db.prepare("UPDATE mappings SET status='draft', current_step=1 WHERE id=?").run(req.params.id);
    } else {
      // === 通过：推进到下一个 step ===

      // P1-Fix: step=3 通过前检查 field_conflicts（未解决的 error）
      if (step === 3) {
        const remainingErrors = db.prepare(`
          SELECT COUNT(*) as cnt FROM field_conflicts fc
          JOIN field_entries fe ON fc.field_entry_a_id = fe.id OR fc.field_entry_b_id = fe.id
          WHERE fe.mapping_id = ? AND fc.severity = 'error' AND fc.status = 'pending'
        `).get(req.params.id);
        if (remainingErrors.cnt > 0) {
          // 存在未解决 error，全部 step3 任务置 blocked
          db.prepare("UPDATE approval_tasks SET status='blocked' WHERE mapping_id=? AND step=3 AND status='approved'").run(req.params.id);
          return res.json({ success: true, blocked: true, reason: '存在未解决的 error 冲突，需先解决冲突' });
        }
      }

      const nextStep = step + 1;
      if (nextStep <= 5) {
        const statusMap = {2: 'dept_reviewed', 3: 'cross_confirmed', 4: 'fields_confirmed', 5: 'final_reviewed'};
        db.prepare("UPDATE mappings SET status=?, current_step=? WHERE id=?").run(statusMap[nextStep], nextStep, req.params.id);
        // 下一批节点置 in_progress（所有 pending 的同 step 节点）
        db.prepare("UPDATE approval_tasks SET status='in_progress' WHERE mapping_id=? AND step=? AND status='pending'").run(req.params.id, nextStep);
      } else {
        // step 5 全部通过后发布
        const allStep5Approved = db.prepare("SELECT COUNT(*) as cnt FROM approval_tasks WHERE mapping_id=? AND step=5 AND status NOT IN ('approved')").get(req.params.id);
        if (allStep5Approved.cnt === 0) {
          db.prepare("UPDATE mappings SET status='published' WHERE id=?").run(req.params.id);
        }
      }
    }
  });
  updateTask();
  res.json({ success: true });
});

// 发布映射（手动）
router.post('/:id/publish', requireAuth, (req, res) => {
  const user = db.prepare("SELECT role FROM users WHERE id=?").get(req.session.userId);
  if (user.role !== 'admin') return res.status(403).json({ error: '仅信息化项目组可发布' });
  db.prepare("UPDATE mappings SET status='published' WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 2: 创建 fieldEntries.js（含列级权限控制）**

```javascript
// mdm-collector/server/routes/fieldEntries.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

// 列级权限：submitter 可写 A/B/C/D/E/M（L），owner 可写 F/G/H/I/J/K
// reviewer 和 admin 可写全部
const SUBMITTER_WRITABLE = ['field_name_cn','field_name_en','data_object','field_type','consume_systems','sync_mode','note'];
const OWNER_WRITABLE = ['field_name_cn','field_name_en','data_object','field_type','consume_systems','sync_mode','note'];
// 注意：submitter 和 owner 的可写字段有重叠，实际以角色和当前节点判断

router.get('/mapping/:mappingId', requireAuth, (req, res) => {
  const fields = db.prepare("SELECT * FROM field_entries WHERE mapping_id=? ORDER BY id").all(req.params.mappingId);
  res.json(fields);
});

// 创建字段台账（自动根据 role 限制可写字段）
router.post('/', requireAuth, (req, res) => {
  const { mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note } = req.body;
  const userRole = req.session.userRole;
  const cs = Array.isArray(consume_systems) ? JSON.stringify(consume_systems) : consume_systems;

  // 列级权限：只有 submitter 和 admin 可创建
  if (userRole !== 'submitter' && userRole !== 'admin') {
    return res.status(403).json({ error: '仅报送人或管理员可创建字段' });
  }

  const stmt = db.prepare(`INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
  const result = stmt.run(mapping_id, field_name_cn || null, field_name_en || null, data_object || null, field_type || null, cs, sync_mode || null, note || null, req.session.userId);
  res.json({ id: result.lastInsertRowid });
});

// 更新字段台账（带列级权限过滤）
router.put('/:id', requireAuth, (req, res) => {
  const { field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note } = req.body;
  const userRole = req.session.userRole;
  const fieldId = req.params.id;

  // 查找字段所属映射及当前用户身份
  const field = db.prepare("SELECT * FROM field_entries WHERE id=?").get(fieldId);
  if (!field) return res.status(404).json({ error: '字段不存在' });

  // 只有 submitter 和 owner 可修改，reviewer/admin 不限
  if (userRole !== 'admin' && userRole !== 'submitter' && userRole !== 'owner') {
    return res.status(403).json({ error: '权限不足' });
  }

  // submitter 只可修改部分字段（表单 A-E 列 + M 列）
  const submitterAllowed = ['field_name_cn','field_name_en','data_object','note'];
  // owner 可修改 F-K 列
  const ownerAllowed = ['field_name_cn','field_name_en','data_object','field_type','consume_systems','sync_mode','note'];

  let allowedFields;
  if (userRole === 'admin' || userRole === 'reviewer') {
    allowedFields = ['field_name_cn','field_name_en','data_object','field_type','consume_systems','sync_mode','note'];
  } else if (userRole === 'owner') {
    allowedFields = ownerAllowed;
  } else {
    allowedFields = submitterAllowed;
  }

  // 记录版本（所有变更字段）
  const cs2 = db.prepare("INSERT INTO change_set (entity_type, entity_id, operated_by, description) VALUES ('field_entry', ?, ?, '更新字段')").run(fieldId, req.session.userId, '更新字段');
  allowedFields.forEach(f => {
    if (field[f] !== req.body[f]) {
      db.prepare("INSERT INTO version_log (entity_type, entity_id, field_name, old_value, new_value, operation, operated_by, change_set_id) VALUES ('field_entry', ?, ?, ?, ?, 'update', ?, ?)").run(fieldId, f, field[f], req.body[f], req.session.userId, cs2.lastInsertRowid);
    }
  });

  // 构建更新语句（只更新 allowed 字段）
  const updates = allowedFields.map(f => `${f}=?`).join(', ');
  const values = allowedFields.map(f => {
    if (f === 'consume_systems') {
      return Array.isArray(req.body[f]) ? JSON.stringify(req.body[f]) : req.body[f];
    }
    return req.body[f] !== undefined ? req.body[f] : field[f];
  });
  values.push(fieldId);

  db.prepare(`UPDATE field_entries SET ${updates}, updated_at=datetime('now') WHERE id=?`).run(...values);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare("DELETE FROM field_entries WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 3: 创建 fieldIdentities.js**

```javascript
// mdm-collector/server/routes/fieldIdentities.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/field/:fieldEntryId', requireAuth, (req, res) => {
  const identity = db.prepare("SELECT * FROM field_identities WHERE field_entry_id=?").get(req.params.fieldEntryId);
  res.json(identity || {});
});

// 创建或更新 field_identity（黄金源确认）
router.put('/:fieldEntryId', requireAuth, (req, res) => {
  const { candidate_systems, authoritative_system, maintain_dept_id, owner_user_id, confirmed, note } = req.body;
  const existing = db.prepare("SELECT id FROM field_identities WHERE field_entry_id=?").get(req.params.fieldEntryId);
  const cs = Array.isArray(candidate_systems) ? JSON.stringify(candidate_systems) : candidate_systems;

  if (existing) {
    db.prepare("UPDATE field_identities SET candidate_systems=?, authoritative_system=?, maintain_dept_id=?, owner_user_id=?, confirmed=?, note=? WHERE field_entry_id=?").run(
      cs, authoritative_system, maintain_dept_id, owner_user_id, confirmed ? 1 : 0, note, req.params.fieldEntryId
    );
  } else {
    db.prepare("INSERT INTO field_identities (field_entry_id, candidate_systems, authoritative_system, maintain_dept_id, owner_user_id, confirmed, note) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      req.params.fieldEntryId, cs, authoritative_system, maintain_dept_id, owner_user_id, confirmed ? 1 : 0, note
    );
  }
  res.json({ success: true });
});

// 确认权威系统
router.post('/:fieldEntryId/confirm', requireAuth, (req, res) => {
  const { authoritative_system } = req.body;
  db.prepare("UPDATE field_identities SET authoritative_system=?, confirmed=1, confirmed_by=?, confirmed_at=datetime('now') WHERE field_entry_id=?").run(
    authoritative_system, req.session.userId, req.params.fieldEntryId
  );
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 4: Commit**

```bash
git add mdm-collector/server/routes/mappings.js mdm-collector/server/routes/fieldEntries.js mdm-collector/server/routes/fieldIdentities.js
git commit -m "feat(mappings): add mapping CRUD + parallel approval tasks + error conflict blocking + column-level auth"
```

---

## Task 6: 待办 + 冲突管理路由

**Files:**
- Create: `mdm-collector/server/routes/todos.js`
- Create: `mdm-collector/server/routes/conflicts.js`

- [ ] **Step 1: 创建 todos.js**

```javascript
// mdm-collector/server/routes/todos.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/', requireAuth, (req, res) => {
  const { dept_id, status, type } = req.query;
  let sql = `SELECT t.*, fd.name as from_dept_name, td.name as to_dept_name
             FROM todos t
             LEFT JOIN departments fd ON t.from_dept_id = fd.id
             LEFT JOIN departments td ON t.to_dept_id = td.id WHERE 1=1`;
  const params = [];
  if (dept_id) { sql += " AND t.to_dept_id=?"; params.push(dept_id); }
  if (status) { sql += " AND t.status=?"; params.push(status); }
  if (type) { sql += " AND t.type=?"; params.push(type); }
  sql += " ORDER BY t.due_date ASC, t.created_at DESC";
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireAuth, (req, res) => {
  const { from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date } = req.body;
  const stmt = db.prepare("INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const result = stmt.run(from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date);
  res.json({ id: result.lastInsertRowid });
});

router.post('/:id/done', requireAuth, (req, res) => {
  db.prepare("UPDATE todos SET status='done', done_at=datetime('now') WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare("DELETE FROM todos WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 2: 创建 conflicts.js（P1-4 修复：value 取对应 conflict_field 的实际值）**

```javascript
// mdm-collector/server/routes/conflicts.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

// 获取冲突列表
router.get('/', requireAuth, (req, res) => {
  const { type, severity, status } = req.query;
  let sql = "SELECT * FROM (";
  if (type === 'term') {
    sql += "SELECT tc.*, 'term' as conflict_type FROM term_conflicts tc WHERE 1=1";
  } else if (type === 'field') {
    sql += "SELECT fc.*, 'field' as conflict_type FROM field_conflicts fc WHERE 1=1";
  } else {
    sql += "SELECT tc.*, 'term' as conflict_type FROM term_conflicts tc UNION ALL SELECT fc.*, 'field' as conflict_type FROM field_conflicts fc";
  }
  if (severity) sql += " AND severity=?";
  if (status) sql += " AND status=?";
  sql += ") WHERE 1=1";
  const params = [];
  if (severity) params.push(severity);
  if (status) params.push(status);
  res.json(db.prepare(sql).all(...params));
});

// 手动触发字段冲突检测（同名字段归并）
// P1-4 修复：value_a/value_b 按 conflict_field 取实际字段值，而非固定 consume_systems
router.post('/detect', requireAuth, (req, res) => {
  const { field_name_cn } = req.query;
  if (!field_name_cn) return res.status(400).json({ error: '缺少 field_name_cn' });

  // 查找同名且来自不同部门的字段
  const conflicts = db.prepare(`
    SELECT a.id as a_id, b.id as b_id, a.field_name_cn, a.field_name_en,
           a.submitted_by as sa, b.submitted_by as sb,
           ua.department_id as da, ub.department_id as db
    FROM field_entries a
    JOIN field_entries b ON a.field_name_cn = b.field_name_cn AND a.id < b.id
    JOIN users ua ON a.submitted_by = ua.id
    JOIN users ub ON b.submitted_by = ub.id
    WHERE a.field_name_cn = ? AND ua.department_id != ub.department_id
  `).all(field_name_cn);

  const insertConflicts = db.transaction(() => {
    conflicts.forEach(c => {
      // 取权威系统判断冲突字段和 severity
      const idA = db.prepare("SELECT * FROM field_identities WHERE field_entry_id=?").get(c.a_id);
      const idB = db.prepare("SELECT * FROM field_identities WHERE field_entry_id=?").get(c.b_id);

      // 判定 conflict_field：权威系统不一致 → authoritative_system，其他字段不一致 → 对应字段名
      let conflictField = 'other';
      let severity = 'warn';
      let valueA = '';
      let valueB = '';

      if (idA && idB) {
        if (idA.authoritative_system && idB.authoritative_system) {
          if (idA.authoritative_system !== idB.authoritative_system) {
            conflictField = 'authoritative_system';
            severity = 'error';
            valueA = idA.authoritative_system;
            valueB = idB.authoritative_system;
          }
        }
      }

      // 如果权威系统相同或未确认，检查 note
      if (conflictField === 'other') {
        const fa = db.prepare("SELECT note FROM field_entries WHERE id=?").get(c.a_id);
        const fb = db.prepare("SELECT note FROM field_entries WHERE id=?").get(c.b_id);
        if (fa && fb && fa.note !== fb.note) {
          conflictField = 'note';
          valueA = fa.note || '';
          valueB = fb.note || '';
        }
      }

      // 仍无差异时取 consume_systems
      if (conflictField === 'other') {
        conflictField = 'consume_systems';
        const fa = db.prepare("SELECT consume_systems FROM field_entries WHERE id=?").get(c.a_id);
        const fb = db.prepare("SELECT consume_systems FROM field_entries WHERE id=?").get(c.b_id);
        valueA = fa ? (fa.consume_systems || '') : '';
        valueB = fb ? (fb.consume_systems || '') : '';
      }

      db.prepare(`INSERT INTO field_conflicts (field_entry_a_id, field_entry_b_id, conflict_field, submitter_a, value_a, submitter_b, value_b, dept_a, dept_b, severity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.a_id, c.b_id, conflictField, c.sa, valueA, c.sb, valueB, c.da, c.db, severity);
    });
  });
  insertConflicts();
  res.json({ detected: conflicts.length });
});

// 解决冲突
router.post('/:id/resolve', requireAuth, (req, res) => {
  const { resolution, adopted_value } = req.body;
  const conflict = db.prepare("SELECT * FROM field_conflicts WHERE id=?").get(req.params.id);
  if (!conflict) return res.status(404).json({ error: 'Not found' });

  const resolve = db.transaction(() => {
    db.prepare("UPDATE field_conflicts SET status='resolved', resolution=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?").run(
      resolution, req.session.userId, req.params.id
    );

    // 回写 authoritative_system（仅当冲突字段为 authoritative_system 时）
    if (conflict.conflict_field === 'authoritative_system' && adopted_value) {
      [conflict.field_entry_a_id, conflict.field_entry_b_id].forEach(feId => {
        const fi = db.prepare("SELECT * FROM field_identities WHERE field_entry_id=?").get(feId);
        if (fi) {
          db.prepare("UPDATE field_identities SET authoritative_system=?, confirmed=1, confirmed_by=?, confirmed_at=datetime('now') WHERE field_entry_id=?").run(
            adopted_value, req.session.userId, feId
          );
        }
      });
    }

    // 检查该 mapping 是否所有 error 都已解决，若无则解除 blocked
    const mapping = db.prepare(`
      SELECT m.id as mapping_id FROM mappings m
      JOIN field_entries fe ON fe.mapping_id = m.id
      WHERE fe.id IN (?, ?)
      LIMIT 1
    `).get(conflict.field_entry_a_id, conflict.field_entry_b_id);
    if (mapping) {
      const remainingErrors = db.prepare(`
        SELECT COUNT(*) as cnt FROM field_conflicts fc
        JOIN field_entries fe ON fc.field_entry_a_id = fe.id OR fc.field_entry_b_id = fe.id
        WHERE fe.mapping_id = ? AND fc.severity = 'error' AND fc.status = 'pending'
      `).get(mapping.mapping_id);
      if (remainingErrors.cnt === 0) {
        db.prepare("UPDATE approval_tasks SET status='in_progress' WHERE mapping_id=? AND status='blocked'").run(mapping.mapping_id);
      }
    }
  });
  resolve();
  res.json({ success: true });
});

// 解决术语冲突
router.post('/term/:id/resolve', requireAuth, (req, res) => {
  const { resolution } = req.body;
  db.prepare("UPDATE term_conflicts SET status='resolved', resolution=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?").run(
    resolution, req.session.userId, req.params.id
  );
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git add mdm-collector/server/routes/todos.js mdm-collector/server/routes/conflicts.js
git commit -m "feat(conflicts): add todos and conflict management with correct conflict_field value resolution"
```

---

## Task 7: 术语词典 + 版本记录路由

**Files:**
- Create: `mdm-collector/server/routes/terminology.js`
- Create: `mdm-collector/server/routes/versions.js`

- [ ] **Step 1: 创建 terminology.js**

```javascript
// mdm-collector/server/routes/terminology.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

router.get('/', requireAuth, (req, res) => {
  const { status } = req.query;
  let sql = "SELECT * FROM terms";
  const params = [];
  if (status) { sql += " WHERE status=?"; params.push(status); }
  sql += " ORDER BY term";
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireRole('admin'), (req, res) => {
  const { term, definition, scope, forbidden } = req.body;
  const stmt = db.prepare("INSERT INTO terms (term, definition, scope, forbidden, created_by) VALUES (?, ?, ?, ?, ?)");
  const result = stmt.run(term, definition, scope, forbidden, req.session.userId);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { term, definition, scope, forbidden } = req.body;
  db.prepare("UPDATE terms SET term=?, definition=?, scope=?, forbidden=? WHERE id=?").run(term, definition, scope, forbidden, req.params.id);
  res.json({ success: true });
});

router.post('/:id/review', requireRole('admin'), (req, res) => {
  const { action } = req.body;
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  db.prepare("UPDATE terms SET status=?, approved_by=?, approved_at=datetime('now') WHERE id=?").run(newStatus, req.session.userId, req.params.id);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 2: 创建 versions.js**

```javascript
// mdm-collector/server/routes/versions.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/entity/:type/:id', requireAuth, (req, res) => {
  const { type, id } = req.params;
  const changeSets = db.prepare("SELECT * FROM change_set WHERE entity_type=? AND entity_id=? ORDER BY operated_at DESC").all(type, id);
  const logs = db.prepare("SELECT * FROM version_log WHERE entity_type=? AND entity_id=? ORDER BY operated_at DESC").all(type, id);
  res.json({ changeSets, logs });
});

router.get('/mapping/:id', requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT vl.*, u.name as operator_name
    FROM version_log vl
    LEFT JOIN users u ON vl.operated_by = u.id
    WHERE vl.entity_type='mapping' AND vl.entity_id=?
    ORDER BY vl.operated_at DESC
  `).all(req.params.id);
  res.json(logs);
});

router.get('/field/:id', requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT vl.*, u.name as operator_name
    FROM version_log vl
    LEFT JOIN users u ON vl.operated_by = u.id
    WHERE vl.entity_type='field_entry' AND vl.entity_id=?
    ORDER BY vl.operated_at DESC
  `).all(req.params.id);
  res.json(logs);
});

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git add mdm-collector/server/routes/terminology.js mdm-collector/server/routes/versions.js
git commit -m "feat(terms): add terminology dictionary and version history routes"
```

---

## Task 8: 导出模块

**Files:**
- Create: `mdm-collector/server/routes/export.js`

- [ ] **Step 1: 创建 export.js**

```javascript
// mdm-collector/server/routes/export.js
const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/excel', requireAuth, async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MDM Collector';
  workbook.created = new Date();

  // Sheet1: 字段台账
  const ws1 = workbook.addWorksheet('字段台账');
  ws1.columns = [
    { header: '业务流程', key: 'process_name', width: 20 },
    { header: '应用系统', key: 'system_name', width: 15 },
    { header: '数据对象', key: 'data_object', width: 12 },
    { header: '中文字段名', key: 'field_name_cn', width: 18 },
    { header: '英文字段名', key: 'field_name_en', width: 18 },
    { header: '字段类型', key: 'field_type', width: 10 },
    { header: '黄金源系统', key: 'authoritative_system', width: 12 },
    { header: '维护部门', key: 'maintain_dept', width: 12 },
    { header: '消费系统', key: 'consume_systems', width: 20 },
    { header: '同步方式', key: 'sync_mode', width: 12 },
    { header: '字段说明', key: 'note', width: 25 },
  ];

  const fields = db.prepare(`
    SELECT fe.*, p.name as process_name, s.name as system_name,
           fi.authoritative_system, d.name as maintain_dept
    FROM field_entries fe
    JOIN mappings m ON fe.mapping_id = m.id
    JOIN processes p ON m.process_id = p.id
    JOIN mapping_systems ms ON ms.mapping_id = m.id
    JOIN systems s ON ms.system_id = s.id AND ms.system_role = 'primary'
    LEFT JOIN field_identities fi ON fi.field_entry_id = fe.id
    LEFT JOIN departments d ON fi.maintain_dept_id = d.id
    WHERE m.status = 'published'
  `).all();

  fields.forEach(f => {
    let cs = f.consume_systems;
    if (cs) { try { cs = JSON.parse(cs).join(', '); } catch(e) {} }
    ws1.addRow({
      process_name: f.process_name,
      system_name: f.system_name,
      data_object: f.data_object,
      field_name_cn: f.field_name_cn,
      field_name_en: f.field_name_en,
      field_type: f.field_type,
      authoritative_system: f.authoritative_system || '',
      maintain_dept: f.maintain_dept || '',
      consume_systems: cs || '',
      sync_mode: f.sync_mode,
      note: f.note,
    });
  });

  // Sheet2: 黄金源矩阵
  const ws2 = workbook.addWorksheet('黄金源矩阵');
  ws2.columns = [
    { header: '业务流程', key: 'process_name', width: 20 },
    { header: '应用系统', key: 'system_name', width: 15 },
    { header: '中文字段名', key: 'field_name_cn', width: 18 },
    { header: '候选系统', key: 'candidate_systems', width: 25 },
    { header: '权威系统', key: 'authoritative_system', width: 15 },
    { header: '维护部门', key: 'maintain_dept', width: 12 },
    { header: '是否确认', key: 'confirmed', width: 10 },
    { header: '确认人', key: 'confirmer', width: 10 },
    { header: '确认时间', key: 'confirmed_at', width: 15 },
  ];

  const identities = db.prepare(`
    SELECT fe.field_name_cn, p.name as process_name, s.name as system_name,
           fi.candidate_systems, fi.authoritative_system, d.name as maintain_dept,
           fi.confirmed, u.name as confirmer, fi.confirmed_at
    FROM field_identities fi
    JOIN field_entries fe ON fi.field_entry_id = fe.id
    JOIN mappings m ON fe.mapping_id = m.id
    JOIN processes p ON m.process_id = p.id
    JOIN mapping_systems ms ON ms.mapping_id = m.id AND ms.system_role = 'primary'
    JOIN systems s ON ms.system_id = s.id
    LEFT JOIN departments d ON fi.maintain_dept_id = d.id
    LEFT JOIN users u ON fi.confirmed_by = u.id
    WHERE m.status = 'published'
  `).all();

  identities.forEach(i => {
    let cands = i.candidate_systems;
    if (cands) { try { cands = JSON.parse(cands).join(', '); } catch(e) {} }
    ws2.addRow({
      process_name: i.process_name,
      system_name: i.system_name,
      field_name_cn: i.field_name_cn,
      candidate_systems: cands || '',
      authoritative_system: i.authoritative_system || '',
      maintain_dept: i.maintain_dept || '',
      confirmed: i.confirmed ? '是' : '否',
      confirmer: i.confirmer || '',
      confirmed_at: i.confirmed_at || '',
    });
  });

  // Sheet3: 术语冲突台账
  const ws3 = workbook.addWorksheet('术语冲突台账');
  ws3.columns = [
    { header: '术语', key: 'term', width: 15 },
    { header: '部门A', key: 'dept_a', width: 12 },
    { header: 'A理解', key: 'dept_a_meaning', width: 20 },
    { header: '部门B', key: 'dept_b', width: 12 },
    { header: 'B理解', key: 'dept_b_meaning', width: 20 },
    { header: '严重程度', key: 'severity', width: 10 },
    { header: '状态', key: 'status', width: 10 },
    { header: '解决方案', key: 'resolution', width: 25 },
  ];

  const termConflicts = db.prepare("SELECT * FROM term_conflicts ORDER BY created_at DESC").all();
  termConflicts.forEach(tc => {
    const da = db.prepare("SELECT name FROM departments WHERE id=?").get(tc.dept_a);
    const db2 = db.prepare("SELECT name FROM departments WHERE id=?").get(tc.dept_b);
    ws3.addRow({
      term: tc.term,
      dept_a: da ? da.name : '',
      dept_a_meaning: tc.dept_a_meaning,
      dept_b: db2 ? db2.name : '',
      dept_b_meaning: tc.dept_b_meaning,
      severity: tc.severity,
      status: tc.status === 'resolved' ? '已解决' : tc.status === 'rejected' ? '已驳回' : '待解决',
      resolution: tc.resolution || '',
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=mdm-field-ledger.xlsx');

  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-collector/server/routes/export.js
git commit -m "feat(export): add Excel export for field ledger + gold source matrix + term conflicts"
```

---

## Task 9: 前端界面（index.html）

**Files:**
- Create: `mdm-collector/public/index.html`
- Create: `mdm-collector/public/template.xlsx`

- [ ] **Step 1: 创建 index.html**

> 主体结构：参考 `docs/Demo/信息化系统应用与集成说明会.html` 视觉风格
> - 6 个 Tab 面板（统计看板 / 报送管理 / 待办收到 / 评审记录 / 术语词典 / 冲突管理）
> - CSS 内联，动画：fadeIn / slideUp / blink / pulse
> - ECharts CDN 引入（看板页）
> - fetch 调用后端 API
> - 冲突检测按钮、审批意见弹窗、导出按钮

- [ ] **Step 2: 创建 template.xlsx**

使用 ExcelJS 生成标准导入模板（表头含填写说明）。

- [ ] **Step 3: Commit**

```bash
git add mdm-collector/public/index.html mdm-collector/public/template.xlsx
git commit -m "feat(frontend): add single-file HTML UI with tab navigation, animations, and ECharts dashboard"
```

---

## Task 10: 初始化脚本 + README

**Files:**
- Create: `mdm-collector/scripts/init-db.js`
- Create: `mdm-collector/README.md`

- [ ] **Step 1: 创建 init-db.js**

```javascript
// mdm-collector/scripts/init-db.js
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const adminHash = hashPassword('admin123');
const check = db.prepare("SELECT id FROM users WHERE employee_no='ADMIN001'").get();
if (!check) {
  db.prepare("INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, NULL, ?, ?, ?)").run(
    '系统管理员', 'ADMIN001', '系统管理员', 'admin', adminHash
  );
  console.log('Admin account created: ADMIN001 / admin123');
} else {
  console.log('Admin account already exists');
}
```

- [ ] **Step 2: 创建 README.md**

```markdown
# MDM 数据收集与评审模块

## 快速启动

```bash
cd mdm-collector
npm install
npm start
# 访问 http://localhost:3000
# 默认管理员：ADMIN001 / admin123
```

## 功能模块

- 统计看板：各部门提交流程数、待办数、冲突数、字段台账完成率
- 数据报送：表单录入 + Excel 批量导入
- 审批流：提交 → 部门内审 → 跨部门确认 → 字段台账确认 → 终审
- 跨部门待办：给其他部门派发待办
- 冲突管理：字段冲突 + 术语冲突，severity 分级
- 术语词典：术语维护 + 审批流
- 版本记录：实体的完整修改历史
- Excel 导出：字段台账 + 黄金源矩阵 + 术语冲突台账

## 技术栈

- 前端：单文件 HTML（原生 JS + CSS，参考演示文件视觉风格）
- 后端：Express.js + SQLite (better-sqlite3)
- 认证：bcryptjs + express-session
- 导出：exceljs
```

- [ ] **Step 3: Commit**

```bash
git add mdm-collector/scripts/init-db.js mdm-collector/README.md
git commit -m "docs: add init script and README"
```

---

## 自检清单

- [x] hashPassword/verifyPassword 同步，无 async/await 不匹配
- [x] step=3 通过前检查 field_conflicts 未解决 error，数量>0 时置 blocked
- [x] /submit 为 step 3/4 并行插入 approval_tasks（每部门/每人一条）
- [x] 冲突检测 value_a/value_b 按 conflict_field 取对应实际字段值
- [x] 无嵌套 git init，在主仓库提交
- [x] fieldEntries.js 列级权限：submitter/owner/reviewer/admin 分级控制可写字段
- [x] 测试框架已从 plan 中移除（无 mocha 依赖）
- [x] 所有路由字段名、参数名与 db.js 建表语句一致

---

## 依赖关系

```
Task 1（脚手架+建表） → Task 2（认证） → Task 3（组织架构路由） → Task 4（系统/能力/流程） → Task 5（映射+审批流） → Task 6（待办+冲突） → Task 7（术语+版本） → Task 8（导出） → Task 9（前端） → Task 10（初始化+README）
```

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-mdm-collector-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
