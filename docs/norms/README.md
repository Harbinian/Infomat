# docs/norms 说明

> 状态：流程映射真源目录  
> 生效日期：2026-06-10  
> 范围：部门能力、流程、应用系统、A1 业务行为和部门桑基图交付物。

本目录是流程治理链路的原始来源之一。修改这里的部门映射文件后，需要重新生成公司级快照，PMO 驾驶舱和 MDM 流程治理承接才会看到新数据。

## 1. 主责文件

| 文件模式 | 作用 | 口径 |
|---|---|---|
| `{部门}部门-能力-流程-系统映射关系.md` | DCM/BBM 标准映射真源 | 原始来源 |
| `{部门}能力层与MDM建设要求.md` | 能力层和 MDM 建设要求说明 | 部门配套说明 |
| `{部门}部门能力流程系统桑基图.html` | 部门桑基图静态页面 | 由映射口径派生 |
| `流程治理/跨部门完整性检查报告.md` | 跨部门引用完整性报告 | 审计报告，不替代映射真源 |
| `_quality-report.md` | DCM/BBM 质检输出 | 生成物，不手工维护 |

部门业务资料子目录用于承载各部门输入材料和整理过程，不替代标准映射 Markdown。

## 2. 修改流程

修改标准映射 Markdown 后，从仓库根目录依次运行：

```powershell
node scripts/parse-sankey-data.mjs
node scripts/check-dcm-bbm.mjs --no-fail
```

如果当前目录是 `docs/norms`，使用：

```powershell
node ../../scripts/parse-sankey-data.mjs
node ../../scripts/check-dcm-bbm.mjs --no-fail
```

`parse-sankey-data.mjs` 会更新 `docs/company-sankey-data.json` 并注入 PMO 驾驶舱内嵌数据。`check-dcm-bbm.mjs` 会刷新 `_quality-report.md`。

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
3. 处理 `_quality-report.md` 的 `BLOCK` 前，优先回到标准映射 Markdown 修正源头。
4. 只修改静态 HTML 时，确认 ECharts 引用仍为本目录相对路径。
