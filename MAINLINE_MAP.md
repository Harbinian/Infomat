# Infomat 主线关系图

> 状态：执行规则  
> 生效日期：2026-06-07  
> 目的：说明 MDM 主线、PMO 主线、流程输入基线、组织真源和脚本工具之间的数据流关系，防止误把展示副本当维护入口。

## 1. 当前阶段主线

当前仓库处于“流程地图与数据地图的梳理与沉淀”阶段。此阶段分析对象是流程，不是具体应用系统。

MDM 平台开发暂时搁置，保留为后续承接平台。PMO 驾驶舱是当前流程地图展示入口。

组织真源在 `docs/organization/`。
信息化项目人员角色映射在 `docs/organization/信息化项目人员角色映射.md`。
正式工作角色与花名册岗位映射在 `docs/organization/工作角色目录与岗位映射.md`。
流程映射以 `docs/norms/` 下的流程输入基线为准。

## 2. 流程治理主线

```text
docs/organization/组织架构和部门职责.md
docs/organization/工作角色目录与岗位映射.md
docs/norms/{部门}部门-能力-流程-系统映射关系.md
docs/norms/流程治理/*.md
  ↓
scripts/parse-sankey-data.mjs
  ↓
docs/company-sankey-data.json
  ↓
pmo/procedure-management/dashboard.html
  内嵌 <script id="sankey-data">
  ↓
apps/mdm-platform 流程治理快照导入
  仅作后续平台承接与验证
```

规则：

- `docs/norms/{部门}部门-能力-流程-系统映射关系.md` 是流程输入基线。
- `docs/company-sankey-data.json` 是 parser 生成快照。
- `pmo/procedure-management/dashboard.html` 是展示副本，不是流程输入基线维护入口。
- `apps/mdm-platform` 只在导入快照后承接结构化查看和后续治理，不反向覆盖 `docs/norms/`。

## 2.1 工作角色治理主线

```text
制度/表单原文中的角色称谓
  ↓ 文档结构化输出：保留原文、证据和 proposed 关系
docs/organization/工作角色目录与岗位映射.md
docs/organization/花名册.md
  ↓ 行政人事部确认角色目录和岗位映射
流程责任部门确认 L3/A1 绑定
  ↓
docs/norms/{部门}部门-能力-流程-系统映射关系.md
  仅登记 confirmed 工作角色绑定
  ↓
scripts/build-work-role-data.mjs
scripts/parse-sankey-data.mjs
  ↓
docs/work-role-data.json
docs/company-sankey-data.json
  ↓
后续 MDM / MySQL 派生承接
```

规则：

- 工作角色不是人员、花名册岗位、部门、原文角色称谓或 RBAC 角色。
- 行政人事部管理角色编码、名称、生命周期、岗位映射和原文别名；流程责任部门确认具体流程绑定。
- 自动抽取和岗位同名只形成候选，不生成正式编码或 `confirmed` 关系。
- `docs/work-role-data.json` 和公司流程快照是生成物，不手工维护、不反写行政人事或流程真源。
- 申请人、当前处理人、全体员工等场景身份及外部参与方不建立内部工作角色绑定。

## 3. 组织与项目人员映射主线

```text
docs/organization/花名册.md
docs/organization/组织架构和部门职责.md
pmo/信息化项目_工作平衡.md
pmo/信息化项目_部门主备对接人名单.md
  ↓
人工治理与来源标注
  ↓
docs/organization/信息化项目人员角色映射.md
  ↓
只读选择 / 派生快照
  ↓
apps/weekly-action-service (3002)
```

规则：

- `花名册.md` 是人员、工号、部门、岗位资料来源。
- `组织架构和部门职责.md` 是信息化工作组和项目执行架构来源。
- `信息化项目人员角色映射.md` 只收已经进入信息化项目运行链条的人，不复制全量花名册。
- 项目材料有名但花名册未匹配时，映射行保留，人员匹配状态标为 `花名册待补`，不根据角色猜测部门或岗位。
- 3002 可以只读使用映射或派生快照，并在事项上保存人员快照和审计记录；不能写回花名册、组织真源、PMO Markdown 真源或 MDM 数据库。

## 4. 字段台账与主数据主线

```text
业务流程（L3）/ 业务行为（A1）
  ↓
field_entries
  数据对象、字段、消费系统、同步方式、L3/A1 引用
  ↓
field_identities
  待确认黄金源、权威系统、维护部门、owner、确认状态
  ↓
待确认主数据对象
  组织、人员、岗位、产品、物料、供应商、工装、设备等
  ↓
后续 MDM 建模、权限、导入导出和接口设计
```

规则：

- 字段台账中的 `data_object` 是待确认主数据对象，不等同于已经完成主数据建模。
- 黄金源确认必须按字段进行，不因流程建议落位自动认定。
- 主数据对象沉淀前必须确认维护部门、审批部门、消费系统和权限边界。
- MDM 本身也作为“主数据治理与数据地图承接能力”管理，当前补充流程见 `docs/norms/流程治理/MDM治理承接流程.md`。该流程先按信息化工作组 / MDM 工作组项目执行架构承接，不伪造常设部门归属，不作为应用系统（S1）写入 DCM/BBM。

## 4.1 3001单流程编制主线

以下为正式3001的v7主线。v7已经发布并进入使用中验证；软件发布不代表真实流程业务验收通过。

```text
空白新建 / process-governance-v1至v7 JSON / 历史多候选结构化JSON
  ↓
apps/structured-output-service（3001，仅当前页面内存）
  ├─ 只读 docs/organization/花名册.md 岗位目录
  └─ 页面不接收编制参考材料
  ↓
docs/contracts/process-governance-v7.schema.json
  ↓
未审核-发起部门-流程名称-阶段-下载时间.json
  ↓
用户保存文件；再次编制时可以手工导入3001
```

规则：

- 公司局域网用户通过`http://<服务器局域网IP>:3001`直接进入3001，不经过DeepSeek、MDM-AI助手或认证网关。
- 3001一份JSON只编制一个流程。历史v2文件含多条流程时，在当前页面拆成候选并逐一下载。
- 3001通过本服务`/api/enums`只读仓库花名册岗位，不调用3000、数据库或会话。岗位只表示当前执行岗位，不生成正式工作角色。
- 新建流程的`reference_materials`为空；页面不新增、展示或编辑参考材料。导入JSON中已有的历史参考材料只在内存中保留并随再次下载带回。
- 表单与记录在独立工作区按整张纸质表单展示。v7先在`data_objects[].fields[]`定义当前单流程内的对象字段，再由`forms[].areas[].items[]`通过`data_field_ref`引用；表单项只保留主表或明细表位置、必填、填写说明、顺序和值使用方式。该引用减少同一流程多张表单重复维护同一字段，但不形成跨流程字段身份或正式黄金源结论；实际运行时自动带入由承载表单的业务系统实现。`form_design_state`继续区分现状、拟设计和历史待确认状态，不增加页面状态或图形字段。
- 3001不保存草稿、不记录审核状态，也不通过API、数据库、队列、回调、共享会话或轮询与3000通信。
- 3001只保存流程编制内容和单文件技术引用，不保存MDM审核意见或批准标记。
- v7中跨部门由业务行为的固定执行部门与流程归口部门自动识别。跨部门先后和返回使用普通`flow_relations[]`，数据传递和返回使用`data_objects[].behavior_links[]`；活动结构不再包含独立交接对象。
- v1至v4旧交接记录只在3001页面内存中转换；原记录、转换结果和无法转换原因只读保存在`migration.legacy_cross_department_records[]`，不参与当前流程计算、评分或绘图。源文件不修改，重复导入不生成重复对象。
- 3001的`data_objects[].lifecycle`只记录当前单流程入口状态、路径事件、出口状态和分析来源；主数据提示只作前端线索，不形成正式认定。3000必须另行完成v7兼容、审核和迁移验证，3001页面明确v7文件暂不能直接导入3000。
- 3001后端保留确定性文档解析器用于历史迁移和回归测试，但页面不再提供参考材料解析入口。模型辅助填报能力已经移除；3001的启动、访问、新建、导入、校验和下载均不依赖DeepSeek或任何辅助服务。
- 3001页面按“JSON基本信息、流程边界、流程骨架、动作与异常、数据与表单、跨部门核对、评审与交接”组织现有v7内容。步骤1至5只在编制人主动执行“检查本轮”后显示本轮自检项；步骤6显示业务核对项，步骤7显示交接检查事项。页面提供四轮阶段下载和最终待核对下载；每次下载按最终文件实际字节计算SHA-256，摘要用于人工交接核对，不写入JSON。
- 3001步骤5支持从Excel或WPS复制粘贴数据对象、对象字段和数据行为关系。页面先在草稿副本中解析、预览并完整校验；任一行失败时整批不应用，成功批次形成一条撤销记录。页面不自动读取剪贴板，不上传`.xlsx`文件。

## 4.2 独立AI结构化填报试点主线

```text
用户从HTTPS :3003登录并启动当前会话的隔离DSH实例
  ↓ 默认进入HTTPS :3004
受限DSH治理工作区（一个案例对应一个内存工作区）
  ↓
用户对话（可选补充经授权、已脱敏的文字材料）
  ↓
apps/structure-assistant（MDM-AI助手服务端）
  ↓ 每次调用前后校验
3001公开的只读结构规则和校验接口
  /api/health?version=process-governance-v5
  /api/schema?version=process-governance-v5
  /api/template?version=process-governance-v5
  /api/validate
  ↓
DeepSeek V4 Pro填报对话（关闭思考模式）
  ↓
未经独立预审的process-governance-v5 JSON
  ↓ 新页面、新上下文
DeepSeek V4 Pro独立结构预审（`reasoning_effort=high`）
  ↓ 用户逐条处理结构问题，同时查看3001格式内容和只读跨职能流程图
预审后的process-governance-v5未审核JSON + 独立问题处理记录
  ↓
用户下载试点结果；如需继续编制，再通过局域网地址手工导入3001
```

规则：

- 助手和3001运行服务器同一个Git提交。正式启动拒绝未提交的工作区；不自动拉取代码，也不向用户电脑复制仓库、Schema或配置。
- DSH固定使用`@deepseek-ai/dsh@0.1.0-rc.6`和Node.js 24。DSH只提供受限治理页面和插件运行环境，不开放原生编码Agent、目录选择、命令、文件编辑、技能、子Agent、网页检索、模型选择或插件管理。
- 每个登录会话使用独立DSH子进程；同一Cookie多标签共享。工作区内容只在该子进程内存中保存，刷新可恢复，退出、会话到期、实例终止、子进程故障或服务重启后清除。
- 5个固定账号登录后分别输入本人API Key。服务端验证后只在当前登录会话对应的进程内存中保存Key；页面只显示SHA-256前12位指纹，管理员看不到其他账号余额和指纹。
- 该试点不属于3001。试点可以单向读取3001公开的结构规则和校验接口，但不得停止、重绑或代管3001；局域网用户使用3001不经过该试点或其网关。
- Schema是每次AI对话的硬限制。模型只能返回受限Patch；3001校验通过后，页面才更新草稿。`migration`和旧`cross_department_handoffs`不向受限Patch开放。
- 填报首页以对话为主，并同步显示结构化输出预览。用户无需先上传材料；AI只发现需要继续确认的结构化信息问题。
- 填报材料、对话、草稿、预审问题和核对记录不落库、不写文件、不进入浏览器持久化空间。非内容用量元数据、维护状态和全局入口切换记录可以写入本机运行目录。
- AI只检查结构，不判断流程事实、职责或业务内容。硬性结构错误不能忽略；字段归位和对象拆分建议允许保持原值并记录理由。
- 助手不调用3001写接口，不与3000通信。用户主动下载和手工导入是两个工具之间唯一的业务内容传递方式。
- 用户只访问集中部署的HTTPS页面。张广懿在服务器发布一次后，用户刷新页面取得新版本；版本变化时，旧页面先下载草稿，再刷新并重新导入。

## 5. MDM 平台主线

```text
docs/contracts/document-structured-output.schema.json
  ↓
apps/mdm-platform/server/db.js
  ↓
apps/mdm-platform/server/routes/*
  ↓
apps/mdm-platform/public/index.html
  ↓
apps/mdm-platform/scripts/test-*.js
apps/mdm-platform/scripts/smoke-*.js
```

关键检查：

```bash
cd apps/mdm-platform
npm run test:mainline
```

该检查验证：

- 流程治理快照可运行。
- 字段台账可引用流程治理 L3/A1。
- 主数据对象基础路由可隔离运行。
- 项目角色权限边界可验证。
- 字段台账可导入导出。

规则：

- 平台测试必须使用隔离数据库或明确声明测试数据范围。
- 运行态数据库不是仓库真源。
- 平台脚本只服务 MDM 时留在 `apps/mdm-platform/scripts/`。
- 跨资料、跨 PMO、跨 app 的脚本进入仓库级 `scripts/`。
- MDM完整流程草稿以`docs/contracts/process-governance-v3.schema.json`为结构规则；兼容导入v1、v2，保存和导出统一为v3。历史文档结构化输出字段仍以`docs/contracts/document-structured-output.schema.json`为兼容规则，两者都不反向覆盖`docs/norms/`。
- 3001继续作为独立、无状态的单流程编制工具运行。MDM不代管3001，只读取用户选择的v1、v2、v3文件，并在服务端重新校验后写入MySQL完整JSON和治理投影。
- MDM“流程治理→流程编制”使用`apps/mdm-platform/public/process-governance-editor/`中的本地编制工作台，复用3001的字段编制、稳定排序、结构评分和跨职能流程图交互。页面通过MDM本地接口读取结构规则和目录，不访问3001服务。
- 当前 MDM 不持久化 `work_role_bindings`；非空关系导入必须返回 `WORK_ROLE_BINDINGS_UNSUPPORTED`，避免静默丢失。行政人事目录和受控试点稳定后，再建设 MySQL 派生表和变更申请能力。

## 6. PMO 项目管理主线

```text
pmo/信息化项目_计划管控真源.md
pmo/信息化项目_WBS结构真源.md
pmo/信息化项目_工作平衡.md
pmo/信息化项目_工作开展原则.md
pmo/信息化项目_协同工作规则.md
pmo/信息化项目_部门主备对接人名单.md
  ↓
pmo/build_pmo_task_data.py
  ↓
pmo/tasks.json
pmo/pmo-source-manifest.json
pmo/gantt-react/public/tasks.json
pmo/gantt-react/public/pmo-source-manifest.json
  ↓
pmo/gantt-react/
```

规则：

- PMO Markdown 是项目计划当前维护入口。
- 部门主备岗、会议和行动项协同规则以 `pmo/信息化项目_协同工作规则.md` 为准，当前主备岗人员以 `pmo/信息化项目_部门主备对接人名单.md` 为准。
- `pmo/信息化项目_协同工作规则_群通知.md` 只用于信息化工作群发布，不是真源。
- 历史 XLSX / MPP / CSV 任务导入文件已废弃，不作为当前输入、不再保留或读取。
- `pmo/gantt-react/public/tasks.json` 是 React 应用消费数据，不是手工维护真源。
- `apps/weekly-action-service/` 是 3002 周会行动项运行台账服务，默认写入 `artifacts/weekly-actions/`；它不回写 PMO Markdown 真源、`tasks.json` 或 MDM 数据库。

## 7. 信息表收集主线

```text
MySQL: person -> user_accounts
MySQL: departments
  ↓ 只读身份与部门
apps/information-collection-service/
  ├─ 4000 管理端：表单设计、任务发布、完成情况、答卷和导出
  └─ 4001 填报端：本人任务、草稿、提交、修改和附件
  ↓
MySQL: collection_*
COLLECTION_FILE_ROOT（仓库外受控附件目录）
```

规则：

- 4000 和 4001 由同一进程提供，但使用独立路由和独立会话 Cookie；任一端口启动失败时，进程关闭另一端口并退出。
- 服务只读复用 `person`、`user_accounts` 和 `departments`。信息收集权限写入 `collection_app_grants`，不得自动继承 3000 的 `admin`、MDM 工作角色或部门负责人权限。
- 表单、不可变发布版本、任务目标快照、当前答卷和历次正式提交均写入 `collection_*` 表。附件正文只写入仓库外 `COLLECTION_FILE_ROOT`，数据库只保存元数据和哈希。
- 服务不写入 MDM 治理业务表、`docs/norms/` 或 PMO 真源。数据库迁移先执行 dry-run，再 apply 和 schema 检查。

## 8. AI 协作与历史方案主线

```text
docs/superpowers/specs/*
docs/superpowers/plans/*
.planning/*
.agents/*
AGENTS.md
CODEX.md
```

规则：

- `docs/superpowers/` 用于追溯历史设计和计划，不作为当前执行真源。
- `AGENTS.md` 和 `CODEX.md` 是 Codex 当前协作入口。
- `.agents/` 是 Codex 可用的项目技能和提示材料，不放项目生成物。
- 历史方案如与当前边界文件冲突，以 `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md` 和本文件为准。
- 代码、脚本、接口、数据库结构、前端行为、启动命令或测试命令变化时，必须同步更新对应文档。

## 9. 禁止的跨线操作

| 禁止操作 | 原因 | 正确做法 |
|---|---|---|
| 改 MDM 时顺手改 `docs/norms/` | 平台代码和流程输入基线混线 | 先确认是否是资料变更任务 |
| 改 PMO 驾驶舱时手工重造流程数据 | 展示副本会偏离流程输入基线 | 修改流程输入基线后运行 parser |
| 跑测试时写共享 `platform.db` | 会污染平台本地状态 | 使用 `MDM_DB_PATH` 隔离数据库 |
| 整理文档时移动 `apps/mdm-platform/` | 运行系统路径被脚本和说明引用 | 先写迁移计划和验证命令 |
| 把截图、zip、解包目录作为证据长期提交 | 检索噪音高，容易误导 AI | 放入 `artifacts/` 或精选到 `docs/samples/` |

## 10. 下一步收口路线

第一步：完成仓库边界审计和三份边界文件。  
第二步：为 `docs/reports/`、`docs/architecture/`、`scripts/` 分组补 README。  
第三步：只迁移低风险生成物和根目录临时文件。  
第四步：评估是否需要拆仓库；拆仓库前必须保持流程治理链路可验证。
