# docs/norms 说明

> 状态：历史制度、映射及兼容消费目录
> 生效日期：2026-06-10  
> 范围：部门能力、流程、应用系统、A1 业务行为和部门桑基图交付物。

本目录保留历史制度、表单、映射及桑基图资产。2026-09-11已撤销全部`docs/`真源身份；当前编制依据用户指定外部材料及业务说明，用户从3001下载未审核JSON后手动上传3000治理。下方数据形状与检查规则仅约束获准维护的旧消费链，不决定当前业务事实或触发数据库同步。

## 1. 主责文件

| 文件模式 | 作用 | 口径 |
|---|---|---|
| `{部门}部门-能力-流程-系统映射关系.md` | DCM/BBM 流程输入基线 | 历史时点的映射记录 |
| `流程映射表字段说明.md` | DCM/BBM 映射表字段口径 | 字段说明和“在哪发现”展示拆解 |
| `{部门}能力层与MDM建设要求.md` | 能力层和 MDM 建设要求说明 | 部门配套说明 |
| `{部门}部门能力流程系统桑基图.html` | 部门桑基图静态页面 | 由映射口径派生 |
| `流程治理/跨部门完整性检查报告.md` | 跨部门引用完整性报告 | 审计报告，不替代流程输入基线 |
| `_quality-report.md` | DCM/BBM 质检输出 | 生成物，不手工维护 |

部门业务资料子目录保留历史制度、表单和整理过程，不作为当前治理依据。

部门流程输入基线 Markdown 可在文件头使用“流程治理结构块 v1”。`parse-sankey-data.mjs` 会优先读取该结构块中的 `meta`、`l3_catalog`、`a1_catalog`、`evidence_catalog`、可选 `work_role_bindings` 和 `mdm_requirement_catalog`；正文旧 Markdown 表格中未被结构块覆盖的 L3/A1 会继续合并进入快照，部门解析来源标记为 `hybrid`。未放结构块的部门会继续走旧 Markdown 解析，并输出回退告警。结构块内的应用系统只允许 `OA`、`MES`、`PLM`、`ERP` 或留空，禁止把 `MDM` 写成应用系统。

工作角色绑定是独立受控关系，不扩宽 DCM/BBM 主表：

- 只有经过行政人事部角色/岗位映射确认和流程责任部门绑定确认的 `confirmed` 关系才能写入基线；候选、待确认项和自动匹配结果不得写入。
- 结构块绑定引用同一结构块的 `evidence_catalog`。
- 旧 Markdown 基线必须在同一“工作角色绑定”章节同时维护“工作角色绑定证据”表；绑定表与证据表的固定字段见 `../../scripts/README.md` 的“流程工作角色绑定输入”。
- 证据必须为 `verified`，包含源文件、条款/页码/表格定位、原文摘录和抽取方式；OCR 或待复核证据不能支撑正式绑定。
- 无效正式绑定会让 parser 在更新 `docs/company-sankey-data.json` 前非零退出，不能降级为普通告警。

## 2. 历史兼容维护

只有获准维护旧展示消费链时才选择输入和输出。从仓库根运行：

```powershell
node scripts/parse-sankey-data.mjs --legacy-display --domain-map <historical-domain-map.json> --out <snapshot.json>
npm run test:parse-sankey-structure-block
```

部门域JSON必须包含非空 `departments` 对象，值为明确域名；不得从旧组织Markdown的首个代码块猜取。parser无默认写入；只有追加 `--dashboard <HTML>` 才注入指定页面。占位路径须换成已核对输入和明确输出。

`check-dcm-bbm.mjs --no-fail` 会刷新质检报告；`verify-norms-source-mapping.mjs`读取历史源文件并生成核验报告及 `artifacts/norms-source-mapping-verify/` 明细。按维护范围选择，不将报告通过称为业务确认。其他目录下执行时，先回仓库根；不复制另一套默认命令。

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

1. 维护历史映射时，使用显式选定的历史部门域JSON；当前部门名称须有外部材料或有权确认，不从组织旧说明推断。
2. 获准修改旧A1、跨部门输入输出或系统字段后，按影响显式生成指定快照；不自动更新当前治理。
3. 修改证据字段或“在哪发现”展示口径后，运行 `node scripts/verify-norms-source-mapping.mjs`，确认源文件编号、制度或表单名称、大概位置、业务流程、业务行为可追溯。
4. 新增或修改工作角色绑定时，确认正式角色/岗位映射已发布、绑定证据表可定位且非 OCR，再运行 parser 与结构块测试；不得为通过校验临时造 `WR-*` 编码。
5. 处理 `_quality-report.md` 或原文-映射表核验报告中的 `BLOCK` 前，优先回到流程输入基线和源文件修正源头。
6. 只修改静态 HTML 时，确认 ECharts 引用仍为本目录相对路径。
