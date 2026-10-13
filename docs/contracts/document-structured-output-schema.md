# 文档结构化输出标准 Schema

> 状态：v2证据草稿及历史投影兼容说明
> 规则文件：`docs/contracts/document-structured-output.schema.json`
> 回归命令：`npm run test:document-structured-output-schema`

## 1. 定位

`document-structured-output.schema.json` 保留为 `document-structured-output-v2` 证据草稿与旧结构块的兼容模型，当前由流程证据映射技能的编译/校验器及旧parser消费。它不提供当前业务或治理权威。

3000的旧制度文档编制、v1至v3导入和旧跨部门承接入口已经退役；本文件的 `process_design_*` 对照仅保留历史实现关联，不表示存在可用的当前导入、发布或编辑接口。当前单流程编制及人工交接按3001、3000 README核对，本工作区3001默认V8候选，V7继续受支持；正式运行状态须实时核对。

## 2. 顶层对象

| 顶层字段 | 含义 | 草稿用途或历史关联 |
|---|---|---|
| `schema_version` | 固定为 `document-structured-output-v2` | 结构规则 |
| `draft` | 制度结构草稿 | `process_design_drafts` |
| `document_profile` | 制度编号、制度名称、目的、范围、与已有制度/流程/表单的关系 | `process_design_document_profiles` |
| `terms` | 术语和定义 | `process_design_terms` |
| `processes` | L3 流程骨架 | `process_design_processes`；可投影到 `l3_catalog` |
| `steps` | A1 业务行为和判断节点；`step_type=action` 表示普通业务行为，`step_type=decision` 表示判断节点 | `process_design_steps`；可投影到 `a1_catalog` |
| `work_role_bindings` | L3 负责人或 A1 参与角色的候选/确认关系；流程草拟期可先选花名册岗位，流程固化后再绑定行政人事部正式工作角色；v2 可选字段 | 证据草稿JSON往返字段；不通过退役入口写入MDM |
| `step_transitions` | 判断分支；只允许同一流程内从判断节点发出，`to_step_ref` 可为空表示未补流向 | `process_design_step_transitions` |
| `behavior_details` | 行为边界、审批、执行标准 | `process_design_behavior_details` |
| `cross_dept_handoffs` | 跨部门承接关系 | `process_design_cross_dept_handoffs` |
| `forms` | 表单 | `process_design_forms` |
| `form_tables` | 主表 / 明细表 | `process_design_form_tables` |
| `form_table_fields` | 附表字段 | `process_design_form_table_fields` |
| `form_fields` | 表单字段和潜在主数据对象 | `process_design_form_fields` |
| `evidence_catalog` | 证据目录和核验状态 | `process_design_evidence`；可投影到 `evidence_catalog` |
| `mdm_requirement_catalog` | 主数据治理需求 | 证据草稿及历史结构块投影字段 |
| `pending_issues` | 围绕结构化对象和字段生成的待确认问题 | 证据草稿待确认项；不自动创建正式问题或待办 |
| `structure_block_projection` | 输出给流程地图 parser 的结构块 v1 视图 | `meta` / `l3_catalog` / `a1_catalog` / `work_role_bindings` / `evidence_catalog` / `mdm_requirement_catalog` |

## 3. 统一枚举

| 枚举 | 标准值 |
|---|---|
| `edition` | 大写字母序列，如 `A`、`B`、`AA` |
| `version_status` | `published`、`superseded`、`retired` |
| `process_type` | `new`、`inherit`、`handoff`、`adjustment` |
| `step_type` | `action`、`decision` |
| `system` | 空值、`OA`、`MES`、`PLM`、`ERP` |
| `field_type` | `文本`、`长文本`、`数字`、`日期`、`日期时间`、`金额`、`枚举`、`布尔`、`部门`、`人员`、`文件编号`、`签名`、`图片`、`附件`、`二维码` |
| `evidence_type` | `制度条款`、`表单样例`、`访谈记录`、`会议纪要`、`流程图`、`台账记录`、`暂无证据` |
| `evidence.status` | `verified`、`pending_review`、`source_missing`、`ocr_extracted_not_confirmed`、`review_only` |
| `work_role_bindings.participation_type` | `owner`、`initiator`、`executor`、`reviewer`、`approver`、`collaborator`、`provider`、`receiver` |
| `work_role_bindings.status` | `proposed`、`confirmed` |

证据草稿及历史parser的机器兼容检查使用 `evidence.status`；它不能单独证明当前正式发布门槛。`maturity` 仍可作为页面提示，不作为结构化证据的主状态。

### 3.1 工作角色字段的兼容约束

以下解释既有v2字段及校验条件。文件声明的`confirmed`须另核对有权确认，不从花名册副本、机器校验或旧消费链推定业务责任。旧岗位归并、部门职责和角色发布流程见历史快照，不作为现行安排。

`work_role_bindings[]` 使用以下字段：`binding_ref`、`process_ref`、`step_ref`、`participant_department`、`source_role_text`、`source_position_name`、`work_role_code`、`participation_type`、`status`、`evidence_refs`、`confirmation_basis`。旧 v2 文件可不含 `source_position_name`。

- `participant_department` 必须使用统一的部门对象，至少包含 `department_name`，不能只写部门字符串。
- `step_ref=null` 表示 L3 流程负责人，只允许 `participation_type=owner`。
- `step_ref` 非空表示 A1 业务行为参与关系，禁止使用 `owner`。
- `proposed` 只表示流程治理提出的候选关系。流程未固化时可以先用 `participant_department + source_position_name` 记录当前实际参与岗位，此时 `work_role_code=null`；`confirmation_basis` 可为空，但候选仍应尽量携带证据引用。
- `confirmed`是文件声明的确认状态，技术上要求非空`confirmation_basis`和至少一条状态为`verified`、可定位、非OCR的`evidence_refs`；具体主体及责任须按业务确认核对。
- 同一文档内 `binding_ref` 必须唯一；同一 `process_ref` 最多只能有一个 `confirmed` 的 L3 `owner`。这是跨数组约束，由 `npm run test:work-role-contract` 和消费端共同校验。
- `source_position_name` 必须按所选部门精确匹配花名册岗位，只表示流程草拟期“当前由哪个岗位参与”，不得进入正式结构块投影，也不得自动改写 `source_role_text`。
- `work_role_code` 非空时必须来自有权确认的正式目录；旧消费链核对显式选定的历史目录及其`WR-0001`类机器编码；检查不决定当前角色或编码分配职责；`confirmed` 必须有该编码。文档抽取不得自行编造编码，原文角色称谓继续保留在 `source_role_text`。
- `申请人`、`当前处理人`、`全体员工` 等场景身份，客户、供应商、银行等外部参与方，以及未澄清的集体称谓不得形成 `confirmed`；OCR 证据只能保留为待复核项。

## 4. 投影规则

| 标准对象 | 结构块 v1 投影 | 说明 |
|---|---|---|
| `processes[]` | `l3_catalog[]` | `l3_key` 是结构块稳定键；历史展示链可用 `process_ref`关联，投影前必须补齐 `l3_key`；投影携带制度编号、制度名称和版次 |
| `steps[]` | `a1_catalog[]` | `a1_code` 是结构块稳定键；投影前必须能找到所属 `l3_key`；投影携带制度编号、制度名称和版次 |
| `work_role_bindings[]` | `work_role_bindings[]` | 投影对象沿用顶层字段形状，但只允许 `status=confirmed`；候选关系不得进入结构块 |
| `step_transitions[]` | 暂不投影到结构块 v1 | 旧3000链路曾保存并只读展示；当前该入口已退役，用于记录判断节点的多分支出口 |
| `evidence_catalog[]` | `evidence_catalog[]` | `status` 必须使用证据五状态 |
| `mdm_requirement_catalog[]` | `mdm_requirement_catalog[]` | 只能来自字段台账或已核验证据，不从字段名直接推断 |
| `pending_issues[]` | 不直接进入结构块 | 用来驱动人工确认和回源整改 |

## 5. 历史承接与现行边界

旧MySQL表的缺列、结构投影及退役导入行为见[历史快照](../archives/2026-10-09-leaf-docs/docs/contracts/document-structured-output-schema.md.before.txt)。这些记录不描述当前数据库状态，不授权补列、回填或恢复导入。当前v2用于证据草稿，正式流程交接按3001、3000应用说明执行。

## 6. 使用方式

1. 流程证据映射技能生成v2草稿时满足机器schema；保留原文证据、责任和待确认事项，不能以模型或兼容测试补造事实。
2. 该v2草稿不进入3000已退役的旧文档编制或导入接口；当前单流程JSON按3001应用入口编制、下载，由用户人工上传3000。
3. 获准维护旧展示链时才生成 `structure_block_projection`，并显式指定parser的历史输入和输出；投影不能成为当前正式流程版本。
4. 修改v2schema、技能消费或旧parser兼容行为后，按影响运行：

```powershell
npm run test:document-structured-output-schema
npm run test:work-role-contract
npm run test:no-banned-terminology
```
