# AGENTS.md

本文件只约束 apps/mdm-platform/ 的实现与维护；根 AGENTS.md 持续适用。当前规则放在本入口，产品说明、历史批次和测试细节按任务读取 README.md、scripts/README.md；docs/ 不是业务真源。

## 当前主线与兼容

- 2026-10-08用户明确“全面转向V8”：原生 process-governance-v8 贯通预览、正式审核发布、固定来源映射、设计交接、确定性分析、编制问题答复、办公室版本关联与工作包。受支持V7的正文、标识、摘要和审核记录原样保留；不降级、不猜测迁移、不回填历史。V1至V3编制、导入及旧承接办理入口已退役，旧记录和共享迁移结构保留。
- 原生格式清单由 server/processNativeFormats.js 维护。预览实现为 server/processPreviewReview.js、server/processPreviewReviewRepository.js、server/routes/processPreviewReview.js；旧预览V7模块及相应导出只作兼容转发。原 process-v7 API、表名、PROCESS_V7_* 开关、候选码与摘要算法标识保留，名称不能代替正文格式判断。
- 当前规则 v7-deterministic-v4 支持V8/V7并包含业务完整性、判断分支及逐动作可执行性；旧v3保持八项V8/V7检查，旧v1/v2仅按V7解释。规则适用、覆盖和跨运行可比性分别核对，不改写旧结果。格式、正文及固定摘要必须一致。
- 3001独立、无状态、单流程，只由用户主动下载上传交接。MDM不停止、重绑、远程读取或代管3001，不共库、不自动互写；当前支持不表示实际运行、开关或业务验收已完成。

## 技术与身份边界

- 保留 Express + MySQL；新增接口放 server/routes/ 并在 server/index.js 注册。同源 React + Vite 前端独立于PMO，保留旧 public/index.html 与本地 ECharts，不使用CDN或共用5173。开发代理只连明确隔离后端，公开构建不得包含材料、用户数据、Secret或服务端源码。
- MySQL使用 MYSQL_HOST、MYSQL_PORT、MYSQL_USER、MYSQL_PASSWORD、MYSQL_DATABASE、MYSQL_CONNECTION_LIMIT。SQLite仅保留历史迁移与隔离测试，公开命令须有 legacy-sqlite: 前缀；不得恢复正式回退或新增SQLite能力。表结构、接口、账号、字段或状态变化须说明兼容、历史影响和验证，不能擅自迁移正式库。
- 人员身份为 person -> user_accounts -> person_roles，一人一账号；独立admin无人员关联且默认关闭，治理只读。users/user_roles、users.role、requireRole与SQLite不作正式授权。
- RBAC使用 server/auth.js 的现有权限中间件及 server/access.js 的范围核验，不按角色名称直接放行。模型 rbac-raci-v3-2026-07-31、七个MDM角色、十九项权限、标签与RACI由 server/roleDefinitions.js 固定；管理页只读，不自定义角色、继承、通配权限或矩阵。
- admin只管理账号、授权和访问审计，治理材料全局只读；叠加业务角色也不能写。部门角色只授予人员所属部门；最终负责人仅取 departments.final_responsible_person_id，不猜姓名、岗位或历史常量。旧账号保留，权限及身份变化处理旧数据兼容。

## 流程核对与正式流转

- 预览只写 process_v7_preview_*，返回 preview_only=true、publishable=false、空正式版本标识。提升是独立接口，须通过M0/M1/M2、权限、并发与恢复门槛；按实际格式原生保存V8/V7。正式审核绑定修订号与摘要，发布后下游只绑定不可变 process_version_id。
- PROCESS_V7_PREVIEW_ENABLED、PROCESS_V7_FORMAL_ENABLED默认关闭；开启后不再由旧 PROCESS_V7_TRIAL_PROCESS_REF 限制为单流程。同案例新修订保持原 process_ref，另一流程另建案例；仓储复核锁定案例、来源及当前操作资格，不合并或回填旧案例。
- 核对摘要版本 process-v7-review-item-v2 包含完整行为、相连流程关系、数据对象/字段/生命周期及表单操作/区域/字段。相关内容变更或缺摘要版本重新打开，无序数组重排和无关对象不重新打开。
- ACTOR_DEPARTMENT_UNRESOLVED不能由人工范围决定解除；提升、提交、通过、发布按当前有效部门重算卡口。审核有卡口时仍可需要修改或拒绝。预览、提升与发布分别调用共享纯校验入口，不能相信客户端状态或旧审核结果。

## 工作包与办公室

- 数据治理由MDM工作组负责；业务部门只答复定向流程事实并提供依据，不负责认定主数据、统一对象、决定关键字段、生命周期规则或发布数据地图。系统候选保持待定，不调用AI、不自动确认。
- PROCESS_DATA_GOVERNANCE_ENABLED默认关闭；开启后用户可选择任一已发布原生V8或受支持V7固定版本（含历史已发布版本）主动建包，旧试点版本配置不再限范围。发布/迁移不自动建包或回填；旧包保留原版本、摘要、规则及审核记录。
- 工作包每次写入复核固定摘要，不复制完整正文、不读预览或原始3001文件。PROCESS_DATA_GOVERNANCE_READ_ONLY=1只展示已完成包，并在路由和仓储拒绝全部写入，不改变流程开关、角色或部门范围。
- 部门是流程/数据归口，办公室是承接工作最小单元；人员可属多个办公室。归口、负责人和成员由用户手工导入，不从岗位或旧名称推断。负责人给有效成员分配任务；办公室不获得正式审核、发布或新增MDM角色。
- MDM写入、目标部门答复、管理员只读、最小上下文、乐观并发和未提交输入保护须在服务端及真实浏览器验证；自动化不等于人工IME或业务验收。

## 页面与验证路由

- 登录默认 roleWorkbench，合并多角色事项并标明来源；优先视图列1至3个下一步动作，完整职责链及问题卡、首次入口、样例和完成标准见 README.md“工作台与问题卡维护约束”。页面不授予权限，不预设审核意见。
- 行为、合同、命令或维护边界变化同步对应说明；仍准确的文档不重写。流程治理、字段、术语、冲突、导入导出、通知/待办修改说明状态与审批影响；Excel导入导出兼顾模板、校验、错误提示与权限。
- 按 package.json、scripts/README.md 选择验证。修改工作台按影响面运行 test:frontend、test:project-roles、test:process-governance、test:mainline、test:role-workbench；纯说明不默认启动平台、连库或跑全套。指令修改运行仓库 test:codex-context，版本整改运行 test:v8-transition、check:native-process-consistency 及相关隔离测试。
