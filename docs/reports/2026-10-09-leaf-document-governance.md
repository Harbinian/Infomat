# Infomat末端文档治理结果

日期：2026-10-09。范围沿仓库级入口展开到应用README、PRD、技术规格、API、数据库、迁移与操作指南、局部约束及技能参考。此次是对上一轮只整理仓库入口的补充：重点处理正文中相互冲突的现行要求、历史状态和实现范围。

## 实际结果

修改29份已有文档，新增5份按用途阅读的当前说明；整理前原文逐文件保存，包含修改前已存在的未提交改动。没有按代码推定新的业务要求。治理时信息收集主表/明细表范围待用户确认；随后用户已确认纳入范围，相关当前说明已同步，开发与正式启用按用户最新要求暂缓，见[范围及启用状态](../../apps/information-collection-service/docs/Scope-Deviations.md)。下文验证结果属于原文档治理轮次。

### 已修正的问题及依据

| 问题 | 当前处理 | 核对依据 |
|---|---|---|
| 3001文首已取消下载门禁，后文仍要求结构校验、业务确认和迁移回读 | 阶段与最终下载均先处理未应用输入，再保存当前JSON；检查独立，下载不表示通过 | [导出入口](../../apps/structured-output-service/public/index.html)、[当前需求](../../apps/structured-output-service/PRD.md#41-阶段下载)及原说明中已有确认 |
| 3001判断节点use已允许，流程关系章节仍全面禁止控制节点数据关系 | V8判断节点仅允许use；创建、更新和表单关系保留原限制；来源V7按历史校验 | [V8专项](../../apps/structured-output-service/scripts/test-v8-decision-data.js)、共享校验器、图命令及原V8要求 |
| 3001当前目标为V8，技术主体仍写生成V6、按V7校验目标及不显示迁移结果 | 来源按各自版本纯校验，在内存生成V8并逐候选校验；显示规范化差异，失败整批不安装 | [迁移实现](../../apps/structured-output-service/public/process-governance-migration.js)、[导入兼容](../../apps/structured-output-service/public/import-compatibility.js)及当前技术规格 |
| 当前清晰视图采用文字阈值，旧正文仍要求固定100%及全屏属性弹窗 | 默认四项任务用并排详情和显式编辑；清晰视图按约14/18像素阈值；七步回退范围单列 | [流程绘图](../../apps/structured-output-service/public/process-diagram.js)及现有阅读要求；本轮未重新进行浏览器验收 |
| 3000全线原生V8已明确，工作包设计、API、DB、角色手册仍仅V7 | 统一已发布原生V8及受支持V7范围；保留正文、ID、摘要及审核历史，机器V7标识不替换 | [当前目录规则](../../apps/mdm-platform/AGENTS.md)、[原生格式策略](../../apps/mdm-platform/server/processNativeFormats.js)、[工作包来源检查](../../apps/mdm-platform/server/processDataGovernanceRepository.js) |
| scope_mode名为published_v7_versions，文档据名称限制V7 | 保留兼容机器值，明确实际primary/supported格式字段；不改变返回合同 | [工作包状态](../../apps/mdm-platform/server/processDataGovernanceScope.js) |
| 预览DB固定schema_version=V7，迁移回退说明遗漏V8使用 | 正文保留实际V8/V7；M2回退检查两种原生使用，不从历史数量推定目标状态 | [正式基础迁移](../../apps/mdm-platform/server/processV7FormalMigration.js)、当前预览仓储 |
| 预览模块已改为通用实现，技术模块表仍把旧V7文件列为主实现 | 使用processPreviewReview正式入口；旧模块仅兼容转发 | [当前目录规则](../../apps/mdm-platform/AGENTS.md)及原生格式一致性检查 |
| 分析存储仍写HTTP和页面未接入，旧确定性阶段仍全面拒绝V8 | 当前HTTP与页面说明收拢；v3支持V8/V7，v1/v2限制及旧结果保留，禁止跨格式等价比较 | [分析API](../../apps/mdm-platform/server/analysisApi.js)、[确定性规则](../../apps/mdm-platform/server/v7AnalysisRules.js)及当前V8确认 |
| 身份说明只列人员链路，遗漏独立系统维护主体 | 人员链与system_admin分开说明；精确身份、锁后资格、失败诊断及旧摘要限制单列 | [系统维护身份](../../apps/mdm-platform/server/systemAdminIdentity.js)、[身份与事务说明](../../apps/mdm-platform/docs/Identity-Transaction-Contract.md) |
| 234KB应用README和155KB脚本说明混合当前功能、阶段测试和补丁结果 | 当前入口缩短，保留有效技术内容到页面、分析、维护、身份专题；242个npm入口按当前package逐项列出，历史结果按需读快照 | [应用入口](../../apps/mdm-platform/README.md)、[脚本入口](../../apps/mdm-platform/scripts/README.md)及[原文快照](../archives/2026-10-09-leaf-docs/README.md) |
| 两项测试命令已取消，信息收集指南混用仓库和应用目录命令 | 取消旧命令副本，统一查当前npm表；明确部署命令cwd与prefix | 当前package.json、[部署指南](../../apps/information-collection-service/docs/Deployment-Runbook.md) |
| v2兼容说明混入旧MySQL缺列现状和角色业务安排 | 保留技术字段、枚举和兼容约束；旧承接与岗位归并安排移出当前说明，不成为当前业务规则 | [v2技术说明](../contracts/document-structured-output-schema.md)、当前退役边界及原文快照 |
| 组织模型引用docs/organization作为组织事实，提取示例默认docs/norms | 改用用户指定外部原始材料与有权确认；PMO模型仍保留自身受控内容真源 | 根目录规则、[组织模型约束](../../pmo/organization-dynamics/AGENTS.md)、[提取参考](../../.agents/skills/process-evidence-mapping/references/chunking-spec.md) |

## 当前说明与追溯的读取方式

3000由[README](../../apps/mdm-platform/README.md)按任务路由到[页面说明](../../apps/mdm-platform/docs/Current-Frontend-Guide.md)、[分析与证据](../../apps/mdm-platform/docs/Current-Analysis-Guide.md)、[运行维护](../../apps/mdm-platform/docs/Current-Runtime-Maintenance.md)及[身份事务合同](../../apps/mdm-platform/docs/Identity-Transaction-Contract.md)。API、数据库及迁移文件仍由应用入口直达。3001保留README、PRD和技术规格的既有分工，将冲突正文直接更新，不要求读者在日期补丁间裁决。

旧阶段进展、单版本试点、V5/V6回退方式和测试结果保留在[29份原始字节快照](../archives/2026-10-09-leaf-docs/README.md)，附manifest及SHA256SUMS。仍有效的限制保留在当前说明，包括历史规则版本、管理员只读、固定来源摘要、兼容原文和未提交输入保护。没有删除或移动原有历史资产，没有重写已存业务数据。

## 待确认与保留限制

[信息收集范围及启用状态](../../apps/information-collection-service/docs/Scope-Deviations.md)：主表/明细表范围缺口已由用户明确确认解决，原目录限制和README、PRD及技术设计已按该确认同步。正式启用仍需运行证据，业务验收仍需有权确认；不能以代码、合同测试或历史数据存在替代。

3000发布源旧baseHash的大整数精度、队列池调用及回滚后失败诊断进一步隔离等问题保留为技术限制。本轮只整理说明，不据此宣称这些实现问题已解决，也不把现有偏差确认为新业务规则。

## 核对范围及验证

初始盘点154份文件，其中48份业务或历史来源仅登记路径及元数据，没有改写原始业务材料。候选检索用于定位问题，不等于逐份完成业务确认；深度修订覆盖下表29份原文及5份新增说明。未把全部历史计划、报告或259KB架构设计草案重新定为当前要求；已标注历史的提示词、验证记录及Proposed方案保留原状态。

- `npm.cmd run test:codex-context`通过：13条指令链均在预算内。
- `npm.cmd run check:native-process-consistency`通过：核对当前格式门槛、通用预览消费者及用户文案；无应用启动或数据库连接。
- `node scripts/test-v8-decision-data.js`通过：V8操作矩阵、V7历史边界、内存迁移、稳定标识及3000共享校验；不读取用户JSON或正式数据库。
- 本地文档检查通过：严格UTF-8、Markdown目标与锚点、npm命令入口存在性、原文快照摘要。跨目录命令结合正文cwd检查，入口存在性不证明可安全直接执行。
- 最终检查覆盖100份技术说明及索引、317个本地链接与锚点、273处npm命令引用；29份快照均与初始盘点SHA-256一致，校验清单与manifest一致。四份核心规格中的定向语义冲突复查为零。
- 完整Git状态复核保留开始时的239条状态记录；本轮没有移除既有改动条目。此项证明状态条目保留，不替代文件内容核验。
- 差异空白检查只针对本轮修改的已跟踪文档；新增文档另做编码及链接检查。精确结果见忽略的`artifacts/document-governance/2026-10-09-leaf-audit/validation.json`。

这些检查不表示正式服务已替换、功能已开启、人工中文输入或业务验收完成。本轮没有启停服务、连接正式数据库、迁移、发布、暂存、提交或推送；原有无关代码改动保留。

## 修改前后文件清单

字节数仅用于检查文档规模，不表示token节省或运行性能。两份大入口的有效内容已进入专题，不能将入口缩小误认为删除了相同比例的有效知识。

| 文档 | 整理前字节 | 当前字节 |
|---|---:|---:|
| [apps/mdm-platform/PRD.md](../../apps/mdm-platform/PRD.md) | 23458 | 16897 |
| [apps/mdm-platform/Tech-Spec.md](../../apps/mdm-platform/Tech-Spec.md) | 27618 | 25424 |
| [apps/mdm-platform/docs/Process-Data-Governance-Design.md](../../apps/mdm-platform/docs/Process-Data-Governance-Design.md) | 8807 | 9109 |
| [apps/mdm-platform/docs/Process-Data-Governance-API-Contract.md](../../apps/mdm-platform/docs/Process-Data-Governance-API-Contract.md) | 6319 | 6679 |
| [apps/mdm-platform/docs/Process-Data-Governance-DB-Schema.md](../../apps/mdm-platform/docs/Process-Data-Governance-DB-Schema.md) | 4765 | 4827 |
| [apps/mdm-platform/docs/Process-Data-Governance-Migration-Runbook.md](../../apps/mdm-platform/docs/Process-Data-Governance-Migration-Runbook.md) | 12422 | 7546 |
| [apps/mdm-platform/docs/Process-V7-Preview-Review-Design.md](../../apps/mdm-platform/docs/Process-V7-Preview-Review-Design.md) | 9606 | 9916 |
| [apps/mdm-platform/docs/Process-V7-Preview-Review-API-Contract.md](../../apps/mdm-platform/docs/Process-V7-Preview-Review-API-Contract.md) | 17419 | 17250 |
| [apps/mdm-platform/docs/Process-V7-Preview-Review-Migration-Runbook.md](../../apps/mdm-platform/docs/Process-V7-Preview-Review-Migration-Runbook.md) | 8688 | 7163 |
| [apps/mdm-platform/docs/role-based-usage-guide.md](../../apps/mdm-platform/docs/role-based-usage-guide.md) | 26726 | 23436 |
| [apps/structured-output-service/README.md](../../apps/structured-output-service/README.md) | 55439 | 54366 |
| [apps/structured-output-service/PRD.md](../../apps/structured-output-service/PRD.md) | 31043 | 31154 |
| [apps/structured-output-service/Tech-Spec.md](../../apps/structured-output-service/Tech-Spec.md) | 48493 | 47965 |
| [pmo/organization-dynamics/AGENTS.md](../../pmo/organization-dynamics/AGENTS.md) | 1474 | 1551 |
| [apps/README.md](../../apps/README.md) | 2092 | 2150 |
| [apps/mdm-platform/README.md](../../apps/mdm-platform/README.md) | 234375 | 5021 |
| [apps/mdm-platform/scripts/README.md](../../apps/mdm-platform/scripts/README.md) | 155035 | 42895 |
| [pmo/gantt-react/AGENTS.md](../../pmo/gantt-react/AGENTS.md) | 5480 | 5443 |
| [apps/mdm-platform/docs/Process-V7-Preview-Review-DB-Schema.md](../../apps/mdm-platform/docs/Process-V7-Preview-Review-DB-Schema.md) | 4031 | 4367 |
| [docs/contracts/document-structured-output-schema.md](../contracts/document-structured-output-schema.md) | 10006 | 8768 |
| [docs/contracts/README.md](../contracts/README.md) | 7387 | 7391 |
| [scripts/README.md](../../scripts/README.md) | 30158 | 29903 |
| [apps/mdm-platform/docs/RBAC-RACI-DB-Schema.md](../../apps/mdm-platform/docs/RBAC-RACI-DB-Schema.md) | 3769 | 4097 |
| [.agents/skills/process-evidence-mapping/references/chunking-spec.md](../../.agents/skills/process-evidence-mapping/references/chunking-spec.md) | 7546 | 7708 |
| [apps/information-collection-service/README.md](../../apps/information-collection-service/README.md) | 4783 | 5162 |
| [apps/information-collection-service/docs/Deployment-Runbook.md](../../apps/information-collection-service/docs/Deployment-Runbook.md) | 2735 | 2976 |
| [docs/archives/README.md](../archives/README.md) | 2276 | 2614 |
| [apps/information-collection-service/docs/PRD.md](../../apps/information-collection-service/docs/PRD.md) | 4408 | 4632 |
| [apps/information-collection-service/docs/Tech-Spec.md](../../apps/information-collection-service/docs/Tech-Spec.md) | 5425 | 5649 |

新增说明：Current-Frontend-Guide、Current-Analysis-Guide、Current-Runtime-Maintenance、Identity-Transaction-Contract及Scope-Deviations。当前维护时，按行为变化更新受影响说明与相关引用；业务范围依据确认，技术行为依据实现，阶段结果写入报告或追溯记录。
