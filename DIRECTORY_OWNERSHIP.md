# Infomat 目录职责与修改规则

> 状态：执行规则  
> 生效日期：2026-06-07  
> 目的：明确每个目录的责任、入口/真源、可修改规则和禁止事项。

## 1. 根目录

| 路径 | 责任 | 可修改规则 | 禁止事项 |
|---|---|---|---|
| `README.md` | 仓库入口说明 | 只放导航、当前基线/真源入口、常用命令入口 | 不写长篇方案，不放生成数据 |
| `AGENTS.md` / `CODEX.md` | Codex 协作规则 | 写跨仓库执行约定、术语约定、阶段边界、文档同步规则和目录级 AGENTS 设置规则 | 不写具体业务交付内容 |
| `MEMORY.md` | 长期项目上下文 | 文件前部维护当前运行基线；历史和长期条目按关键词检索 | 不作为执行规则，不让历史条目覆盖当前运行基线或边界文件 |
| `CONTEXT.md` | 仓库术语和目录规范 | 新增长期有效的仓库域语言 | 不记录临时计划 |
| `REPOSITORY_BOUNDARY.md` | 仓库职责边界 | 定义仓库放什么、不放什么 | 不替代目录级 README |
| `DIRECTORY_OWNERSHIP.md` | 目录责任矩阵 | 定义每个目录怎么改 | 不记录具体迁移日志 |
| `MAINLINE_MAP.md` | 主线数据流关系 | 定义资料、PMO、MDM、脚本的链路 | 不写平台实现细节 |

根目录不应继续新增临时 YAML、截图、压缩包、解包目录或一次性调查文本。历史散放的根目录 PMO YAML 已归档到 `pmo/archive/page-snapshots/2026-06-05-playwright-yaml/`。原根目录 `temp_survey.txt` 已登记后迁入 `docs/HardwareResearch/06B厂房接入民机非密园区网需求调查表_抽取文本.txt`，后续同类基础设施调查材料应直接进入对应资料目录。

目录级 `AGENTS.md` 只放在有独立真源、生成副作用、运行命令、验证口径或禁止事项的关键目录。当前目录级入口为 `apps/mdm-platform/`、`apps/structured-output-service/`、`apps/structure-assistant/`、`apps/weekly-action-service/`、`apps/information-collection-service/`、`pmo/`、`pmo/procedure-management/`、`pmo/gantt-react/`、`pmo/deliverables/`、`docs/norms/`、`docs/Demo/` 和 `scripts/`。纯报告、归档、样例和说明性架构目录默认使用 README。

## 2. 可运行系统

| 路径 | 责任 | 入口/接口 | 可修改规则 | 禁止事项 |
|---|---|---|---|---|
| `apps/` | 可运行应用集合 | 子目录 README | 新应用必须有独立 README、运行命令和数据边界 | 不放业务资料原件 |
| `apps/mdm-platform/` | MDM 平台源码 | `package.json`、`server/`、`public/`、`scripts/` | 平台功能、平台测试、平台维护脚本在此修改 | 不放 PMO 甘特图、流程制度原文、历史方案 |
| `apps/structured-output-service/` | 局域网单流程治理编制工具 | `package.json`、`server.js`、`public/`、`scripts/` | 默认监听`0.0.0.0:3001`供公司局域网用户直接访问；按 `docs/contracts/process-governance-v7.schema.json` 导出单流程未审核JSON并兼容导入v1至v7及历史多候选结构化JSON；页面内编辑会话区分未应用修改与未下载修改，并在切换、下载和替换前保护用户输入；可只读读取流程映射、花名册和 `docs/work-role-data.json` 做候选提示 | 不保存用户内容和图坐标，不写回 `docs/norms/`、花名册或工作角色真源，不调用3000，不依赖DeepSeek、MDM-AI助手或认证网关，不替代受控发布流程 |
| `apps/structure-assistant/` | MDM-AI助手及受限DSH治理入口 | `package.json`、`server.js`、`public/`、`lib/`、`dsh-plugin/`、`config/`、`scripts/` | 端口3003提供登录和运行控制；端口3004认证后代理每个登录会话的隔离DSH实例、助手接口和3001结构化工具；只在DSH子进程内存中保存当前治理工作区内容 | 不直接暴露DSH子进程，不开放编码Agent、命令、任意文件访问或模型配置；不停止、重绑或代管3001；不把业务内容写入文件、数据库或浏览器持久化空间；不判断业务事实，不写入3000或`docs/norms/`，不提交密钥 |
| `apps/weekly-action-service/` | PMO 周会行动项服务 | `package.json`、`server.js`、`public/`、`scripts/` | 提供 3002 周会行动项登记、跟踪、关闭证据和延期原因维护；默认写入 `artifacts/weekly-actions/` 运行台账 | 不写回 PMO Markdown 真源、`tasks.json` 或 MDM 数据库；不把浏览器本地保存作为台账 |
| `apps/information-collection-service/` | 内部信息表收集服务 | `package.json`、`server/`、`public/`、`scripts/`、`docs/` | 4000 管理端设计并发布收集任务，4001 填报端保存本人草稿和答卷；只读复用 `person`、`user_accounts`、`departments`，业务数据写入 `collection_*` 表，附件写入仓库外受控目录 | 不修改 MDM 身份、角色或治理业务表；不自动继承 3000 权限；不向浏览器持久化答案或附件 |
| `apps/mdm-platform/server/` | MDM 后端实现 | Express 路由、当前MySQL运行schema与历史/测试SQLite兼容实现 | 修改时同步平台测试 | 不直接依赖 PMO 页面内嵌数据 |
| `apps/mdm-platform/public/` | MDM 前端 | 单文件前端和静态资源 | 仅放平台运行所需前端资源 | 不放 PMO 驾驶舱截图 |
| `apps/mdm-platform/scripts/` | 平台内脚本和测试 | 平台数据库、平台路由 | 脚本应说明是否写数据库，测试应使用隔离库 | 不放仓库级 parser |
| `apps/mdm-platform/data/` | 历史和测试用本地数据目录 | 历史/测试SQLite文件 | 只用于受控兼容验证或隔离测试，不作为正式运行入口 | 不作为仓库真源，不提交数据库，不替代当前MySQL运行配置 |

代码、接口、数据库结构、前端行为、启动命令或测试命令变化时，必须同步更新本应用 README、目录 `AGENTS.md`、使用手册或对应测试说明；无需更新时，在交付说明中写明原因。

## 3. 信息化资料

| 路径 | 责任 | 入口/接口 | 可修改规则 | 禁止事项 |
|---|---|---|---|---|
| `docs/` | 资料、说明、方案沉淀 | 子目录分工 | 文档按资产类型进入子目录 | 不放本地生成物 |
| `docs/norms/` | 流程输入基线、制度/表单源文件材料、部门桑基图资产 | 部门映射 Markdown、制度/表单源文件 | 新增或修改流程输入基线后运行流程地图 parser；工作角色只写 confirmed 绑定并同步维护受控证据表 | 不放候选工作角色绑定、临时报告、截图、运行日志 |
| `docs/organization/` | 正式切换前的组织架构、部门职责、正式工作角色和项目治理角色映射真源，以及人员参考资料 | `组织架构和部门职责.md`、`工作角色目录与岗位映射.md`、`信息化项目人员角色映射.md`；`花名册.md` 仅为参考 | 切换前，部门到域映射变化必须先改这里，工作角色由行政人事部维护并使用花名册岗位作参考核验；3000 行政人事功能完成对应首版发布并正式切换后，组织、员工主数据和正式工作角色以 3000 发布版本为唯一正式真源，本目录对应文件改为受控只读导出 | 不在页面、脚本或运行台账里另造组织、工作角色或项目治理角色口径；不得把花名册或其他参考资料自动认定为员工主数据 |
| `docs/contracts/` | 自动化校验规则 | 规则说明、JSON规则文件 | 可修改校验规则和执行约定 | 不写业务流程正文，不替代流程输入基线或组织真源 |
| `docs/integration/` | 集成和主数据治理方案 | 方案文档 | 可沉淀接口、主数据、系统协同方案 | 不作为当前流程输入基线 |
| `docs/samples/` | 最小样例 | 样例 README 或文件名 | 只保留可复现、可说明格式的样例 | 不堆放完整生成输出 |
| `docs/reports/` | 审计、测试、稳定化报告 | 报告日期和主题 | 新增仓库审计、稳定性检查、阶段总结 | 不放当前执行基线或真源 |
| `docs/architecture/` | 架构说明 | 架构主题文档 | 用于说明长期结构、模块关系、职责规则 | 不替代 ADR |
| `docs/adr/` | 架构决策记录 | ADR 编号 | 记录已经接受的长期决策 | 不写普通会议纪要 |
| `docs/superpowers/` | 历史设计和计划 | 历史计划、设计文档 | 只用于追溯，旧路径按当前结构解释 | 不作为当前执行真源 |
| `docs/archives/` | 历史归档 | 归档索引 | 后续迁移旧方案或废弃材料 | 不放仍在执行的基线或真源 |

## 4. PMO / 展示工具

| 路径 | 责任 | 入口/接口 | 可修改规则 | 禁止事项 |
|---|---|---|---|---|
| `pmo/` | 项目管理工作室 | `pmo/README.md` | PMO 计划、甘特图、流程地图驾驶舱放在此处 | 不放 MDM 后端代码 |
| `pmo/procedure-management/` | 流程地图驾驶舱 | `dashboard.html` 内嵌 `#sankey-data` | 页面展示和截图验证在此处 | 不手工复制第二份流程数据 |
| `pmo/gantt-react/` | React 甘特图 / PMO 看板 | `public/tasks.json`、`src/` | 前端交互、看板展示、PMO 插件在此处 | 不放制度或流程输入基线 |
| `pmo/deliverables/` | PMO 交付物 | `README.md`、`AGENTS.md`、DLV 文档与表格 | 交付物按编号维护；状态、版本和 PMO 真源影响需同步 | 构建目录、临时导出和未脱敏附件不应长期提交 |
| `pmo/scripts/` | PMO 局部测试脚本 | PMO 页面和插件 | 只放服务 PMO 应用的 smoke 脚本 | 不放仓库级流程 parser |

## 5. 仓库级脚本

| 路径 | 责任 | 输入 | 输出 | 修改规则 |
|---|---|---|---|---|
| `scripts/` | 跨 app / 跨资料的仓库级自动化 | 由脚本和 `scripts/README.md` 声明 | 由脚本和 `scripts/README.md` 声明 | 修改前读取 `scripts/AGENTS.md`; 脚本必须说明输入、输出、是否写文件、是否改数据库 |
| `scripts/parse-sankey-data.mjs` | 流程地图解析与注入 | `docs/norms/`、`docs/organization/`、`docs/work-role-data.json` | `docs/company-sankey-data.json`、PMO 驾驶舱内嵌数据 | 修改后必须验证 PMO 驾驶舱数据；只发布 confirmed 工作角色绑定 |
| `scripts/check-dashboard-data.mjs` | 驾驶舱数据检查 | PMO 驾驶舱 / JSON | 检查输出 | 只做校验，不改流程输入基线或组织真源 |
| `scripts/glossary.mjs` | 术语表查询 | `docs/glossary.md` | 查询输出 | 新术语仍应写入术语表 |

后续轻量收口时，可在 `scripts/` 下逐步新增 `process-governance/`、`mdm-maintenance/`、`repo-audit/`，但第一轮不移动现有脚本。

## 6. 生成物、本地状态与历史资料

| 路径 | 当前状态 | 规则 |
|---|---|---|
| `artifacts/` | 生成物目录 | 默认不提交 |
| `output/` | 历史渲染输出 | 后续迁移到 `artifacts/` 或保留为样例前先审计 |
| `_tmp/` | PPTX 解包和临时脚本 | 不应作为仓库真源 |
| `snapshots/` | norms 快照 | 需确认是否作为历史快照保留；若保留，应补 README |
| `ai_materials/` | AI 处理输入材料 | 需确认是否为长期资料源；若是，应说明与 `docs/norms/` 的关系 |
| `.agents/` | Codex 可用的项目技能和提示材料 | 可保留，但不放生成物 |
| `.superpowers/` | Superpowers 工作输出 | 当前含截图等生成物，后续应迁移或忽略 |
| `node_modules/` | 本地依赖 | 不提交 |
| `test-results/` | 测试输出 | 不提交 |

## 7. 修改前自检

每次任务开始前先回答：

1. 这次改的是资料、应用、PMO 展示、脚本、AI 工作区，还是历史归档？
2. 这次改动是否会改变任何输入基线或真源？
3. 这次改动是否会写数据库、生成 HTML、覆盖 JSON 或注入页面？
4. 是否需要运行对应 parser、smoke 或稳定性检查？
5. 如果改了代码、脚本、接口或命令，是否已同步更新文档？
6. 目标目录是否已有目录级 `AGENTS.md`; 若没有,README 是否足以说明本次修改边界？
7. 是否把生成物误放进了可提交目录？

无法回答时，先做审计，不做迁移。
