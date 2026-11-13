# MDM平台 RBAC 与 RACI 接口约定

## 1. 通用规则

- 所有接口使用JSON。
- 除登录外均要求有效会话。
- 写接口同时接受CSRF保护。
- 错误响应至少包含`error`；稳定业务错误同时包含`code`。
- 会话失效返回401；权限或范围不足返回403；状态冲突返回409；业务输入不完整返回422。

## 2. 固定模型

### `GET /api/rbac/model`

当前代码返回`rbac-raci-v5-2026-10-19`模型、二十二项权限、九个固定角色、角色使用说明、每个角色的`visibleTabs`和十三项RACI说明活动。九角色包括系统组一个、MDM组七个、目录维护组一个；活动说明不自动授予权限或任命人员。部署及显式模型迁移须同版，实际目标版本另行核对。

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

该入口保留为已有员工开户的兼容接口，不创建员工主档。没有员工记录返回`PERSON_DIRECTORY_RECORD_REQUIRED`，姓名或部门与已有员工不一致返回`PERSON_IDENTITY_MISMATCH`。新账号登录名与工号一致；现有账号及历史登录名不自动重写。当前页面对已选员工使用`POST /api/org/accounts/:personId/assign-account`，绑定已读取的`expectedPerson`、原因和当前维护资格。目录资料由行政人事另行维护，见[目录接口](../DIRECTORY_API.md)。

请求示例：

```json
{
  "loginName": "EMP001",
  "employeeNo": "EMP001",
  "name": "示例人员",
  "departmentId": 10,
  "reason": "部门确认开通MDM平台账号",
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

该兼容接口不再修改员工姓名、工号或部门；提交一致资料时返回原记录且不写入，实际变更返回`PERSON_DIRECTORY_MAINTENANCE_REQUIRED`。员工调部等目录变化由行政人事按当前目录约束办理；系统不自动撤销原部门角色、变更负责人或停用账号。角色变化改用专用授权接口，已有账号和审计保留。

### `POST /api/org/accounts/:personId/role-assignments`

权限：`identity:assign-role`。

请求字段：

- `roleCode`
- `scopeDepartmentId`
- `authorizationBasis`
- `effectiveFrom`
- `effectiveTo`

部门角色必须与人员所属部门一致；全局角色不得携带部门范围。

`roleCode=department_mdm_reviewer`保留兼容标识，表示部门负责人本人核对及最终确认。专用授权须携带`expectedFinalResponsiblePersonId`；替换另一人还须`confirmReplaceFinalResponsiblePerson=true`，在同一事务核对现任、明确交接并同步最终责任登记。只有组织登记与本人有效同部门授权一致时才可确认，不设置中间审核员；原授权及历史意见不据此自动补任命或升格为当前确认。

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
  "decisionBasis": "部门负责人本人核对并确认",
  "evidenceReference": "会议纪要第3项",
  "decidedAt": "2026-07-30T09:30:00+08:00"
}
```

`decision`只允许`approved`、`returned`、`rejected`。

服务端从部门记录取得最终责任人，不接受客户端提交责任人。

当前部门最终确认由符合登记及有效授权的负责人本人办理；主对接人或其他人员不能代记录。该决定接口及旧枚举继续兼容，不替代正式审核任务绑定或恢复门槛。

### `GET /api/governance/decision-records`

支持按治理领域、对象、版本和部门筛选。全局读取者可以指定部门；部门读取者只能读取本人所属部门。

## 7. 旧接口

| 接口 | 当前行为 |
|---|---|
| `POST|PUT /api/org/users*` | `410 LEGACY_IDENTITY_API_RETIRED` |
| `/api/import-rbac/*`写操作 | `410 LEGACY_IDENTITY_API_RETIRED` |
| 角色或权限矩阵写操作 | `405 CORE_GOVERNANCE_MODEL_READ_ONLY` |

旧接口不得写入`users/user_roles`作为正式身份数据。

## 历史追溯

[2026-11-11整理前快照](../../../docs/archives/2026-11-11-mdm-documentation/apps/mdm-platform/docs/RBAC-RACI-API-Contract.md.before.txt)保留旧模型数量、账号目录混合维护及原示例。接口路径、字段、角色标识及旧决定枚举继续按兼容合同解释，不因说明更新迁移或改写既有记录。
