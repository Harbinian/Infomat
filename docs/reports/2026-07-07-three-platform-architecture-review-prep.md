# 企业数字化治理平台软件架构评审回复稿 V1.0

> 日期：2026-07-07
> 状态：已按 ChatGPT 建议原文完成逐条审核
> 范围：MDM 平台 3000、文档结构化输出辅助服务 3001、PMO 周会行动项服务 3002
> 本稿性质：给外部架构建议的事实核验与回复稿，不替代任何真源、合同、ADR 或目录级规则。

## 1. 评审结论

ChatGPT 的总体判断有价值：三个工具确实正在从“小工具”走向长期维护的平台能力，必须用软件工程视角审查边界、数据、权限、审计、测试和文档。

但需要校正一个关键前提：当前仓库的正式阶段不是“把三个系统合并成一个统一运行平台”，而是“流程地图与数据地图的梳理与沉淀”。MDM 开发暂时搁置，文档结构化输出和 PMO 周会服务也都被限定为辅助工具或运行台账。因此，本轮正确动作不是立即统一数据库、统一运行时或重构成平台内核，而是继续守住三个原则：

1. **模块分责**：3000、3001、3002 是职责不同的 Module，不是互相直连写库的子系统。
2. **接口优先**：跨模块关系先用结构化合同、只读快照、人工导入和运行台账表达。
3. **真源不反写**：辅助工具和运行台账不能绕过人工确认、权限、证据和发布卡口。

## 2. 建议逐条审核表

| ChatGPT 建议 | 本库状态 | 结论 | 证据 | 回复要点 |
|---|---|---|---|---|
| 不再按功能验收，而做软件工程级总评审 | 需要做，且本次已开始形成正式回复稿 | 采纳 | `AGENTS.md:5`、`CODEX.md:7`、`REPOSITORY_BOUNDARY.md`、`MAINLINE_MAP.md`、`docs/adr/` | 这个建议正确。后续应从报告沉淀到 ADR、合同和验证命令，而不是停留在聊天结论。 |
| 三个工具正在形成企业数字化治理平台 | 长期方向可参考，但当前不能直接视为一个统一运行平台 | 部分采纳 | `AGENTS.md:5`、`CODEX.md:7`、`apps/README.md:14-21` | 可以作为目标架构语言，但实施上仍应保持 3000/3001/3002 分责，避免过早合并运行时和数据库。 |
| 如果三者独立开发，会重复用户、权限、文件、字典、审批、审计 | 风险成立，但已有边界控制 | 采纳风险判断 | `apps/README.md:20-21`、`MAINLINE_MAP.md:64,126,151` | 重复建设风险真实存在；当前用合同、只读消费、运行台账和 MDM 权限边界控制，不应靠“先合并”解决。 |
| MDM 不应一期做清洗、多源融合、自动合并、订阅、质量评分、血缘等重能力 | 与当前阶段一致 | 采纳 | `AGENTS.md:5-8`、`MAINLINE_MAP.md:126` | 现在应避免把 MDM 推成全量主数据平台。先守住流程治理承接、字段身份、证据、权限和编号。 |
| MDM 一期只承担字段映射版本管理、格式校验、接口日志、异常拦截、对账报告 | 与当前实际不完全一致 | 部分采纳 | `apps/mdm-platform/README.md:187,202`、`docs/contracts/document-structured-output.schema.json:19` | 这些能力可作为 MDM 数据治理方向的一部分，但当前 MDM 已承接文档结构化输出、流程治理问题池、角色工作台和 MySQL 身份/RBAC，不能把范围简单回退到这五项。 |
| MDM 使用 `mdm_object` / `mdm_attribute_definition` / `mdm_attribute_value` 等通用模型，避免按对象建独立表 | 可作为未来目标模型候选，但不能直接套用 | 暂缓 | `MAINLINE_MAP.md:110-126`、`docs/superpowers/specs/2026-06-03-mdm-phase-1-long-term-blueprint.md` | 当前要先稳定字段身份、流程/制度/表单结构和证据链。是否采用通用对象模型，需要单独 Tech Spec/ADR，并兼容已有 MySQL schema。 |
| PMO 真源必须保持 Markdown -> Parser -> JSON/Excel/H5，不允许派生物反写 Markdown | 已是当前主线 | 已完成且必须坚持 | `MAINLINE_MAP.md:137-151`、`pmo/README.md`、`apps/weekly-action-service/README.md:20-21` | 这个判断完全正确。3002 只能保存周会运行台账，不能反写 PMO Markdown 真源、`tasks.json` 或 MDM 数据库。 |
| PMO 应建立 Project/WBS/Task/Milestone/Deliverable/Risk/Issue/Change/Acceptance 关系模型 | 方向正确，当前分散存在于 PMO 真源、Gantt、3002 设计和交付物中 | 采纳为后续建模方向 | `apps/weekly-action-service/README.md:15,45,49`、`pmo/`、`pmo/gantt-react/` | 需要先做“PMO 领域模型盘点表”，把运行台账和计划真源分开，再决定是否进入数据库模型。 |
| 文档结构化输出不只是 Word -> AI 总结 -> Markdown，而是企业知识编译器 | 与当前 3001/3000 合同方向一致 | 采纳，但要受控 | `apps/structured-output-service/README.md:7,26-29,74`、`docs/contracts/document-structured-output.schema.json:19` | 当前 3001 已按 `document-structured-output-v2` 产出结构化对象，3000 再按 MDM 权限和证据卡口承接。不能让模型输出自动成为正式真源。 |
| 三个平台需要统一身份体系 | 长期方向正确，当前已有 MDM 身份/RBAC 和 3002 人员快照 | 分阶段采纳 | `AGENTS.md:66-67`、`apps/weekly-action-service/README.md:19-22` | MDM 可作为长期身份/RBAC中心候选；3002 当前只读人员快照，3001 暂时不应引入正式登录和写权限。 |
| 三个平台需要统一审计体系 | 长期方向正确，当前粒度不同 | 分阶段采纳 | `apps/weekly-action-service/README.md:15`、`apps/mdm-platform/README.md:187,202` | MDM 写入和 3002 v2 运行台账需要审计；3001 因无状态、不保存用户原文，当前更重要的是避免持久化风险。 |
| 建立元数据中心，统一物料、工装、项目、流程、制度等编号 | 方向正确，但不能先建中心再反推业务 | 暂缓 | `docs/contracts/document-structured-output.schema.json`、`MAINLINE_MAP.md:93-126`、`docs/organization/组织架构和部门职责.md` | 当前已有流程、制度、表单、字段、部门等局部编号和真源。统一元数据中心应在流程地图/数据地图稳定后由 ADR 固化。 |
| 输出《企业数字化治理平台软件架构评审报告 V1.0》 | 值得做 | 采纳为下一步交付物 | `docs/reports/`、`docs/adr/` | 本稿是回复稿。正式架构评审报告应放在 `docs/reports/`，稳定结论再提升到 `docs/architecture/` 或 ADR。 |

## 3. 可直接回复 ChatGPT 的文本

你的建议我按“外部架构评审意见”接收了。总体判断是：软件工程级总评审这个方向正确，但需要结合本库事实校正实施顺序。

当前三个工具确实有走向企业数字化治理平台的趋势，但本库现在的正式阶段是“流程地图与数据地图的梳理与沉淀”，不是把 3000、3001、3002 立即合并成统一运行平台。MDM 开发也处于暂缓状态。因此我们不能直接把三个工具统一数据库、统一运行时或统一写权限，而要先稳住模块边界和接口合同。

已完成或已有证据的部分：

1. 三平台边界已经明确。3001 是本地无状态的文档结构化输出辅助服务，只导出 `document-structured-output-v2` JSON，不保存原文、不写数据库、不写回 `docs/norms/` 或花名册。3000 MDM 只读取用户选择的结构化 JSON 文件，并继续执行 MDM 自己的权限、部门范围、编号、证据核验、审核和发布卡口。3002 是 PMO 周会运行台账服务，不写回 PMO Markdown 真源、`tasks.json` 或 MDM 数据库。

2. 数据合同已经有第一条稳定主线。文档结构化输出合同是 `docs/contracts/document-structured-output.schema.json`，固定版本为 `document-structured-output-v2`。3001 按它导出，3000 按它导入，回归命令是 `npm run test:document-structured-output-schema`。

3. PMO 真源链路的判断完全正确。PMO 应坚持 Markdown 真源 -> Parser -> JSON/Excel/H5/展示层，不允许 Excel、H5 或 3002 运行台账反向污染 PMO 正本。

4. “文档结构化引擎是企业知识编译器”这个判断也正确，但必须加一个约束：模型整理结果不是正式真源。正确路径是 3001 生成结构化 JSON，用户检查后导入 3000，3000 再走权限、证据、审核和发布卡口。

需要暂缓或修正的部分：

1. 统一身份、统一审计、元数据中心是长期方向，但不应立刻通过“合并三个系统”实现。当前更稳的路径是：MDM 保持身份/RBAC 能力，3002 先只读人员快照和运行台账，3001 继续保持无状态辅助工具。等流程地图、数据地图和 PMO 管理动作稳定后，再把稳定接口提升成公共能力。

2. MDM 的通用对象模型建议有参考价值，但不能直接把现有 MySQL schema 改成 `mdm_object` / `mdm_attribute_value` 这种通用模型。当前要先稳定字段身份、流程/制度/表单结构、证据链和发布卡口。是否采用通用主数据对象模型，需要单独 Tech Spec 和 ADR。

3. MDM 一期边界不能简单回退成“字段映射、格式校验、接口日志、异常拦截、对账报告”五项。当前 MDM 已经承接流程治理问题池、文档结构化输出导入、角色工作台和 MySQL 身份/RBAC，后续要做的是收敛和分层，而不是按通用 MDM 教科书重开。

4. 3002 暂不直接接 MySQL。PMO 周会管理模式还在试运行，先稳定责任拆分、证据、延期、核验、复盘包和运行导出。v2 第一版继续使用 `artifacts/weekly-actions/` 运行文件，等管理模式稳定后再评估独立 PMO 数据库。

我们共同吸收的软件工程思维是：先定义 Module，再固定 Interface；先用合同和测试守住边界，再做平台化；运行台账和正式真源必须分开；本地辅助工具默认不能拥有正式写权限；所有架构约束都要能落到文档入口和验证命令上。

所以，你提出的“架构盘点表 + 技术债清单 + V1.0 目标架构”我采纳，但建议分两层做：先在 `docs/reports/` 输出评审报告，把当前事实、风险、债务和目标架构写清；只有稳定结论再提升为 `docs/architecture/` 或 ADR。这样既吸收平台化思维，也不会在当前阶段过早合并系统、制造新的耦合。

## 4. 我们要一起学习的工程思维

### 4.1 Module 先于平台口号

平台化不是把所有东西放进一个库、一个数据库或一个服务。真正的平台化，是每个模块有清楚职责、清楚接口、清楚失败边界。当前最重要的 Module 边界是：

- 3001：结构化输出辅助工具，Interface 是 `document-structured-output-v2` JSON。
- 3000：MDM 承接平台，Interface 是 MDM 权限、编号、证据核验、审核和发布卡口。
- 3002：PMO 周会运行台账，Interface 是周会事项、证据、责任和复盘导出。

### 4.2 Interface 是可测试表面

只要一个边界重要，就应能被测试守住。当前已经有：

- `npm run test:document-structured-output-schema` 守住 3001/3000 的结构化合同。
- `npm --prefix apps/structured-output-service test` 守住 3001 无状态和导入导出边界。
- `npm --prefix apps/weekly-action-service test` 守住 3002 服务端本机台账边界。
- `npm run test:infomat-services-config` 守住 3000/3001/3002 固定启动合同。

### 4.3 真源和运行材料不能混

PMO Markdown、组织架构、花名册、流程输入基线和 MDM 数据库分别有不同治理含义。运行台账、临时导出、AI 结构化结果、页面展示数据都不能自动反写正式真源。

### 4.4 先收敛，再抽象

统一身份、统一审计、元数据中心都值得做，但它们应该从已经稳定的业务接口中抽取，而不是先做一个“公共中心”再让三个工具迁就它。否则平台化会变成新的技术债。

## 5. 本轮证据与验证

本轮没有修改应用代码、接口、数据库结构或启动命令，只把此前准备稿更新为正式回复稿。

本轮之前为保证评审证据可运行，已修复并验证过 3002 人员快照测试链路：

- `scripts/generate-weekly-action-personnel-snapshot.mjs`
- `scripts/test-weekly-action-personnel-snapshot.mjs`

已通过的验证：

```powershell
npm run test:document-structured-output-schema
npm --prefix apps/structured-output-service test
npm --prefix apps/weekly-action-service test
npm run test:weekly-action-personnel
npm run test:infomat-services-config
```

文档同步判断：

- 本轮正式修改的是 `docs/reports/2026-07-07-three-platform-architecture-review-prep.md`。
- 没有改变代码、脚本命令、接口合同、数据库结构、启动方式或目录级规则。
- 因此无需同步修改 `README`、`AGENTS.md`、`CODEX.md`、`docs/glossary.md` 或 ADR。

