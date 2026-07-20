# AGENTS.md

本目录用于沉淀部门体系文件、DCM 映射、BBM 行为明细和部门桑基图页面。

根目录 `AGENTS.md`、`CODEX.md` 和三份边界文件仍然有效。本文件只补充 `docs/norms/` 的流程输入基线维护规则。

## DCM / BBM 质检脚本

在本目录新增或修改以下内容后，必须运行 DCM/BBM 双合同质检脚本：

- `{部门}部门-能力-流程-系统映射关系.md`
- `{部门}能力层与MDM建设要求.md`
- `{部门}部门能力流程系统桑基图.html`
- 业务行为（A1）映射、审批流、跨部门输入输出、应用系统（S1）字段
- 已确认工作角色绑定及其独立证据表
- `pmo/procedure-management/dashboard.html` 内嵌 sankey-data

从仓库根目录运行：

```powershell
node scripts/parse-sankey-data.mjs
node scripts/check-dcm-bbm.mjs --no-fail
node scripts/verify-norms-source-mapping.mjs
```

如果当前目录是 `docs/norms`，运行：

```powershell
node ../../scripts/parse-sankey-data.mjs
node ../../scripts/check-dcm-bbm.mjs --no-fail
node ../../scripts/verify-norms-source-mapping.mjs
```

## 质检口径

- DCM 管稳定骨架：`部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 业务流程（L3）→ 应用系统（S1）`。
- BBM 管行为明细：`业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）`。
- BBM 只能挂接到 DCM 已存在的业务流程（L3），不能反向改写 DCM 的能力域（L1）、业务能力（L2）、业务流程（L3）口径。
- 应用系统（S1）只能是 `OA`、`MES`、`PLM`、`ERP` 或留空；`MDM` 不得作为应用系统（S1）。
- 业务行为（A1）必须并入标准映射文档，不得另建 `{部门}A1业务行为映射关系.md` 或 `{部门}部门能力流程行为系统桑基图.html`。
- 证据字段应能拆解为源文件编号、制度或表单名称、条款/表格/摘录等“大概位置”；`verify-norms-source-mapping.mjs` 只读核验这些锚点，不自动改写流程输入基线。
- 工作角色候选和待确认关系不得写入流程输入基线。结构块 `work_role_bindings` 只允许 `confirmed`；旧 Markdown 录入必须在同一“工作角色绑定”章节同时维护“工作角色绑定证据”表，字段合同见 `scripts/README.md`。
- 已确认工作角色关系必须引用有效 L3/A1、行政人事正式角色及参与部门岗位映射，并有 `verified`、可定位、非 OCR 的证据和流程责任部门确认依据。任一正式关系无效时，`parse-sankey-data.mjs` 必须在写公司快照前非零退出。
- 新增或修改本目录下的部门桑基图 HTML 时，ECharts 必须引用同目录 `echarts.min.js`；禁止写成 `../echarts.min.js`。

## 报告处理

- `BLOCK`：必须处理或明确登记为历史遗留，否则不要交付。
- `WARN`：需要判断是历史口径差异、待部门确认，还是应立即修正。
- `INFO`：通常是未建模部门、占位部门或提醒项。

`docs/norms/_quality-report.md` 是质检输出，不手工维护。

## 文档同步

修改流程输入基线、脚本口径、质检命令、静态资产引用或部门桑基图维护方式时，必须同步更新 `README.md` 和本文件。无需更新文档时，在交付说明中写明原因。
