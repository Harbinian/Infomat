# MDM 平台 RBAC 角色权限管理系统 — 设计规格

## 概述

为 MDM 平台新增完整的基于角色的访问控制（RBAC）系统，提供管理员图形化角色和权限管理界面，支持批量导入。

### 目标

- 动态角色定义（增删改），支持角色继承
- 资源+操作+字段级权限控制
- 统一管理功能访问权限和数据操作权限
- 直接替换现有 `requireRole` / `requireDataPermission` 中间件
- 批量导入用户-角色分配和角色-权限定义（Excel + CSV）
- 管理员图形化界面操作
- 首次登录强制修改初始密码，支持登录后修改密码

### 非目标

- 不做现有数据迁移（当前均为测试数据）
- 不接入外部认证系统（OA/统一认证）
- 不引入前端框架或构建工具

---

## 数据模型

### 新增 4 张表

```sql
-- 角色定义表
CREATE TABLE roles (
  role_id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_code TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  description TEXT,
  parent_role_id INTEGER REFERENCES roles(role_id),
  is_system INTEGER NOT NULL DEFAULT 0,  -- 1=系统预置，不可删除
  permissions_json TEXT DEFAULT '{}',    -- 扩展字段级约束
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 权限定义表
CREATE TABLE permissions (
  perm_id INTEGER PRIMARY KEY AUTOINCREMENT,
  perm_code TEXT NOT NULL UNIQUE,        -- 格式: resource:action，通配 *:*
  resource TEXT NOT NULL,                -- 资源类型: product, org_unit, person, system...
  action TEXT NOT NULL,                  -- 操作: read, create, update, delete, approve, submit...
  field_constraints TEXT DEFAULT NULL,   -- JSON: {"exclude":["mobile"],"readonly":["cost"]}
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 角色-权限关联表
CREATE TABLE role_permissions (
  role_perm_id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  perm_id INTEGER NOT NULL REFERENCES permissions(perm_id) ON DELETE CASCADE,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  UNIQUE(role_id, perm_id)
);

-- 用户-角色关联表
CREATE TABLE user_roles (
  user_role_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, role_id)
);
```

### 预置数据

**4 个系统角色** (`is_system=1`)：

| role_code | role_name | parent_role_id |
|-----------|-----------|----------------|
| admin | 管理员 | NULL |
| reviewer | 审核员 | NULL |
| owner | 业务负责人 | NULL |
| submitter | 报送人 | NULL |

**预置权限码**（部分）：

| 系统角色 | 权限码 |
|----------|--------|
| admin | `*:*`（通配全部权限） |
| reviewer | `review:approve`, `conflict:manage`, `conflict:resolve`, `dashboard:view`, `mapping:read`, `todos:manage` |
| owner | `mapping:create`, `mapping:update`, `mapping:submit`, `mapping:read`, `dashboard:view`, `todos:manage` |
| submitter | `mapping:submit`, `mapping:read`, `dashboard:view` |

### 现有表变更

- `users.role`：保留但不再作为权限判断依据，仅供向后兼容
- `users.permissions`：保留但废弃，不再写入
- `user_dept_roles`：保留但废弃，由新 RBAC 系统覆盖

### 角色继承规则

角色通过 `parent_role_id` 形成继承链。权限检查时，用户的最终权限集 = 直接分配角色的权限 ∪ 所有父角色的权限（递归向上合并）。子角色中 `effect=deny` 的条目可以覆盖继承的 `allow`。

### 字段级权限

`permissions.field_constraints` JSON 定义该权限对应的字段级控制：
- `exclude`: 列表中字段从响应中移除
- `readonly`: 列表中字段在响应中保留但不可修改

中间件 `applyFieldConstraints` 在响应阶段根据用户的全部有效权限合并字段约束后执行过滤。

---

## API 路由

### 新增路由模块: `server/routes/roles.js`

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/roles` | 角色列表（含继承链、权限数、用户数） | `admin:access` |
| GET | `/api/roles/:id` | 角色详情 + 完整权限树 + 已分配用户列表 | `admin:access` |
| POST | `/api/roles` | 创建自定义角色 | `admin:access` |
| PUT | `/api/roles/:id` | 编辑角色（名称/描述/父角色） | `admin:access` |
| DELETE | `/api/roles/:id` | 删除角色（is_system=1 拒绝，有用户绑定时拒绝） | `admin:access` |
| GET | `/api/roles/:id/permissions` | 某角色的权限矩阵（含继承标记） | `admin:access` |
| PUT | `/api/roles/:id/permissions` | 批量更新角色权限（整表替换，事务中先删后插） | `admin:access` |

### 新增路由模块: 扩展用户路由

在现有 `server/routes/org.js` 中新增：

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/users/:id/roles` | 查看用户角色列表 | `admin:access` |
| PUT | `/api/users/:id/roles` | 设置用户角色（替换全部角色） | `admin:access` |
| GET | `/api/permissions` | 全部权限定义列表（按资源分组） | `admin:access` |

### 密码管理（扩展 org.js）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/me/password` | 当前登录用户修改自己的密码 |
| GET | `/api/me/password-status` | 检查当前用户是否使用初始密码 |

### 批量导入路由

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/import/user-roles` | 上传用户-角色分配文件 | `admin:access` |
| POST | `/api/import/role-permissions` | 上传角色-权限定义文件 | `admin:access` |
| GET | `/api/import/templates/user-roles` | 下载用户-角色导入模板 (.xlsx) | `admin:access` |
| GET | `/api/import/templates/role-permissions` | 下载角色-权限导入模板 (.xlsx) | `admin:access` |

---

## 导入模板定义

### 模板一：用户-角色分配

| 列 | 列名 | 必填 | 说明 |
|----|------|------|------|
| A | 工号 | 是 | 匹配 users.employee_no |
| B | 姓名 | 否 | 仅校验提示，不写入 |
| C | 角色编码 | 是 | 多个角色逗号分隔，如 `reviewer,dept_auditor` |
| D | 操作类型 | 否 | `add`（追加）/ `replace`（替换全部），默认 replace |

### 模板二：角色-权限定义

| 列 | 列名 | 必填 | 说明 |
|----|------|------|------|
| A | 角色编码 | 是 | 目标角色，不存在则自动创建 |
| B | 角色名称 | 新建时 | 已有角色忽略此列 |
| C | 父角色编码 | 否 | 继承角色，新建时有效 |
| D | 权限码 | 是 | `resource:action` 或 `*:*` 通配 |
| E | 效果 | 否 | `allow`（默认）/ `deny` |
| F | 字段限制 | 否 | JSON 字符串，如 `{"exclude":["mobile"]}` |

### 导入校验规则

- 工号必须在 users 表中存在
- 用户-角色导入时，角色编码必须在 roles 表中存在
- 角色-权限导入时，角色编码不存在则自动创建
- 权限码格式必须为 `resource:action` 或 `*:*`
- 字段限制如果填写必须是合法 JSON
- 同一文件内重复行自动去重（同一用户+同一角色只保留最后一次）

### 导入响应格式

```json
{
  "total": 50,
  "success": 47,
  "errors": [
    {"row": 3, "employee_no": "EMP099", "reason": "工号不存在"},
    {"row": 17, "employee_no": "EMP015", "reason": "角色编码 'bad_role' 不存在"}
  ],
  "imported_at": "2026-05-19T15:30:00+08:00"
}
```

---

## 中间件重设计

### `auth.js` 新增导出

```js
// 权限检查（统一替换 requireRole + requireDataPermission）
function requirePermission(permCode) {
  return (req, res, next) => {
    if (!req.session.userId) return send401(res);
    const perms = getUserEffectivePermissions(req.session.userId);
    if (!perms.has(permCode) && !perms.has('*:*')) {
      return send403(res, '权限不足');
    }
    req.effectivePermissions = perms;
    next();
  };
}

// 字段级过滤（替换 stripInternalIds）
function applyFieldConstraints(resourceType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      const constraints = getFieldConstraints(req.effectivePermissions, resourceType);
      return originalJson(applyConstraints(body, constraints));
    };
    next();
  };
}
```

### `getUserEffectivePermissions(userId)` 实现

1. 查询 `user_roles` 获取用户所有直接角色
2. 对每个角色，递归查询 `parent_role_id` 获取继承链
3. 合并所有角色的 `role_permissions`（含父角色），`deny` 覆盖 `allow`
4. 返回 `Set<permCode>` + 合并后的 `fieldConstraints` Map

### 路由文件改动

22 个路由文件中进行全局替换：

- `requireRole('admin')` → `requirePermission('admin:access')`
- `requireDataPermission(cat, act)` → `requirePermission(`${cat}:${act}`)
- `stripInternalIds` → `applyFieldConstraints(resourceType)`（按需）

改动量：每个路由文件约 3-10 处，整体约 100-150 处机械替换。

---

## 前端 UI

### 新增 Tab: "角色权限"

- Tab 按钮：`<button class="tab" data-tab="rbac" data-roles="admin">角色权限</button>`
- 仅 admin 角色可见
- 左右分栏布局：左侧子导航（260px），右侧主内容区

### 面板一：角色列表

- 表格展示：角色编码、名称、继承自、权限数、用户数、系统标记、操作
- 操作按钮：新建角色（弹出对话框）、编辑（系统角色跳过）、删除（系统角色和有用户的角色拒绝）
- 新建/编辑对话框：角色编码、名称、描述、父角色下拉选择

### 面板二：权限矩阵

- 上方角色选择器（下拉列表）
- 主体为资源×操作的 checkbox 网格表格
- 继承自父角色的权限以灰色 disabled 显示，不可取消
- 每行右侧可编辑字段限制 JSON（小文本框）
- 底部保存按钮，批量提交

### 面板三：用户角色分配

- 左栏：用户搜索 + 用户列表（可搜索工号/姓名）
- 右栏：选中用户的当前角色（checkbox 列表）+ 保存按钮
- 每个用户至少保留一个角色

### 面板四：批量导入

- 导入类型选择（用户-角色 / 角色-权限）
- 模板下载链接
- 文件拖拽/点击上传区域
- 上传后展示导入结果：成功数、失败数、逐行错误明细
- 最近导入历史记录

### 密码修改（全局）

- 登录后检测：如果当前密码是初始密码（`init1234`），弹出强制修改密码对话框，不可跳过
- 用户菜单中添加"修改密码"选项：当前密码 + 新密码 + 确认密码
- 后端 `POST /api/me/password` 验证当前密码，更新为新密码

### 技术约束

- 无前端框架，纯原生 HTML/CSS/JS
- 复用现有的 Tab 切换机制和 `data-roles` 可见性控制
- 复用现有 CSS 样式约定（与现有 UI 风格一致）

---

## 测试策略

### 冒烟测试

新增 `scripts/smoke-rbac.js`：
- 角色 CRUD：创建/读取/更新/删除自定义角色
- 权限分配：为角色添加/移除权限，验证继承
- 用户角色：为用户分配/移除角色
- 权限检查：验证中间件拦截（有权限通过、无权限 403）
- 字段过滤：验证 `applyFieldConstraints` 正确排除/只读字段
- 密码修改：验证修改密码、初始密码检测
- 批量导入：验证用户-角色导入、角色-权限导入、错误报告

### 现有测试

- `smoke-master-data.js` 和 `smoke-integration.js` 全部通过（中间件替换后路由行为不变）
- `npm test:frontend` 通过（新 Tab 不破坏现有 Tab）

### 测试数据

所有测试用例使用独立的测试角色和测试用户，不依赖现有生产数据。

---

## 实施顺序

1. **建表** — db.js 新增 CREATE TABLE（IF NOT EXISTS，幂等）
2. **预置数据** — init-db 插入 4 个系统角色 + 预置权限码
3. **auth.js 中间件** — 新增 `requirePermission`、`applyFieldConstraints`，实现 `getUserEffectivePermissions`
4. **角色路由** — `routes/roles.js`（角色 CRUD + 权限分配）
5. **用户路由扩展** — org.js 新增用户角色端点 + 密码管理端点
6. **导入路由** — `routes/import.js` 或扩展现有 import.js（批量导入 + 模板下载）
7. **中间件替换** — 22 个路由文件中全局替换 requireRole → requirePermission
8. **前端 UI** — index.html 新增"角色权限"Tab + 密码修改对话框
9. **测试** — smoke-rbac.js 冒烟测试
