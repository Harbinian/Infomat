---
name: process-evidence-mapping
description: 从用户指定的制度、表单和流程资料生成 Infomat document-structured-output-v2 证据草稿及待确认问题，支持待复核视觉转录，不用于正式发布。
---

# Process Evidence Mapping

本技能梳理业务流程、业务行为及证据链。唯一机器主产物为
`artifacts/process-input-baseline-review/<run-id>/document-structured-output-v2.json`，
字段合同以 `docs/contracts/document-structured-output.schema.json` 为准。
兼容性中间 JSON 和 Markdown 视图不能替代该合同或流程输入基线。

## 必要边界

- 先直接读取文字、表格或节点；图片、扫描件可用当前可用的视觉能力或已有 OCR 记录形成带原文件摘要、页码和块定位的待复核转录。自动文本抽取失败仍保留 `blocked_unreadable` 或 `failed`，不猜测画面、不静默跳过。可用部分继续生成；缺口阻断其依赖的结论和完整成果声明，没有可用内容时停止生成。
- 抽取结果保持 `evidence_status=pending_review`、`verification_status=unverified`、`allowed_downstream_use=review_only`。不得自动生成 `verified` 证据或 `confirmed` 工作角色。
- 不写数据库，不写回 `docs/norms/`，不分配正式角色编码，不生成正式 `structure_block_projection`，不自动发布 DCM/BBM。发布由独立受控流程执行。
- 不用相似度、标题、部门名称或交接动词确认流程、对象同一性、责任、跨部门承接或系统选型。未知必填事实在草稿及 `pending_issues[]` 中明确待确认。
- 业务依据为用户指定的外部原始材料、实际业务说明和明确确认；`docs/` 历史材料不是治理真源，技术合同仅决定兼容结构。只读取本次范围及必要来源，不固定通读根目录或人员资料。

## 按任务读取

- 生成、核对或修复草稿：读取 [草稿工作流与证据合同](references/review-workflow.md)，使用现有编排器完成可读性检查、抽取、编译、实例校验和派生视图。
- 修改技能规则、抽取器或评测机制：读取 [技能维护与验证](references/maintenance.md)，按改动范围选择回归。纯说明、描述或路由整理不要求先生成演进提案。
- 确需语义召回时：再读取 [向量证据规则](references/vector-evidence-rules.md)；语义检索为可选能力。

已有授权包含本地草稿生成、实例检查及相关失败修复，不需要在每个中间文件生成后请求确认。只暂停依赖来源或业务事实缺口的部分，不以技术测试代替业务确认。转录导入复用现有 `scripts/ocr-source.mjs` 的记录格式，不自动安装识别工具或向外部服务发送资料。

## 交付

报告草稿、问题视图和 `source_coverage.json` 路径、待确认数量及实际发生的阻断、降级或未覆盖风险。`partial` 或生成命令退出码为 0 都不表示来源齐全或完整成果通过，来源缺口保留在草稿及 `pending_issues[]`。实例须通过 `validate-document-structured-output-v2.mjs --input <v2-json>`，派生视图与实例保持一致；未修改生成逻辑时不重复运行技能开发测试套件。
