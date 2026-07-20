import fs from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = { data: '', output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--data') args.data = resolve(argv[++index] || '');
    else if (argv[index] === '--output') args.output = resolve(argv[++index] || '');
  }
  if (!args.data || !args.output) throw new Error('Usage: node build-manifest.mjs --data <json> --output <dir>');
  return args;
}

const args = parseArgs(process.argv.slice(2));
const pkg = JSON.parse(await fs.readFile(args.data, 'utf8'));
const packageDate = String(pkg.generatedAt || pkg.snapshotDate).slice(0, 10);
const rows = [];
for (const department of pkg.departments) {
  const fileName = `${department.name}_流程与数据梳理模板_${packageDate}.xlsx`;
  const stat = await fs.stat(join(args.output, fileName));
  rows.push(`| ${department.name} | ${department.counts.processes} | ${department.counts.behaviors} | ${department.counts.unmappedProcesses} | ${department.counts.blockingProcessEvidence} | ${department.counts.blockingBehaviorEvidence} | ${fileName} | ${stat.size} |`);
}
const guideName = `流程与数据梳理填写及评审标准_${packageDate}.docx`;
const guideStat = await fs.stat(join(args.output, guideName));
const manifest = `# 九部门流程与数据梳理模板交付清单

- 编制日期：${packageDate}
- 流程映射快照：${pkg.snapshotDate}
- 数据范围：${pkg.totals.processes} 条 L3、${pkg.totals.behaviors} 条 A1、${pkg.totals.unmappedProcesses} 条系统承接方向待确认流程
- 制度名称解析：L3 缺失 ${pkg.totals.missingProcessTitles} 条，A1 缺失 ${pkg.totals.missingBehaviorTitles} 条
- 证据阻断：L3 ${pkg.totals.blockingProcessEvidence} 条，A1 ${pkg.totals.blockingBehaviorEvidence} 条；其中编号—名称不唯一分别为 ${pkg.totals.ambiguousProcessTitles} / ${pkg.totals.ambiguousBehaviorTitles} 条
- Excel 为部门唯一填报真源；Word 仅解释填写与评审口径

| 部门 | L3流程 | A1行为 | 系统承接待确认 | L3证据阻断 | A1证据阻断 | 文件 | 字节数 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
${rows.join('\n')}

## 通用说明

- ${guideName}（${guideStat.size} 字节）

## 每份工作簿固定结构

1. 00_填写说明
2. 01_流程总览
3. 02_业务行为
4. 03_数据字典
5. 04_证据索引
6. 05_完整性检查
7. 98_下拉选项
8. 99_来源快照（只读保护）

## 交付边界

- 本轮未修改流程输入基线、桑基图快照、PMO 驾驶舱或 MDM 数据。
- 本轮未登记正式 PMO DLV，也未导入 3001。
- 所有预填内容均需部门确认；“继承所属流程制度”只用于展示与追溯，不等于本行为已有直接原文证据。
`;
const manifestPath = join(args.output, '交付清单.md');
await fs.writeFile(manifestPath, manifest, 'utf8');
process.stdout.write(`${JSON.stringify({ manifest: basename(manifestPath), files: rows.length + 2, totals: pkg.totals })}\n`);
