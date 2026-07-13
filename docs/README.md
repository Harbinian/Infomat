# docs 资料目录说明

> 状态：导航说明  
> 生效日期：2026-06-10  
> 依据：`REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md`、`MAINLINE_MAP.md`

`docs/` 是信息化资料库，承载组织架构、流程地图、数据地图、主数据治理资料、审计报告、历史方案和参考材料。当前阶段分析对象是流程，不是具体应用系统；涉及流程输入基线时，应优先读取 `docs/organization/` 和 `docs/norms/`。

## 1. 当前入口

| 资料类型 | 当前入口 | 说明 |
|---|---|---|
| 部门到域映射 | `docs/organization/组织架构和部门职责.md` | 脚本和页面中的部门域口径必须与这里一致。 |
| 流程输入基线 | `docs/norms/{部门}部门-能力-流程-系统映射关系.md` | PMO 驾驶舱和 MDM 流程治理快照都不反向作为维护入口；问题卡证据另定位制度/表单源文件。 |
| 跨部门完整性报告 | `docs/norms/流程治理/跨部门完整性检查报告.md` | 当前作为跨部门风险校验输入之一，后续仍需减少从报告反推数据的依赖。 |
| 流程展示快照 | `docs/company-sankey-data.json` | 由 `scripts/parse-sankey-data.mjs` 生成，供 PMO 驾驶舱和后续平台承接使用，不手工维护。 |
| 文档结构化输出 schema | `docs/contracts/document-structured-output.schema.json` | 统一 MDM 文档结构化页面、MySQL 承接表、待确认问题和结构块投影的数据模型，不替代流程输入基线。 |
| 术语表 | `docs/glossary.md` | 术语查询脚本读取这里，新术语仍应回写到本文件。 |
| 上下文管理 | `docs/architecture/context-management.md` | 说明项目资料上下文分层、读取顺序和历史材料使用规则。 |

## 2. 子目录分工

| 路径 | 职责 | 修改规则 |
|---|---|---|
| `docs/norms/` | 制度/表单源文件材料、流程输入基线和部门桑基图资产 | 改流程输入基线后运行 `node scripts/parse-sankey-data.mjs`。 |
| `docs/organization/` | 组织架构和部门职责真源 | 部门或域发生变化时先改这里，再同步脚本和页面口径。 |
| `docs/reports/` | 审计、测试、稳定化和阶段总结报告 | 新增仓库审查或整改报告放这里，不散放根目录。 |
| `docs/architecture/` | 长期架构和上下文说明 | 解释结构、模块关系和执行规则，不替代 ADR。 |
| `docs/adr/` | 长期架构决策记录 | 只记录已接受的决策，不写临时计划。 |
| `docs/contracts/` | 当前主线契约文件 | 用于校验主线关系、文档结构化输出模型和脚本合同，不替代流程输入基线。 |
| `docs/integration/` | 集成、主数据和系统协同方案 | 可沉淀方案，不作为流程输入基线。 |
| `docs/plans/` | 计划类资料 | 作为方案或计划沉淀，不替代 PMO 计划真源。 |
| `docs/samples/` | 最小样例 | 只保留能复现格式或契约的精选样例。 |
| `docs/superpowers/` | 历史设计、计划和协作记录 | 仅用于追溯，和当前规则冲突时以根目录边界文件为准。 |
| `docs/archives/` | 历史归档预留 | 当前为空，后续迁移前先写提案。 |
| `docs/外部参考/` | 外部参考资料 | 作为参考材料保留，使用前需确认与当前真源关系。 |
| `docs/U8SoftHelp/` | U8 帮助文件集合 | 体积较大，迁出或 LFS 化前需先写迁移提案。 |
| `docs/training/` | 培训材料 | 作为资料留存，不作为流程或 MDM 真源。 |
| `docs/Demo/` | 演示材料 | 作为演示留存，不作为主线入口。 |
| `docs/screenshots/` | 精选截图资料 | 新截图默认不放这里，除非已确认为长期样例。 |
| `docs/meetings/` | 会议资料 | 保留会议记录或整理材料，不写入当前执行规则。 |
| `docs/HardwareResearch/` | 硬件相关调研资料 | 作为专项资料留存，不参与流程治理主线。 |

## 3. 根目录文件状态

`docs/` 根目录仍保留若干历史散放文件。当前先登记口径，不在本轮直接迁移：

| 文件 | 当前口径 |
|---|---|
| `company-sankey-data.json` | 生成快照，禁止手工维护。 |
| `glossary.md` | 当前术语表入口。 |
| `MDM平台使用说明.md`、`MDM平台使用说明.html` | 平台使用说明，后续可评估是否归入 MDM 文档目录。 |
| `generate-manual-html.js` | 使用说明 HTML 生成脚本，后续可评估是否归入 MDM 或 docs 局部工具。 |
| `主数据编码规范.md`、`U8编码规则汇总.md`、`工艺人员编码说明.md`、`EBOM_PBOM_MBOM_主数据规范总结.md` | 主数据和编码参考资料，后续迁移前需确认引用关系。 |
| `昌兴复材-沈飞民机供应链信息化协同平台管理制度.md`、`MDM平台拓展计划.md` | 方案或制度资料，后续迁移前需确认是否仍为当前有效口径。 |

## 4. 修改自检

修改 `docs/` 前先确认：

1. 改动是否会改变组织真源、流程输入基线或跨部门风险输入。
2. 是否需要运行 `scripts/parse-sankey-data.mjs`。
3. 是否会影响 `pmo/procedure-management/dashboard.html` 或 MDM 流程治理快照。
4. 如果改了代码、脚本、接口、命令或测试口径，是否已同步更新对应文档。
5. 是否把生成物、截图、运行日志或一次性中间文件误放入 `docs/`。

无法判断时，先写入 `docs/reports/` 做审计或迁移提案，不直接移动文件。
