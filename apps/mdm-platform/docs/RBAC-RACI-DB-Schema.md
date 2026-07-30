# 3000 RBAC 与 RACI 数据结构

## 1. 唯一身份链路

```text
departments
    ↑
person → user_accounts
    ↓
person_roles → roles → role_permissions → permissions
```

正式运行不从`users/user_roles`补齐身份或权限。

## 2. 核心表

### `person`

保存人员身份和当前所属部门。工号唯一。人员可以没有账号，也可以作为部门最终负责人。

### `user_accounts`

| 字段 | 规则 |
|---|---|
| `person_id` | 一人最多一个账号 |
| `login_name` | 唯一 |
| `password_hash` | 只保存密码散列 |
| `account_status` | `pending_activation`、`active`、`locked`、`disabled` |
| `must_change_password` | 临时密码登录后必须改密 |
| `auth_version` | 账号、部门或权限变化时递增，用于使旧会话失效 |

### `roles`

| 字段 | 规则 |
|---|---|
| `status` | `active`、`legacy`或`retired` |
| `role_group` | `system`、`mdm`或`legacy` |
| `is_core`/`protected_core` | 固定治理模型标记 |
| `model_version` | 当前固定模型版本 |

只有当前模型的七个`active`角色产生权限。

### `person_roles`

| 字段 | 规则 |
|---|---|
| `scope_type` | `global`或`department`；被分派事项和已升级事项范围由业务关系另行校验 |
| `scope_department_id` | 部门角色必填，且必须等于人员所属部门 |
| `authorization_basis` | 必填 |
| `effective_from` | 必填 |
| `effective_to` | 可空；不为空时不得早于生效日期 |
| `assignment_status` | `active`、`revoked`、`expired` |
| `revoked_by_person_id`、`revoked_at`、`revocation_reason` | 撤销时记录 |

授权记录不物理删除。

## 3. 审计与责任

### `identity_access_events`

只追加记录：

- 开户；
- 首次启用；
- 恢复、停用和解锁；
- 密码重置；
- 部门变更；
- 角色授予和撤销；
- 迁移切换和补偿。

保存操作者、目标人员、账号、角色授权记录、原因、时间和非敏感上下文。不得保存明文密码或密码散列。

### `governance_decision_records`

保存：

- 治理领域；
- 对象类型、对象标识和版本；
- 部门；
- 写入时系统确认的部门最终负责人；
- 记录人；
- `approved`、`returned`或`rejected`；
- 决定依据；
- 可选证据引用；
- 决定时间；
- 被替代记录。

记录只追加，不覆盖或静默删除。

## 4. 迁移表

- `identity_migration_batches`：迁移批次、模式、状态、盘点结果和执行结果。
- `identity_migration_account_backup`：账号状态、`auth_version`和首次改密状态备份。
- `identity_migration_role_backup`：人员角色授权备份。
- `identity_migration_role_model_backup`：角色模型备份。
- `identity_migration_permission_backup`：权限定义备份。
- `identity_migration_role_permission_backup`：角色权限关系备份。

每个备份均按`batch_id`隔离。重复执行同一已完成批次返回幂等结果。

## 5. 约束与索引

- 工号、登录名、人员账号关系使用唯一约束。
- 部门、人员、角色、权限和责任记录使用外键或等价存在性检查。
- 有效角色查询按人员、状态和有效期建立索引。
- 责任记录按治理对象、版本和部门建立查询索引。
- 审计事件按时间、目标人员和事件类型建立查询索引。

## 6. 历史数据处理

- 历史账号和角色关系不删除。
- 非七个固定角色统一标记为`retired`，其角色权限关系删除，不再产生有效权限。
- 除受控`ADMIN001`外，迁移时所有旧账号停用，旧有效角色授权撤销。
- 管理员逐项核对后，通过新接口授予角色并重新启用账号。
- 缺少部门或最终责任人的记录只报告，不用默认值掩盖。
