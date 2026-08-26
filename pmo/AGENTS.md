# AGENTS.md — PMO 数字化底座

`pmo/` 目录包含昌兴复材项目管理办公室（PMO）数字化底座，含流程地图驾驶舱、React 甘特图 / PMO 看板、周会事项台账和交付物工作台。

根目录 `AGENTS.md` 和 `CODEX.md` 仍然有效。本文件只补充 PMO 目录内的维护规则。

## 目录结构

```text
pmo/
├── AGENTS.md                          # 本文件 — PMO 总览
├── README.md                          # PMO 入口说明
├── procedure-management/              # 流程地图驾驶舱
│   ├── AGENTS.md                      # 驾驶舱维护规则
│   └── dashboard.html                 # 主驾驶舱
├── gantt-react/                       # 甘特图 / PMO 看板
│   ├── AGENTS.md                      # 应用维护规则
│   ├── README.md
│   ├── src/
│   └── package.json
├── deliverables/                      # PMO 交付物正本
├── tasks.json                         # 由 Markdown 真源生成
├── pmo-source-manifest.json           # PMO 服务读取的真源清单
├── 信息化项目_计划管控真源.md
├── 信息化项目_WBS结构真源.md
├── 信息化项目_执行标准真源.md
├── 信息化项目_工作平衡.md
├── 信息化项目_工作开展原则.md
├── 信息化项目_协同工作规则.md
├── 信息化项目_部门主备对接人名单.md
├── 信息化项目_协同工作规则_群通知.md
├── build_pmo_task_data.py
└── pmo-gantt-known-issues.md
```

## 真源边界

- PMO 计划、资源、风险、阶段门和执行字段以 `信息化项目_计划管控真源.md` 为准。
- WBS 编号、父子层级和排序以 `信息化项目_WBS结构真源.md` 为准。
- 执行标准卡、检查清单、完成判定和证据要求以 `信息化项目_执行标准真源.md` 为准。
- 人员分配、例会把关机制、高压窗口和推进原则分别以 `信息化项目_工作平衡.md`、`信息化项目_工作开展原则.md` 为准。
- 部门主备岗、会议、行动项、调整、升级和完成确认以 `信息化项目_协同工作规则.md` 为准；当前人员名单以 `信息化项目_部门主备对接人名单.md` 为准。
- `信息化项目_协同工作规则_群通知.md` 是信息化工作群发布副本，不替代规则正文或人员名单。
- `tasks.json`、`pmo-source-manifest.json` 和 `gantt-react/public/*` 是生成消费文件，不手工维护。

## 数据更新流程

1. 先修改对应 Markdown 真源。
2. 在 `pmo/` 下运行：

```powershell
python build_pmo_task_data.py
```

3. 回到仓库根目录运行：

```powershell
npm run test:pmo-task-data
```

4. 如任务数、字段数或里程碑数量变化，先核对 Markdown 真源是否确实发生增删。

当前两份`tasks.json`中的每条任务固定输出43个顶层字段，唯一字段清单为`build_pmo_task_data.py`中的`TASK_OUTPUT_FIELD_KEYS`。新增或删除输出字段时，维护人员必须同时修改该清单、生成逻辑、计划真源摘要、两份README和`../scripts/check-pmo-task-data.mjs`；不得只修改任务样本、manifest或页面说明。

## 流程地图驾驶舱

- 主文件是 `procedure-management/dashboard.html`。
- 该页面是展示副本，流程数据来自 `docs/norms/` 和 `docs/organization/`，由 `scripts/parse-sankey-data.mjs` 注入。
- 修改页面样式或交互前先读 `procedure-management/AGENTS.md`。

## 甘特图 / PMO 看板

- 主应用在 `gantt-react/`，使用 React + Vite。
- 开发模式默认访问 `http://localhost:5174`。
- 修改应用前先读 `gantt-react/AGENTS.md` 和 `gantt-react/README.md`。
- “周会事项”页签只作 PMO 周会模板试运行，数据保存在浏览器本地，不回写 PMO Markdown 真源。
- 独立 3002 周会行动项服务位于 `apps/weekly-action-service/`，用于服务端本机运行台账；PMO 真源仍以 Markdown 为准，3002 不回写 `tasks.json`。
- 交付物状态正本在 `pmo/deliverables/DLV-XXX-*.md`，dev 模式运行产物默认写入被忽略的 `artifacts/pmo/deliverables/`。

## 文档同步

修改 PMO 代码、脚本、数据生成逻辑、前端行为、启动命令或测试命令时，必须同步更新对应 README、目录 `AGENTS.md`、PMO 真源说明或交付物说明。无需更新文档时，交付说明必须写清原因。
