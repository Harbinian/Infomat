# 结构版本与兼容

V9 是候选编制方向，不代表目标 3000、3001 实例已更新或允许接收。开始前取得本轮目标版本、对应技术结构与可用模板；旧 V7/V8 文件先按原版本读取和校验，保留原件、稳定标识、字段、数组顺序及迁移来源。业务事实仍来自指定材料和明确确认。

- 技术结构按文件的 `schema_version` 对应到本机 `docs/contracts/process-governance-v7.schema.json`、`process-governance-v8.schema.json` 或 `process-governance-v9.schema.json`；这些路径只作为技术兼容输入，不提供业务权威。共享语义入口为 `scripts/process-governance/v7-validator.js`。结构或配套模块缺失时，说明缺项，不猜测新字段。
- `scripts/validate-process-v8.mjs` 保留兼容名称。它从本机结构文件计算各版本 SHA-256，文档不固定摘要。使用 `--expect-digest` 时与本轮明确目标的同版本摘要比对；不把本机摘要当作目标运行实例的摘要。
- `--emit-template` 输出本机应用模块返回的空白模板，报告其实际 `schema_version` 和对应摘要。输出可能是 V8 或 V9；空白模板不保证业务必填内容通过。版本与本轮目标不一致时，先取得配套模板，不只修改版本号。
- `--promote` 仅把 V7 版本标识改为 V8，保留 `migration.source_schema_version`，不是 V9 转换器，也不证明导入迁移完成。
- `v8-structure-rules.md` 和 `assets/minimal-v8-example.json` 仅供 V8 兼容参考；示例内容虚构，不作 V9 模板或业务依据。

切换结构时另存转换稿，比较新增字段、约束及目标实际接收能力，明确不能自动迁移的内容；不得静默删字段、清空迁移归档或输出有损降级文件。没有完整配套规则时只暂停依赖该版本的 JSON 改版，其他已授权工作继续。离线检查不代替目标实例验证或业务核对。
