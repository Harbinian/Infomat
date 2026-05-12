const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const templatePath = path.join(root, 'public', 'template.xlsx');

async function main() {
  assert.ok(fs.existsSync(indexPath), 'public/index.html should exist');
  const html = fs.readFileSync(indexPath, 'utf8');

  [
    '统计看板',
    '报送管理',
    '待办收到',
    '评审记录',
    '术语词典',
    '冲突管理'
  ].forEach(label => assert.ok(html.includes(label), `missing tab label ${label}`));

  [
    'https://cdn.jsdelivr.net/npm/echarts',
    '@keyframes fadeIn',
    '@keyframes slideUp',
    '@keyframes blink',
    '@keyframes pulse',
    '/api/org/me',
    '/api/mappings',
    '/api/field-entries',
    '/api/todos',
    '/api/conflicts',
    '/api/terminology',
    '/api/import/field-entries',
    '/api/export/excel',
    'template.xlsx'
  ].forEach(needle => assert.ok(html.includes(needle), `missing frontend hook ${needle}`));

  assert.ok(fs.existsSync(templatePath), 'public/template.xlsx should exist');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const sheet = workbook.getWorksheet('字段台账');
  assert.ok(sheet, 'template should include 字段台账 worksheet');

  const headers = sheet.getRow(1).values.slice(1);
  assert.deepStrictEqual(headers, ['数据对象', '字段说明', '中文字段名', '英文字段名', '字段类型', '消费系统', '同步方式']);
  assert.strictEqual(sheet.getRow(2).getCell(1).value, '客户');
  assert.ok(String(sheet.getRow(3).getCell(2).value || '').includes('仅数据对象和字段说明'));

  const guide = workbook.getWorksheet('填写说明');
  assert.ok(guide, 'template should include 填写说明 worksheet');
  assert.ok(String(guide.getRow(1).getCell(1).value || '').includes('MDM 字段台账导入模板'));

  console.log('Frontend assets test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
