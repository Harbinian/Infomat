// R05 bounded parser for the legacy 字段台账 workbook.
//
// The route used to receive the whole file into memory and then walk it on the HTTP thread with
// no expansion, sheet, row, column or cell budget. A small compressed workbook could therefore
// cost an unbounded amount of CPU and memory while the event loop was blocked.
//
// This module reuses the extraction infrastructure that the evidence parsers already use:
// `inspectArchive` reads the ZIP central directory first and rejects damaged structures, oversized
// expansion, path traversal, duplicate names and macro/external-link/embedded content before
// ExcelJS allocates anything. The row walk then happens inside a worker thread with its own
// memory ceiling, a wall-clock timeout and a process-wide concurrency gate, so a hostile file
// cannot monopolise the request thread.
//
// The workbook's business meaning is unchanged: same sheet selection, same header row, same cell
// text rules, same list separators. Only the cost of reading it is bounded.
const ExcelJS = require('exceljs');
const { inspectArchive } = require('./masterDataTemplate');

const VERSION = 'legacy-field-import-v2';
// Local engineering bounds, not confirmed production capacity. They match the evidence parsers so
// one workbook cannot be cheap on one path and expensive on another.
const LIMITS = Object.freeze({
  bytes: 5 * 1024 * 1024,
  expanded: 32 * 1024 * 1024,
  entries: 1000,
  rows: 5000,
  columns: 64,
  cells: 100000,
  sheets: 8,
  maxImportRows: 5000,
  timeoutMs: 15000,
  concurrency: 2
});

const fail = (name, statusCode = 400, message = null) =>
  Object.assign(new Error(message || `字段台账解析失败（${name}）`), { code: `LEGACY_IMPORT_${name}`, statusCode });

function cellText(row, headerMap, header) {
  const index = headerMap[header];
  if (!index) return '';
  const value = row.getCell(index).value;
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('').trim();
  }
  return String(value).trim();
}

function buildHeaderMap(sheet) {
  const map = {};
  sheet.getRow(1).eachCell((cell, colNumber) => {
    if (cell.value) map[String(cell.value).trim()] = colNumber;
  });
  return map;
}

function normalizeNullable(value) {
  return value === '' || value === undefined ? null : value;
}

function listFromCell(value) {
  if (!value) return [];
  return String(value).split(/[,，;；、]/).map(item => item.trim()).filter(Boolean);
}

// Runs inside the worker thread, and directly in unit tests. Never touches the filesystem,
// the network or a database.
async function extractLegacyFieldsFromBytes(bytes, originalName, contextId, submittedBy) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail('EMPTY');
  if (bytes.length > LIMITS.bytes) throw fail('LIMIT', 413, 'Excel 文件不能超过 5MB');
  if (typeof originalName !== 'string' || originalName.length > 255 || !/\.xlsx$/i.test(originalName)) {
    throw fail('TYPE', 400, '只支持 .xlsx 文件');
  }
  // Structure, expansion, entries, rows, columns, cells, CRC and active content are all checked
  // before ExcelJS runs. The archive module answers in its own code family, so its failures are
  // translated here: one import path reports one family, and the caller handles one set of codes.
  try {
    inspectArchive(bytes, LIMITS);
  } catch (error) {
    const code = String((error && error.code) || '');
    const statusCode = (error && error.statusCode) || 400;
    if (code === 'TEMPLATE_LIMIT_EXCEEDED') throw fail('LIMIT', 413, error.message);
    if (code === 'TEMPLATE_ACTIVE_CONTENT_UNSUPPORTED') throw fail('ACTIVE_CONTENT', 400, error.message);
    throw fail('DAMAGED', statusCode === 413 ? 413 : 400, error.message);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes, { ignoreNodes: ['dataValidations', 'conditionalFormatting'] });
  } catch {
    throw fail('DAMAGED', 400, 'Excel 文件结构损坏，无法解析');
  }
  if (workbook.worksheets.length > LIMITS.sheets) throw fail('LIMIT', 413, `工作表数量超过 ${LIMITS.sheets} 张`);

  const sheet = workbook.getWorksheet('字段台账') || workbook.worksheets[0];
  if (!sheet) throw fail('TYPE', 400, 'Excel 中没有可读取的工作表');
  if (sheet.rowCount > LIMITS.rows || sheet.columnCount > LIMITS.columns) {
    throw fail('LIMIT', 413, `单个工作表不得超过 ${LIMITS.rows} 行、${LIMITS.columns} 列`);
  }

  const headerMap = buildHeaderMap(sheet);
  const requiredHeaders = ['数据对象', '字段说明'];
  const missing = requiredHeaders.filter(header => !headerMap[header]);
  if (missing.length) throw fail('HEADER', 400, `缺少表头：${missing.join(', ')}`);

  const rows = [];
  let cells = 0;
  sheet.eachRow((row, rowNumber) => {
    row.eachCell(() => { if (++cells > LIMITS.cells) throw fail('LIMIT', 413, `单元格总数超过 ${LIMITS.cells}`); });
    if (rowNumber === 1) return;
    const dataObject = cellText(row, headerMap, '数据对象');
    const note = cellText(row, headerMap, '字段说明');
    if (!dataObject && !note) return;
    if (rows.length >= LIMITS.maxImportRows) throw fail('LIMIT', 413, `导入行数超过 ${LIMITS.maxImportRows}`);
    rows.push({
      context_id: contextId,
      data_object: dataObject,
      business_definition: note,
      note,
      field_name_cn: normalizeNullable(cellText(row, headerMap, '中文字段名')),
      field_name_en: normalizeNullable(cellText(row, headerMap, '英文字段名')),
      field_type: normalizeNullable(cellText(row, headerMap, '字段类型')),
      consume_systems: listFromCell(cellText(row, headerMap, '消费系统')),
      sync_mode: normalizeNullable(cellText(row, headerMap, '同步方式')),
      submitted_by: submittedBy
    });
  });
  return rows;
}

let active = 0;

// Process-wide gate: a second concurrent parse is allowed, a third is refused rather than queued,
// so an upload burst cannot multiply the memory ceiling by the number of requests.
async function parseLegacyFields({ bytes, originalName, contextId, submittedBy, signal = null }) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes) throw fail('LIMIT', 413, 'Excel 文件不能超过 5MB');
  if (active >= LIMITS.concurrency) throw fail('BUSY', 503, '正在解析其他字段台账，请稍后重试');
  if (signal && signal.aborted) throw fail('ABORTED', 400, '导入已取消');

  active += 1;
  const { Worker } = require('node:worker_threads');
  let worker;
  let timer;
  let onAbort;
  try {
    worker = new Worker(require.resolve('./legacyImportThread'), {
      workerData: { bytes, originalName, contextId, submittedBy },
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    });
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(fail('TIMEOUT', 413, `字段台账解析超过 ${LIMITS.timeoutMs / 1000} 秒`)), LIMITS.timeoutMs);
      if (signal) {
        onAbort = () => reject(fail('ABORTED', 400, '导入已取消'));
        signal.addEventListener('abort', onAbort, { once: true });
      }
      worker.once('message', message => (message.result ? resolve(message.result) : reject(Object.assign(
        fail(message.error && message.error.name ? message.error.name : 'DAMAGED', (message.error && message.error.statusCode) || 400),
        { message: (message.error && message.error.message) || '字段台账解析失败' }))));
      worker.once('error', () => reject(fail('RESOURCE_LIMIT', 413, '字段台账超出可解析规模')));
      worker.once('exit', code => { if (code) reject(fail('RESOURCE_LIMIT', 413, '字段台账超出可解析规模')); });
    });
  } finally {
    clearTimeout(timer);
    if (onAbort && signal) signal.removeEventListener('abort', onAbort);
    if (worker) await worker.terminate();
    active -= 1;
  }
}

// Test seam: the gate is process-wide, so an isolated case can read it.
function activeParseCount() {
  return active;
}

module.exports = { VERSION, LIMITS, extractLegacyFieldsFromBytes, parseLegacyFields, activeParseCount, fail };
