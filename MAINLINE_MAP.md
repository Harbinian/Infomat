# Infomat 主线关系图

测试脚本及辅助历史资料仅保留在维护者本机，不随 Git 分发；公开包不提供对应测试命令。本地验证须使用已有工具或明确取得的测试材料，并遵守隔离、权限和验收边界。


Git 分发保留源码、配置示例、运行维护入口、有效契约、技能依赖及必要生成输入。测试脚本与夹具、辅助说明和历史副本按 `.gitignore` 仅留本机，取消跟踪不删除本地文件。公开 `package.json` 不再列出这些测试命令；本机原命令清单位于被忽略的 `.local-tests/commands.json`，执行前须结合本机已有工具核对。


> 状态：当前关系说明
> 范围：已确认的工作方向、现有技术消费关系和维护入口；不表示服务已开启或业务已验收。

## 1. 单流程编制与治理

```text
用户指定的外部原始材料 + 业务主体说明及确认
  → 3001：在当前页面内存中编制单流程
  → 用户主动下载未审核 JSON
  → 用户手动上传 3000
  → 3000：治理、核对、审核和正式版本
  → 依据经治理确认的版本生成程序文件
```

退回后由编制人在 3001 修订、下载，再上传到 3000 原案例。3001 独立、无状态，不与 3000 自动互写或共享数据库；未审核材料、正式版本和程序文件分别维护。

业务真源及责任确认按 [AGENTS.md](AGENTS.md)。人员事实依据用户指定的行政人事部发布 Excel；花名册 Markdown 和只读目录快照是副本，不能据其确定任命、流程职责或系统权限。

| 技术环节 | 维护入口 | 核对内容 |
|---|---|---|
| 3001 编制和历史文件兼容 | [3001 README](apps/structured-output-service/README.md) | 支持版本、页面内存迁移、用户输入保护、校验和下载 |
| 3000 导入、预览、核对、提升和正式版本 | [3000 README](apps/mdm-platform/README.md) | 支持版本、功能开关、身份权限、部门范围、修订及阻断条件 |
| 目标实例的准备、开启和验收 | 应用运行证据及有权主体确认 | 按 [CODEX.md](CODEX.md) 的状态证据边界判断 |

版本、试点限制和具体操作由应用入口维护。本图不把候选代码、配置或隔离测试写成目标实例的实际状态。

## 2. 历史资料消费与展示

```text
显式选定的历史 norms、组织及角色副本 + 部门域 JSON
  → 历史兼容解析或快照生成器
  → 显式指定的 JSON 快照
  → 可选更新驾驶舱内嵌数据
  → 历史流程地图展示
```

`docs/norms/`、`docs/organization/`、`docs/work-role-data.json`、`docs/company-sankey-data.json` 及旧驾驶舱保留兼容关系，均不作为当前治理依据。3001 对目录副本的只读消费只提供录入提示，不赋予副本业务权威。

获准维护旧展示链时，`parse-sankey-data.mjs` 使用显式 `--legacy-display --domain-map <JSON> --out <JSON>`；只有指定 `--dashboard <HTML>` 才注入页面。工作角色快照生成同样须显式选择兼容输入及输出。完整参数、校验和副作用见 [脚本 README](scripts/README.md)，展示消费见 [驾驶舱 README](pmo/procedure-management/README.md)。

`sync-process-governance-mainline.mjs` 对显式历史快照默认只输出同步计划，不自动重造资料或刷新驾驶舱。MySQL 写入须另行核对 `--apply`、配置、目标、权限及恢复条件。正式数据库主线使用 MySQL；SQLite 仅用于明确隔离的历史迁移或测试。

字段台账中的对象和黄金源线索仍需由有权主体确认，不能直接认定主数据、权威系统或维护责任。历史结构块、文档结构化 v2 和旧映射说明技术兼容现状。

周会行动项独立应用、MDM-AI 助手和 DSH 已退出当前运行链；历史台账及私有配置保留。3000 已退役入口及历史文件承接范围按应用 README 核对。

## 3. PMO 项目管理

```text
pmo/信息化项目_计划管控真源.md
pmo/信息化项目_WBS结构真源.md
pmo/信息化项目_执行标准真源.md
pmo/信息化项目_工作平衡.md
pmo/信息化项目_工作开展原则.md
pmo/信息化项目_协同工作规则.md
pmo/信息化项目_部门主备对接人名单.md
  → pmo/build_pmo_task_data.py
  → pmo/tasks.json + pmo/pmo-source-manifest.json
  → pmo/gantt-react/public/ 中的对应消费副本
  → PMO 甘特图与看板
```

PMO Markdown 是项目计划的维护入口。协同规则及主备岗人员分别由对应 Markdown 维护，群通知文本只用于发布。历史 XLSX、MPP 和 CSV 导入不作为当前输入。

两份任务数据和两份来源清单由固定生成器维护，不手工修改。改变上述输入时运行 `npm run build:pmo-task-data` 和 本机保留的对应验证入口，核对来源摘要。完整维护要求见 [PMO README](pmo/README.md)。

## 4. 信息表收集

```text
MySQL: person、user_accounts、departments
  → 只读复用身份及部门
  → 信息表收集服务：4000 管理端 + 4001 填报端
  → MySQL: collection_*（独立权限和收集业务数据）
  → COLLECTION_FILE_ROOT（仓库外附件正文）
```

服务不写 MDM 身份、角色或治理业务表，不自动继承 3000 权限；附件正文和数据库元数据分别保存。路由、会话、发布版本、草稿、提交和迁移规则见 [应用 README](apps/information-collection-service/README.md)。

## 5. 维护和追溯

- 数据关系变化时更新本图；应用内部实现、版本和操作变化由应用入口维护。
- 目录责任及局部入口注册由 [DIRECTORY_OWNERSHIP.md](DIRECTORY_OWNERSHIP.md) 维护，资料收纳和历史资产边界由 [REPOSITORY_BOUNDARY.md](REPOSITORY_BOUNDARY.md) 维护。
- 新增派生消费文件先核对直接消费关系、生成命令、来源及一致性检查；ADR 的 `Proposed` 状态不表示已评审接受。
- 历史输出在责任、敏感性、直接消费关系及恢复路径确认前，只登记分类，不移动、不删除。
- 历史设计和整理经过通过 [归档索引](docs/archives/README.md) 按需追溯，不与本图的当前关系混排。
