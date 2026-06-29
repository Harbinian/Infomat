---
name: process-evidence-mapping
description: >
  Use for Infomat process-governance work when turning制度、规程、表单、台账、流程图、PDF/图片和OCR待确认 into a controlled evidence chain: source inventory, OCR review, evidence chunks, local embedding retrieval, reviewItem interpretation, role extraction, object chains, reviewItem mapping todo Markdown, mapping diff audit, and source-verified DCM/BBM entry.
---

# Process Evidence Mapping

本技能只服务 `docs/norms` 流程治理。分析对象是流程和证据链，不是应用系统。执行者必须按下面顺序从上到下完成；待确认 JSON 留在 `artifacts/`，人工处理面板写入 `docs/norms/流程治理/输入基线问题待办.md`。

## 技能演进评测

当需要改进本技能本身时，先使用 `references/evolution-cases.jsonl` 和问题识别批次产物生成演进提案。运行 `.agents/skills/process-evidence-mapping/scripts/generate-evolution-proposal.mjs`，输出只能写入 `artifacts/process-evolution/<run-id>/evolution-proposal.md`。

演进评测只判断技能质量、待确认解释质量和测试缺口。待确认 JSON、向量召回、OCR 结果、人工待办和 `evolution-proposal.md` 都只能生成提案，不得自动修改已确认流程映射、PMO 页面、MDM 接口或技能文件。任何 DCM/BBM 入库仍必须按“受控入库”逐条回源核验。

### 1. 仓库上下文

**输入**：用户任务、当前仓库根目录、相关部门名称、目标制度或资料目录。

**动作**：先读取 `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md`、`MAINLINE_MAP.md`、`docs/norms/CLAUDE.md`、`docs/organization/组织架构和部门职责.md`。确认真源边界：流程输入基线是 `docs/norms/{部门}部门-能力-流程-系统映射关系.md`，待确认结果不是流程输入基线。

**输出**：本轮处理范围、主责资产、可改文件、禁止触碰目录、部门到域映射口径。

**不得做**：不得把 PMO、MDM 前端、应用系统选型或临时 `artifacts/` 结果当作流程输入基线；不得移动资料目录或顺手重排仓库。

**下一步条件**：仓库边界和主责资产明确后，进入源文件清单。

### 2. 源文件清单

**输入**：部门资料目录、单个制度文件或用户指定的文件清单。

**动作**：递归到最深叶子目录，列出所有可达文件和空/不可读目录。记录文件路径、文件名、文件号、版次、文件类型、大小/修改时间、正文哈希、表格数/图示数、处理状态、处理理由、source_company、source_org_name、source_boundary_flag。输入基线问题识别流水线默认使用 `run-process-input-baseline-review-workflow.mjs` 生成 `source_manifest.jsonl`；批量源清单可先用 `extract-evidence-chunks.mjs` 生成 source index。

**输出**：`artifacts/.../source_manifest.jsonl`，以及需要 OCR、转换或人工复核的源文件清单。

**不得做**：不得只看高层文件夹就命名能力或流程；不得把外部参考、历史模板、生成物、`_extracted/`、临时文件直接纳入已确认流程映射。

**下一步条件**：每个源文件至少有纳入、排除、待复核之一的处理状态后，进入可读性判断/OCR。

### 3. 可读性判断/OCR

**输入**：源文件清单、PDF、图片、低可读页面、抽取失败或 `extraction_quality=needs_ocr` 的来源。

**动作**：对 PDF、图片和低可读页面固定进入 OCR 判断，复用 `scripts/ocr-source.mjs`。OCR 输出写入 `artifacts/ocr/<run-id>/` 或输入基线问题识别工作流的 `artifacts/process-input-baseline-review/<run-id>/ocr/`。OCR 记录必须保留 source path/hash、页块、文本、置信度、工具版本、`review_required`、`evidence_status=ocr_extracted_not_confirmed`。

**输出**：OCR manifest、raw/json/markdown 结果、`review-required.jsonl`、待确认待办中的 `OCR待复核` 项。

**不得做**：不得只看 OCR 文本入库；不得让 OCR 文本直接形成 L3、A1、审批链、输入部门、输出部门或系统落位结论。

**下一步条件**：可读文本和 OCR 待复核项都被标记后，进入 evidence chunks。

### 4. Evidence Chunks

**输入**：可读源文件、OCR 待复核文本、源文件清单。

**动作**：运行 `.agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs`。按证据单元切 chunk：条款、标题下段落组、表格行、表单字段组、签批栏、台账字段、流程节点/边、附件标题。每个 chunk 保留 `source_file`、doc_no、version、source anchor、`raw_text`、`normalized_text`、`normalized_review_text`、artifact_type、extraction_quality、chunk_hash、review status。

**输出**：`chunks.jsonl`、`chunking_warnings.md`。所有 chunk 默认 `evidence_status=reviewItem`、`verification_status=unverified`、`allowed_downstream_use=review_only`。

**不得做**：不得修正 `raw_text`；不得把 `normalized_review_text` 当原文引用；不得引用 `partial` 或 `needs_ocr` chunk 作为正式证据。

**下一步条件**：chunk 可追溯到原文位置后，进入 embedding 检索。

### 5. Embedding 检索

**输入**：`chunks.jsonl`、本地 embedding 配置、检索问题清单。

**动作**：默认使用本地 Ollama：provider `ollama`，endpoint `http://127.0.0.1:11434/api/embed`，model `qwen3-embedding:latest`，dimensions `1024`。运行 `build-embedding-manifest.mjs` 生成 `embedding_manifest.json` 和 vectors；manifest 必须记录模型、维度、chunking rule、source hash。再用 `evidence-retriever.mjs` 召回审批链、受控传递、对象别名、归档保存、角色参与等待确认证据。若 Ollama 或模型不可用，降级为关键词/规则抽取，并在报告和待办中标明本轮未使用向量检索。

**输出**：`embedding_manifest.json`、`vectors.jsonl`、`review_evidence.jsonl`、待确认证据报告。所有向量结果保持 `evidence_status=reviewItem` 和 `allowed_downstream_use=review_only`。

**不得做**：不得把相似度当证据强度；不得用向量相似度直接判断 L3/A1、对象同一性、审批类型、输入输出部门、MDM 归属或系统落位。

**下一步条件**：检索结果已标记为待确认或已明确降级后，进入输入基线解读。

### 6. 输入基线解读

**输入**：`chunks.jsonl`、`review_evidence.jsonl`、源文件清单、当前部门。

**动作**：运行 `extract-process-review-items.mjs`，生成制度输入基线解读：待确认能力、待确认 L3、待确认 A1、审批链待确认、受控传递待确认、归档/保存待确认、验收标准缺口。待确认名称可以规范化，但必须保留原文锚点和待确认说明。

**输出**：`document_review_items.json`。该 JSON 是机器可读待确认，不是已确认流程映射。

**不得做**：不得把输入基线解读直接写入部门已确认流程映射；不得直接填写 `审批类型`、`输入来源部门`、`输出目标部门`；不得省略来源文件/条款。

**下一步条件**：待确认流程和待确认行为有来源锚点后，进入角色抽取。

### 7. 角色抽取

**输入**：`chunks.jsonl`、输入基线解读、部门上下文。

**动作**：运行 `extract-role-review-items.mjs`，抽取部门、岗位、审批身份、数据提供方、数据接收方、协同角色。区分主责部门、执行角色、发起角色、审核角色、批准角色、数据提供角色、协同角色。角色来自原文时标明原文明确；来自上下文时标明待确认。

**输出**：`role_review_items.json`，即角色簿待确认。

**不得做**：不得把审批角色误写成输出部门；不得把“有关部门”“相关部门”自动映射到当前组织部门；不得把外部客户、供应商、银行直接塞入输入/输出部门字段。

**下一步条件**：角色簿覆盖制度中出现的关键角色后，进入对象链。

### 8. 对象链

**输入**：`chunks.jsonl`、`role_review_items.json`、输入基线解读。

**动作**：运行 `build-object-chains.mjs`。以具体对象为中心串联动作，例如申请单、情况说明、工资明细、BOM、报表、台账、废品损失、盈亏处理事项。动作从原文动词和签批栏抽取：填写、编制、汇总、提交、校对、核对、审核、审批、批准、发布、通报、归档。

**输出**：`object_chains.json`，包含对象、动作链、相关角色、来源锚点和问题类型。

**不得做**：不得因为同在一个标题下就合并不同对象；不得把对象链里的“审核/批准”直接变成正式审批字段；不得把对象别名当作已确认同一对象。

**下一步条件**：关键对象至少有来源动作链或明确待补后，进入输入基线问题。

### 9. 输入基线问题

**输入**：`document_review_items.json`、`role_review_items.json`、`object_chains.json`、当前已确认流程映射。

**动作**：把输入基线解读、角色簿和对象链汇总成可审计待确认问题。问题类型固定为：`待确认L3`、`待确认A1`、`角色待确认`、`审批链待确认`、`受控传递待确认`、`OCR待复核`、`验收标准待补`、`归档要求待补`、`系统落位待确认`。稳定键由部门、来源文件、条款、问题类型、问题内容 hash 生成。

**输出**：`artifacts/.../mapping_diff_items.json` 的前置待确认问题集合。

**不得做**：不得把待确认问题写进正式 DCM/BBM；不得把待确认系统落位说成系统选型建议；不得把相似命中说成已覆盖。

**下一步条件**：待确认问题具备稳定键和问题类型后，进入待确认待办 Markdown。

### 10. 待确认待办 Markdown

**输入**：待确认问题 JSON、当前已确认流程映射、现有 `docs/norms/流程治理/输入基线问题待办.md`。

**动作**：运行 `update-input-baseline-review-todo-md.mjs`。待确认结果分两层保存：机器可读 JSON 留在 `artifacts/`，人工处理清单写入 `docs/norms/流程治理/输入基线问题待办.md`。Markdown 待办只保留当前未解决待确认问题；解决一条就删除一条。新待确认按稳定键去重，已确认流程映射已覆盖的待确认不再写入。

**输出**：只含未解决项的待确认待办 Markdown。每条必须包含编号、部门、来源文件/条款、问题类型、问题内容、当前映射位置、建议动作、处理状态、负责人/确认对象。

**不得做**：不得在待办里长期堆积“已解决”；不得把待办当流程输入基线；不得靠待办替代原始待确认 JSON、已确认流程映射变更记录和 git 历史。

**下一步条件**：人工处理面板生成后，进入当前映射差异审计。

### 11. 当前映射差异审计

**输入**：当前部门已确认流程映射、待确认问题 JSON、待确认待办 Markdown。

**动作**：运行 `diff-review-items-with-mapping.mjs`。对比问题内容与当前 `{部门}部门-能力-流程-系统映射关系.md`：已被已确认流程映射覆盖的待确认关闭；仍未覆盖的待确认保留到待办；人工删除但未被已确认流程映射覆盖的待确认下轮重新出现。审计报告必须写明 embedding 是否使用、source hash、待确认数量和边界声明。

**输出**：`mapping_diff_report.md`、更新后的 `mapping_diff_items.json` 和待办 Markdown。

**不得做**：不得把“未命中待确认”解释为业务不存在；不得为了消除待办而模糊改写已确认流程映射；不得在审计报告里给出没有原文核验的肯定结论。

**下一步条件**：差异项清晰后，进入受控入库。

### 12. 受控入库

**输入**：待办项、原始制度条款/表格/签批栏/流程图/OCR 原图位置、当前已确认流程映射。

**动作**：逐条回源核验。确认后才更新 DCM 主表、同一 Markdown 内的 BBM/A1、流程图 Markdown、MDM 建设要求或 Sankey 数据。正式 DCM/BBM 仍遵守原列结构、证据依据、跨部门受控传递规则和系统落位规则。OCR 项只能在核验原 PDF/图片后入库。

**输出**：受控变更后的已确认流程映射、必要的变更说明、从待办 Markdown 删除的已处理项。

**不得做**：不得批量把待确认 JSON 自动写入已确认流程映射；不得绕过原文核验；不得把 MDM 写成 应用系统（S1）；不得对 OA/MES/ERP/PLM 作“最忙、主用、承载最多”等评价。

**下一步条件**：已确认流程映射已更新或确认暂不入库后，进入验证与报告。

### 13. 验证与报告

**输入**：变更后的技能、脚本、待确认输出、已确认流程映射、待办 Markdown。

**动作**：至少运行 `npm run test:process-evidence-skill`、`npm run test:process-evidence-evolution`、`npm run test:process-input-baseline-review`、`npm run test:ocr-source`、`.agents/skills/process-evidence-mapping/scripts/test-vector-pipeline.mjs`（若本地 Ollama 不可用则记录降级原因）、`npm run test:process-governance-mainline`、`node scripts/check-dcm-bbm.mjs --no-fail`、`node scripts/audit-a1-transfer-evidence.mjs --no-write`。需要刷新 Sankey 时再运行 `node scripts/parse-sankey-data.mjs`。

**输出**：测试结果、输入基线问题识别工作流输出路径、待办 Markdown 路径、未验证或降级项、下一步人工确认清单。

**不得做**：不得声称待确认已正式入库，除非已完成受控入库和验证；不得隐藏 OCR/embedding 降级；不得把未跑的测试说成已通过。

**下一步条件**：验证完成后向用户报告本轮完成项、失败项和待人工确认项。
