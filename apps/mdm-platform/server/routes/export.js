const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { requireAuth } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');

function jsonListText(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).join(', ');
  } catch (error) {
    return value;
  }
  return value;
}

function identitySystem(identity) {
  if (!identity) return '';
  return identity.authoritative_system_name || identity.authoritative_system || '';
}

router.get('/excel', requireAuth, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MDM 平台';
    workbook.created = new Date();

    const repo = await dataMapRepository();
    const data = await repo.exportFieldLedger();
    const fields = data.fields || [];
    const identities = data.identities || [];

    const ledger = workbook.addWorksheet('字段台账');
    ledger.columns = [
      { header: '数据地图上下文', key: 'context_title', width: 24 },
      { header: '所属部门', key: 'dept_name', width: 14 },
      { header: '数据对象', key: 'object_name', width: 14 },
      { header: '中文字段名', key: 'field_name_cn', width: 18 },
      { header: '英文字段名', key: 'field_name_en', width: 18 },
      { header: '字段类型', key: 'field_type', width: 10 },
      { header: '黄金源系统', key: 'authoritative_system', width: 16 },
      { header: '维护部门', key: 'maintain_dept', width: 12 },
      { header: '流程治理节点', key: 'process_governance_node_key', width: 24 },
      { header: 'A1编号', key: 'process_governance_a1_code', width: 18 },
      { header: '消费系统', key: 'consume_systems', width: 20 },
      { header: '同步方式', key: 'sync_mode', width: 12 },
      { header: '字段说明', key: 'note', width: 28 }
    ];

    fields.forEach(field => {
      ledger.addRow({
        context_title: field.context_title || field.context_key || '',
        dept_name: field.dept_name || '',
        object_name: field.object_name_cn || field.data_object || '',
        field_name_cn: field.field_name_cn || '',
        field_name_en: field.field_name_en || '',
        field_type: field.field_type || field.data_type || '',
        authoritative_system: identitySystem(field.identity),
        maintain_dept: field.identity ? (field.identity.maintain_dept_name || field.identity.maintain_dept_id || '') : '',
        process_governance_node_key: field.process_governance_node_key || '',
        process_governance_a1_code: field.process_governance_a1_code || '',
        consume_systems: jsonListText(field.consume_systems),
        sync_mode: field.sync_mode || '',
        note: field.note || field.business_definition || ''
      });
    });

    const matrix = workbook.addWorksheet('黄金源矩阵');
    matrix.columns = [
      { header: '数据地图上下文', key: 'context_title', width: 24 },
      { header: '主要系统', key: 'system_name', width: 15 },
      { header: '中文字段名', key: 'field_name_cn', width: 18 },
      { header: '待确认系统', key: 'authority_system_options', width: 25 },
      { header: '权威系统', key: 'authoritative_system', width: 15 },
      { header: '维护部门', key: 'maintain_dept', width: 12 },
      { header: '是否确认', key: 'confirmed', width: 10 },
      { header: '确认人', key: 'confirmer', width: 10 },
      { header: '确认时间', key: 'confirmed_at', width: 18 }
    ];

    identities.forEach(identity => {
      matrix.addRow({
        context_title: identity.context_title || identity.context_key || '',
        system_name: identity.system_name || '',
        field_name_cn: identity.field_name_cn || '',
        authority_system_options: jsonListText(identity.authority_system_options),
        authoritative_system: identitySystem(identity),
        maintain_dept: identity.maintain_dept_name || identity.maintain_dept_id || '',
        confirmed: identity.confirmed ? '是' : '否',
        confirmer: identity.confirmed_by || '',
        confirmed_at: identity.confirmed_at || ''
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=mdm-data-map-field-ledger.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
