# 九部门流程与数据字典模板生成器

本目录保留九部门历史模板复核包的生成工具。旧 `docs/` 快照和副本只用于兼容预填；不构成现行业务规则、组织职责或正式治理依据。只有用户明确要求维护该历史复核包时才运行，不另建当前 PMO/3001/3000 生成链。

## 边界

- 只读输入：`docs/norms/{部门}部门-能力-流程-系统映射关系.md`、`docs/company-sankey-data.json`。
- 不修改 `docs/norms/`、桑基图快照、PMO 驾驶舱、MDM 数据库或 3001。
- Excel 是本批次填报载体；预填内容须按当前外部材料和业务确认复核。Word 只解释该批次填写与评审口径。
- 制度标题按原文保留。无法唯一解析时必须保留缺证状态，不得臆造制度名称。

## 脚本

- `build-template-data.mjs`：解析九部门 L3、A1、系统映射和制度证据，要求 `--legacy-display --out`，输出标准化 JSON，并验证原历史包的 273 条 L3、1415 条 A1、7 条系统承接待确认流程；这些固定数量不是当前全公司业务数量。
- `build-workbooks.mjs`：使用 `@oai/artifact-tool` 生成九份 Excel；每份包含 `00`、`01`、`02`、`03`、`04`、`05`、`98`、`99` 八张工作表。
- `protect-workbooks.ps1`：通过本机 Excel 将每份工作簿的 `99_来源快照` 设为无密码只读保护，用户仍可按组织规则解除保护。
- `build-guide.py`：使用 `python-docx` 生成《流程与数据梳理填写及评审标准》；`--output-dir` 按同一份数据的 `packageDate` 自动命名，仍兼容显式 `--output`。
- `build-manifest.mjs`：核对预期文件存在后生成交付清单和部门数量汇总。
- `verify-workbooks.mjs`：重新导入九份最终工作簿，验证固定工作表、数量、制度名称列、系统承接待确认数量和公式错误。

## 运行

先通过 Codex workspace dependency loader 取得受管 Node.js、Python 和 `node_modules` 路径。工作簿脚本应复制到临时目录运行，并在该目录创建指向受管 `node_modules` 的 junction。

```powershell
$node = '<workspace dependency node.exe>'
$python = '<workspace dependency python.exe>'
$managedNodeModules = '<workspace dependency node_modules>'
$tmp = Join-Path $env:TEMP 'infomat-process-template-build'
$output = '<delivery directory>'
$packageDate = '<本批次日期 YYYY-MM-DD>'

New-Item -ItemType Directory -Force -Path $tmp, $output | Out-Null
& $node scripts/process-governance-templates/build-template-data.mjs `
  --legacy-display --package-date $packageDate --out (Join-Path $tmp 'template-data.json')

$workbookBuilder = Join-Path $tmp 'workbook-builder'
New-Item -ItemType Directory -Force -Path $workbookBuilder | Out-Null
Copy-Item scripts/process-governance-templates/build-workbooks.mjs (Join-Path $workbookBuilder 'build-workbooks.mjs') -Force
New-Item -ItemType Junction -Path (Join-Path $workbookBuilder 'node_modules') -Target $managedNodeModules | Out-Null
& $node (Join-Path $workbookBuilder 'build-workbooks.mjs') `
  --data (Join-Path $tmp 'template-data.json') `
  --output $output `
  --qa (Join-Path $tmp 'qa')

& scripts/process-governance-templates/protect-workbooks.ps1 -WorkbookDirectory $output

& $python scripts/process-governance-templates/build-guide.py `
  --data (Join-Path $tmp 'template-data.json') `
  --asset-dir '<meeting material directory>' `
  --output-dir $output

& $node scripts/process-governance-templates/build-manifest.mjs `
  --data (Join-Path $tmp 'template-data.json') `
  --output $output

Copy-Item scripts/process-governance-templates/verify-workbooks.mjs (Join-Path $workbookBuilder 'verify-workbooks.mjs') -Force
& $node (Join-Path $workbookBuilder 'verify-workbooks.mjs') `
  --data (Join-Path $tmp 'template-data.json') `
  --output $output `
  --report (Join-Path $tmp 'final-workbook-verification.json')
```

`packageDate` 是本批次所有文件名和 Word 编制日期的统一日期；未指定时按 Asia/Shanghai 当天生成，`generatedAt` 保留实际生成时刻。工作簿、Word、清单和验证器读取同一份 JSON；旧数据包未含 `packageDate` 时继续按 `generatedAt`/`snapshotDate` 回退，保持历史包可读。

## 验证

`npm run test:root-script-safety` 用合成文件存在夹具验证日期优先级、历史回退及无兼容标识停止；它不生成真实 Office 交付物，也不代替下面的渲染检查。

1. 标准化脚本必须输出 `273 L3 / 1415 A1 / 7 unmapped`，且流程、A1 制度名称缺失数均为 0。
2. 工作簿公式错误扫描必须为 0；每个部门的 L3、A1 和待确认系统承接数量必须与桑基图快照一致。
3. 每份工作簿必须包含 8 张工作表，`01` 和 `02` 中的原文制度名称位于冻结区内。
4. 使用本机 Office 只读打开并逐表渲染检查表头、长文本、冻结列、颜色和公式结果。
5. Word 必须逐页渲染，检查图片、表格、分页、页眉页脚和长文本。

## 输出副作用

脚本只在指定输出目录创建 `.xlsx`、`.docx` 和临时 QA 文件；不会写回历史输入副本或外部系统；工作簿保护脚本另需本机 Excel，只有明确输出对象才运行。
