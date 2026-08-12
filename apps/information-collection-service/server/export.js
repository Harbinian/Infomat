'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const archiver = require('archiver');
const { parseJson } = require('./service');
const { storagePath } = require('./files');

function safeSegment(value) {
  return String(value || '').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim().slice(0, 80) || '未命名';
}

function safeSheetName(value, workbook) {
  const base = String(value || '明细表').replace(/[\[\]:*?/\\]/g, '_').trim().slice(0, 31) || '明细表';
  let name = base;
  let suffix = 2;
  while (workbook.getWorksheet(name)) {
    const tail = `-${suffix++}`;
    name = `${base.slice(0, 31 - tail.length)}${tail}`;
  }
  return name;
}

function optionLabels(field, value) {
  const labels = new Map((field.options || []).map(option => [option.optionKey, option.label]));
  const values = Array.isArray(value) ? value : [value];
  return values.map(item => labels.get(item) || String(item)).join('；');
}

function displayAnswer(field, value, files) {
  if (value === null || value === undefined || value === '') return '';
  if (['single_choice', 'multiple_choice'].includes(field.type)) return optionLabels(field, value);
  if (field.type === 'boolean') return value ? '是' : '否';
  if (field.type === 'person') return `${value.employeeNo || ''} ${value.personName || ''}`.trim();
  if (field.type === 'department') return value.departmentName || '';
  if (field.type === 'attachment') {
    const ids = new Set(Array.isArray(value) ? value : []);
    return files.filter(file => ids.has(file.file_id)).map(file => file.original_name).join('；');
  }
  return Array.isArray(value) ? value.join('；') : value;
}

async function loadExportData(pool, taskId) {
  const [[task]] = await pool.execute(
    `SELECT t.*, f.name AS form_name, d.name AS owner_department_name, v.schema_json
       FROM collection_tasks t
       JOIN collection_forms f ON f.form_id=t.form_id
       JOIN departments d ON d.id=t.owner_department_id
       JOIN collection_form_versions v ON v.form_version_id=t.form_version_id
      WHERE t.task_id=?`,
    [taskId]
  );
  const [rows] = await pool.execute(
    `SELECT tt.*, s.submission_id, s.status AS submission_status, s.answers_json, s.last_saved_at, s.submitted_at, s.submit_count
       FROM collection_task_targets tt
       LEFT JOIN collection_submissions s ON s.task_id=tt.task_id AND s.person_id=tt.person_id
      WHERE tt.task_id=? ORDER BY tt.department_name_snapshot, tt.employee_no_snapshot`,
    [taskId]
  );
  const [files] = await pool.execute(
    `SELECT cf.*, s.person_id, tt.employee_no_snapshot, tt.person_name_snapshot
       FROM collection_files cf
       JOIN collection_submissions s ON s.submission_id=cf.submission_id
       JOIN collection_task_targets tt ON tt.task_id=s.task_id AND tt.person_id=s.person_id
      WHERE s.task_id=? AND cf.status='active' ORDER BY tt.employee_no_snapshot, cf.original_name`,
    [taskId]
  );
  return { task, schema: parseJson(task.schema_json, {}), rows, files };
}

async function buildWorkbook(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Infomat Information Collection';
  const summary = workbook.addWorksheet('任务概况');
  summary.addRows([
    ['任务编号', data.task.task_code], ['任务名称', data.task.name], ['表单名称', data.task.form_name],
    ['发起部门', data.task.owner_department_name], ['开始时间', data.task.open_at], ['截止时间', data.task.due_at || '未设置'],
    ['目标人数', data.rows.length], ['已提交', data.rows.filter(row => row.submission_status === 'submitted').length]
  ]);
  summary.getColumn(1).width = 18;
  summary.getColumn(2).width = 50;
  summary.getColumn(1).font = { bold: true };

  const mainFields = data.schema.sections.filter(section => section.kind !== 'detail').flatMap(section => section.fields);
  const detailSections = data.schema.sections.filter(section => section.kind === 'detail');
  const detail = workbook.addWorksheet('答卷明细', { views: [{ state: 'frozen', ySplit: 1 }] });
  detail.columns = [
    { header: '工号', key: 'employeeNo', width: 16 }, { header: '姓名', key: 'personName', width: 16 },
    { header: '部门', key: 'departmentName', width: 20 }, { header: '状态', key: 'status', width: 14 },
    { header: '最后保存时间', key: 'lastSavedAt', width: 22 }, { header: '提交时间', key: 'submittedAt', width: 22 },
    ...mainFields.map(field => ({ header: field.label, key: field.fieldKey, width: Math.min(40, Math.max(16, field.label.length * 2 + 4)) }))
  ];
  for (const row of data.rows) {
    const answers = parseJson(row.answers_json, {});
    const rowFiles = data.files.filter(file => Number(file.person_id) === Number(row.person_id));
    const output = {
      employeeNo: row.employee_no_snapshot, personName: row.person_name_snapshot,
      departmentName: row.department_name_snapshot || '', status: statusLabel(row.submission_status),
      lastSavedAt: row.last_saved_at || '', submittedAt: row.submitted_at || ''
    };
    mainFields.forEach(field => { output[field.fieldKey] = displayAnswer(field, answers[field.fieldKey], rowFiles); });
    detail.addRow(output);
  }
  detail.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  detail.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B3F2B' } };
  detail.autoFilter = { from: 'A1', to: detail.getRow(1).getCell(detail.columnCount).address };

  detailSections.forEach((section, sectionIndex) => {
    const sheet = workbook.addWorksheet(safeSheetName(`明细${sectionIndex + 1}-${section.title}`, workbook), { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: '工号', key: 'employeeNo', width: 16 }, { header: '姓名', key: 'personName', width: 16 },
      { header: '部门', key: 'departmentName', width: 20 }, { header: '答卷状态', key: 'status', width: 14 },
      { header: '明细行号', key: 'rowNumber', width: 12 },
      ...section.fields.map(field => ({ header: field.label, key: field.fieldKey, width: Math.min(40, Math.max(16, field.label.length * 2 + 4)) }))
    ];
    for (const row of data.rows) {
      const answers = parseJson(row.answers_json, {});
      const rows = answers.__detailRows?.[section.sectionKey] || [];
      rows.forEach((detailRow, rowIndex) => {
        const output = {
          employeeNo: row.employee_no_snapshot, personName: row.person_name_snapshot,
          departmentName: row.department_name_snapshot || '', status: statusLabel(row.submission_status), rowNumber: rowIndex + 1
        };
        section.fields.forEach(field => { output[field.fieldKey] = displayAnswer(field, detailRow.values?.[field.fieldKey], []); });
        sheet.addRow(output);
      });
    }
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6C8496' } };
    sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(sheet.columnCount).address };
  });

  const attachmentSheet = workbook.addWorksheet('附件清单', { views: [{ state: 'frozen', ySplit: 1 }] });
  attachmentSheet.columns = [
    { header: '工号', key: 'employeeNo', width: 16 }, { header: '姓名', key: 'personName', width: 16 },
    { header: '字段标识', key: 'fieldKey', width: 38 }, { header: '原文件名', key: 'originalName', width: 40 },
    { header: '大小（字节）', key: 'sizeBytes', width: 18 }, { header: 'SHA-256', key: 'sha256', width: 66 },
    { header: '扫描状态', key: 'scanStatus', width: 16 }
  ];
  for (const file of data.files) attachmentSheet.addRow({
    employeeNo: file.employee_no_snapshot, personName: file.person_name_snapshot, fieldKey: file.field_key,
    originalName: file.original_name, sizeBytes: Number(file.size_bytes), sha256: file.sha256, scanStatus: file.scan_status
  });
  attachmentSheet.getRow(1).font = { bold: true };
  return workbook;
}

function statusLabel(status) {
  if (status === 'submitted') return '已提交';
  if (status === 'draft') return '草稿';
  return '未开始';
}

async function sendXlsx(pool, taskId, res) {
  const data = await loadExportData(pool, taskId);
  const workbook = await buildWorkbook(data);
  const filename = `${safeSegment(data.task.task_code)}-${safeSegment(data.task.name)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  await workbook.xlsx.write(res);
  res.end();
  return { filename, rowCount: data.rows.length };
}

async function sendZip(pool, taskId, res, config) {
  const data = await loadExportData(pool, taskId);
  const workbook = await buildWorkbook(data);
  const xlsx = await workbook.xlsx.writeBuffer();
  const filename = `${safeSegment(data.task.task_code)}-${safeSegment(data.task.name)}-附件包.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => res.destroy(err));
  archive.pipe(res);
  archive.append(Buffer.from(xlsx), { name: '答卷明细.xlsx' });
  for (const file of data.files) {
    const filePath = storagePath(config, file.storage_key);
    if (!fs.existsSync(filePath)) continue;
    const folder = `${safeSegment(file.employee_no_snapshot)}_${safeSegment(file.person_name_snapshot)}`;
    archive.file(filePath, { name: path.posix.join('附件', folder, `${file.file_id}_${safeSegment(file.original_name)}`) });
  }
  await archive.finalize();
  return { filename, rowCount: data.rows.length, fileCount: data.files.length };
}

module.exports = { buildWorkbook, loadExportData, sendXlsx, sendZip };
