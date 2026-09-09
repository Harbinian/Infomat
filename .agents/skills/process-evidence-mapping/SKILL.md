---
name: process-evidence-mapping
description: 从可直接读取的制度、表单和流程资料生成 Infomat document-structured-output-v2 证据草稿及待确认问题，不用于正式发布。
---

# Process Evidence Mapping

本技能梳理业务流程、业务行为及证据链。唯一机器主产物为
`artifacts/process-input-baseline-review/<run-id>/document-structured-output-v2.json`，
字段合同以 `docs/contracts/document-structured-output.schema.json` 为准。
兼容性中间 JSON 和 Markdown 视图不能替代该合同或流程输入基线。

## 必要边界

- 只处理可直接读取文字、表格或节点文本的来源。图片、扫描件、无文本 PDF 或提取失败必须登记 `blocked_unreadable` 或 `failed` 并阻断该批次；不得静默跳过、识别图像文字、自动抄录或猜测画面。取得可读原件或人工确认文字版后才能重跑。
- 抽取结果保持 `evidence_status=pending_review`、`verification_status=unverified`、`allowed_downstream_use=review_only`。不得自动生成 `verified` 证据或 `confirmed` 工作角色。
- 不写数据库，不写回 `docs/norms/`，不分配正式角色编码，不生成正式 `structure_block_projection`，不自动发布 DCM/BBM。发布由独立受控流程执行。
- 不用相似度、标题、部门名称或交接动词确认流程、对象同一性、责任、跨部门承接或系统选型。未知必填事实在草稿及 `pending_issues[]` 中明确待确认。
- 只读取用户指定范围及其必要真源。部门口径不清时查组织真源；不要固定通读根目录文档或人员参考资料。

## 按任务读取

- 生成、核对或修复草稿：读取 [草稿工作流与证据合同](references/review-workflow.md)，使用现有编排器完成可读性检查、抽取、编译、实例校验和派生视图。
- 修改技能规则、抽取器或评测机制：读取 [技能维护与验证](references/maintenance.md)，按改动范围选择回归。纯说明、描述或路由整理不要求先生成演进提案。
- 确需语义召回时：再读取 [向量证据规则](references/vector-evidence-rules.md)；语义检索为可选能力。

已有授权包含本地草稿生成、实例检查及相关失败修复，不需要在每个中间文件生成后请求确认。遇到来源或业务事实缺口时保留明确阻断或待确认，不以技术测试代替业务确认。

## 交付

报告草稿和问题视图路径、待确认数量及实际发生的阻断、降级或未覆盖风险。实例须通过 `validate-document-structured-output-v2.mjs --input <v2-json>`，派生视图与实例保持一致；未修改生成逻辑时不重复运行技能开发测试套件。
