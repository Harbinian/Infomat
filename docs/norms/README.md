# docs/norms 说明

> 状态：流程输入基线目录
> 生效日期：2026-06-10  
> 范围：部门能力、流程、应用系统、A1 业务行为和部门桑基图交付物。

本目录承载制度/表单源文件材料、部门流程输入基线和部门桑基图资产。修改这里的部门流程输入基线后，需要重新生成公司级快照，PMO 驾驶舱和 MDM 流程治理承接才会看到新数据。

## 1. 主责文件

| 文件模式 | 作用 | 口径 |
|---|---|---|
| `{部门}部门-能力-流程-系统映射关系.md` | DCM/BBM 流程输入基线 | 已确认流程映射输入 |
| `流程映射表字段说明.md` | DCM/BBM 映射表字段口径 | 字段说明和“在哪发现”展示拆解 |
| `{部门}能力层与MDM建设要求.md` | 能力层和 MDM 建设要求说明 | 部门配套说明 |
| `{部门}部门能力流程系统桑基图.html` | 部门桑基图静态页面 | 由映射口径派生 |
| `流程治理/跨部门完整性检查报告.md` | 跨部门引用完整性报告 | 审计报告，不替代流程输入基线 |
| `_quality-report.md` | DCM/BBM 质检输出 | 生成物，不手工维护 |

部门业务资料子目录用于承载各部门制度/表单源文件材料和整理过程，不替代流程输入基线。

部门流程输入基线 Markdown 可在文件头使用“流程治理结构块 v1”。`parse-sankey-data.mjs` 会优先读取该结构块中的 `meta`、`l3_catalog`、`a1_catalog`、`evidence_catalog`、可选 `work_role_bindings` 和 `mdm_requirement_catalog`；正文旧 Markdown 表格中未被结构块覆盖的 L3/A1 会继续合并进入快照，部门解析来源标记为 `hybrid`。未放结构块的部门会继续走旧 Markdown 解析，并输出回退告警。结构块内的应用系统只允许 `OA`、`MES`、`PLM`、`ERP` 或留空，禁止把 `MDM` 写成应用系统。

工作角色绑定是独立受控关系，不扩宽 DCM/BBM 主表：

- 只有经过行政人事部角色/岗位映射确认和流程责任部门绑定确认的 `confirmed` 关系才能写入基线；候选、待确认项和自动匹配结果不得写入。
- 结构块绑定引用同一结构块的 `evidence_catalog`。
- 旧 Markdown 基线必须在同一“工作角色绑定”章节同时维护“工作角色绑定证据”表；绑定表与证据表的固定字段见 `../../scripts/README.md` 的“流程工作角色绑定输入”。
- 证据必须为 `verified`，包含源文件、条款/页码/表格定位、原文摘录和抽取方式；OCR 或待复核证据不能支撑正式绑定。
- 无效正式绑定会让 parser 在更新 `docs/company-sankey-data.json` 前非零退出，不能降级为普通告警。

## 2. 修改流程

修改流程输入基线 Markdown 后，从仓库根目录依次运行：

```powershell
node scripts/parse-sankey-data.mjs
npm run test:parse-sankey-structure-block
node scripts/check-dcm-bbm.mjs --no-fail
node scripts/verify-norms-source-mapping.mjs
```

如果当前目录是 `docs/norms`，使用：

```powershell
node ../../scripts/parse-sankey-data.mjs
npm --prefix ../.. run test:parse-sankey-structure-block
node ../../scripts/check-dcm-bbm.mjs --no-fail
node ../../scripts/verify-norms-source-mapping.mjs
```

`parse-sankey-data.mjs` 会更新 `docs/company-sankey-data.json` 并注入 PMO 驾驶舱内嵌数据。`check-dcm-bbm.mjs` 会刷新 `_quality-report.md`。`verify-norms-source-mapping.mjs` 会只读盘点 `docs/norms` 源文件和映射表，并输出原文-映射表核验报告及 `artifacts/norms-source-mapping-verify/` 机器明细。

目录级维护规则见 `AGENTS.md`。修改流程输入基线、质检命令、静态资产引用或部门桑基图维护方式时，必须同步更新本 README 或 `AGENTS.md`。

## 3. 静态资产约定

本目录下的部门桑基图 HTML 必须引用同目录的 ECharts：

```html
<script src="echarts.min.js"></script>
```

不要改成 `../echarts.min.js`。PMO 页面和 MDM 前端有各自的静态资产约定。

## 4. 已知缺口

工程技术部映射交付物、历史部门别名和跨部门风险来源口径见：

- `docs/reports/2026-06-10-process-truth-gap-audit.md`
- `docs/reports/2026-06-10-full-repo-remediation-triage.md`

本 README 只说明目录边界，不补写缺失部门映射，不重算流程数据。

## 5. 修改自检

1. 新增部门映射时，先确认 `docs/organization/组织架构和部门职责.md` 中的部门名称。
2. 修改 A1 业务行为、跨部门输入输出或应用系统字段后，重新生成公司级快照。
3. 修改证据字段或“在哪发现”展示口径后，运行 `node scripts/verify-norms-source-mapping.mjs`，确认源文件编号、制度或表单名称、大概位置、业务流程、业务行为可追溯。
4. 新增或修改工作角色绑定时，确认正式角色/岗位映射已发布、绑定证据表可定位且非 OCR，再运行 parser 与结构块测试；不得为通过校验临时造 `WR-*` 编码。
5. 处理 `_quality-report.md` 或原文-映射表核验报告中的 `BLOCK` 前，优先回到流程输入基线和源文件修正源头。
6. 只修改静态 HTML 时，确认 ECharts 引用仍为本目录相对路径。
