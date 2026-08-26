# CODEX.md

本文件是 Infomat 仓库的 Codex 协作说明。Codex 执行任务时,先遵守根目录 `AGENTS.md`,再按本文件确认执行纪律、文档同步和验证口径。

## 当前工作阶段

仓库当前处于"流程地图与数据地图的梳理与沉淀"阶段。默认分析对象是流程、数据、组织职责和项目资料,不是具体应用系统。

MDM 平台保留为后续承接应用。除非用户明确要求进入 MDM 平台开发,不要把流程输入基线、PMO 展示或业务资料写入平台源码。

## 启动上下文

跨目录任务开始前按顺序读取:

1. `AGENTS.md`
2. `CODEX.md`
3. `MEMORY.md`的`Current Runtime Baseline`；历史和长期条目只按任务关键词检索
4. `REPOSITORY_BOUNDARY.md`
5. `DIRECTORY_OWNERSHIP.md`
6. `MAINLINE_MAP.md`
7. 任务相关目录下的 `README.md` / `AGENTS.md`

数据治理、3001结构化编制、3000受控承接、流程地图或数据地图任务在读取`MAINLINE_MAP.md`后继续读取`docs/architecture/data-governance-operating-rules.md`。

历史计划、历史 specs、审计报告只能用于追溯,不能覆盖当前边界文件。若历史材料和当前边界冲突,以根目录执行规则为准。

## 执行纪律

- 先确认资产类型:资料、PMO 展示、MDM 应用、仓库脚本、AI 协作配置或历史归档。
- 先找真源,再改派生文件。PMO 驾驶舱、JSON 快照和 MDM 导入数据都不是流程输入基线。
- 脏工作区中只改本次任务相关文件,不回滚、不整理用户已有改动。
- 修改前说明正在改什么；完成后说明改了什么、为什么改、怎么验证。
- 可运行验证优先于口头判断。不能运行验证时,说明原因和剩余风险。

## 代码变更必须同步文档

任何代码、脚本、接口、数据库结构、前端交互、启动命令或测试命令变化,都必须同步检查并更新文档。

同步范围包括但不限于:

- 所在目录 `README.md` 和 `AGENTS.md`
- 根目录 `README.md`、`AGENTS.md`、`CODEX.md`
- `docs/glossary.md`
- `apps/mdm-platform/docs/role-based-usage-guide.md`
- `scripts/README.md`
- PMO 真源、交付物说明或使用手册

如果确认无需更新文档,最终交付说明必须写明原因。引入新术语、新缩写或改变术语含义时,必须同步更新 `docs/glossary.md`。

## 3000 / 3001 升级执行检查

3000 或 3001 发生版本更新时,按根目录 `AGENTS.md` 的旧数据迁移规则执行。开始编码前先确认旧数据来源、当前可读版本和受影响字段;实现时同时提供迁移或兼容读取能力;交付前使用旧版本样本验证导入、转换、重复执行、失败恢复和关键引用一致性。

3000 的持久化数据迁移必须有备份、回滚或补偿和迁移后核对。3001 只能在当前页面内存中迁移历史 JSON,不得为兼容旧数据增加持久化能力或与 3000 通信。无法安全迁移的内容必须明确阻塞并给出保住、导出或人工处理数据的办法,不得静默丢弃。

## 3000 固定身份、RBAC 与 RACI

3000当前治理模型版本为`rbac-raci-v3-2026-07-31`。正式身份链路固定为`person -> user_accounts -> person_roles`;运行时不得回退到`users/user_roles`或SQLite人员接口。流程治理顶部只保留一个入口，内部使用流程编制、跨部门承接待办、承接冲突待办和V7预览核对四个工作区。正式编制继续兼容导入v1、v2和v3并统一保存、导出v3。原生V7预览、跨部门核对、提升、提交、审核和发布技术路径已经实现，正式版本以不可变`process_version_id`保存；V7新修订必须回到3001，不能通过3000通用下一版或旧结构化导入路径降级为V3。该路径默认关闭，只允许通过一个精确`PROCESS_V7_TRIAL_PROCESS_REF`开展经批准的单流程试点，不构成V7全量承接。3001继续独立、无状态运行，3000不读取3001运行时页面或服务端业务内容。

正式3001导出`process-governance-v7`，兼容导入v1至v7和历史多候选结构化JSON。流程图、数据流、数据生命周期、文字编制和属性面板共同读写一份页面内存草稿；生命周期分析使用本地确定性规则，主数据认定提示不写入正式结论。旧交接、工作角色、参考材料和内部流程调用只读归档。历史文件中指向控制节点的数据关系和表单处理关系可以带着技术阻断进入页面整改，但严格校验和下载规则不放宽。v7已发布并进入使用中验证，但软件发布不代表真实流程业务验收通过；3000的V7路径只能在默认关闭、精确单流程和明确批准的边界内受控承接；MDM-AI助手仍固定使用v5。

原生V7承接必须分别记录以下四个状态，不得相互替代：

1. **已实现**：代码路径和接口存在，并取得对应自动测试结果。
2. **数据库已准备**：M1/M2结构存在且一致，并记录当时的V7行数；这不表示运行时已经开放。
3. **运行时已开启**：记录实际开关、运行提交和唯一试点`process_ref`；默认状态为关闭且未配置试点引用。
4. **业务已验收**：只记录实际通过的流程、日期和确认主体；未完成真实试点时不得写成V7全量业务验收。

- 普通账号只能由MDM系统管理员通过`/api/org/accounts`手工创建、授权和启用。禁止自助注册、批量开户和RBAC批量导入。
- 固定角色、权限包和RACI由`apps/mdm-platform/server/roleDefinitions.js`及测试固化,管理页面只读。
- `admin`只管理账号、角色授权和访问审计,并对治理材料全局只读;不得审核、确认、修改或发布业务内容。
- 部门最终负责人只从`departments.final_responsible_person_id`读取,不得根据姓名、岗位、职务或历史常量推测。
- 角色、部门或账号状态变化必须递增`auth_version`,使旧会话立即失效。
- 现有库升级必须先执行`npm run migrate:rbac-raci-v2:dry-run`,再按`apps/mdm-platform/docs/RBAC-RACI-Migration-Runbook.md`执行、回滚或补偿。

## 目录级 AGENTS.md

目录级 `AGENTS.md` 只放在有独立真源、生成副作用、运行命令、验证口径或禁止事项的关键目录。新增或调整目录级 `AGENTS.md` 时,同步更新 `DIRECTORY_OWNERSHIP.md`、相关 README 和 `docs/architecture/context-management.md`。

当前应优先读取的目录级入口包括:

- `apps/mdm-platform/AGENTS.md`
- `apps/structured-output-service/AGENTS.md`
- `apps/structure-assistant/AGENTS.md`
- `apps/weekly-action-service/AGENTS.md`
- `apps/information-collection-service/AGENTS.md`
- `pmo/AGENTS.md`
- `pmo/procedure-management/AGENTS.md`
- `pmo/gantt-react/AGENTS.md`
- `pmo/deliverables/AGENTS.md`
- `docs/norms/AGENTS.md`
- `docs/Demo/AGENTS.md`
- `scripts/AGENTS.md`

## 常用验证

流程地图数据变化:

```powershell
node scripts/parse-sankey-data.mjs
node scripts/check-dashboard-data.mjs
```

PMO 任务数据变化:

```powershell
cd pmo
python build_pmo_task_data.py
cd ..
npm run test:pmo-task-data
```

MDM / PMO 本地联动:

```powershell
npm run start:infomat-services
npm run smoke:infomat-services
```

AI结构化填报试点：

- 使用Node.js 24运行`@deepseek-ai/dsh@0.1.0-rc.6`；端口3003负责登录和运行控制，端口3004负责认证后的DSH治理工作区及`/structured-tool/`代理。
- DSH只运行受限治理插件，不向业务用户开放编码Agent或本机文件、命令、技能、模型配置能力。
- 一个登录会话对应一个内存型DSH实例。业务内容只能由用户主动下载，不能写入服务器文件、数据库或浏览器持久化空间。

```powershell
npm run verify:dsh-entry
npm run verify:structure-pilot
npm run start:structure-pilot
npm run smoke:structure-pilot
```

MDM 代码变化按影响面选择:

```powershell
npm --prefix apps/mdm-platform run test:frontend
npm --prefix apps/mdm-platform run test:project-roles
npm --prefix apps/mdm-platform run test:process-governance
npm --prefix apps/mdm-platform run test:mainline
npm --prefix apps/mdm-platform run test:role-workbench
```

## 交付口径

最终回复应包含:

- 本次修改目标。
- 实际修改或删除的文件。
- 文档同步结果。
- 验证命令和结果。
- 未验证项、残留风险或需要用户决策的事项。

不要只回复"已完成"。
