# 九部门流程与数据字典模板生成器

本目录用于从当前流程输入基线生成九部门流程梳理工作簿和公司级填写说明。

## 边界

- 只读输入：`docs/norms/{部门}部门-能力-流程-系统映射关系.md`、`docs/company-sankey-data.json`。
- 不修改 `docs/norms/`、桑基图快照、PMO 驾驶舱、MDM 数据库或 3001。
- Excel 是部门填报真源；Word 只解释填写与评审口径。
- 制度标题按原文保留。无法唯一解析时必须保留缺证状态，不得臆造制度名称。

## 脚本

- `build-template-data.mjs`：解析九部门 L3、A1、系统映射和制度证据，输出标准化 JSON，并验证 273 条 L3、1415 条 A1、7 条系统承接待确认流程。
- `build-workbooks.mjs`：使用 `@oai/artifact-tool` 生成九份 Excel；每份包含 `00`、`01`、`02`、`03`、`04`、`05`、`98`、`99` 八张工作表。
- `protect-workbooks.ps1`：通过本机 Excel 将每份工作簿的 `99_来源快照` 设为无密码只读保护，用户仍可按组织规则解除保护。
- `build-guide.py`：使用 `python-docx` 生成公司级《流程与数据梳理填写及评审标准》。
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

New-Item -ItemType Directory -Force -Path $tmp, $output | Out-Null
& $node scripts/process-governance-templates/build-template-data.mjs --out (Join-Path $tmp 'template-data.json')

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
  --output (Join-Path $output '流程与数据梳理填写及评审标准_2026-07-17.docx')

& $node scripts/process-governance-templates/build-manifest.mjs `
  --data (Join-Path $tmp 'template-data.json') `
  --output $output

Copy-Item scripts/process-governance-templates/verify-workbooks.mjs (Join-Path $workbookBuilder 'verify-workbooks.mjs') -Force
& $node (Join-Path $workbookBuilder 'verify-workbooks.mjs') `
  --data (Join-Path $tmp 'template-data.json') `
  --output $output `
  --report (Join-Path $tmp 'final-workbook-verification.json')
```

## 验证

1. 标准化脚本必须输出 `273 L3 / 1415 A1 / 7 unmapped`，且流程、A1 制度名称缺失数均为 0。
2. 工作簿公式错误扫描必须为 0；每个部门的 L3、A1 和待确认系统承接数量必须与桑基图快照一致。
3. 每份工作簿必须包含 8 张工作表，`01` 和 `02` 中的原文制度名称位于冻结区内。
4. 使用本机 Office 只读打开并逐表渲染检查表头、长文本、冻结列、颜色和公式结果。
5. Word 必须逐页渲染，检查图片、表格、分页、页眉页脚和长文本。

## 输出副作用

脚本只在指定输出目录创建 `.xlsx`、`.docx` 和临时 QA 文件；不会写回流程输入真源或外部系统。
