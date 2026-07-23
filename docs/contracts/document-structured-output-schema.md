# 文档结构化输出标准 Schema

> 状态：标准合同  
> 生效日期：2026-07-07  
> 机器合同：`docs/contracts/document-structured-output.schema.json`  
> 回归命令：`npm run test:document-structured-output-schema`

## 1. 定位

`document-structured-output.schema.json` 是文档结构化输出的统一数据模型。它把现有三处口径收敛到一份合同：

| 来源 | 作用 |
|---|---|
| `apps/mdm-platform/public/index.html` | 页面采集制度草稿、制度档案、术语、流程、业务行为、跨部门承接、表单字段和证据 |
| `apps/mdm-platform/server/mysqlSchema.js` | MySQL 承接表结构 |
| `scripts/parse-sankey-data.mjs` | 流程治理结构块 v1 的 parser 约束 |

该合同不替代 `docs/norms/` 流程输入基线，也不替代 `docs/organization/组织架构和部门职责.md`。

## 2. 顶层对象

| 顶层字段 | 含义 | 当前承接 |
|---|---|---|
| `schema_version` | 固定为 `document-structured-output-v2` | schema 合同 |
| `draft` | 制度结构草稿 | `process_design_drafts` |
| `document_profile` | 制度编号、制度名称、目的、范围、与已有制度/流程/表单的关系 | `process_design_document_profiles` |
| `terms` | 术语和定义 | `process_design_terms` |
| `processes` | L3 流程骨架 | `process_design_processes`；可投影到 `l3_catalog` |
| `steps` | A1 业务行为和判断节点；`step_type=action` 表示普通业务行为，`step_type=decision` 表示判断节点 | `process_design_steps`；可投影到 `a1_catalog` |
| `work_role_bindings` | L3 负责人或 A1 参与角色的候选/确认关系；流程草拟期可先选花名册岗位，流程固化后再绑定行政人事部正式工作角色；v2 可选字段 | 当前随结构化 JSON 往返，尚不写入 MDM |
| `step_transitions` | 判断分支；只允许同一流程内从判断节点发出，`to_step_ref` 可为空表示未补流向 | `process_design_step_transitions` |
| `behavior_details` | 行为边界、审批、执行标准 | `process_design_behavior_details` |
| `cross_dept_handoffs` | 跨部门承接关系 | `process_design_cross_dept_handoffs` |
| `forms` | 表单 | `process_design_forms` |
| `form_tables` | 主表 / 明细表 | `process_design_form_tables` |
| `form_table_fields` | 附表字段 | `process_design_form_table_fields` |
| `form_fields` | 表单字段和潜在主数据对象 | `process_design_form_fields` |
| `evidence_catalog` | 证据目录和核验状态 | `process_design_evidence`；可投影到 `evidence_catalog` |
| `mdm_requirement_catalog` | 主数据治理需求 | 当前主要用于结构块投影，MySQL 尚无独立承接表 |
| `pending_issues` | 围绕结构化对象和字段生成的待确认问题 | 可由 MDM 问题池承接 |
| `structure_block_projection` | 输出给流程地图 parser 的结构块 v1 视图 | `meta` / `l3_catalog` / `a1_catalog` / `work_role_bindings` / `evidence_catalog` / `mdm_requirement_catalog` |

制度主对象由 `process_design_documents` 承接，正式版次由 `process_design_versions` 承接。制度编号全公司唯一；版次由系统按 `A -> B -> ... -> Z -> AA -> AB` 生成，用户不能手填或跳号。

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

发布和 parser 相关硬门槛只看 `evidence.status`。`maturity` 仍可作为页面提示，不作为结构化证据的主状态。

### 3.1 工作角色关系约束

`work_role_bindings[]` 使用以下字段：`binding_ref`、`process_ref`、`step_ref`、`participant_department`、`source_role_text`、`source_position_name`、`work_role_code`、`participation_type`、`status`、`evidence_refs`、`confirmation_basis`。旧 v2 文件可不含 `source_position_name`。

- `participant_department` 必须使用统一的部门对象，至少包含 `department_name`，不能只写部门字符串。
- `step_ref=null` 表示 L3 流程负责人，只允许 `participation_type=owner`。
- `step_ref` 非空表示 A1 业务行为参与关系，禁止使用 `owner`。
- `proposed` 只表示流程治理提出的候选关系。流程未固化时可以先用 `participant_department + source_position_name` 记录当前实际参与岗位，此时 `work_role_code=null`；`confirmation_basis` 可为空，但候选仍应尽量携带证据引用。
- `confirmed` 表示行政人事部已经发布有效角色及岗位映射、且流程责任部门已经确认具体绑定；必须有非空 `confirmation_basis` 和至少一条状态为 `verified`、可定位、非 OCR 的 `evidence_refs`。
- 同一文档内 `binding_ref` 必须唯一；同一 `process_ref` 最多只能有一个 `confirmed` 的 L3 `owner`。这是跨数组约束，由 `npm run test:work-role-contract` 和消费端共同校验。
- `source_position_name` 必须按所选部门精确匹配花名册岗位，只表示流程草拟期“当前由哪个岗位参与”，不得进入正式结构块投影，也不得自动改写 `source_role_text`。
- 流程固化后，由行政人事部将岗位候选按稳定责任归并为正式工作角色；岗位与流程角色是多对多关系，不做一对一自动改名。
- `work_role_code` 非空时必须来自 `docs/organization/工作角色目录与岗位映射.md` 生成的正式目录，并使用行政人事部顺序分配的 `WR-0001` 编码；`confirmed` 必须有该编码。文档抽取不得自行编造编码，原文角色称谓继续保留在 `source_role_text`。
- `申请人`、`当前处理人`、`全体员工` 等场景身份，客户、供应商、银行等外部参与方，以及未澄清的集体称谓不得形成 `confirmed`；OCR 证据只能保留为待复核项。

## 4. 投影规则

| 标准对象 | 结构块 v1 投影 | 说明 |
|---|---|---|
| `processes[]` | `l3_catalog[]` | `l3_key` 是结构块稳定键；当前页面可先用 `process_ref` 承接，投影前必须补齐 `l3_key`；投影携带制度编号、制度名称和版次 |
| `steps[]` | `a1_catalog[]` | `a1_code` 是结构块稳定键；投影前必须能找到所属 `l3_key`；投影携带制度编号、制度名称和版次 |
| `work_role_bindings[]` | `work_role_bindings[]` | 投影对象沿用顶层字段形状，但只允许 `status=confirmed`；候选关系不得进入结构块 |
| `step_transitions[]` | 暂不投影到结构块 v1 | 3000 保存并在详情只读展示，用于记录判断节点的多分支出口 |
| `evidence_catalog[]` | `evidence_catalog[]` | `status` 必须使用证据五状态 |
| `mdm_requirement_catalog[]` | `mdm_requirement_catalog[]` | 只能来自字段台账或已核验证据，不从字段名直接推断 |
| `pending_issues[]` | 不直接进入结构块 | 用来驱动人工确认和回源整改 |

## 5. 当前实现差异

| 差异 | 标准处理 |
|---|---|
| MySQL `process_design_processes` 当前没有独立 `owner`、`system`、`evidence_refs` 列 | schema 先作为标准字段保留；未落库时可从证据或导出投影阶段补齐 |
| MySQL `process_design_steps` 当前没有独立 `entry`、`system`、`evidence_refs` 列 | schema 先作为 A1 投影字段保留；缺失时生成 `pending_issues` |
| `step_transitions.to_step_ref` 可为空 | 3000 导入时保留为空流向并返回 warning，详情页展示为“未补流向” |
| MySQL `process_design_evidence.object_type` 当前只覆盖部分对象 | schema 以文档结构对象为准，平台承接时可继续映射到现有对象类型 |
| `mdm_requirement_catalog` 当前没有独立 MySQL 表 | schema 保留标准结构，避免主数据需求散落在自由文本里 |
| 外部制度引用关系当前为自由文本 | 页面要求写明制度编号、版次和制度名称；本轮不新增引用明细接口 |
| 工作角色关系当前没有 MDM 承接表 | v2 先以可选 `work_role_bindings` 随结构化 JSON 往返；3000 对非空数组在任何写入前返回 `422 WORK_ROLE_BINDINGS_UNSUPPORTED`，旧 v2 文件和空数组保持兼容 |
| 角色原文摘录过去只存在页面辅助数据 | `evidence.source_excerpt` 作为可选字段随 JSON 往返，`locate_method` 继续记录抽取或定位方式 |

## 6. 使用方式

1. 模型或脚本输出文档结构化结果时，先满足 `document-structured-output.schema.json`，`schema_version` 必须是 `document-structured-output-v2`。
2. 页面和 MySQL 只作为承接实现，字段缺口应回写为 `pending_issues`，不要让模型自行补结论；新字母版次必须完整重写，不复制旧版内容。
3. 要交给流程地图 parser 时，生成 `structure_block_projection`，并确保 `parser_schema_version=1`、证据引用不悬空。
4. 发布下一版次后，只把当前有效版次投影到默认流程图谱和 A1 视图，旧版保留为历史追溯。
5. 修改 schema、前端结构化字段、MySQL process_design 表或 parser 结构块字段后，运行：

```powershell
npm run test:document-structured-output-schema
npm run test:work-role-contract
npm run test:no-banned-terminology
```
