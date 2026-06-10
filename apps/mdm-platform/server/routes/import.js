const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const router = express.Router();
const db = require('../db');
const { requireAuth, getUserEffectivePermissions } = require('../auth');
const { getEffectiveRoleCodes } = require('../access');

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

function canImportForMapping(req, mappingId) {
  // Check admin via RBAC
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  if (permSet.has('admin:access') || permSet.has('*:*')) return true;

  const mapping = db.prepare('SELECT submitted_by FROM mappings WHERE id=?').get(mappingId);
  const roleCodes = getEffectiveRoleCodes(req);
  return mapping && roleCodes.has('submitter') && mapping.submitted_by === req.session.userId;
}

function normalizeNullable(value) {
  return value === '' || value === undefined ? null : value;
}

function handleUpload(req, res, next) {
  upload.single('file')(req, res, error => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Excel 文件不能超过 5MB' });
    return res.status(400).json({ error: 'Excel 文件上传失败' });
  });
}

router.post('/field-entries', requireAuth, handleUpload, async (req, res) => {
  try {
    const mappingId = Number(req.body.mapping_id);
    if (!mappingId) return res.status(400).json({ error: '缺少 mapping_id' });
    if (!req.file) return res.status(400).json({ error: '缺少 Excel 文件' });
    if (!canImportForMapping(req, mappingId)) {
      return res.status(403).json({ error: '仅该映射报送人或管理员可导入字段台账' });
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
        field_name_cn: cellText(row, headerMap, '中文字段名'),
        field_name_en: cellText(row, headerMap, '英文字段名'),
        data_object: dataObject,
        field_type: cellText(row, headerMap, '字段类型'),
        consume_systems: cellText(row, headerMap, '消费系统'),
        sync_mode: cellText(row, headerMap, '同步方式'),
        note
      });
    });

    const insertRows = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO field_entries
          (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      rows.forEach(row => {
        const { permSet: importPermSet } = getUserEffectivePermissions(req.session.userId);
        const ownerColumnsAllowed = importPermSet.has('admin:access') || importPermSet.has('*:*');
        stmt.run(
          mappingId,
          ownerColumnsAllowed ? normalizeNullable(row.field_name_cn) : null,
          ownerColumnsAllowed ? normalizeNullable(row.field_name_en) : null,
          normalizeNullable(row.data_object),
          ownerColumnsAllowed ? normalizeNullable(row.field_type) : null,
          ownerColumnsAllowed ? normalizeNullable(row.consume_systems) : null,
          ownerColumnsAllowed ? normalizeNullable(row.sync_mode) : null,
          normalizeNullable(row.note),
          req.session.userId
        );
      });
    });

    insertRows();
    res.json({ imported: rows.length });
  } catch (error) {
    if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
      return res.status(400).json({ error: '数据不符合约束' });
    }
    console.error(error);
    return res.status(400).json({ error: 'Excel 解析或导入失败' });
  }
});

module.exports = router;
