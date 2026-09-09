# 技能维护与验证

仅修改技能、抽取器、编排或评测机制时读取本说明。用户明确要求改进技能即授权相应本地修改；评测不授权修改业务真源或正式发布。

## 演进提案的适用条件

调整候选抽取、问题解释或证据规则，并有真实评测批次时，先用既有案例形成可审查提案：

```powershell
node .agents/skills/process-evidence-mapping/scripts/generate-evolution-proposal.mjs `
  --cases .agents/skills/process-evidence-mapping/references/evolution-cases.jsonl `
  --review-run artifacts/process-input-baseline-review/<run-id> `
  --out artifacts/process-evolution/<evolution-run-id>
```

提案为 `artifacts/process-evolution/<run-id>/evolution-proposal.md`，只评测技能规则、待确认解释和测试缺口，不自动修改流程输入基线、PMO、MDM 或技能。不得编造案例或批次。

描述、路由、排版、同义去重和验证触发条件调整不要求该前置。涉及抽取行为但缺少真实评测输入时，可完成已授权的隔离修复，并明确尚未验证实际资料上的效果。

## 按影响面验证

| 修改内容 | 对应入口 |
|---|---|
| 技能入口、参考路由和保留边界 | 技能格式校验；`npm run test:process-evidence-skill` |
| 演进提案或案例解释逻辑 | `npm run test:process-evidence-evolution` |
| 来源读取、抽取、编译、问题或视图流程 | `npm run test:process-input-baseline-review-workflow` |
| 标准合同或结构校验 | `npm run test:document-structured-output-schema` |
| 切块、向量或召回机制 | `node .agents/skills/process-evidence-mapping/scripts/test-vector-pipeline.mjs` |

跨机制修改覆盖相关检查，已通过且未受新改动影响的部分不重复执行。文档断言仅证明边界和路由存在；抽取或编译行为需用实例、反例及输出结果验证，不能靠固定标题、段落标签或词句证明。

交付时区分本地静态检查、隔离工作流和真实资料评测。测试通过不代表业务已确认或已发布。
