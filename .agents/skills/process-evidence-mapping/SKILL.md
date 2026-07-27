---
name: process-evidence-mapping
description: >
  Use for Infomat process-governance work when turning directly readable
  制度、规程、表单、台账、流程图和文本型 PDF into a traceable
  document-structured-output-v2 review draft with evidence, process and behavior
  candidates, business-facing pending issues, schema validation and a strict
  human-controlled publication boundary.
---

# Process Evidence Mapping

本技能只服务 Infomat 流程证据梳理。分析对象是业务流程、业务行为和证据链，不是应用系统。

唯一机器主产物是
`artifacts/process-input-baseline-review/<run-id>/document-structured-output-v2.json`，
字段合同以 `docs/contracts/document-structured-output.schema.json` 为准。
`document_review_items.json`、`role_review_items.json`、`object_chains.json` 和
`mapping_diff_items.json` 只允许作为兼容性中间产物；Markdown 只允许作为 v2
`pending_issues[]` 的派生视图。

## 强制边界

- 只处理能够直接读取文字、表格或节点文本的源文件。
- 图片、扫描件、无文本 PDF 和无法直接提取内容的页面一律阻断。
- 严禁执行图像转文字、文字识别、自动抄录或根据画面猜测内容。
- 阻断来源必须进入 `source_manifest.jsonl`，状态为
  `blocked_unreadable`；资料责任人提供可读取原件或经人工确认的文字版后才能重跑。
- 自动抽取只能形成 `pending_review` 候选；`verified` 必须由人工回到可直接读取的
  原文位置确认。
- 技能不得写数据库，不得写回 `docs/norms/`，不得自动生成正式结构块投影，不得
  自动发布 DCM/BBM。

## 技能演进评测

改进本技能前，先运行：

```powershell
node .agents/skills/process-evidence-mapping/scripts/generate-evolution-proposal.mjs `
  --cases .agents/skills/process-evidence-mapping/references/evolution-cases.jsonl `
  --review-run artifacts/process-input-baseline-review/<run-id> `
  --out artifacts/process-evolution/<evolution-run-id>
```

演进提案只评测技能规则、待确认解释和测试缺口。它不得自动修改流程输入基线、
PMO 页面、MDM 接口或技能文件。技能文件只有在用户明确要求改进时才可修改。
提案文件固定为 `artifacts/process-evolution/<run-id>/evolution-proposal.md`。

### 1. 仓库上下文

**输入**：用户任务、仓库根目录、部门、目标制度或资料目录。

**动作**：读取根 `AGENTS.md`、`CODEX.md`、`REPOSITORY_BOUNDARY.md`、
`DIRECTORY_OWNERSHIP.md`、`MAINLINE_MAP.md`、`docs/norms/AGENTS.md`、
`docs/norms/README.md` 和 `docs/organization/组织架构和部门职责.md`。先确认主责
资产、真源、只读边界和部门名称。

**输出**：处理范围、可改资产、只读资产、部门口径和验证入口。

**不得做**：不得把 PMO、MDM 页面、临时 artifacts 或历史报告当流程输入基线；
不得顺手移动资料或重排目录。

**下一步条件**：主责资产和只读边界明确后进入源文件清单。

### 2. 源文件清单与可读性门

**输入**：用户指定的制度、规程、表单、台账、文本型 PDF、可直接读取节点文本的
流程图或资料目录。

**动作**：递归到叶子目录，运行
`extract-evidence-chunks.mjs` 生成 `source_manifest.jsonl`。记录路径、文件号、
版次、类型、大小、时间、正文哈希、处理状态、处理理由、来源公司和组织边界。对
图片、扫描件、无文本 PDF、转换失败和空来源直接阻断。

**输出**：`source_manifest.jsonl`、`chunks.jsonl`、`chunking_warnings.md`。
每个来源必须是 `chunked`、`excluded`、`deferred`、`failed` 或
`blocked_unreadable` 之一；存在后两种状态时本轮停止。

**不得做**：不得静默跳过不可读来源；不得从文件名、目录名或不可读画面推断流程
事实；不得调用任何图像转文字工具。

**下一步条件**：所有纳入来源均可直接读取且能定位原文后进入证据切块。

### 3. 证据切块

**输入**：通过可读性门的源文件和 `source_manifest.jsonl`。

**动作**：按条款、标题下段落组、表格行、表单字段组、签批栏、台账字段、可直接
读取的流程节点/边和附件标题切块。保留 `source_file`、`doc_no`、`version`、
`source_anchor`、`raw_text`、`normalized_review_text`、`artifact_type`、
`extraction_quality`、`chunk_hash` 和来源边界字段。

**输出**：可追溯 `chunks.jsonl`。默认
`evidence_status=pending_review`、`verification_status=unverified`、
`allowed_downstream_use=review_only`。

**不得做**：不得修正 `raw_text`；不得把搜索修复提示当原文；不得让 `partial`、
`failed` 或 `blocked_unreadable` 内容支撑正式字段。

**下一步条件**：每个候选能回到可直接读取的源文件位置后进入可选检索。

### 4. 可选语义检索

**输入**：`chunks.jsonl` 和本地 embedding 配置。

**动作**：需要扩大召回时，使用 `qwen3-embedding:latest`、1024 维本地向量，
检索流程边界、对象、角色、审批、跨部门交接、表单字段、归档和完成标准。模型不可
用时降级为关键词/规则抽取并记录 `embedding_manifest.status=skipped`。

**输出**：`embedding_manifest.json`、`vectors.jsonl`、
`review_evidence.jsonl`。召回结果保持 `pending_review/review_only`。

**不得做**：不得把相似度当证据强度；不得用相似度确认 L3、A1、对象同一性、
审批、跨部门承接、正式工作角色或系统落位。

**下一步条件**：召回结果已保持候选状态或已明确降级后进入通用候选抽取。

### 5. 通用流程与行为候选

**输入**：`chunks.jsonl`、可选 `review_evidence.jsonl` 和部门上下文。

**动作**：运行 `extract-process-review-items.mjs`。从制度标题、职责、工作程序、
动作词和对象词形成 L3/A1 候选；抽取器必须面向所有部门使用同一套通用规则，不得
在核心脚本中硬编码财务、经营或其他部门的专用结论。

**输出**：`document_review_items.json`，包含能力、L3、A1、审批、承接、归档和
完成标准候选。

**不得做**：不得把候选直接认定为已确认流程；不得补写原文没有的流程起止、角色、
输入、输出、完成标准或系统。

**下一步条件**：L3/A1 候选均有原文锚点后进入角色和对象链。

### 6. 角色与对象链

**输入**：`chunks.jsonl` 和流程/行为候选。

**动作**：运行 `extract-role-review-items.mjs` 与
`build-object-chains.mjs`。保留原文角色称谓，按对象串联编制、提交、审核、
批准、接收、反馈、归档等动作。

**输出**：`role_review_items.json`、`object_chains.json`。

**不得做**：不得把原文角色直接变成正式 `WR-*`；不得把审批人当输出部门；不得
把“相关部门”自动映射到具体部门；不得把同标题下的不同对象强行合并。

**下一步条件**：角色和对象链均保留原文锚点后编译 v2。

### 7. 编译 document-structured-output-v2

**输入**：流程候选、角色候选、对象链、差异候选和 `chunks.jsonl`。

**动作**：运行 `compile-document-structured-output-v2.mjs`，生成当前标准合同。
至少输出 `draft`、`document_profile`、`processes[]`、`steps[]`、
`behavior_details[]`、`step_transitions[]`、`evidence_catalog[]` 和
`pending_issues[]`。未知必填值只能使用明确的“待确认”占位并同步生成待确认问题。

每项 A1 至少检查执行角色、触发场景、前置条件、输入材料、动作、输出结果、执行
标准和证据。缺任何一项都必须进入同一 A1 的 `pending_issues[]`。

**输出**：`document-structured-output-v2.json`。

**不得做**：不得自动生成 `verified` 证据；不得自动生成 `confirmed` 工作角色；
不得因为“相关部门”或交接动词自动创建 `cross_dept_handoffs[]`；不得输出正式
`structure_block_projection`。

**下一步条件**：v2 实例通过标准 Schema 和引用完整性校验后进入问题视图。

### 8. 待确认问题与差异审计

**输入**：v2 候选、当前部门已确认流程映射。

**动作**：对比候选与当前映射，所有问题必须包含 `stable_key`、
`structured_object_type`、`structured_object_key`、`target_block`、
`target_field`、`evidence_status`、`issue_type`、`question_for_user` 和来源锚点。
问题类型使用标准合同枚举；抽取失败但来源可读时使用 `抽取结果待复核`，不可读来源
在第 2 步已经阻断，不生成猜测性问题。

**输出**：v2 `pending_issues[]` 和兼容性 `mapping_diff_report.md`。

**不得做**：不得把待确认问题写入正式 DCM/BBM；不得把系统落位写成系统评价或
选型建议；不得把“未命中”解释为业务不存在。

**下一步条件**：待确认问题均能定位到对象、字段和来源后生成派生视图。

### 9. 派生人工视图

**输入**：v2 `pending_issues[]`。

**动作**：运行 `update-input-baseline-review-todo-md.mjs`，在同一
`artifacts/process-input-baseline-review/<run-id>/` 下生成
`pending-issues.md`。

**输出**：仅供人工阅读的未解决问题清单。

**不得做**：不得把 Markdown 当机器合同、流程输入基线或长期真源；不得默认写入
`docs/norms/流程治理/`。

**下一步条件**：人工阅读视图与 v2 问题数量一致后进入人工确认边界。

### 10. 人工确认与发布边界

**输入**：v2 草稿、源文件、流程责任部门意见、必要的接收部门和行政人事部确认。

**动作**：业务人员在 3001/3000 或受控评审流程中确认字段。跨部门承接必须确认
具体交付物、接收部门、交接动作、承接标准和目标流程/行为；正式工作角色必须由
行政人事目录和流程责任部门共同确认；证据必须有来源、位置、摘录、确认人和时间。

**输出**：经人工确认的 v2 草稿，后续由受控发布流程生成结构块投影。

**不得做**：技能本身不得写数据库、写回流程输入基线、分配正式角色编码、代替
接收部门确认或触发正式发布。

**下一步条件**：所有发布必填项和逐对象证据通过人工确认后，才可进入独立发布流程。

### 11. 验证与报告

**输入**：技能文件、脚本、v2 输出和派生视图。

**动作**：至少运行：

```powershell
npm run test:process-evidence-skill
npm run test:process-evidence-evolution
npm run test:process-input-baseline-review-workflow
npm run test:document-structured-output-schema
node .agents/skills/process-evidence-mapping/scripts/test-vector-pipeline.mjs
```

工作流还必须自动执行
`validate-document-structured-output-v2.mjs --input <v2-json>`。

**输出**：测试结果、v2 输出路径、阻断来源、检索降级、待确认数量和未覆盖风险。

**不得做**：不得把测试通过说成业务已确认；不得隐藏不可读来源或检索降级；不得
声称已正式发布，除非独立受控发布流程确实完成。

**下一步条件**：验证通过后向用户报告修改、文档同步、测试和剩余风险。
