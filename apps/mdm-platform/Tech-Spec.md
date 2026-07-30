# 3000 RBAC 与 RACI 重构技术规格

## 1. 版本与边界

- 治理模型版本：`rbac-raci-v2-2026-07-30`
- 正式身份存储：MySQL
- 正式身份链路：`person -> user_accounts -> person_roles -> roles -> role_permissions -> permissions`
- 遗留`users/user_roles`和SQLite人员接口：仅保留隔离测试或一个版本的只读兼容，不参与正式授权

本规格只改变身份、授权、责任证据和相关接口判断，不改变流程地图、数据地图和术语治理的业务对象结构。

## 2. 组成模块

| 模块 | 文件 | 责任 |
|---|---|---|
| 固定治理模型 | `server/roleDefinitions.js` | 定义十九项权限、七个角色、八项RACI活动和模型版本 |
| 身份读取 | `server/identityMysqlRepository.js` | 从人员、账号和有效角色计算当前身份、权限和数据范围 |
| 账号与责任服务 | `server/governanceAccessMysqlRepository.js` | 账号生命周期、角色授权、访问审计、部门决定和发布责任核验 |
| 数据结构 | `server/mysqlSchema.js` | 身份、授权、审计、责任记录和迁移表 |
| 迁移 | `server/rbacRaciMysqlMigration.js` | 盘点、备份、固定模型写入、账号切换、回滚和补偿 |
| 身份接口 | `server/routes/accounts.js` | 管理员手工开户和账号生命周期接口 |
| 模型接口 | `server/routes/rbac.js` | 固定模型只读接口 |
| 责任接口 | `server/routes/governance.js` | 部门决定读取和追加接口 |
| 会话与中间件 | `server/auth.js` | 登录、会话校验、权限校验和首次改密限制 |
| 前端 | `public/index.html` | 权限生成菜单、账号管理和“角色与责任”只读页面 |

## 3. 授权计算

每次受保护请求按以下顺序处理：

1. 从会话取得`personId`、`accountId`和`authVersion`。
2. 读取`person`与`user_accounts`当前状态。
3. 比较会话`authVersion`和账号`auth_version`。
4. 读取当前日期有效、状态为`active`且包含授权依据的`person_roles`。
5. 只接受`roles.status='active'`且`roles.model_version`等于当前模型版本的七个固定角色。
6. 合并角色固定权限，不接受`*:*`通配权限。
7. 根据全局、本部门、本人被分派事项或已升级事项计算数据范围。
8. 业务路由继续核对对象状态、任务关系和责任证据。

任一步失败即拒绝请求。前端隐藏按钮只用于减少误操作，不能代替服务端授权。

## 4. 会话

正式会话只保存：

```json
{
  "personId": 1,
  "accountId": 1,
  "authVersion": 3
}
```

显示名称、部门、角色和权限由每次请求重新读取。账号状态、部门或角色变化时，服务端递增`auth_version`，旧会话在下一次请求时返回401并清除。

`must_change_password=1`时，除读取当前会话、修改本人密码和退出外，其他业务接口返回403。

## 5. 固定角色与范围

- `admin`、`mdm_lead`、`data_quality_auditor`为全局范围。
- `department_contact`、`department_mdm_reviewer`为人员所属部门范围。
- `data_conflict_handler`为本人被分派事项范围。
- `decision_group`为已升级事项范围。
- 跨部门临时代办使用独立委托关系，不改变永久角色范围。

非七个固定角色全部转为`retired`并删除有效权限关联。旧角色不自动映射到新角色。

## 6. 写入事务

以下操作必须在单一MySQL事务中完成：

- 创建人员、待启用账号、初始角色授权和访问审计。
- 部门变更、旧部门角色撤销、新部门角色授予、`auth_version`递增和审计。
- 角色授予或撤销、账号必要状态变化、`auth_version`递增和审计。
- 账号启用、恢复、停用、密码重置和审计。
- 部门决定追加及被替代记录关联。

事务失败时不保留部分账号、部分授权或部分责任记录。

## 7. 数据结构

详细字段见[RBAC-RACI-DB-Schema.md](docs/RBAC-RACI-DB-Schema.md)。关键变化如下：

- `roles`增加状态、分组、核心标记和模型版本。
- `person_roles`增加范围、部门、授权依据、有效期、状态和撤销信息。
- `user_accounts`使用`pending_activation`、`active`、`locked`、`disabled`，并保存`must_change_password`和`auth_version`。
- `identity_access_events`只追加账号与授权事件，不保存明文密码或密码散列。
- `governance_decision_records`只追加部门责任决定。
- `identity_migration_*`表保存迁移批次和恢复所需快照。

## 8. 接口

详细请求、响应和错误见[RBAC-RACI-API-Contract.md](docs/RBAC-RACI-API-Contract.md)。

核心接口：

- `GET /api/rbac/model`
- `GET|POST /api/org/accounts`
- `GET|PATCH /api/org/accounts/:personId`
- `POST /api/org/accounts/:personId/role-assignments`
- `POST /api/org/accounts/:personId/role-assignments/:assignmentId/revoke`
- `POST /api/org/accounts/:personId/activate|enable|disable|reset-password`
- `GET|POST /api/governance/decision-records`
- `GET /api/org/me`

旧`/api/org/users*`写接口返回410；旧RBAC批量导入返回410；固定模型写请求返回405。

## 9. 责任记录与发布卡口

`recordGovernanceDecision`在写入前完成：

1. 当前用户拥有`governance:record-department-decision`。
2. 当前用户具有该部门有效`department_mdm_reviewer`授权。
3. 部门与人员状态有效。
4. `departments.final_responsible_person_id`存在且指向有效人员。
5. 决定值、对象、版本、依据和决定时间有效。

`assertGovernancePublishReady`在发布前完成：

1. 对象和版本明确。
2. 所有必需部门均有最新`approved`决定。
3. 必需部门责任人完整。
4. 阻断问题数量为零。
5. 结构检查通过。
6. 版本检查通过。

MDM工作组组长只能在卡口通过后发布，不能以角色权限跳过部门决定。

## 10. 安全控制

- 密码由`bcryptjs`保存散列。
- 临时密码只在启用或重置响应中返回一次。
- 访问事件不保存密码或密码散列。
- 所有权限检查在服务端执行。
- 固定模型不接受自定义角色、角色继承或通配权限。
- 最后一个有效管理员受`LAST_ACTIVE_ADMIN`保护。
- 登录名、工号和人员账号关系使用唯一约束。
- 管理员具有治理全局只读权限，但没有业务写权限。

## 11. 兼容与迁移

迁移顺序和恢复条件见[RBAC-RACI-Migration-Runbook.md](docs/RBAC-RACI-Migration-Runbook.md)。

切换原则：

- 迁移前执行dry-run。
- 备份旧角色、权限、账号和角色关系。
- 仅`ADMIN001`自动保留管理员权限。
- 其他账号停用，旧角色关系保留历史但不产生权限。
- 清除旧会话。
- 未发生新授权事件前可以整批回滚；已经发生新授权事件后使用补偿撤销。
- 空数据库只允许执行一次受控管理员初始化。

## 12. 验证

最低验证入口：

```powershell
npm run test:rbac-raci-v2
npm run test:frontend
npm run test:project-roles
npm run test:role-workbench
npm run test:process-governance
npm run test:mainline
npm run migrate:rbac-raci-v2:dry-run
```

正式运行还必须执行：

```powershell
cd E:\CA001\Infomat
npm run start:infomat-services
npm run smoke:infomat-services
```

浏览器至少核对登录页、首次改密、管理员账号管理、只读角色责任页、管理员业务写按钮不可用和代表性角色的数据范围。
