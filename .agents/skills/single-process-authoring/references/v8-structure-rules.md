# V8 结构与映射规则

本文件约束生成文件的结构与语义，不赋予技能业务决策权。结构以 `docs/contracts/process-governance-v8.schema.json` 为准，语义以 `scripts/process-governance/v7-validator.js` 为准；两者也是 3001 和 3000 共用的同一份规则。

## 1 顶层结构与身份

文件本体必须且仅按结构包含：`schema_version`、`export_meta`、`process`、`behaviors`、`flow_relations`、`data_objects`、`forms`、`terms`、`migration`。接口响应中的 `app_commit/schema_digest/data` 包装层不是编制 JSON，不得作为文件本体上传。

`export_meta` 包含 `package_ref`、真实可确认的 `exported_at`、`initiating_department`、`compiler`。`process` 包含稳定 `process_ref`、名称、归口部门、目的、范围、可空的能力域与业务能力，以及分类状态。

`classification_status` 只能取 `unclassified`、`needs_review`、`confirmed`：尚未分类时保持 `unclassified`；已提出能力域或业务能力但尚未获得有权主体确认时用 `needs_review`；只有取得确认才能改为 `confirmed`。技术校验通过不改变分类状态。

技术标识使用 1—160 位英文字母、数字、点、下划线、冒号或连字符，并以字母或数字起始，在同一文档中保持唯一。新流程更换包及流程标识；同一流程修订保留已有对象标识。中文名称可以修改，不据此创建重复对象。形式合法不等于跨文件业务身份已治理。

新建沿用空白模板的空迁移归档并声明源版本 V8，不伪造 V7 来源。已导入的迁移归档、历史信息和未受影响字段必须保留；无法解释的旧内容提问，不清空。

结构内 `imported_v1`、`imported_v2` 仅供 V8 引用旧定义及迁移归档，其旧版顶层字段不是 V8 输出模板。不因为在依赖定义中看到 `cross_department_handoffs`、`work_role` 等历史字段，就把它们添加到 V8 顶层或当前业务行为。

## 2 行为、主体与流程关系

| 业务含义 | V8 字段或值 | 使用约束 |
|---|---|---|
| 实际业务办理 | `node_type: action` | 名称写清主体、动作、对象；具体动作写入 `behavior_description` |
| 结果判断 | `decision` | 表达判断内容，不重复承担前面的核对/审批工作 |
| 并行开始与汇合 | `parallel_split` / `parallel_join` | 属于控制节点，不分配虚构岗位，不独立计人工负荷 |
| 固定执行部门岗位 | `actor_assignment_mode: fixed_department` | `current_actor_role` 按页面既有方式连接部门与岗位称谓；不新增 actor 字段 |
| 全公司通用 | `company_wide` | 只表示责任适用方式，不表示全公司每个人都会办理 |
| 部门由前序数据确定 | `dynamic_from_data` | 明确 `actor_department_data_ref` 与 `actor_position_rule`，来源对象必须存在 |
| 入口、时限、完成结果 | `trigger`、`timing`、`completion_standard` | 非入口步骤不强塞流程启动条件；具体约束来自业务确认 |
| 历史输入输出描述 | `precondition`、`input_description`、`output_description` | 保留兼容字段；实际条件与输入输出同步反映在关系中，不作为另一套独立真源 |
| 会签 | `countersign_all_required`、`countersign_target_departments` | 表达指定部门全部确认知悉；不替代审核、批准或并行汇合 |

每个业务行为的执行主体应明确。协作方确实独立产出、审批或承担独立完成标准时，作为自己的业务行为确认；仅在一个活动内参与时，明确其具体贡献，并在报告按贡献计量，不擅自拆流程凑行为数。

关系为 `sequence`、`condition`、`loop`、`parallel`，端点使用 `behavior_ref`；同一节点不能直接连向自身。顺序关系表达直接继续；条件关系表达判断节点选择；回路明确退回条件和目标；并行明确开始与同一汇合。条件／回路应有可核对条件。判断节点可有一条无条件默认继续路线，不能用多个无条件出口掩盖分支。

循环每层都须有退出条件与去向。并行分支应全部进入同一汇合；若某分支可能在汇合前终止整个流程，应先重新确认建模方式。审核行为后再判断结果，不把普通行为承载的多条条件出线当作完整判断建模。

## 3 数据对象、字段与表单

`data_objects[]` 的每个对象必须含 `data_ref/data_name/description/information_type/fields/behavior_links/source_relations/lifecycle`。信息类型是业务说明，不是正式主数据认定。`fields[]` 每项包含 `field_ref/field_name/field_type/definition`。

数据操作规则：

- `action` 可使用 `create`、`update`、`use`、`pending_confirmation`。
- `decision` **仅允许 `use`**，表示使用数据作判断依据。这是 V8 相对 V7 的唯一放行差异。
- 并行等其他控制节点不允许数据操作；判断的创建、更新、待确认操作应回到实际办理行为确认。
- `update` 指向该对象真实存在的 `updated_field_refs`；不知道更新哪些字段时先追问，不把全部字段默认勾选。
- 同一数据对象与同一行为不要重复登记相同操作。记录 `use` 不代表创建、取得授权、改变状态或更新全部字段。
- 外部来源使用 `source_relations`，确认来源部门、流程、行为、数据名称和可用时间；不能仅凭外部文件名推断来源。

表单结构为 `forms[] → areas[] → items[]`。表单需 `form_ref/form_name/form_no/form_design_state/behavior_links/areas`。原有表单选 `current_state`，拟议新表单选 `proposed_design`，未知保持 `unspecified`。编号未知时按结构用 `null` 并登记待确认，不编造公司受控编号。

区域 `area_type` 使用“基本信息”或“明细清单”；多张明细分区保留，不混成一个表。对象字段先定义，表单字段用 `business_data_ref` 和 `data_field_ref` 引用。引用必须属于同一对象；`item_type` 与被引用的对象字段类型一致。表单显示名称可以不同，但不复制一套字段业务定义。

表单字段同时要有 `item_ref/item_name/item_type/required/instructions/value_usage_mode/value_origin_mode/source_links`。其中 `required` 是布尔值，没有“未知”枚举：尚未确认必填性时先保留在外部待确认记录，不自行填 `false`。生成最终文件前须明确；阶段草稿注明尚未编码的字段。

取值使用方式为 `authoritative_input/reuse_existing/calculated/external_source/pending_confirmation`；取值方式为 `direct_current_process/depends_on_data/pending_confirmation`。这里的输入方式不是正式主数据权威认定。不按引用顺序默认第一个为权威输入，也不以同名字段自动推断沿用关系。

`source_links` 须按结构指向确实存在的数据对象或字段，并写明已确认的取值依据。表单处理关系只连 `action`；操作值为 `create/fill/modify/review/approve/confirm/read/archive/void`，根据实际动作选择，不能将审批当填写或把只读当更新。

## 4 生命周期与记录控制

生命周期采用结构允许的适用状态、入口状态、路径、事件和分析元信息。未知时使用明确的 `pending_confirmation`，不为了完整性制造事件。业务使用状态、保管状态和匿名处理适用性分别确认；“已经归档”不自动等于“业务失效”，有个人信息也不自动等于应匿名化。

若匿名处理不适用，适用性与结果按结构同时使用 `not_applicable`。生命周期主状态待定时可保留已知明细，不删除。只登记有依据的时点、责任、结果和异常，不得把未经运行的分析标记为已分析，也不得伪造 `source_fingerprint`。

制度第 8 章须逐项说明纸质记录、关联表单的留存部门和保存期限；电子载体确有要求时另列。期限不能从编制规范的“长期”套用到其他制度。没有对应 JSON 字段的控制说明保留于制度正文和待确认清单，不塞入不相干字段。

## 5 草稿、校验与修正

结构允许的空值只表达尚未确定，不能掩盖遗漏。无待定值的枚举、布尔或时间字段必须先确认；信息暂不能合法编码时明确列出未编码内容，交付阶段草稿。

本地离线校验检查类型、结构、引用、端点、操作与节点类型、字段归属等可机器判定的问题；3001 页面另给业务提示。技能只能报告实际执行过的检查，不能声称“与模板相似，所以校验通过”。

修正输入为当前完整 JSON ＋ 校验错误路径／代码／消息 ＋ 相关确认。仅修正可据结构明确修复的问题；若错误涉及缺失业务事实，先问当前最关键问题。不得删掉冲突对象、清空数组、重建全部标识或直接把待确认改成已确认。

修正输出包括修改摘要、仍未解决的问题及完整修正版 JSON；同步更新受到影响的制度和报告。导入后再下载、重新导入并核对内容。若对话中的旧稿与用户最新下载的文件冲突，先核对，不能覆盖较新的业务内容。
