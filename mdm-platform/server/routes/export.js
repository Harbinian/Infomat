const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireAuth } = require('../auth');

function jsonListText(value) {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.join(', ');
  } catch (error) {
    return value;
  }
  return value;
}

router.get('/excel', requireAuth, async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MDM 平台';
  workbook.created = new Date();

  const ledger = workbook.addWorksheet('字段台账');
  ledger.columns = [
    { header: '业务流程', key: 'process_name', width: 20 },
    { header: '应用系统', key: 'system_name', width: 15 },
    { header: '数据对象', key: 'data_object', width: 12 },
    { header: '中文字段名', key: 'field_name_cn', width: 18 },
    { header: '英文字段名', key: 'field_name_en', width: 18 },
    { header: '字段类型', key: 'field_type', width: 10 },
    { header: '黄金源系统', key: 'authoritative_system', width: 12 },
    { header: '维护部门', key: 'maintain_dept', width: 12 },
    { header: '消费系统', key: 'consume_systems', width: 20 },
    { header: '同步方式', key: 'sync_mode', width: 12 },
    { header: '字段说明', key: 'note', width: 25 }
  ];

  const fields = db.prepare(`
    SELECT fe.*, p.name as process_name, s.name as system_name,
           fi.authoritative_system, d.name as maintain_dept
    FROM field_entries fe
    JOIN mappings m ON fe.mapping_id = m.id
    JOIN processes p ON m.process_id = p.id
    JOIN mapping_systems ms ON ms.mapping_id = m.id
    JOIN systems s ON ms.system_id = s.id AND ms.system_role = 'primary'
    LEFT JOIN field_identities fi ON fi.field_entry_id = fe.id
    LEFT JOIN departments d ON fi.maintain_dept_id = d.id
    WHERE m.status = 'published'
    ORDER BY p.name, fe.id
  `).all();

  fields.forEach(field => {
    ledger.addRow({
      process_name: field.process_name,
      system_name: field.system_name,
      data_object: field.data_object,
      field_name_cn: field.field_name_cn,
      field_name_en: field.field_name_en,
      field_type: field.field_type,
      authoritative_system: field.authoritative_system || '',
      maintain_dept: field.maintain_dept || '',
      consume_systems: jsonListText(field.consume_systems),
      sync_mode: field.sync_mode,
      note: field.note
    });
  });

  const matrix = workbook.addWorksheet('黄金源矩阵');
  matrix.columns = [
    { header: '业务流程', key: 'process_name', width: 20 },
    { header: '应用系统', key: 'system_name', width: 15 },
    { header: '中文字段名', key: 'field_name_cn', width: 18 },
    { header: '候选系统', key: 'candidate_systems', width: 25 },
    { header: '权威系统', key: 'authoritative_system', width: 15 },
    { header: '维护部门', key: 'maintain_dept', width: 12 },
    { header: '是否确认', key: 'confirmed', width: 10 },
    { header: '确认人', key: 'confirmer', width: 10 },
    { header: '确认时间', key: 'confirmed_at', width: 15 }
  ];

  const identities = db.prepare(`
    SELECT fe.field_name_cn, p.name as process_name, s.name as system_name,
           fi.candidate_systems, fi.authoritative_system, d.name as maintain_dept,
           fi.confirmed, u.name as confirmer, fi.confirmed_at
    FROM field_identities fi
    JOIN field_entries fe ON fi.field_entry_id = fe.id
    JOIN mappings m ON fe.mapping_id = m.id
    JOIN processes p ON m.process_id = p.id
    JOIN mapping_systems ms ON ms.mapping_id = m.id AND ms.system_role = 'primary'
    JOIN systems s ON ms.system_id = s.id
    LEFT JOIN departments d ON fi.maintain_dept_id = d.id
    LEFT JOIN users u ON fi.confirmed_by = u.id
    WHERE m.status = 'published'
    ORDER BY p.name, fe.id
  `).all();

  identities.forEach(identity => {
    matrix.addRow({
      process_name: identity.process_name,
      system_name: identity.system_name,
      field_name_cn: identity.field_name_cn,
      candidate_systems: jsonListText(identity.candidate_systems),
      authoritative_system: identity.authoritative_system || '',
      maintain_dept: identity.maintain_dept || '',
      confirmed: identity.confirmed ? '是' : '否',
      confirmer: identity.confirmer || '',
      confirmed_at: identity.confirmed_at || ''
    });
  });

  const termConflictSheet = workbook.addWorksheet('术语冲突台账');
  termConflictSheet.columns = [
    { header: '术语', key: 'term', width: 15 },
    { header: '部门A', key: 'dept_a', width: 12 },
    { header: 'A理解', key: 'dept_a_meaning', width: 20 },
    { header: '部门B', key: 'dept_b', width: 12 },
    { header: 'B理解', key: 'dept_b_meaning', width: 20 },
    { header: '严重程度', key: 'severity', width: 10 },
    { header: '状态', key: 'status', width: 10 },
    { header: '解决方案', key: 'resolution', width: 25 }
  ];

  const termConflicts = db.prepare(`
    SELECT tc.*, da.name as dept_a_name, db.name as dept_b_name
    FROM term_conflicts tc
    LEFT JOIN departments da ON tc.dept_a = da.id
    LEFT JOIN departments db ON tc.dept_b = db.id
    ORDER BY tc.created_at DESC
  `).all();

  termConflicts.forEach(conflict => {
    termConflictSheet.addRow({
      term: conflict.term,
      dept_a: conflict.dept_a_name || '',
      dept_a_meaning: conflict.dept_a_meaning,
      dept_b: conflict.dept_b_name || '',
      dept_b_meaning: conflict.dept_b_meaning,
      severity: conflict.severity,
      status: conflict.status === 'resolved' ? '已解决' : conflict.status === 'rejected' ? '已驳回' : '待解决',
      resolution: conflict.resolution || ''
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=mdm-field-ledger.xlsx');

  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
