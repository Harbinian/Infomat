# MDM 平台删除权限完整修复 — 设计规格

## 概述

补全 MDM 平台所有资源类型的 DELETE 端点，统一鉴权逻辑，并在前端暴露删除入口。

### 目标

- V2 数据模型 (8 个资源) 新增 DELETE 端点，含级联删除
- V1 补漏 (capabilities, processes) 新增 DELETE 端点
- 统一使用 `requirePermission('admin:access')` 保护所有删除操作
- classNode membership 删除权限从 `requireAuth` 收紧为 `admin:access`
- mappings.js 删除从旧 `session.userRole` 检查迁移到 RBAC
- 前端 15 处数据列表面板新增删除按钮 (仅 admin 可见)

### 非目标

- 不引入软删除机制
- 不改动现有数据模型或外键定义
- 不在前端引入批量删除

---

## DELETE 端点清单

### V2 资源 (8 路由，9 端点)

| 端点 | 路由文件 | 级联删除链 |
|------|----------|-----------|
| `DELETE /api/org-units/:code` | orgUnit.js | org_unit → position → person_position_assignment |
| `DELETE /api/positions/:code` | position.js | position → person_position_assignment |
| `DELETE /api/persons/:employeeNo` | person.js | person → person_position_assignment |
| `DELETE /api/product-families/:code` | productFamily.js | product_family → product → attribute_value + entity_class_membership |
| `DELETE /api/products/:code` | product.js | product → attribute_value + entity_class_membership |
| `DELETE /api/class-nodes/:code` | classNode.js | class_node (递归子节点) → entity_class_membership |
| `DELETE /api/attributes/defs/:code` | attribute.js | attribute_def → attribute_value |
| `DELETE /api/external/systems/:code` | external.js | external_system → external_identity (by system_code) |
| `DELETE /api/external/identities/:id` | external.js | 单行，无级联 |

### V1 补漏 (2 路由，2 端点)

| 端点 | 路由文件 | 级联删除链 |
|------|----------|-----------|
| `DELETE /api/capabilities/:id` | capabilities.js | capability (递归子节点 L1→L2→L3) |
| `DELETE /api/processes/:id` | processes.js | process → mappings → field_entries + field_identities + approval_tasks + approval_history + todos + mapping_related_departments |

---

## 鉴权模型

所有新 DELETE 端点统一使用：

```js
router.delete('/:id', requireAuth, requirePermission('admin:access'), (req, res) => { ... });
```

超管 (admin) 通过 seed 数据获得 `*:*` 通配符，自动通过 `requirePermission('admin:access')`。

### 两处已有端点的鉴权修正

**classNode.js membership delete (L101)**：

```diff
-router.delete('/memberships/:id', requireAuth, (req, res) => {
+router.delete('/memberships/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
```

**mappings.js delete (L205)**：

```diff
-if (mapping.submitted_by !== req.session.userId && req.session.userRole !== 'admin') {
+const { permSet } = getUserEffectivePermissions(req.session.userId);
+const isAdmin = permSet.has('admin:access') || permSet.has('*:*');
+if (mapping.submitted_by !== req.session.userId && !isAdmin) {
```

mappings.js 顶部需新增导入：
```js
const { getUserEffectivePermissions } = require('../auth');
```

---

## 级联删除实现模式

每个 DELETE 处理函数按以下模式实现：

```js
router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const record = db.prepare('SELECT * FROM <table> WHERE <key>=?').get(req.params.code);
    if (!record) return res.status(404).json({ error: '<资源>不存在' });

    const cascaded = {};

    // 1. 查询并删除最底层子孙
    // 2. 逐层向上删除，记录各级数量
    // 3. 最后删除自身

    // 示例：org_unit
    const positions = db.prepare('SELECT position_id FROM position WHERE org_unit_id=?').all(record.org_unit_id);
    for (const p of positions) {
      const { changes: assignments } = db.prepare('DELETE FROM person_position_assignment WHERE position_id=?').run(p.position_id);
      cascaded.assignments = (cascaded.assignments || 0) + assignments;
    }
    const { changes: posCount } = db.prepare('DELETE FROM position WHERE org_unit_id=?').run(record.org_unit_id);
    cascaded.positions = posCount;
    db.prepare('DELETE FROM org_unit WHERE org_unit_id=?').run(record.org_unit_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

返回格式：
```json
{ "success": true, "cascaded": { "assignments": 3, "positions": 2 } }
```

---

## 前端删除入口

在 index.html 的 15 个数据列表面板中添加删除操作。

### 实现模式

每处删除按钮遵循统一模式：

```js
// 渲染时：仅 admin 可见
if (isAdmin) {
  html += '<a href="#" onclick="deleteResource(\'' + item.code + '\')" style="color:#e53935;">删除</a>';
}

// 删除函数
function deleteResource(code) {
  if (!confirm('确定要删除 ' + code + ' 吗？相关子数据也将被删除。')) return;
  fetch('/api/resource/' + code, { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { alert('删除失败：' + data.error); }
      else { renderList(); }
    });
}
```

### 面板清单

| Tab | 渲染函数/位置 | 资源 | API |
|-----|-------------|------|-----|
| 组织架构 | 部门表格 | 部门 | `DELETE /api/org/departments/:id` |
| 组织架构 | 系统表格 | 系统 | `DELETE /api/systems/:id` |
| 能力流程 | 能力表格 | 能力 | `DELETE /api/capabilities/:id` |
| 能力流程 | 流程表格 | 流程 | `DELETE /api/processes/:id` |
| 组织架构(V2) | OU 表格 | 组织单元 | `DELETE /api/org-units/:code` |
| 人员管理 | 岗位表格 | 岗位 | `DELETE /api/positions/:code` |
| 人员管理 | 人员表格 | 人员 | `DELETE /api/persons/:employeeNo` |
| 产品主数据 | 产品族表格 | 产品族 | `DELETE /api/product-families/:code` |
| 产品主数据 | 产品表格 | 产品 | `DELETE /api/products/:code` |
| 产品主数据 | 分类节点表格 | 分类节点 | `DELETE /api/class-nodes/:code` |
| 产品主数据 | 属性定义表格 | 属性定义 | `DELETE /api/attributes/defs/:code` |
| 产品主数据 | 外部系统表格 | 外部系统 | `DELETE /api/external/systems/:code` |
| 业务映射 | 映射表格 | 映射 | `DELETE /api/mappings/:id` |
| 业务映射 | 字段台账表格 | 字段台账 | `DELETE /api/field-entries/:id` |
| 待办 | 待办列表 | 待办 | `DELETE /api/todos/:id` |

### 权限判断

前端通过 `state.user.role === 'admin'` 判断是否显示删除按钮（与现有角色删除按钮一致）。后续可扩展为 `state.user.adminAccess === true` 传入，但本次沿用现有模式。

---

## 测试验证

所有测试手工执行：

1. **鉴权测试**：非登录用户调用 DELETE → 401；非 admin 用户调用 → 403
2. **级联验证**：创建 org_unit → position → assignment 链，删除 org_unit，确认三级记录均被删除
3. **错误处理**：删除不存在的 code → 404
4. **前端冒烟**：admin 登录后在各面板看到删除按钮，点击确认后数据消失
5. **非 admin 不可见**：submitter/reviewer 登录后删除按钮不显示
