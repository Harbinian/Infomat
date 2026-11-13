# MDM平台 RBAC 与 RACI 数据结构

## 1. 人员身份与系统维护主体

```text
departments
    ↑
person → user_accounts
    ↓
person_roles → roles → role_permissions → permissions
```

普通人员按上图关联身份及权限。独立`system_admin`通过`system_admin_accounts`及系统会话维护，不关联真实员工或部门；原人员管理员和历史审计保留。两类主体的精确会话绑定、锁后资格及审计见[身份与事务合同](Identity-Transaction-Contract.md)。正式运行不从`users/user_roles`补齐身份或权限。

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
| `role_group` | `system`、`mdm`、`directory`或`legacy`；已有分组约束由显式人事角色迁移兼容扩展 |
| `is_core`/`protected_core` | 固定治理模型标记 |
| `model_version` | 当前固定模型版本 |

当前固定模型为`rbac-raci-v5-2026-10-19`，九个角色分为系统、MDM和目录维护三组，合计二十二项权限、十三项RACI说明活动。只有状态为`active`且模型版本匹配的角色可以产生对应权限；仍须核对人员授权、部门、有效期和事项关系。v3目标按职责v4、人事角色v5顺序显式升级，保留角色ID与已有授权；不能只换代码或批量停用旧账号代替升级。

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

以下停用、撤销及退休规则仅描述旧身份基线转换批次，不适用于已有v3/v4/v5目标的日常维护或增量升级。当前升级及恢复条件见[迁移手册](RBAC-RACI-Migration-Runbook.md)，历史正文见[2026-11-11整理前快照](../../../docs/archives/2026-11-11-mdm-documentation/apps/mdm-platform/docs/RBAC-RACI-DB-Schema.md.before.txt)。

- 历史账号和角色关系不删除。
- 旧基线批次把当时七个固定角色之外的角色标记为`retired`，删除其权限关系并保留角色记录；不能据此退休当前v5新增的治理经办或目录维护角色。
- 除受控`ADMIN001`外，迁移时所有旧账号停用，旧有效角色授权撤销。
- 管理员逐项核对后，通过新接口授予角色并重新启用账号。
- 缺少部门或最终责任人的记录只报告，不用默认值掩盖。
