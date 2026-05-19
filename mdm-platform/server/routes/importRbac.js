const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const csvParse = require('csv-parse/sync');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const adminGate = [requireAuth, requirePermission('admin:access')];

function cellText(row, headerMap, header) {
  const index = headerMap[header];
  if (!index) return '';
  const value = row.getCell(index).value;
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map(p => p.text || '').join('').trim();
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

function parseCsvRows(buffer) {
  const text = buffer.toString('utf-8').replace(/^﻿/, '');
  const records = csvParse.parse(text, { columns: true, skip_empty_lines: true, bom: true });
  return records;
}

// POST /api/import-rbac/user-roles
router.post('/user-roles', ...adminGate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少文件' });

    let rows = [];
    const ext = (req.file.originalname || '').toLowerCase();

    if (ext.endsWith('.csv')) {
      const records = parseCsvRows(req.file.buffer);
      const headers = Object.keys(records[0] || {});
      rows = records.map((r, i) => ({
        row: i + 2,
        employee_no: String(r['工号'] || r[headers[0]] || '').trim(),
        name: String(r['姓名'] || r[headers[1]] || '').trim(),
        role_codes: String(r['角色编码'] || r[headers[2]] || '').trim(),
        operation: String(r['操作类型'] || r[headers[3]] || 'replace').trim()
      }));
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) return res.status(400).json({ error: 'Excel 中没有可读取的工作表' });
      const headerMap = buildHeaderMap(sheet);
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const employee_no = cellText(row, headerMap, '工号');
        if (!employee_no) return;
        rows.push({
          row: rowNumber,
          employee_no,
          name: cellText(row, headerMap, '姓名'),
          role_codes: cellText(row, headerMap, '角色编码'),
          operation: cellText(row, headerMap, '操作类型') || 'replace'
        });
      });
    }

    if (rows.length === 0) return res.status(400).json({ error: '文件中没有数据行' });

    const errors = [];
    let success = 0;
    const seen = new Map();

    // Deduplicate within file
    for (const r of rows) {
      if (!r.employee_no) { errors.push({ row: r.row, employee_no: '', reason: '工号为空' }); continue; }
      if (!r.role_codes) { errors.push({ row: r.row, employee_no: r.employee_no, reason: '角色编码为空' }); continue; }
      seen.set(r.employee_no, r);
    }

    db.transaction(() => {
      for (const [empNo, r] of seen) {
        const user = db.prepare('SELECT id FROM users WHERE employee_no=?').get(empNo);
        if (!user) { errors.push({ row: r.row, employee_no: empNo, reason: '工号不存在' }); continue; }

        const roleCodes = r.role_codes.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        if (roleCodes.length === 0) { errors.push({ row: r.row, employee_no: empNo, reason: '角色编码格式错误' }); continue; }

        const invalidRoles = [];
        const validRoleIds = [];
        for (const code of roleCodes) {
          const role = db.prepare('SELECT role_id FROM roles WHERE role_code=?').get(code);
          if (!role) { invalidRoles.push(code); } else { validRoleIds.push(role.role_id); }
        }
        if (invalidRoles.length > 0) {
          errors.push({ row: r.row, employee_no: empNo, reason: `角色编码不存在: ${invalidRoles.join(', ')}` });
          if (validRoleIds.length === 0) continue;
        }

        if (r.operation === 'add') {
          const existingRoleIds = new Set(db.prepare('SELECT role_id FROM user_roles WHERE user_id=?').all(user.id).map(r => r.role_id));
          for (const rid of validRoleIds) {
            if (!existingRoleIds.has(rid)) {
              db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)').run(user.id, rid, req.session.userId);
            }
          }
        } else {
          db.prepare('DELETE FROM user_roles WHERE user_id=?').run(user.id);
          const insert = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)');
          for (const rid of validRoleIds) { insert.run(user.id, rid, req.session.userId); }
        }

        // Update users.role for backward compat
        if (validRoleIds.length > 0) {
          const primaryRole = db.prepare('SELECT role_code FROM roles WHERE role_id=?').get(validRoleIds[0]);
          if (primaryRole) db.prepare('UPDATE users SET role=? WHERE id=?').run(primaryRole.role_code, user.id);
        }
        success++;
      }
    })();

    res.json({ total: rows.length, success, errors, imported_at: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: '文件解析或导入失败' });
  }
});

// POST /api/import-rbac/role-permissions
router.post('/role-permissions', ...adminGate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少文件' });

    let rows = [];
    const ext = (req.file.originalname || '').toLowerCase();

    if (ext.endsWith('.csv')) {
      const records = parseCsvRows(req.file.buffer);
      const headers = Object.keys(records[0] || {});
      rows = records.map((r, i) => ({
        row: i + 2,
        role_code: String(r['角色编码'] || r[headers[0]] || '').trim(),
        role_name: String(r['角色名称'] || r[headers[1]] || '').trim(),
        parent_role_code: String(r['父角色编码'] || r[headers[2]] || '').trim(),
        perm_code: String(r['权限码'] || r[headers[3]] || '').trim(),
        effect: String(r['效果'] || r[headers[4]] || 'allow').trim(),
        field_constraints: String(r['字段限制'] || r[headers[5]] || '').trim()
      }));
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) return res.status(400).json({ error: 'Excel 中没有可读取的工作表' });
      const headerMap = buildHeaderMap(sheet);
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const role_code = cellText(row, headerMap, '角色编码');
        if (!role_code) return;
        rows.push({
          row: rowNumber,
          role_code,
          role_name: cellText(row, headerMap, '角色名称'),
          parent_role_code: cellText(row, headerMap, '父角色编码'),
          perm_code: cellText(row, headerMap, '权限码'),
          effect: cellText(row, headerMap, '效果') || 'allow',
          field_constraints: cellText(row, headerMap, '字段限制')
        });
      });
    }

    if (rows.length === 0) return res.status(400).json({ error: '文件中没有数据行' });

    const errors = [];
    let success = 0;

    db.transaction(() => {
      // Group by role_code
      const roleGroups = new Map();
      for (const r of rows) {
        if (!r.role_code) { errors.push({ row: r.row, reason: '角色编码为空' }); continue; }
        if (!r.perm_code) { errors.push({ row: r.row, role_code: r.role_code, reason: '权限码为空' }); continue; }

        // Validate perm_code format
        if (!/^(\*:\*|\w+:\w+)$/.test(r.perm_code)) {
          errors.push({ row: r.row, role_code: r.role_code, reason: `权限码格式错误: ${r.perm_code}` });
          continue;
        }

        // Validate field_constraints JSON if provided
        if (r.field_constraints) {
          try { JSON.parse(r.field_constraints); } catch (e) {
            errors.push({ row: r.row, role_code: r.role_code, reason: '字段限制 JSON 格式错误' });
            continue;
          }
        }

        if (!roleGroups.has(r.role_code)) {
          roleGroups.set(r.role_code, { role_name: r.role_name, parent_role_code: r.parent_role_code, perms: [] });
        }
        roleGroups.get(r.role_code).perms.push(r);
      }

      for (const [roleCode, group] of roleGroups) {
        // Find or create role
        let role = db.prepare('SELECT role_id FROM roles WHERE role_code=?').get(roleCode);
        if (!role) {
          if (!group.role_name) { errors.push({ role_code: roleCode, reason: `角色 ${roleCode} 不存在，且未提供角色名称` }); continue; }
          let parentRoleId = null;
          if (group.parent_role_code) {
            const parent = db.prepare('SELECT role_id FROM roles WHERE role_code=?').get(group.parent_role_code);
            if (!parent) { errors.push({ role_code: roleCode, reason: `父角色编码不存在: ${group.parent_role_code}` }); continue; }
            parentRoleId = parent.role_id;
          }
          const result = db.prepare('INSERT INTO roles (role_code, role_name, parent_role_id, created_by) VALUES (?, ?, ?, ?)').run(roleCode, group.role_name, parentRoleId, req.session.userId);
          role = { role_id: result.lastInsertRowid };
        }

        // Ensure permissions exist and link
        for (const p of group.perms) {
          const [resource, action] = p.perm_code === '*:*' ? ['*', '*'] : p.perm_code.split(':');
          db.prepare('INSERT OR IGNORE INTO permissions (perm_code, resource, action) VALUES (?, ?, ?)').run(p.perm_code, resource, action);
          const perm = db.prepare('SELECT perm_id FROM permissions WHERE perm_code=?').get(p.perm_code);
          db.prepare('INSERT OR REPLACE INTO role_permissions (role_id, perm_id, effect) VALUES (?, ?, ?)').run(role.role_id, perm.perm_id, p.effect);
        }
        success += group.perms.length;
      }
    })();

    res.json({ total: rows.length, success, errors, imported_at: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: '文件解析或导入失败' });
  }
});

// GET /api/import-rbac/templates/user-roles — download user-role import template
router.get('/templates/user-roles', ...adminGate, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('用户角色分配');
    sheet.columns = [
      { header: '工号', key: 'employee_no', width: 15 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '角色编码', key: 'role_codes', width: 25 },
      { header: '操作类型', key: 'operation', width: 12 }
    ];
    // Add example row
    sheet.addRow({ employee_no: 'EMP001', name: '张三', role_codes: 'submitter,reviewer', operation: 'replace' });
    sheet.getRow(2).getCell(4).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"replace,add"']
    };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="user_roles_template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '模板生成失败' });
  }
});

// GET /api/import-rbac/templates/role-permissions — download role-permission import template
router.get('/templates/role-permissions', ...adminGate, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('角色权限定义');
    sheet.columns = [
      { header: '角色编码', key: 'role_code', width: 18 },
      { header: '角色名称', key: 'role_name', width: 15 },
      { header: '父角色编码', key: 'parent_role_code', width: 15 },
      { header: '权限码', key: 'perm_code', width: 20 },
      { header: '效果', key: 'effect', width: 10 },
      { header: '字段限制', key: 'field_constraints', width: 30 }
    ];
    sheet.addRow({ role_code: 'dept_auditor', role_name: '部门审核员', parent_role_code: 'reviewer', perm_code: 'mapping:approve', effect: 'allow', field_constraints: '' });
    sheet.addRow({ role_code: 'dept_auditor', role_name: '', parent_role_code: '', perm_code: 'product:read', effect: 'allow', field_constraints: '{"exclude":["cost"]}' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="role_permissions_template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '模板生成失败' });
  }
});

module.exports = router;
