// R05 legacy field-ledger parsing: bounded, off the request thread, and business-semantics
// unchanged. Pure unit test over synthetic workbooks; no HTTP, database or filesystem.
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const parser = require('../server/legacyImportParser');

const HEADERS = ['数据对象', '字段说明', '中文字段名', '英文字段名', '字段类型', '消费系统', '同步方式'];

async function workbookBuffer(sheetName, rows, headers = HEADERS) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  if (headers) sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function codeOf(error) {
  return String((error && error.code) || '');
}

// A minimal, hand-built ZIP so a hostile header can be expressed exactly (store method, so the
// declared sizes are entirely under the test's control).
function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      return c;
    });
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const declared = entry.declaredSize === undefined ? data.length : entry.declaredSize;
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, data);

    const dir = Buffer.alloc(46 + name.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(declared, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    name.copy(dir, 46);
    central.push(dir);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

test('the legacy template still parses to exactly the same rows', async () => {
  const bytes = await workbookBuffer('字段台账', [
    ['供应商', '供应商唯一编码', '供应商编码', 'supplier_code', '编码', 'ERP, SRM', '批量'],
    ['', '', '', '', '', '', ''],
    ['客户', '客户主数据说明', '客户名称', 'customer_name', '文本', 'ERP；CRM', '实时']
  ]);
  const rows = await parser.extractLegacyFieldsFromBytes(bytes, 'ledger.xlsx', 10, 42);
  assert.equal(rows.length, 2, 'a fully blank row is still skipped');
  assert.deepEqual(rows[0], {
    context_id: 10, data_object: '供应商', business_definition: '供应商唯一编码', note: '供应商唯一编码',
    field_name_cn: '供应商编码', field_name_en: 'supplier_code', field_type: '编码',
    consume_systems: ['ERP', 'SRM'], sync_mode: '批量', submitted_by: 42
  });
  assert.deepEqual(rows[1].consume_systems, ['ERP', 'CRM'], 'every supported separator still splits the list');
  assert.equal(rows[1].field_name_cn, '客户名称');
});

test('a file without the 字段台账 sheet still falls back to the first sheet', async () => {
  const bytes = await workbookBuffer('Sheet1', [['供应商', '说明', '名称', 'name', '文本', 'ERP', '实时']]);
  const rows = await parser.extractLegacyFieldsFromBytes(bytes, 'ledger.xlsx', 10, 42);
  assert.equal(rows.length, 1);
});

test('required headers are still required', async () => {
  const bytes = await workbookBuffer('字段台账', [['供应商', '说明']], ['数据对象', '中文字段名']);
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(bytes, 'ledger.xlsx', 10, 42),
    error => codeOf(error) === 'LEGACY_IMPORT_HEADER' && error.statusCode === 400);
});

test('a damaged archive is refused before the workbook is loaded', async () => {
  const bytes = await workbookBuffer('字段台账', [['供应商', '说明', '名称', 'name', '文本', 'ERP', '实时']]);
  const truncated = bytes.subarray(0, bytes.length - 30);
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(truncated, 'ledger.xlsx', 10, 42),
    error => /^(TEMPLATE_|LEGACY_IMPORT_)/.test(codeOf(error)));
});

test('an expansion the archive declares but does not contain is still refused', async () => {
  // The declared uncompressed size is what the archive claims; the check must not trust the
  // compressed size and must not wait until the memory has already been spent.
  const hostile = zip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<x/>'.repeat(4)), declaredSize: 64 * 1024 * 1024 }]);
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(hostile, 'ledger.xlsx', 10, 42),
    error => /^(TEMPLATE_|LEGACY_IMPORT_)/.test(codeOf(error)));
});

test('an archive with too many entries, or a traversal name, is refused', async () => {
  const many = zip(Array.from({ length: 1001 }, (_, i) => ({ name: `xl/parts/p${i}.xml`, data: Buffer.from('x') })));
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(many, 'ledger.xlsx', 10, 42),
    error => /^(TEMPLATE_|LEGACY_IMPORT_)/.test(codeOf(error)));
  const traversal = zip([{ name: '../xl/workbook.xml', data: Buffer.from('x') }]);
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(traversal, 'ledger.xlsx', 10, 42),
    error => /^(TEMPLATE_|LEGACY_IMPORT_)/.test(codeOf(error)));
});

test('the workbook budgets are enforced, each with a capacity answer', async () => {
  const tooManySheets = new ExcelJS.Workbook();
  for (let i = 0; i < 9; i += 1) tooManySheets.addWorksheet(`S${i}`).addRow(HEADERS);
  const sheetsBytes = Buffer.from(await tooManySheets.xlsx.writeBuffer());
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(sheetsBytes, 'ledger.xlsx', 10, 42),
    error => codeOf(error) === 'LEGACY_IMPORT_LIMIT' && error.statusCode === 413);

  const tooWide = await workbookBuffer('字段台账', [['a', 'b', 'c', 'd', 'e', 'f', 'g', ...Array.from({ length: 60 }, () => 'x')]]);
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(tooWide, 'ledger.xlsx', 10, 42),
    error => codeOf(error) === 'LEGACY_IMPORT_LIMIT' && error.statusCode === 413);

  const tooManyRows = await workbookBuffer('字段台账',
    Array.from({ length: 5001 }, (_, i) => [`对象${i}`, `说明${i}`, '', '', '', '', '']));
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(tooManyRows, 'ledger.xlsx', 10, 42),
    error => codeOf(error) === 'LEGACY_IMPORT_LIMIT' && error.statusCode === 413);
});

test('only .xlsx is accepted and every parse goes through the archive check', async () => {
  const bytes = await workbookBuffer('字段台账', [['供应商', '说明', '名称', 'name', '文本', 'ERP', '实时']]);
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(bytes, 'ledger.xls', 10, 42),
    error => codeOf(error) === 'LEGACY_IMPORT_TYPE');
  await assert.rejects(() => parser.extractLegacyFieldsFromBytes(Buffer.alloc(0), 'ledger.xlsx', 10, 42),
    error => codeOf(error) === 'LEGACY_IMPORT_EMPTY');
});

test('a burst is bounded by the concurrency gate instead of queueing', async () => {
  const bytes = await workbookBuffer('字段台账', Array.from({ length: 200 }, (_, i) => [`对象${i}`, `说明${i}`, '', '', '', '', '']));
  const first = parser.parseLegacyFields({ bytes, originalName: 'a.xlsx', contextId: 1, submittedBy: 1 });
  const second = parser.parseLegacyFields({ bytes, originalName: 'b.xlsx', contextId: 1, submittedBy: 1 });
  await assert.rejects(() => parser.parseLegacyFields({ bytes, originalName: 'c.xlsx', contextId: 1, submittedBy: 1 }),
    error => codeOf(error) === 'LEGACY_IMPORT_BUSY' && error.statusCode === 503);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.length, 200);
  assert.equal(b.length, 200);
  assert.equal(parser.activeParseCount(), 0, 'the gate is released on the ordinary path');
});

test('a cancelled request releases the gate and writes nothing', async () => {
  const bytes = await workbookBuffer('字段台账', Array.from({ length: 200 }, (_, i) => [`对象${i}`, `说明${i}`, '', '', '', '', '']));
  const controller = new AbortController();
  const pending = parser.parseLegacyFields({ bytes, originalName: 'a.xlsx', contextId: 1, submittedBy: 1, signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, error => codeOf(error) === 'LEGACY_IMPORT_ABORTED');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(parser.activeParseCount(), 0, 'the gate is released on the cancelled path too');
  const already = new AbortController();
  already.abort();
  await assert.rejects(() => parser.parseLegacyFields({ bytes, originalName: 'a.xlsx', contextId: 1, submittedBy: 1, signal: already.signal }),
    error => codeOf(error) === 'LEGACY_IMPORT_ABORTED');
  assert.equal(parser.activeParseCount(), 0);
});
