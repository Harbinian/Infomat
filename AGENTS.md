# AGENTS.md

AI 助手在本项目协作时的补充约定(与 CLAUDE.md 配套)。

## 项目当前阶段

仓库处于 **"流程地图与数据地图的梳理与沉淀"** 阶段,MDM 平台开发暂时搁置。
在这个阶段:**应用系统不是分析对象,流程才是**。

## 仓库边界入口

开始任何跨目录任务前,先读取:

- `REPOSITORY_BOUNDARY.md`:仓库放什么、不放什么。
- `DIRECTORY_OWNERSHIP.md`:各目录责任、真源、可改规则和禁止事项。
- `MAINLINE_MAP.md`:流程治理、字段台账、MDM、PMO 与脚本之间的数据流。

如果任务跨越资料、应用、PMO 展示、脚本或 AI 工作区,先确认主责资产,不要顺手移动文件或重排目录。

## 沟通与命名约定

- **避免**对具体应用系统(OA / MES / ERP / PLM)做"最忙/承载最多/主用"等评价性描述。
  - ❌ "OA 是最忙的系统,承载了 124 条流程"
  - ✅ "目前有 124 个流程建议落位到 OA 类应用"
  - ✅ "X 个流程尚未明确落位的应用系统"
- **可以**说"X 个流程""Y 个承载关系""Z 个待补全部门"等纯数量描述。
- 当用户问"该用哪个系统"时,先反问业务场景,不要直接给出系统选型建议。

## 仪表盘 / 统计页面约定

- 统计 / 驾驶舱类页面统一放在 `pmo/` 目录下(如 `pmo/procedure-management/dashboard.html`)。
- **支持两种模式**:全公司视图 / 单域视图(顶部切换)。
- **不需要** CSV 导出(管理层只看不动手)。
- **关键发现** 区可自动生成,但遵循上述"避免系统评价"约定。
- 数据源优先读取 PMO 驾驶舱 HTML 内嵌的 `#sankey-data`,不重造数据。
- 视觉延续米色暖宣纸系(赭红/鼠尾草/雾蓝/暗金主辅分明),跟 Sankey 保持一致。

## MDM 角色工作台约定

- MDM 前端主责资产在 `apps/mdm-platform/`。调整登录后首页、角色工作台、项目角色或 RBAC 接口时,不要改 `docs/norms/`、PMO 驾驶舱或流程真源。
- 登录后默认第一屏为 `roleWorkbench`。首屏必须让用户知道自己该干什么:顶部显示当前身份、当前部门、今天优先处理事项数;左侧第一块固定为"我现在该做什么",列出 1 到 3 个下一步动作。
- 角色分组保持为"项目工作角色 / 基础权限角色"。项目工作角色至少覆盖 `it_lead`、`project_lead`、`business_contact`、`data_quality`、`decision_group`;基础权限角色保留 `submitter`、`owner`、`reviewer`、`admin`。
- 多角色用户默认合并展示为"我的工作台",事项和角色卡片要能看出来源角色。
- "角色使用说明"中,每个角色必须包含:角色目标、第一步入口、典型样例、常见误区、完成标准。样例使用真实业务口吻,但不要写死敏感数据。
- 角色桑基图层级固定为:角色 → 业务能力 → L3流程 → A1业务行为 → 处理入口。点击任一节点后,右侧必须显示对应事项、样例解释和可执行入口。
- 默认视角为"待办优先";切换到"全量职责"后展示该角色全部职责链路。
- `/api/org/me` 应返回当前用户全部 RBAC 角色编码/名称;`GET /api/role-workbench?mode=todo|all` 返回角色、工作流步骤、桑基数据、待办、样例说明和跳转目标。
- 变更 MDM 角色工作台后,优先回归: `npm run test:frontend`、`npm run test:project-roles`、`npm run test:process-governance`、`npm run test:mainline`。如新增或调整工作台接口,同步覆盖 `npm run test:role-workbench`。

## 静态资产

- `pmo/` 等项目页使用项目根的 `echarts.min.js`，按相对路径引用 `<script src="../echarts.min.js"></script>`。
- `docs/norms/` 下的部门桑基图页面使用本目录内的 `docs/norms/echarts.min.js`，必须引用 `<script src="echarts.min.js"></script>`，禁止写成 `../echarts.min.js`。
- `apps/mdm-platform/public/` 下的 MDM 前端页面使用本目录内的 `echarts.min.js`,必须引用 `<script src="echarts.min.js"></script>`。

## 数据真源

- **部门→域映射**:`docs/organization/组织架构和部门职责.md` 是真源。任何脚本/页面里的 `DEPT_DOMAIN` 硬编码都必须跟它一致(注意:是"直**辖**"域,不是"直**属**"域)。
  - 总经理直辖:工程技术部 / 质量管理部 / 财务部
  - 经营副总:行政人事部 / 经营发展部 / 物资保障部
  - 生产副总:项目管理部 / 复材车间 / 运维安环部
- **流程数据**:`docs/norms/{部门}部门-能力-流程-系统映射关系.md` 是原始来源,由 `scripts/parse-sankey-data.mjs` 解析并直接注入 PMO 驾驶舱 HTML 的 `<script id="sankey-data">` 标签。
  - 新增 / 改 norms 文件后必须跑 `node scripts/parse-sankey-data.mjs`,驾驶舱才会显示新数据。
