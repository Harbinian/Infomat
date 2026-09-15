// File parsing and publication validation only; no database or filesystem writes.
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');

const MAX_ROWS = 5000;
const MAX_COLUMNS = 64;
const KINDS = new Set(['organization', 'roster', 'master_data']);
const FIELDS = {
  organization: [
    { key: 'code', label: '组织编码', required: true, aliases: ['部门编码', '组织编码', '办公室编码', 'code'] },
    { key: 'name', label: '组织名称', required: true, aliases: ['部门名称', '组织名称', '办公室名称', '部门', 'name'] },
    { key: 'unit_type', label: '组织层级', aliases: ['组织层级', 'unit_type'] },
    { key: 'owning_department_code', label: '归口部门编码', aliases: ['归口部门编码', '所属部门编码', 'owning_department_code'] },
    { key: 'manager_employee_no', label: '办公室负责人工号', aliases: ['办公室负责人工号', '负责人工号', 'manager_employee_no'] },
    { key: 'parent_code', label: '上级部门编码', aliases: ['上级部门编码', '上级组织编码', 'parent_code'] },
    { key: 'department_type', label: '部门类型', aliases: ['部门类型', '组织类型', 'department_type'] },
    { key: 'status', label: '状态', aliases: ['状态', 'status'] }
  ],
  roster: [
    { key: 'employee_no', label: '工号', required: true, aliases: ['工号', '员工编号', '人员编码', 'employee_no'] },
    { key: 'person_name', label: '姓名', required: true, aliases: ['姓名', '员工姓名', 'person_name'] },
    { key: 'department_code', label: '部门编码', aliases: ['部门编码', 'department_code'] },
    { key: 'department_name', label: '部门名称', aliases: ['部门名称', '部门', 'department_name'] },
    { key: 'office_codes', label: '办公室编码', aliases: ['办公室编码', 'office_codes'] },
    { key: 'employment_status', label: '在职状态', aliases: ['在职状态', '任职状态', 'employment_status'] },
    { key: 'mobile', label: '手机', aliases: ['手机', '手机号', '联系电话', 'mobile'] },
    { key: 'email', label: '邮箱', aliases: ['邮箱', '电子邮箱', 'email'] }
  ],
  master_data: []
};

function failure(message, code = 'PUBLICATION_INPUT_INVALID', details = {}) {
  const error = new Error(message);
  error.statusCode = 422;
  error.code = code;
  error.details = details;
  return error;
}

function text(value) { return String(value == null ? '' : value).trim(); }
function folded(value) { return text(value).toLocaleLowerCase('en-US'); }

function validateMatrix(headers, rows, sourceRows) {
  if (!Array.isArray(headers) || !headers.length || headers.length > MAX_COLUMNS) throw failure(`表格必须包含1至${MAX_COLUMNS}列`);
  const clean = headers.map(text);
  if (clean.some(h => !h || h.length > 128) || new Set(clean.map(folded)).size !== clean.length) throw failure('首行必须是非空且不重复的列名，每列名称不超过128个字符');
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) throw failure(`每次导入必须包含1至${MAX_ROWS}行数据`);
  const rowNumbers=sourceRows || rows.map((_,index)=>index+2);
  if(!Array.isArray(rowNumbers)||rowNumbers.length!==rows.length||rowNumbers.some((number,index)=>!Number.isSafeInteger(number)||number<2||(index>0&&number<=rowNumbers[index-1])))throw failure('文件行号无效，请重新读取文件');
  const normalized = rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== clean.length) throw failure(`第${rowNumbers[index]}行的列数与表头不一致`);
    return row.map(value => {
      if (value !== null && typeof value === 'object') throw failure(`第${rowNumbers[index]}行含有不支持的复杂值`);
      const result = String(value == null ? '' : value);
      if (result.length > 4000) throw failure(`第${rowNumbers[index]}行有单元格超过4000个字符`);
      return result;
    });
  });
  if (Buffer.byteLength(JSON.stringify(normalized)) > 8 * 1024 * 1024) throw failure('解析后的数据超过8MB，请分批导入');
  return { headers: clean, rows: normalized, sourceRows: rowNumbers };
}

function excelCell(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().replace(/T00:00:00\.000Z$/, '');
  if (typeof value === 'object') {
    if (value.formula || value.sharedFormula || value.error) throw failure(`单元格${cell.address}包含公式或错误，请先转换为明确的值`);
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (typeof value.text === 'string') return value.text;
    throw failure(`单元格${cell.address}的内容无法读取`);
  }
  if (typeof value === 'number' && Number.isInteger(value) && /^0+$/.test(cell.numFmt || '')) return String(value).padStart(cell.numFmt.length, '0');
  return String(value);
}

function checkWorkbookSize(buffer) {
  // Inspect ZIP directory sizes before ExcelJS expands workbook entries in memory.
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw failure('Excel文件结构无效');
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16), expanded = 0;
  if (count > 1000) throw failure('工作簿内容过多，请仅保留需要导入的工作表');
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw failure('Excel文件结构无效');
    expanded += buffer.readUInt32LE(cursor + 24);
    if (expanded > 32 * 1024 * 1024) throw failure('工作簿解压内容超过32MB，请缩减后导入');
    cursor += 46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
}

async function parseSpreadsheet(buffer, filename, sheetName = '') {
  let matrix;
  let sheets = [];
  let selectedSheet = '';
  let sourceRows;
  if (/\.csv$/i.test(filename)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch (_) { throw failure('CSV文件必须使用UTF-8编码'); }
    try {
      const records = parse(buffer, { bom:true, skip_empty_lines:true, relax_column_count:false, max_record_size:300000, info:true });
      matrix=records.map(item=>item.record);
      sourceRows=records.slice(1).map(item=>item.info.lines);
    }
    catch (_) { throw failure('CSV文件无法解析，请使用UTF-8编码并检查每行列数'); }
  } else if (/\.xlsx$/i.test(filename)) {
    checkWorkbookSize(buffer);
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(buffer); } catch (_) { throw failure('Excel文件无法读取，请上传有效的.xlsx文件'); }
    sheets = workbook.worksheets.map(sheet => sheet.name);
    const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
    if (!sheet) throw failure('所选工作表不存在');
    selectedSheet = sheet.name;
    if (sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > MAX_COLUMNS) throw failure(`每次导入最多${MAX_ROWS}行、${MAX_COLUMNS}列`);
    const width = sheet.columnCount;
    matrix = [];
    sourceRows=[];
    for (let i = 1; i <= sheet.rowCount; i += 1) {
      const row = Array.from({ length: width }, (_, col) => excelCell(sheet.getRow(i).getCell(col + 1)));
      if (i === 1 || row.some(value => text(value))) { matrix.push(row); if(i>1)sourceRows.push(i); }
    }
  } else throw failure('请上传.xlsx或UTF-8编码的.csv文件');
  if (!matrix || matrix.length < 2) throw failure('文件需要包含一行表头和至少一行数据');
  const validated = validateMatrix(matrix[0], matrix.slice(1), sourceRows);
  return { ...validated, sheets, sheetName: selectedSheet };
}

function suggestedMapping(kind, headers) {
  const mapping = {};
  for (const field of FIELDS[kind] || []) {
    const matches = headers.filter(header => field.aliases.some(alias => folded(alias) === folded(header)));
    if (matches.length === 1) mapping[field.key] = matches[0];
  }
  return mapping;
}

function normalizePublication(input) {
  if (!input || !KINDS.has(input.kind)) throw failure('发布类型无效');
  const matrix = validateMatrix(input.headers, input.rows, input.sourceRows);
  const title = text(input.title);
  if (!title || title.length > 255) throw failure('请填写不超过255个字符的发布名称');
  const sourceFileName = text(input.sourceFileName).split(/[\\/]/).pop();
  if (!sourceFileName || sourceFileName.length > 255) throw failure('缺少有效的原始文件名');
  const mapping = {};
  for (const field of FIELDS[input.kind]) {
    const header = text(input.mapping && input.mapping[field.key]);
    if (!header && field.required) throw failure(`请选择“${field.label}”对应的文件列`);
    if (header && !matrix.headers.includes(header)) throw failure(`“${field.label}”对应的文件列不存在`);
    if (header) mapping[field.key] = header;
  }
  if (input.kind === 'roster' && !mapping.department_code && !mapping.department_name) throw failure('请选择部门编码或部门名称对应的文件列');
  const keyHeader = input.kind === 'master_data' ? text(input.keyHeader) : mapping[input.kind === 'roster' ? 'employee_no' : 'code'];
  if (!matrix.headers.includes(keyHeader)) throw failure('请选择唯一标识列');
  const keyIndex = matrix.headers.indexOf(keyHeader);
  const seen = new Map();
  const records = matrix.rows.map((row, index) => {
    const rowNumber=matrix.sourceRows[index];
    const key = text(row[keyIndex]);
    if (!key || key.length > 128) throw failure(`第${rowNumber}行的唯一标识为空或超过128个字符`);
    if (seen.has(folded(key))) throw failure(`第${rowNumber}行与第${seen.get(folded(key))}行的唯一标识重复`, 'PUBLICATION_DUPLICATE_KEY');
    seen.set(folded(key), rowNumber);
    const record = {};
    for (const [field, header] of Object.entries(mapping)) record[field] = text(row[matrix.headers.indexOf(header)]);
    for (const field of FIELDS[input.kind].filter(field => field.required)) if (!record[field.key]) throw failure(`第${rowNumber}行的${field.label}为空`);
    if(input.kind==='organization') {
      record.unit_type=({部门:'department',办公室:'office'})[record.unit_type]||record.unit_type||'department';
      if(!['department','office'].includes(record.unit_type))throw failure(`第${rowNumber}行的组织层级只能是部门或办公室`);
      if(record.unit_type==='office'&&!record.owning_department_code)throw failure(`第${rowNumber}行的办公室缺少归口部门编码`);
      if(record.unit_type==='office'&&/[;；、\n]/.test(record.code))throw failure(`第${rowNumber}行的办公室编码不能包含成员关系分隔符`);
    }
    const limits = { code:128, name:255, parent_code:128, owning_department_code:128, manager_employee_no:128, department_type:64, employee_no:128, person_name:255, department_code:128, department_name:255, mobile:64, email:255 };
    for (const [field, value] of Object.entries(record)) if (limits[field] && value.length > limits[field]) throw failure(`第${rowNumber}行的${FIELDS[input.kind].find(item => item.key === field).label}超过${limits[field]}个字符`);
    if (input.kind === 'organization' && record.status) {
      record.status = ({ 有效:'active', 启用:'active', 停用:'inactive', 归档:'archived' })[record.status] || record.status;
      if (!['active', 'inactive', 'archived'].includes(record.status)) throw failure(`第${rowNumber}行的部门状态无效`);
    }
    if (input.kind === 'roster' && record.employment_status) {
      record.employment_status = ({ 在职:'active', 离职:'leave', 停职:'suspended', 停用:'inactive' })[record.employment_status] || record.employment_status;
      if (!['active', 'leave', 'suspended', 'inactive'].includes(record.employment_status)) throw failure(`第${rowNumber}行的在职状态无效`);
    }
    return record;
  });
  const content = { schemaVersion: 'mdm-publication-v1', kind: input.kind, title, sourceFileName, sheetName: text(input.sheetName), ...matrix, mapping, keyHeader };
  return { content, records, contentHash: crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex') };
}

async function exportSpreadsheet(content) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('发布数据');
  sheet.addRow(content.headers);
  content.rows.forEach(row => sheet.addRow(row.map(value => String(value == null ? '' : value))));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.columns.forEach(column => { column.width = 24; });
  return await workbook.xlsx.writeBuffer();
}

module.exports = { MAX_ROWS, MAX_COLUMNS, FIELDS, failure, parseSpreadsheet, suggestedMapping, normalizePublication, exportSpreadsheet };
