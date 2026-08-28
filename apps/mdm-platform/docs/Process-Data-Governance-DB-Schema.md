# 流程版本后续数据治理数据库结构

## 1. 数据边界

新结构只保存3000在流程发布后的MDM治理工作。流程业务事实继续以`process_design_versions.process_content_json`中的不可变V7正文为准；新表不复制完整V7正文，也不保存或修改用户选择的3001文件。

迁移键：`2026-08-27-process-data-governance-v1`。

## 2. 表关系

| 表 | 用途 | 主要唯一约束 |
|---|---|---|
| `process_data_governance_creation_tasks` | 记录必须形成工作包的任务、失败和补偿状态 | `task_ref`、`process_version_id` |
| `process_data_governance_work_packages` | 保存固定版本绑定、来源摘要、规则版本、风险、时限和整体状态 | `package_ref`、`process_version_id` |
| `process_data_governance_details` | 保存对象身份、关键字段、数据流和生命周期待定候选及MDM结论 | `work_package_id + detail_ref` |
| `process_data_governance_fact_requests` | 保存MDM定向问题和业务部门事实答复 | `request_ref` |
| `process_data_governance_reviews` | 只追加保存工作包审核依据 | 无覆盖式唯一键；新审核记录可引用被替代记录 |
| `process_data_governance_events` | 只追加保存创建、候选、判断、提问、答复、关闭和完成事件 | 事件自增标识 |

## 3. 引用完整性

- 创建任务和工作包通过外键绑定`process_design_versions(id)`，来源版本不能因删除而失去审计依据。
- 工作包的`source_document_id`绑定`process_design_documents(id)`。
- 工作包、明细、事实问题和审核记录绑定部门时均引用`departments(id)`。
- 明细、事实问题、审核和事件均使用`ON DELETE RESTRICT`或受控的`SET NULL`，不能通过级联删除抹去治理过程。
- 每个`process_version_id`最多一个创建任务和一个工作包。

## 4. 来源绑定字段

`process_data_governance_work_packages`至少保存：

- `process_version_id`：正式不可变流程版本标识；
- `source_document_id`和`owning_department_id`：正式主档和归口部门；
- `source_content_hash`：形成工作包时的V7内容摘要；
- `rule_version`：生成待定候选的固定规则版本；
- `risk_level`和`risk_basis_json`：高风险事件数量及规则依据；
- `revision_no`：所有写入共享的乐观并发修订号。

每次写入前复核`source_content_hash`。摘要变化时不自动迁移、重算或覆盖工作包。

## 5. 候选与正式结论分层

`process_data_governance_details`分别保存：

- `candidate_rule_code`和`candidate_json`：系统按固定规则生成的待定内容；
- `source_snapshot_digest`：该条来源结构的稳定摘要；
- `governance_json`：MDM工作组记录的结论和依据；
- `status`：当前办理状态；
- `high_risk`：来源中存在销毁、不可逆匿名化或全量记录操作时为1。

候选字段不能为空，但候选值必须保持待确认。`governance_json`不能由候选生成动作自动写入。

## 6. 事实问题边界

`process_data_governance_fact_requests`保存具体问题、提出原因、目标部门、答复和证据位置。它不保存“请业务部门认定主数据”一类专业治理任务。

状态顺序为：

1. `open`：目标部门需要答复；
2. `answered`：业务部门已答复，等待MDM核对；
3. `closed`：MDM工作组已经记录采用情况；
4. `cancelled`：保留给受控取消路径，候选实现尚未开放前端操作。

## 7. 旧数据影响

2026年8月27日只读预演发现当前库有11个`published`流程版本，六张新表和迁移记录均不存在。

迁移只创建空结构，不执行以下操作：

- 不把11个历史版本批量转成工作包；
- 不读取或修改原始3001文件；
- 不猜测哪个版本应作为试点；
- 不为缺失字段、对象或生命周期规则填默认治理结论；
- 不修改现有流程版本、数据地图或身份记录。

历史版本只有在MDM工作组明确提交与唯一试点配置相同的`process_version_id`后，才按当前固定正文补建工作包。

## 8. 删除与恢复

自动回退只允许六张表全部为空时执行。任一表存在治理记录，回退命令必须停止并报告非空对象，不能自动删除。

已经产生业务记录后需要恢复时，应使用执行迁移前验证过的数据库备份，或者设计经审批的补偿迁移；不得通过直接删表或删除迁移记录伪造未迁移状态。

