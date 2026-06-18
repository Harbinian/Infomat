const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { getEffectiveRoleCodesAsync } = require('../access');
const { dataMapRepository } = require('../dataMapMysqlRepository');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

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
  return String(value).split(/[,\uFF0C;；、]/).map(item => item.trim()).filter(Boolean);
}

function handleUpload(req, res, next) {
  upload.single('file')(req, res, error => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Excel 文件不能超过 5MB' });
    return res.status(400).json({ error: 'Excel 文件上传失败' });
  });
}

function handleError(res, error) {
  if (error && error.statusCode) return res.status(error.statusCode).json({ error: error.message });
  if (error && (String(error.code || '').startsWith('ER_') || String(error.message).includes('constraint'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(400).json({ error: 'Excel 解析或导入失败' });
}

async function canImportForContext(req, context) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  if (permSet.has('admin:access') || permSet.has('*:*')) return true;
  const roleCodes = await getEffectiveRoleCodesAsync(req);
  const sameDepartment = Number(context.dept_id || 0) === Number(req.session.departmentId || 0);
  return sameDepartment && (roleCodes.has('submitter') || roleCodes.has('owner'));
}

router.post('/field-entries', requireAuth, handleUpload, async (req, res) => {
  try {
    const contextId = Number(req.body.context_id || req.body.mapping_id);
    if (!contextId) return res.status(400).json({ error: '缺少 context_id' });
    if (!req.file) return res.status(400).json({ error: '缺少 Excel 文件' });

    const repo = await dataMapRepository();
    const context = await repo.getContext(contextId);
    if (!context) return res.status(404).json({ error: '数据地图上下文不存在' });
    if (!await canImportForContext(req, context)) {
      return res.status(403).json({ error: '无权导入该数据地图上下文字段台账' });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.getWorksheet('字段台账') || workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ error: 'Excel 中没有可读取的工作表' });

    const headerMap = buildHeaderMap(sheet);
    const requiredHeaders = ['数据对象', '字段说明'];
    const missing = requiredHeaders.filter(header => !headerMap[header]);
    if (missing.length) return res.status(400).json({ error: `缺少表头：${missing.join(', ')}` });

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const dataObject = cellText(row, headerMap, '数据对象');
      const note = cellText(row, headerMap, '字段说明');
      if (!dataObject && !note) return;
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
        submitted_by: req.session.userId
      });
    });

    for (const row of rows) {
      await repo.createField(row, req.session.userId);
    }

    await repo.recordImportBatch({
      source_type: 'excel',
      file_name: req.file.originalname,
      context_id: contextId,
      imported_by: req.session.userId,
      row_count: rows.length,
      status: 'imported',
      note: '字段台账导入'
    });

    res.json({ imported: rows.length, context_id: contextId, mapping_id: contextId });
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
