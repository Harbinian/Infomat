# Infomat 目录职责与修改规则

Git 分发保留源码、配置示例、运行维护入口、有效契约、技能依赖及必要生成输入。测试脚本与夹具、辅助说明和历史副本按 `.gitignore` 仅留本机，取消跟踪不删除本地文件。公开 `package.json` 不再列出这些测试命令；本机原命令清单位于被忽略的 `.local-tests/commands.json`，执行前须结合本机已有工具核对。


> 状态：目录维护规则
> 目的：明确每个目录的责任、维护入口、可修改规则和禁止事项。

## 1. 根目录

业务真源及当前工作主线按根 [AGENTS.md](AGENTS.md)。以下表格定位目录责任和技术维护入口，不根据旧文件确定业务、任命或审批规则。

| 路径 | 责任 | 可修改规则 | 禁止事项 |
|---|---|---|---|
| `README.md` | 仓库入口说明 | 只放导航、当前基线/真源入口、常用命令入口 | 不写长篇方案，不放生成数据 |
| `AGENTS.md` | Codex 自动加载根 Interface | 只写当前阶段、全仓硬规则、任务路由和状态表述底线 | 不写应用详细规格、端口配置、静态资源路径或完整目录清单 |
| `CODEX.md` | 仓库变更任务的按需 Implementation | 写基线检查、脏工作区保护、实施、迁移、文档同步、验证和交付方法 | 不作为普通只读问答的强制前置，不写应用业务规格或完整目录清单 |
| `MEMORY.md` | 历史项目上下文 | 按关键词追溯；内容更新须有明确授权 | 旧“当前运行基线”不代表当前状态，不覆盖当前规则、实现及实时证据 |
| `CONTEXT.md` | 仓库术语和目录规范 | 新增长期有效的仓库域语言 | 不记录临时计划 |
| `REPOSITORY_BOUNDARY.md` | 仓库职责边界 | 定义仓库放什么、不放什么 | 不替代目录级 README |
| `DIRECTORY_OWNERSHIP.md` | 目录责任矩阵 | 定义每个目录怎么改 | 不记录具体迁移日志 |
| `MAINLINE_MAP.md` | 主线数据流关系 | 定义资料、PMO、MDM、脚本的链路 | 不写平台实现细节 |
| `.codex/config.toml` | 仓库内 Codex 展示与推理偏好 | 只保存非敏感的仓库级偏好，并继承根目录执行规则 | 不保存 Secret、主机连接、个人路径、运行状态或业务事实 |

根目录不新增临时 YAML、截图、压缩包、解包目录或一次性调查文本。历史页面快照按需从 `pmo/archive/page-snapshots/` 查找；基础设施调查资料进入 `docs/HardwareResearch/`。迁移经过保留在历史记录中，不作为当前目录说明的正文。

目录级 `AGENTS.md` 只放在有独立真源、生成副作用、运行命令、验证口径或禁止事项的关键目录。纯报告、归档、样例和说明性架构目录默认使用 README。以下机器可读注册块是全部局部入口的唯一清单；检查脚本、根入口和其他说明文档不得另建清单。

<!-- codex-context-registry:start -->
```text
apps/mdm-platform/AGENTS.md
apps/structured-output-service/AGENTS.md
apps/information-collection-service/AGENTS.md
apps/slack-bot/AGENTS.md
pmo/AGENTS.md
pmo/procedure-management/AGENTS.md
pmo/gantt-react/AGENTS.md
pmo/deliverables/AGENTS.md
pmo/organization-dynamics/AGENTS.md
docs/norms/AGENTS.md
docs/organization/AGENTS.md
docs/contracts/AGENTS.md
docs/Demo/AGENTS.md
scripts/AGENTS.md
```
<!-- codex-context-registry:end -->

## 2. 可运行系统

| 路径 | 责任 | 维护入口 | 可修改规则 | 禁止事项 |
|---|---|---|---|---|
| `apps/` | 可运行应用集合 | 子目录 README | 新应用必须有独立 README、运行命令和数据边界 | 不放业务资料原件 |
| `apps/u8-stock-order-query/` | U8 出入库订单归属与销售质量编号核查服务 | README、`server.mjs`、`public/`、`scripts/`、`compose.yaml` | 固定账套只读查询、销售质量编号唯一性独立页、中文字段说明、北京时间显示；Docker 3088 全 IPv4 监听，独立启动和停止 | 不写 U8 单据，不用管理员账号提供网页查询，不自动回填或修改归属，不操作其他服务 |
| `apps/mdm-platform/` | MDM 平台源码 | `package.json`、`server/`、`public/`、`scripts/` | 平台功能、平台测试、平台维护脚本在此修改 | 不放 PMO 甘特图、流程制度原文、历史方案 |
| `apps/structured-output-service/` | 局域网单流程治理编制工具 | `AGENTS.md`、README、`package.json`、`server.js`、`public/`、`scripts/` | 维护单流程编制、页面输入保护及受支持历史文件兼容；只读目录副本用于录入提示；版本、运行方式和验收门槛由应用入口维护 | 不保存用户内容和图坐标，不写回资料副本，不调用3000或共享数据库，不据目录提示确认组织及责任 |
| `apps/information-collection-service/` | 内部信息表收集服务 | `package.json`、`server/`、`public/`、`scripts/`、`docs/` | 4000 管理端设计并发布收集任务，4001 填报端保存本人草稿和答卷；只读复用 `person`、`user_accounts`、`departments`，业务数据写入 `collection_*` 表，附件写入仓库外受控目录 | 不修改 MDM 身份、角色或治理业务表；不自动继承 3000 权限；不向浏览器持久化答案或附件 |
| `apps/slack-bot/` | Slack 问答机器人（Claude Code CLI 无头模式的 Slack 入口） | `AGENTS.md`、`README.md`、`src/`、`compose.yaml`、`Dockerfile`、`sync.sh` | 只读档读 `repo-sync` 同步出的卷镜像（`:ro`），写入档仅对 `BOT_WRITE_USERS` 开放且直写宿主机仓库；凭据只存 `.env`，不进镜像；权限按提问者判定 | 不把 token 或密钥写入会被提交或被构建的文件；不绕过提问者粒度的权限判定；不让只读档拿到写工具或可写挂载；不把机器人输出当业务结论或治理决定 |
| `apps/mdm-platform/server/` | MDM 后端实现 | Express 路由、当前MySQL运行schema与历史/测试SQLite兼容实现 | 修改时同步平台测试 | 不直接依赖 PMO 页面内嵌数据 |
| `apps/mdm-platform/public/` | MDM 旧前端及共享本地资产 | 既有页面和本地图形资源 | 保留未迁移模块及资源路径兼容 | 不放 PMO 驾驶舱截图 |
| `apps/mdm-platform/frontend/` | MDM React 前端 | React + Vite 源码、独立锁文件及构建配置 | 维护页面及同源访问；旧路径兼容范围按应用入口核对；dist为被忽略的公开构建产物 | 不共用 PMO 业务代码、配置或5173服务，不公开业务材料及服务端源码 |
| `apps/mdm-platform/scripts/` | 平台内脚本和测试 | 平台数据库、平台路由 | 脚本应说明是否写数据库，测试应使用隔离库 | 不放仓库级 parser |
| `apps/mdm-platform/data/` | 历史和测试用本地数据目录 | 历史/测试SQLite文件 | 只用于受控兼容验证或隔离测试，不作为正式运行入口 | 不作为仓库真源，不提交数据库，不替代当前MySQL运行配置 |

行为、接口、结构、命令或维护边界变化时，同步承载该信息的文档；文档仍准确时无需改写。具体选择见根 `AGENTS.md` 和 `CODEX.md`。

## 3. 信息化资料

| 路径 | 责任 | 入口/接口 | 可修改规则 | 禁止事项 |
|---|---|---|---|---|
| `docs/` | 资料、说明、方案沉淀 | 子目录分工 | 文档按资产类型进入子目录 | 不放本地生成物 |
| `docs/norms/` | 历史制度、表单、映射及部门桑基图资产 | 本目录AGENTS及README用于定位旧消费关系 | 仅维护获准的副本或历史兼容；生成命令须显式声明旧输入，不自动同步当前治理 | 不以旧资料决定业务事实、职责或审批，不放临时报告、截图、日志 |
| `docs/organization/` | 组织、人员、角色历史资料和转换副本；不再是真源 | `AGENTS.md`、README及原文件位置保留用于追溯 | 只维护明确授权的记录或副本，人员事实回到用户指定的行政人事发布Excel，任命由有权主体确认 | 不以本目录旧职责、岗位或映射决定当前流程和授权，不自动据此生成或同步3000业务数据 |
| `docs/contracts/` | 自动化结构和校验规则 | `AGENTS.md`、规则说明、JSON规则文件 | 修改前读取本目录 `AGENTS.md`；发布版本变化必须同时处理旧数据兼容和回归 | 不写业务流程正文，不替代流程输入基线或组织真源，不保存 Secret |
| `docs/integration/` | 集成和主数据治理方案 | 方案文档 | 可沉淀接口、主数据、系统协同方案 | 不作为当前流程输入基线 |
| `docs/samples/` | 最小样例 | 样例 README 或文件名 | 只保留可复现、可说明格式的样例 | 不堆放完整生成输出 |
| `docs/reports/` | 审计、测试、稳定化报告 | 报告日期和主题 | 新增仓库审计、稳定性检查、阶段总结 | 不放当前执行基线或真源 |
| `docs/architecture/` | 架构说明 | 架构主题文档 | 用于说明长期结构、模块关系、职责规则 | 不替代 ADR |
| `docs/adr/` | 架构决策记录 | ADR 编号和明确状态 | 记录 `Proposed`、`Accepted` 等需长期追溯的决策；状态变化必须有评审依据 | 不把普通会议纪要或执行计划写成已接受决策 |
| `docs/superpowers/` | 历史设计和计划 | 历史计划、设计文档 | 只用于追溯，旧路径按当前结构解释 | 不作为当前执行真源 |
| `docs/archives/` | 历史归档 | 归档索引 | 后续迁移旧方案或废弃材料 | 不放仍在执行的基线或真源 |

## 4. PMO / 展示工具

| 路径 | 责任 | 入口/接口 | 可修改规则 | 禁止事项 |
|---|---|---|---|---|
| `pmo/` | 项目管理工作室 | `pmo/README.md` | PMO 计划、甘特图、流程地图驾驶舱放在此处 | 不放 MDM 后端代码 |
| `pmo/procedure-management/` | 流程地图驾驶舱 | `dashboard.html` 内嵌 `#sankey-data` | 页面展示和截图验证在此处 | 不手工复制第二份流程数据 |
| `pmo/gantt-react/` | React 甘特图 / PMO 看板 | `public/tasks.json`、`src/` | 前端交互、看板展示、PMO 插件在此处 | 不放制度或流程输入基线 |
| `pmo/deliverables/` | PMO 交付物 | `README.md`、`AGENTS.md`、DLV 文档与表格 | 交付物按编号维护；状态、版本和 PMO 真源影响需同步 | 构建目录、临时导出和未脱敏附件不应长期提交 |
| `pmo/organization-dynamics/` | 组织数字化参与度模型和可视资产 | `AGENTS.md`、`README.md`、模型 Markdown、SVG、HTML、PPTX | 先改模型真源，再同步受影响的可视资产；PNG 写入 `artifacts/` | 不替代组织事实或绩效结论，不提交本地 PNG、缓存和调试输出 |
| `pmo/scripts/` | PMO 局部测试脚本 | PMO 页面和插件 | 只放服务 PMO 应用的 smoke 脚本 | 不放仓库级流程 parser |

## 5. 仓库级脚本

| 路径 | 责任 | 输入 | 输出 | 修改规则 |
|---|---|---|---|---|
| `scripts/` | 跨 app / 跨资料的仓库级自动化 | 由脚本和 `scripts/README.md` 声明 | 由脚本和 `scripts/README.md` 声明 | 修改前读取 `scripts/AGENTS.md`; 脚本必须说明输入、输出、是否写文件、是否改数据库 |
| `scripts/parse-sankey-data.mjs` | 历史流程地图解析与可选注入 | 旧norms/工作角色副本及显式部门域JSON | 必须指定输出；仅指定dashboard才注入 | 使用`--legacy-display`；兼容检查不认定业务事实，不自动同步数据库 |
| `scripts/check-dashboard-data.mjs` | 驾驶舱数据检查 | PMO 驾驶舱 / JSON | 检查输出 | 只做校验，不改流程输入基线或组织真源 |
| `scripts/glossary.mjs` | 术语表查询 | `docs/glossary.md` | 查询输出 | 新术语仍应写入术语表 |

`scripts/` 当前保持既有平铺入口和 README 分组。只有另行确认引用迁移、命令兼容和验证方案后，才可以新建分类子目录或移动脚本。

## 6. 派生文件、本地状态与历史资料

已有受控派生消费文件按 [仓库职责边界](REPOSITORY_BOUNDARY.md) 维护，不手工改写生成结果。[ADR-0004](docs/adr/0004-controlled-derived-consumer-files.md) 仍为 `Proposed`，不单独授权新增纳管、移动或删除历史文件。其他可再生成内容默认属于本地生成物。

| 路径 | 当前状态 | 规则 |
|---|---|---|
| `artifacts/` | 临时生成物和本地验证输出目录 | 默认不提交 |
| `output/` | 历史渲染输出 | 后续迁移到 `artifacts/` 或保留为样例前先审计 |
| `_tmp/` | PPTX 解包和临时脚本 | 不应作为仓库真源 |
| `.tmp/` | 历史调查、解包和预览中间文件 | 新生成物写入 `artifacts/`；已外置的 U8 帮助文档解包资料从 [归档索引](docs/archives/README.md) 查找，其余已跟踪资产仍需逐项确认后处理 |
| `snapshots/` | 历史norms快照 | 已有README；保留历史内容，不作为当前治理或自动生成入口 |
| `ai_materials/` | 有来源的AI处理输入材料及历史索引 | 按README及本次用户指定范围使用；不自动赋予资料当前治理权威 |
| `.agents/` | Codex 可用的项目技能和提示材料 | 可保留，但不放生成物 |
| `.claude/skills/` | Claude Code 项目级技能入口 | 只放指向 `.agents/skills/` 的薄入口，技能正文、参考和脚本仍在 `.agents/skills/`；不放生成物、运行状态或业务事实 |
| `.codex/config.toml` | 仓库内 Codex 偏好 | 可提交非敏感偏好，不放 Secret、主机信息、运行状态或业务事实 |
| `.superpowers/` | Superpowers历史工作输出 | 插件已退出当前工作流；保留历史资产，未经迁移授权不移动或删除 |
| `node_modules/` | 本地依赖 | 不提交 |
| `test-results/` | 测试输出 | 不提交 |

## 7. 责任不清时的判断

结合上表确认主责资产、真源和生成副作用，再读取相关局部入口。只有迁移或跨资产影响尚不明确时，先完成针对性的只读检查；不把整张责任矩阵或固定自检清单设为每次任务的前置。
