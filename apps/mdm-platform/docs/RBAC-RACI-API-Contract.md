# 3000 RBAC 与 RACI 接口约定

## 1. 通用规则

- 所有接口使用JSON。
- 除登录外均要求有效会话。
- 写接口同时接受CSRF保护。
- 错误响应至少包含`error`；稳定业务错误同时包含`code`。
- 会话失效返回401；权限或范围不足返回403；状态冲突返回409；业务输入不完整返回422。

## 2. 固定模型

### `GET /api/rbac/model`

返回模型版本、固定权限、七个角色、角色使用说明、每个角色的`visibleTabs`和十一项RACI活动。

对`/api/rbac/model`发起POST、PUT、PATCH或DELETE时返回：

```json
{
  "code": "CORE_GOVERNANCE_MODEL_READ_ONLY",
  "error": "核心角色、权限和责任矩阵由固定治理模型维护，页面只提供查看"
}
```

## 3. 登录

### `POST /api/org/login`

请求字段为`loginName`和`password`。一个兼容版本内仍接受旧字段`employee_no`作为登录名，但服务端只按`user_accounts.login_name`认证，不从旧`users`表或工号字段回退。

## 4. 账号

### `POST /api/org/accounts`

权限：`identity:manage-account`和`identity:assign-role`。

请求示例：

```json
{
  "loginName": "employee001",
  "employeeNo": "EMP001",
  "name": "示例人员",
  "departmentId": 10,
  "reason": "部门确认开通3000账号",
  "roleAssignments": [
    {
      "roleCode": "department_contact",
      "scopeDepartmentId": 10,
      "authorizationBasis": "部门负责人确认记录2026-07-30",
      "effectiveFrom": "2026-07-30",
      "effectiveTo": null
    }
  ]
}
```

成功返回201。账号状态为`pending_activation`，响应不包含可登录密码。

### `PATCH /api/org/accounts/:personId`

维护姓名或部门。变更部门时必须同时提交：

- `changeReason`
- 新`departmentId`
- 至少一项新部门角色`roleAssignments`

系统自动撤销旧部门角色并递增`auth_version`。

### `POST /api/org/accounts/:personId/role-assignments`

权限：`identity:assign-role`。

请求字段：

- `roleCode`
- `scopeDepartmentId`
- `authorizationBasis`
- `effectiveFrom`
- `effectiveTo`

部门角色必须与人员所属部门一致；全局角色不得携带部门范围。

### `POST /api/org/accounts/:personId/role-assignments/:assignmentId/revoke`

请求字段：

- `reason`：必填
- `disableAccount`：撤销最后一个有效角色时必须为`true`

撤销最后一个有效管理员返回`LAST_ACTIVE_ADMIN`。

### 账号状态接口

| 接口 | 作用 | 特殊要求 |
|---|---|---|
| `POST .../:personId/activate` | 首次启用待启用账号 | 返回一次性`initialPassword` |
| `POST .../:personId/enable` | 恢复锁定或停用账号 | 待启用账号必须先走`activate` |
| `POST .../:personId/disable` | 停用账号 | `reason`必填 |
| `POST .../:personId/reset-password` | 重置密码 | 返回一次性`initialPassword` |

启用和重置后均设置`must_change_password=1`。

### 查询

- `GET /api/org/accounts`
- `GET /api/org/accounts/:personId`
- `GET /api/org/accounts/audit-events?personId=&eventType=&limit=`

审计接口只返回操作信息，不返回密码或密码散列。

## 5. 当前身份

### `GET /api/org/me`

返回：

- 人员和账号标识；
- 姓名、工号、部门；
- 账号状态和首次改密状态；
- 全部当前有效角色；
- 当前有效权限；
- 数据范围；
- 治理模型版本。

旧单一`role`字段只能作为显示兼容，不参与授权。

## 6. 部门决定

### `POST /api/governance/decision-records`

权限：`governance:record-department-decision`。

请求示例：

```json
{
  "departmentId": 10,
  "subjectDomain": "process",
  "subjectType": "process_map",
  "subjectId": "PROC-001",
  "subjectVersion": "V2",
  "decision": "approved",
  "decisionBasis": "部门负责人2026-07-30线下确认",
  "evidenceReference": "会议纪要第3项",
  "decidedAt": "2026-07-30T09:30:00+08:00"
}
```

`decision`只允许`approved`、`returned`、`rejected`。

服务端从部门记录取得最终责任人，不接受客户端提交责任人。

### `GET /api/governance/decision-records`

支持按治理领域、对象、版本和部门筛选。全局读取者可以指定部门；部门读取者只能读取本人所属部门。

## 7. 旧接口

| 接口 | 当前行为 |
|---|---|
| `POST|PUT /api/org/users*` | `410 LEGACY_IDENTITY_API_RETIRED` |
| `/api/import-rbac/*`写操作 | `410 LEGACY_IDENTITY_API_RETIRED` |
| 角色或权限矩阵写操作 | `405 CORE_GOVERNANCE_MODEL_READ_ONLY` |

旧接口不得写入`users/user_roles`作为正式身份数据。
