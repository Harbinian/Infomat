// Read-only OOXML extraction. Never evaluate formulas, links, macros or document instructions.
const ExcelJS = require('exceljs');
const { inspectArchive, cellSource } = require('./masterDataTemplate');
const { digest } = require('./dataMapDefinitionValues');
const crypto = require('node:crypto');
const VERSION = 'excel-evidence-v1';
const LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, expanded: 32 * 1024 * 1024, entries: 1000,
  rows: 5000, columns: 16384, cells: 100000, sheets: 32, snapshot: 24 * 1024 * 1024, ignoreValidationRanges: true, validateCrc:true });
const fail = (name, statusCode = 400) => Object.assign(new Error(name), { code: 'DEFINITION_EXCEL_' + name, statusCode });
async function extract(bytes, originalName) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail('EMPTY');
  if (bytes.length > LIMITS.bytes) throw fail('LIMIT', 413);
  if (typeof originalName !== 'string' || originalName.length > 255 || !/\.xlsx$/i.test(originalName)) throw fail('TYPE');
  const xmls=new Map();
  const archive = inspectArchive(bytes, LIMITS, (name,data)=>{if(name==='xl/workbook.xml'||name==='xl/_rels/workbook.xml.rels'||/^xl\/worksheets\/[^/]+\.xml$/.test(name))xmls.set(name,data.toString('utf8'));});
  const attr=(tag,key)=>tag.match(new RegExp('(?:^|\\s)'+key+'=["\x27]([^"\x27]*)["\x27]'))?.[1];
  const relations=new Map([...String(xmls.get('xl/_rels/workbook.xml.rels')).matchAll(/<(?:\w+:)?Relationship\s[^>]+>/g)].map(m=>[attr(m[0],'Id'),attr(m[0],'Target')]));
  const sheetPaths=[...String(xmls.get('xl/workbook.xml')).matchAll(/<(?:\w+:)?sheet\s[^>]+>/g)].map(m=>{const target=relations.get(attr(m[0],'r:id'));return target?require('node:path').posix.normalize(target.startsWith('/')?target.slice(1):'xl/'+target):null;});
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes, { ignoreNodes: ['dataValidations', 'conditionalFormatting'] }); } catch { throw fail('DAMAGED'); }
  if (workbook.worksheets.length > LIMITS.sheets) throw fail('LIMIT', 413);
  const sheets = []; let count = 0, formulaCount = 0;
  for (const [sheetIndex,sheet] of workbook.worksheets.entries()) {
    const rawCells=new Map([...String(xmls.get(sheetPaths[sheetIndex])||'').matchAll(/<(?:\w+:)?c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)].map(m=>[attr(m[1],'r'),{raw_xml_value:m[2]?.match(/<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1]??null,raw_xml_formula:m[2]?.match(/<(?:\w+:)?f(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?f>/)?.[1]??null}]));
    const cells = {};
    if (sheet.rowCount > LIMITS.rows || sheet.columnCount > LIMITS.columns) throw fail('LIMIT', 413);
    sheet.eachRow(row => row.eachCell(cell => {
      if (++count > LIMITS.cells) throw fail('LIMIT', 413);
      const source = cellSource(cell, sheet.name);
      if (source.raw_type === 'formula') formulaCount++;
      cells[cell.address] = { ...source, ...(rawCells.get(cell.address)||{raw_xml_value:null,raw_xml_formula:null}), raw_xml_status:rawCells.has(cell.address)?'available':'unavailable', merged_into: cell.isMerged && cell.master.address !== cell.address ? cell.master.address : null };
    }));
    sheets.push({ name: sheet.name, state: sheet.state, row_count: sheet.rowCount, column_count: sheet.columnCount,
      merges: sheet.model.merges || [], cells });
  }
  const document = { format: VERSION, sheets, coverage: { cell_count: count, formula_count: formulaCount,
    extraction_status: count ? 'extracted' : 'empty', formulas_evaluated: false,
    not_covered: ['图表、图片、切片器及绘图文字未提取', '条件格式、数据验证及无值样式单元格未提取', '不计算公式；缓存值未经重新计算核实', '不核定业务事实、主数据或权威来源', '不执行超链接、材料指令或远程抓取'] } };
  if (Buffer.byteLength(JSON.stringify(document)) > LIMITS.snapshot) throw fail('LIMIT', 413);
  return { original_name: originalName.split(/[\\/]/).pop(), raw_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    byte_length: bytes.length, parser_version: VERSION, archive, document, content_digest: digest(document) };
}
let active = 0;
async function parseExcelEvidence(bytes, name) {
  if (active >= 2) throw fail('BUSY', 503);
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes) throw fail('LIMIT', 413);
  active++;
  const { Worker } = require('node:worker_threads');
  let worker, timer;
  try {
    worker = new Worker(require.resolve('./excelEvidenceThread'), { workerData: { bytes, name }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(fail('TIMEOUT', 413)), 15000);
      worker.once('message', m => m.result ? resolve(m.result) : reject(Object.assign(fail('DAMAGED'), m.error)));
      worker.once('error', () => reject(fail('RESOURCE_LIMIT', 413)));
      worker.once('exit', code => { if (code) reject(fail('RESOURCE_LIMIT', 413)); });
    });
  } finally { clearTimeout(timer); if (worker) await worker.terminate(); active--; }
}
module.exports = { VERSION, LIMITS, extract, parseExcelEvidence, fail };
