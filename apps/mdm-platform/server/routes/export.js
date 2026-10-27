const express = require('express');
const { logRequestFailure } = require('../securityLog');
const router = express.Router();
const ExcelJS = require('exceljs');
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');
const { EXPORT_LIMITS, acquireExportSlot, createAbortScope } = require('../exportBudget');

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

async function exportScope(req) {
  const personId = req.session.personId || req.session.userId;
  const { permSet } = await getUserEffectivePermissionsAsync(personId);
  if (permSet.has('governance:read-global')) return {};
  if (permSet.has('governance:read-department') && req.session.departmentId) {
    return { departmentId: req.session.departmentId };
  }
  return null;
}

router.get('/excel', requireAuth, async (req, res) => {
  let release = null;
  let abortScope = null;
  let workbook = null;
  let stopWorkbook = null;
  try {
    const scope = await exportScope(req);
    if (!scope) return res.status(403).json({ error: '无权导出治理数据' });
    // R09: the slot and the departure scope are taken before any data is read, so a burst or a
    // client that hangs up is bounded before the cost is incurred rather than after.
    release = acquireExportSlot();
    abortScope = createAbortScope(req, res);
    const repo = await abortScope.run(() => dataMapRepository());
    const data = await abortScope.run(() => repo.exportFieldLedger(scope, { signal: abortScope.signal, maxRows: EXPORT_LIMITS.maxRows, view:req.query.view }));
    const fields = data.fields || [];
    const identities = data.identities || [];
    abortScope.check();
    // Start streaming only after bounded reads succeed. Committed rows do not accumulate a
    // second in-memory workbook; aborting the archive also stops a stalled download.
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=mdm-data-map-field-ledger.xlsx');
    workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, creator: 'MDM 平台', created: new Date() });
    stopWorkbook = () => { workbook.zip.abort(); res.destroy(); };
    abortScope.signal.addEventListener('abort', stopWorkbook, { once: true });

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
      { header: '字段说明', key: 'note', width: 28 },
      { header: '固定版本',key:'version_id',width:22 },{header:'承接发布',key:'publication_id',width:38},{header:'治理状态',key:'governance_status',width:20},{header:'内容摘要',key:'content_digest',width:68}
    ];

    fields.forEach(field => {
      ledger.addRow({
        version_id:field.version_id,publication_id:field.publication_id,governance_status:field.governance_status,content_digest:field.content_digest,
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
      }).commit();
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
      }).commit();
    });

    await abortScope.run(() => workbook.commit());
  } catch (error) {
    logRequestFailure(res, error, { status: error && error.statusCode ? error.statusCode : 500 });
    if (res.headersSent) {
      // The download already started: the only honest signal left is to end the connection, so
      // the client can tell a complete file from an interrupted one.
      return res.destroy();
    }
    if (error && error.code === 'EXPORT_ABORTED') return undefined;
    const status = error && error.statusCode ? error.statusCode : 500;
    return res.status(status).json({ error: status === 500 ? '服务器错误' : error.message, code: error && error.code });
  } finally {
    if (stopWorkbook) abortScope.signal.removeEventListener('abort', stopWorkbook);
    if (workbook && !res.writableEnded) workbook.zip.abort();
    if (abortScope) abortScope.dispose();
    if (release) release();
  }
});

module.exports = router;
