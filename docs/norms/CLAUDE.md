# CLAUDE.md

本目录用于沉淀部门体系文件、DCM 映射、BBM 行为明细和部门桑基图页面。

## DCM / BBM 质检脚本

在本目录新增或修改以下内容后，必须运行 DCM/BBM 双合同质检脚本：

- `{部门}部门-能力-流程-系统映射关系.md`
- `{部门}能力层与MDM建设要求.md`
- `{部门}部门能力流程系统桑基图.html`
- 业务行为（A1）映射、审批流、跨部门输入输出、应用系统（S1）字段
- `pmo/procedure-management/dashboard.html` (内嵌 sankey-data)

从仓库根目录运行：

```powershell
node scripts/check-dcm-bbm.mjs --no-fail
```

如果当前目录是 `docs/norms`，运行：

```powershell
node ../../scripts/check-dcm-bbm.mjs --no-fail
```

脚本会读取合同文件：

```text
docs/contracts/dcm-bbm-contract.json
```

并生成报告：

```text
docs/norms/_quality-report.md
```

## 质检口径

- DCM 管稳定骨架：`部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 业务流程（L3）→ 应用系统（S1）`。
- BBM 管行为明细：`业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）`。
- BBM 只能挂接到 DCM 已存在的业务流程（L3），不能反向改写 DCM 的能力域（L1）、业务能力（L2）、业务流程（L3）口径。
- 应用系统（S1）只能是 `OA`、`MES`、`PLM`、`ERP` 或留空；`MDM` 不得作为应用系统（S1）。
- 业务行为（A1）必须并入标准映射文档，不得另建 `{部门}A1业务行为映射关系.md` 或 `{部门}部门能力流程行为系统桑基图.html`。
- 新增或修改本目录下的部门桑基图 HTML 时，ECharts 必须引用同目录 `echarts.min.js`；禁止写成 `../echarts.min.js`。

## 报告处理

- `BLOCK`：必须处理或明确登记为历史遗留，否则不要交付。
- `WARN`：需要判断是历史口径差异、待部门确认，还是应立即修正。
- `INFO`：通常是未建模部门、占位部门或提醒项。

若修改了映射 Markdown，先重新生成公司级 JSON：

```powershell
node ../../scripts/parse-sankey-data.mjs
```

再运行：

```powershell
node ../../scripts/check-dcm-bbm.mjs --no-fail
```
