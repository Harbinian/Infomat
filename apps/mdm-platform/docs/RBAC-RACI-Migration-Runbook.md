# 3000 RBAC 与 RACI 迁移手册

## 1. 适用范围

本手册用于将现有3000身份与授权数据迁移到当前固定模型`rbac-raci-v3-2026-07-31`。命令和脚本名称保留`v2`用于兼容既有部署入口。

迁移会：

- 写入固定角色和权限；
- 退休所有非固定角色；
- 撤销除受控管理员外的旧有效角色授权；
- 停用除受控管理员外的旧账号；
- 递增所有账号`auth_version`，使旧会话失效；
- 保留历史账号和授权记录；
- 写入迁移批次和访问审计。

迁移不会：

- 自动创建部门主对接人、审核员或其他业务角色；
- 根据姓名、职务或旧常量补齐部门负责人；
- 删除历史身份数据；
- 修改`docs/norms/`、PMO页面或组织真源。

## 2. 前置条件

1. 固定MySQL容器和连接配置可用。
2. `scripts/infomat-services.local.env`存在且不输出其内容。
3. `ADMIN001`已经存在于`person`和`user_accounts`。
4. 迁移期间停止3000业务写入。
5. 已确定执行人和迁移时间。

## 3. 装载本机配置

在仓库根目录读取本机配置。不要把密码打印到终端、日志或文档。

```powershell
cd E:\CA001\Infomat
$lines = Get-Content scripts\infomat-services.local.env
foreach ($line in $lines) {
  if ($line -match '^\s*([^#][^=]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process')
  }
}
$env:MYSQL_HOST = "localhost"
$env:MYSQL_PORT = "3307"
$env:MYSQL_USER = "mdm_user"
$env:MYSQL_DATABASE = "infomat_mdm"
$env:MYSQL_CONNECTION_LIMIT = "16"
$env:MDM_ADMIN_EMPLOYEE_NO = "ADMIN001"
cd apps\mdm-platform
```

## 4. Dry-run

```powershell
npm run migrate:rbac-raci-v2:dry-run
```

核对：

- 人员、账号、有效账号、角色和授权数量；
- 重复工号和重复登录名；
- 孤立角色授权；
- 人员缺失部门；
- 启用部门缺失最终负责人；
- `ADMIN001`人员和账号是否存在。

以下情况阻断迁移：

- `DUPLICATE_EMPLOYEE_NO`
- `DUPLICATE_LOGIN_NAME`
- `ORPHAN_ROLE_ASSIGNMENT`
- `ADMIN_ACCOUNT_NOT_FOUND`

缺失部门或最终负责人必须列入整改，但不通过猜测修复。缺失最终负责人会在决定记录和发布时继续阻断。

## 5. 执行迁移

```powershell
npm run migrate:rbac-raci-v2:apply
```

记录返回的`batchId`。脚本在单一事务中：

1. 建立迁移批次。
2. 备份角色、权限、账号和人员角色关系。
3. 写入七个固定角色和十九项权限。
4. 退休所有非固定角色并删除其有效权限关系。
5. 撤销除`ADMIN001`管理员角色外的旧有效授权。
6. 保持`ADMIN001`为有效管理员。
7. 停用其他账号。
8. 递增所有账号`auth_version`。
9. 写入访问事件。
10. 核对迁移后至少存在一个有效管理员。

同一`batchId`已完成时再次执行只返回幂等结果。

## 6. 迁移后核对

执行：

```powershell
npm run test:rbac-raci-v2
npm run test:mainline
```

数据库核对原则：

- 七个固定角色状态为`active`且模型版本一致。
- 其他角色状态为`retired`且不再有有效权限关系。
- 只有`ADMIN001`保留迁移自动授予的管理员权限。
- 其他旧账号状态为`disabled`。
- 所有账号`auth_version`已递增。
- 迁移批次状态为`completed`。
- 账号与角色变化均有`identity_access_events`。

随后从仓库根目录执行：

```powershell
npm run start:infomat-services
npm run smoke:infomat-services
```

浏览器核对：

- 未登录只显示登录页；
- `ADMIN001`可以登录；
- 管理员只能管理账号和授权，不能执行治理业务写操作；
- 角色与责任页面显示七个角色、十一项RACI活动和固定可见标签；
- 旧批量开户和RBAC导入入口不可用。

## 7. 账号恢复

迁移后，管理员逐人取得权威输入：

- 登录名；
- 工号和姓名；
- 当前部门；
- MDM工作角色；
- 授权依据；
- 生效日期和可选失效日期。

管理员通过页面或`/api/org/accounts`逐项授权。不得把旧角色自动映射为新角色。完成核对后再启用账号并交付一次性临时密码。

## 8. 回滚

只有迁移后尚未发生新的账号、角色或授权审计事件时，才允许整批回滚：

```powershell
npm run migrate:rbac-raci-v2:rollback -- --batch-id <batchId>
```

回滚从该批次备份恢复角色、权限、账号状态和人员角色关系。回滚后重新核对账号数量、角色关系、管理员入口和登录。

如果迁移后已经发生新授权事件，不得整批覆盖。应执行补偿：

```powershell
npm run migrate:rbac-raci-v2:compensate -- --batch-id <batchId>
```

补偿按迁移批次撤销迁移产生的授权影响，同时保留迁移后真实发生的审计记录。补偿完成后由管理员按确认清单恢复账号。

## 9. 中途失败

- 事务内失败：数据库自动回滚，迁移批次记录失败原因。
- schema初始化失败：停止执行，修复后重新dry-run。
- 最后管理员核对失败：整笔迁移回滚并返回`ACTIVE_ADMIN_REQUIRED`。
- 服务启动失败：停止业务写入，保留数据库和日志，先执行只读核对，不重复猜测性修复。

## 10. 空数据库初始化

空数据库只能执行一次受控管理员初始化：

```powershell
npm run bootstrap:admin
```

检测到已有人员、账号或有效管理员后，脚本拒绝再次执行。初始密码只在响应中显示一次，不写入仓库。
