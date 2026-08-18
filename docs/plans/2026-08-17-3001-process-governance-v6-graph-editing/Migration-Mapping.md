# 3001流程结构规则v5到v6迁移映射

## 总则

- 转换只在当前页面内存中执行，源文件不修改，导出统一为v6。
- 转换必须幂等：同一输入重复规范化，结果不继续变化。
- 无法无损转换的内容进入`migration`归档，不得静默丢弃、清空或猜测。
- 引用完整性：技术标识唯一性和行为、数据、表单、关系的本文件引用在转换后仍须通过`/api/validate`。

## 根对象映射

| v5字段 | v6字段 | 转换规则 |
|---|---|---|
| `schema_version` | `schema_version` | 改为`process-governance-v6` |
| `export_meta` | `export_meta` | 原样保留 |
| `process` | `process` | 原样保留 |
| `reference_materials[]` | `migration.reference_materials[]` | 移入归档，只读保留，无损往返 |
| `behaviors[]` | `behaviors[]` | 按行为映射转换 |
| `flow_relations[]` | `flow_relations[]` | 按关系映射转换 |
| `data_objects[]` | `data_objects[]` | 按数据映射转换 |
| `internal_process_calls[]` | `migration.internal_process_calls[]` | 移入归档，只读绘图，无损往返 |
| `forms[]` | `forms[]` | 按表单映射转换 |
| `terms[]` | `terms[]` | 原样保留 |
| `migration` | `migration` | 扩展归档字段 |

## 行为映射

| v5字段 | v6字段 | 转换规则 |
|---|---|---|
| `behavior_ref` | `behavior_ref` | 原样保留 |
| `node_type` | `node_type` | 原样保留 |
| `behavior_name` | `behavior_name` | 原样保留 |
| `behavior_description` | `behavior_description` | 原样保留，可选 |
| `current_actor_role` | `actor_department` + `actor_position` | 拆解，见下方规则 |
| `actor_assignment_mode` | `actor_assignment_mode` | 原样保留 |
| `actor_department_data_ref` | `actor_department_data_ref` | 原样保留，动态责任时使用 |
| `actor_position_rule` | `actor_position_rule` | 原样保留，动态责任时使用 |
| `trigger` | `trigger` | 移出必填，保留为可选历史字段 |
| `precondition` | `precondition` | 原样保留，可选 |
| `input_description` | `input_description` | 移出必填，保留为可选历史字段 |
| `output_description` | `output_description` | 移出必填，保留为可选历史字段 |
| `timing` | `timing` | 原样保留 |
| `completion_standard` | `completion_standard` | 原样保留 |
| `work_role` | `migration.work_roles[]` | 移入归档，见下方规则 |
| `countersign_all_required` | `countersign_all_required` | 原样保留 |
| `countersign_target_departments` | `countersign_target_departments` | 原样保留 |

### `current_actor_role`拆解规则

| 原值 | 转换结果 |
|---|---|
| `全公司` | `actor_assignment_mode=company_wide`，`actor_department=""`，`actor_position=""` |
| 部门与岗位拼接且部门能唯一匹配组织目录 | `actor_assignment_mode=fixed_department`，`actor_department=部门`，`actor_position=岗位` |
| 无法唯一匹配或拆分不明确 | 原字符串写入`migration.unresolved_actor_roles[]`，行为保留`fixed_department`，`actor_department=""`并提示补录 |

拆分时以`docs/organization/组织架构和部门职责.md`或`/api/enums`返回的部门目录为匹配依据；不得按姓名、岗位或历史常量猜测。

### `work_role`移入规则

- 值为`null`时不生成记录。
- 值为对象时，每条写入`migration.work_roles[]`，保留`behavior_ref`、`work_role_code`、`role_duty`、`work_role_name`、`assignment_status`，并增加`source_schema_version`。
- 历史工作角色只读保留，不参与当前流程计算、评分或绘图；被引用行为不得删除。

## 流程关系映射

| v5字段 | v6字段 | 转换规则 |
|---|---|---|
| `relation_ref` | `relation_ref` | 原样保留 |
| `relation_type` | `relation_type` | 原样保留 |
| `from_behavior_ref` | `from_behavior_ref` | 原样保留 |
| `to_behavior_ref` | `to_behavior_ref` | 原样保留 |
| `condition` | `condition` | 原样保留 |
| `join_mode` | — | 删除；并行汇合语义由`node_type=parallel_join`节点承担 |

## 数据对象映射

| v5字段 | v6字段 | 转换规则 |
|---|---|---|
| `data_ref` | `data_ref` | 原样保留 |
| `data_name` | `data_name` | 原样保留 |
| `description` | `description` | 原样保留 |
| `governance_status` | — | 删除；数据对象默认即待治理候选 |
| `information_type` | `information_type` | 原样保留，枚举不变 |
| `behavior_links[]` | `behavior_links[]` | 原样保留，唯一写入位 |
| `source_relations[]` | `source_relations[]` | 原样保留 |

## 表单映射

`formOrRecord`、`formArea`、`formItem`、`formBehaviorLink`结构不变。

`fieldSourceLink`需补一个`source_type`字段区分来源：

| 字段 | v6转换规则 |
|---|---|
| `source_type` | 新增，枚举`current_process_data`或`external_system` |
| `source_data_ref` | 本流程来源保留`data_ref`；外部系统来源置空 |
| `source_system_name`、`source_data_name` | 外部系统来源时填写系统名称和来源数据名称 |

旧v5字段来源缺少来源类型时，按本流程数据兼容读取，不推断为外部系统。

## `migration`归档容器（v6）

```text
migration: {
  source_schema_version,
  source_process_ref,
  source_process_count,
  legacy_cross_department_records[],
  reference_materials[],
  internal_process_calls[],
  work_roles[],
  unresolved_actor_roles[]
}
```

归档内容只读保留、随导出带回、不参与当前流程计算、评分或绘图。
