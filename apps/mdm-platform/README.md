# MDM 平台（3000）

3000接收用户从3001主动下载并上传的单流程JSON，保存案例、修订、部门核对、正式审核发布及后续治理记录。3001保持独立、无状态；两者不自动互写或共享数据库。业务事实、职责和审批要求来自用户指定的外部原始材料及明确确认，`docs/`不作为治理真源。

## 当前格式与边界

当前主线为原生V8。预览、正式审核发布、固定来源映射、设计交接、确定性分析、编制问题答复、办公室版本关联和数据治理工作包支持原生V8及受支持V7，保留旧正文、稳定标识、摘要和审核历史。V8判断节点仅允许以`use`引用数据，其他关系按共享校验入口处理；格式支持不授予业务审批权，不自动派单、建包或调用AI。

格式策略由`server/processNativeFormats.js`维护。预览实现是`server/processPreviewReview.js`、`server/processPreviewReviewRepository.js`及`server/routes/processPreviewReview.js`。旧V7模块仅为兼容转发入口。`process-v7`API、表名、`PROCESS_V7_*`开关、`v7_source`、`v7_deterministic`和摘要机器名称保留，不用于判断实际正文版本。

新确定性规则`v7-deterministic-v4`支持V8/V7，包含原有八项技术/关系检查及业务编制完整性、判断分支、逐动作可执行性三项内容检查。旧v1/v2仅按V7解释，旧v3仍支持V8/V7并保持原有八项覆盖；排队恢复和历史结果不增加检查项。跨规则等价比较只用于相同原生V7的原有八项检查；扩展检查范围或改变V8/V7格式时不能解释为旧问题已解决。来源版本必须与正文一致，摘要须通过检查。

预览页面和正式办理页面通过`content_checks`显示当前修订的技术错误、编制缺项、待确认事项及JSON位置和处理建议。内容规则复用3001的纯规则模块，不调用3001服务。`POST /api/process-v7-preview/checks`允许有现有治理读取/编制权限的身份在上传前只读检查，不创建案例或修订。技术错误时业务内容检查标为`not_run`；规则不可用时标为`unavailable`，均不能显示为完整检查通过。

编制缺项和无法对应有效部门的固定执行角色（包括空角色及仅写“全公司”）保留当前修订卡口，人工范围决定不能解除。提升、提交、审核通过、发布使用共享入口重算；审核仍可需要修改或拒绝。数据对象、表单缺失及显式待确认内容只提示核实，不补造业务事实。历史正文、标识、摘要及审核记录保留原样；历史核对完成不豁免当前检查。预览和正式草稿均可下载未完成原生JSON，下载不应用页面未提交的意见。

预览、正式治理和工作包分别由`PROCESS_V7_PREVIEW_ENABLED`、`PROCESS_V7_FORMAL_ENABLED`、`PROCESS_DATA_GOVERNANCE_ENABLED`控制，默认关闭。旧精确试点变量不再决定范围。工作包绑定用户选定的已发布固定版本；`scope_mode=published_v7_versions`是兼容机器值，实际支持格式由状态接口的原生格式字段说明。工作包只读参数只控制工作包，不能解释为全平台只读。

V1至V3本地编制、旧结构化导入及跨部门承接办理已退役。历史数据库、兼容结构与迁移工具保留，不能按旧说明恢复写入或把旧内容当作正式原生版本。

## 按任务阅读

| 任务 | 当前说明 |
|---|---|
| 按角色办理、完成标准及意见保护 | [角色化使用手册](docs/role-based-usage-guide.md) |
| 页面、目录导入、字段、办公室及编制入口 | [当前页面与操作说明](docs/Current-Frontend-Guide.md) |
| 固定来源、映射、交接、分析与Excel/DOCX/PDF证据 | [分析与证据说明](docs/Current-Analysis-Guide.md) |
| 运行变量、结构维护、备份恢复及历史导入 | [运行与结构维护](docs/Current-Runtime-Maintenance.md) |
| 精确身份、锁后资格、诊断及摘要限制 | [身份与事务合同](docs/Identity-Transaction-Contract.md) |
| 产品范围与技术模块 | [PRD](PRD.md)、[技术规格](Tech-Spec.md) |
| 权限及身份迁移 | [权限与RACI](docs/Permission-RACI.md)、[身份迁移](docs/RBAC-RACI-Migration-Runbook.md) |
| 原生流程预览、修订、提升及正式办理 | [设计](docs/Process-V7-Preview-Review-Design.md)、[API](docs/Process-V7-Preview-Review-API-Contract.md)、[数据库](docs/Process-V7-Preview-Review-DB-Schema.md)、[迁移](docs/Process-V7-Preview-Review-Migration-Runbook.md) |
| 固定版本后续数据治理工作包 | [设计](docs/Process-Data-Governance-Design.md)、[API](docs/Process-Data-Governance-API-Contract.md)、[数据库](docs/Process-Data-Governance-DB-Schema.md)、[迁移与恢复](docs/Process-Data-Governance-Migration-Runbook.md) |
| 命令、脚本副作用与验证选择 | [脚本说明](scripts/README.md) |
| 3000本机Docker部署 | [Docker说明](DOCKER.md) |

实施前按[AGENTS.md](AGENTS.md)及相关局部规则确定维护范围。界面说明中的源码能力不证明当前实例已开放。

## 运行与验证

仅操作3000时，在本应用目录使用以下入口；它们不操作PMO或3001。启停与部署仍须有相应目标授权。

```powershell
npm.cmd run service:start
npm.cmd run service:check
```

直接`npm start`要求显式MySQL读模型与连接变量，不回退SQLite、不自动建表或迁移。Secret只通过受控环境提供，不读出或写入说明。共用开发启动脚本同时涉及MDM、PMO及初始化，不能用于仅3000的发布。

文档核对可用`npm.cmd run check:native-process-consistency`。格式源码变更按影响面选择`test:v8-transition`及相应合同；`test:v8-integration`涉及前端构建、自有临时MySQL、随机HTTP和Edge，执行前核对隔离条件。实际浏览器采用Edge100%、1699×828 CSS像素，仅桌面。相关检查不能替代运行开关、人工IME及业务验收。

## 历史追溯

原README的阶段进展、旧单版本限制、候选批次和验证结果保留在[历史快照](../../docs/archives/2026-10-09-leaf-docs/apps/mdm-platform/README.md.before.txt)。退役承接、V3及旧身份迁移材料按兼容或恢复任务读取，不列作当前业务操作入口。
