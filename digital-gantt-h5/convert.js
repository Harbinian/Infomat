/**
 * convert.js — 信息化项目 CSV → JSON 转换脚本
 *
 * Reads ../pmo/信息化项目.csv and outputs tasks.json (pretty-printed JSON array).
 * 314 lines (1 header + 313 data rows). Skips empty rows.
 */

const fs = require('fs');
const path = require('path');

const csvPath = path.resolve(__dirname, '..', 'pmo', '信息化项目.csv');
const jsonPath = path.resolve(__dirname, 'tasks.json');

const raw = fs.readFileSync(csvPath, 'utf-8');

// Split lines, handling both \r\n and \n
const lines = raw.split(/\r?\n/);

// Header fields in order:
// ID, WBS, 任务名称, 任务类型, 工期, 开始时间, 完成时间,
// 前置任务, 资源名称, 责任部门, 供应商, 审核人/审批组,
// 风险等级, 里程碑, 交付物, 备注

const FIELD_MAP = [
  ['id',          'int'],
  ['wbs',         'str'],
  ['name',        'str'],
  ['type',        'str'],
  ['duration',    'str'],
  ['start',       'str'],
  ['finish',      'str'],
  ['predecessors','str'],
  ['resources',   'str'],
  ['department',  'str'],
  ['vendor',      'str'],
  ['reviewer',    'str'],
  ['risk',        'str'],
  ['milestone',   'str'],
  ['deliverable', 'str'],
  ['notes',       'str'],
];

const tasks = [];

// Skip header line (index 0)
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line === '') continue; // skip blank lines

  // Split by comma; some lines have trailing commas, so limit fields to 16
  const rawFields = line.split(',');

  // If the row has trailing comma(s), the split will produce extra empty strings.
  // We only need the first 16 fields.
  const fields = rawFields.slice(0, 16);

  // Pad with empty strings if needed (defensive, shouldn't happen)
  while (fields.length < 16) {
    fields.push('');
  }

  // Skip rows with no task name (CSV field index 2)
  if (!fields[2] || fields[2].trim() === '') continue;

  const task = {};
  for (let j = 0; j < FIELD_MAP.length; j++) {
    const [key, type] = FIELD_MAP[j];
    const val = (fields[j] || '').trim();
    task[key] = type === 'int' ? parseInt(val, 10) || 0 : val;
  }
  tasks.push(task);
}

fs.writeFileSync(jsonPath, JSON.stringify(tasks, null, 2), 'utf-8');

console.log(`Converted ${tasks.length} rows → ${path.relative(process.cwd(), jsonPath)}`);
