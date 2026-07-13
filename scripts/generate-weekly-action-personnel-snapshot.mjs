import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_COLUMNS = [
  '工号',
  '姓名',
  '花名册部门',
  '花名册职务',
  '项目组织',
  '项目角色',
  '任命状态',
  '来源材料',
  '来源位置',
  '来源可信度',
  '人员匹配状态',
  '是否待确认'
];

const ROSTER_COLUMNS = ['姓名', '工号', '部门', '职务'];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) index += 1;
  }
  return args;
}

function cellsFromLine(line) {
  return line.split('|').slice(1, -1).map(cell => cell.trim());
}

function isDividerRow(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{2,}:?$/.test(cell));
}

function parseMarkdownTables(markdown, requiredColumns) {
  const rows = [];
  let header = null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|') || !line.endsWith('|')) {
      header = null;
      continue;
    }
    const cells = cellsFromLine(line);
    if (isDividerRow(cells)) continue;
    if (!header) {
      header = cells;
      continue;
    }
    if (!requiredColumns.every(column => header.includes(column))) continue;
    rows.push(Object.fromEntries(header.map((column, index) => [column, cells[index] || ''])));
  }
  return rows;
}

function parseRoster(markdown) {
  const rows = parseMarkdownTables(markdown, ROSTER_COLUMNS);
  const byName = new Map();
  for (const row of rows) {
    byName.set(row['姓名'], {
      name: row['姓名'],
      employeeId: row['工号'],
      department: row['部门'],
      position: row['职务']
    });
  }
  return byName;
}

function normalizeCode(value) {
  const hash = crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex').slice(0, 10).toUpperCase();
  return hash;
}

function personRoleKeyFor(row) {
  const organizationCode = normalizeCode(row['项目组织']);
  const roleCode = normalizeCode(row['项目角色']);
  if (row['人员匹配状态'] === '花名册待补') {
    return `PENDING-${normalizeCode(row['姓名'])}__ORG-${organizationCode}__ROLE-${roleCode}`;
  }
  return `EMP-${row['工号']}__ORG-${organizationCode}__ROLE-${roleCode}`;
}

function warning(code, message, row) {
  return {
    code,
    message,
    name: row['姓名'],
    projectOrganization: row['项目组织'],
    projectRole: row['项目角色']
  };
}

function validateRow(row, rosterByName, failures, warnings) {
  if (!row['姓名'] || !row['项目组织'] || !row['项目角色']) {
    failures.push(`映射行缺少姓名、项目组织或项目角色: ${JSON.stringify(row)}`);
    return;
  }

  const matchStatus = row['人员匹配状态'];
  const appointmentStatus = row['任命状态'];
  const roster = rosterByName.get(row['姓名']);

  if (matchStatus === '已匹配花名册') {
    if (!roster) {
      failures.push(`${row['姓名']} 标为已匹配花名册，但花名册中未找到`);
      return;
    }
    const expected = {
      工号: roster.employeeId,
      花名册部门: roster.department,
      花名册职务: roster.position
    };
    for (const [field, value] of Object.entries(expected)) {
      if (row[field] !== value) {
        failures.push(`${row['姓名']} ${field} 与花名册不一致: 映射=${row[field]} 花名册=${value}`);
      }
    }
  } else if (matchStatus === '花名册待补') {
    const pendingFields = ['工号', '花名册部门', '花名册职务'];
    for (const field of pendingFields) {
      if (row[field] !== '待花名册确认') {
        failures.push(`${row['姓名']} 标为花名册待补，但 ${field} 不是待花名册确认`);
      }
    }
    warnings.push(warning('ROSTER_PENDING', '项目材料中有人名，但花名册尚未匹配', row));
  } else {
    failures.push(`${row['姓名']} 人员匹配状态无效: ${matchStatus}`);
  }

  if (appointmentStatus === '暂定' || appointmentStatus === '待确认') {
    warnings.push(warning('APPOINTMENT_PENDING', `任命状态为${appointmentStatus}`, row));
  }
  if (String(row['来源可信度'] || '').startsWith('中：') || String(row['来源可信度'] || '').startsWith('待确认')) {
    warnings.push(warning('SOURCE_REVIEW', `来源可信度为${row['来源可信度']}`, row));
  }
}

function toRole(row) {
  const selectable = row['任命状态'] !== '已撤销';
  const usageRestrictions = [];
  if (row['人员匹配状态'] === '花名册待补') usageRestrictions.push('不能作为默认主业务责任人；如选为主责任人，必须关联人员信息待校正事项');
  if (row['任命状态'] === '待确认') usageRestrictions.push('不建议作为关闭责任人');
  if (row['人员匹配状态'] === '花名册待补' || row['任命状态'] === '待确认') usageRestrictions.push('不能作为 PMO 核验人或关闭操作人');
  return {
    personRoleKey: personRoleKeyFor(row),
    selectable,
    name: row['姓名'],
    employeeId: row['工号'],
    rosterDepartment: row['花名册部门'],
    rosterPosition: row['花名册职务'],
    projectOrganization: row['项目组织'],
    projectRole: row['项目角色'],
    appointmentStatus: row['任命状态'],
    sourceMaterial: row['来源材料'],
    sourceLocation: row['来源位置'],
    sourceReliability: row['来源可信度'],
    personnelMatchStatus: row['人员匹配状态'],
    pendingConfirmation: row['是否待确认'],
    usageRestrictions
  };
}

function buildPeople(roles) {
  const people = new Map();
  for (const role of roles) {
    const key = role.personnelMatchStatus === '花名册待补' ? `PENDING-${role.name}` : `EMP-${role.employeeId}`;
    const current = people.get(key) || {
      personKey: key,
      name: role.name,
      employeeId: role.employeeId,
      rosterDepartment: role.rosterDepartment,
      rosterPosition: role.rosterPosition,
      personnelMatchStatus: role.personnelMatchStatus,
      roleKeys: []
    };
    current.roleKeys.push(role.personRoleKey);
    people.set(key, current);
  }
  return [...people.values()];
}

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function buildSnapshot({ mappingPath, rosterPath, outputPath, generatedBy }) {
  const mappingMarkdown = fs.readFileSync(mappingPath, 'utf8');
  const rosterMarkdown = fs.readFileSync(rosterPath, 'utf8');
  const rows = parseMarkdownTables(mappingMarkdown, REQUIRED_COLUMNS);
  const rosterByName = parseRoster(rosterMarkdown);
  const failures = [];
  const warnings = [];

  if (rows.length === 0) failures.push('未从人员角色映射文件中解析到映射行');

  for (const row of rows) validateRow(row, rosterByName, failures, warnings);

  const roles = rows.map(toRole).filter(role => role.selectable);
  const duplicateKeys = roles
    .map(role => role.personRoleKey)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateKeys.length > 0) failures.push(`personRoleKey 重复: ${[...new Set(duplicateKeys)].join(', ')}`);
  if (roles.some(role => role.appointmentStatus === '已撤销')) failures.push('已撤销人员不能进入可选角色列表');

  if (failures.length > 0) {
    const error = new Error(`人员快照生成失败:\n${failures.join('\n')}`);
    error.failures = failures;
    throw error;
  }

  const sourceHash = crypto
    .createHash('sha256')
    .update(mappingMarkdown)
    .update(rosterMarkdown)
    .digest('hex');
  const generatedAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    snapshotId: `PERSONNEL-${generatedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${sourceHash.slice(0, 8).toUpperCase()}`,
    generatedAt,
    generatedBy,
    sourceFiles: [
      path.relative(process.cwd(), mappingPath).replace(/\\/g, '/'),
      path.relative(process.cwd(), rosterPath).replace(/\\/g, '/')
    ],
    sourceHash,
    rowCount: rows.length,
    warningCount: warnings.length,
    warnings,
    people: buildPeople(roles),
    personRoles: roles
  };

  writeJsonAtomic(outputPath, snapshot);
  return snapshot;
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = parseArgs(process.argv.slice(2));
  const mappingPath = path.resolve(args.mapping || path.join(repoRoot, 'docs', 'organization', '信息化项目人员角色映射.md'));
  const rosterPath = path.resolve(args.roster || path.join(repoRoot, 'docs', 'organization', '花名册.md'));
  const outputPath = path.resolve(args.out || path.join(repoRoot, 'artifacts', 'weekly-actions', 'personnel-snapshot.json'));
  const generatedBy = args['generated-by'] || process.env.USERNAME || process.env.USER || 'unknown';
  try {
    const snapshot = buildSnapshot({ mappingPath, rosterPath, outputPath, generatedBy });
    console.log(`personnel snapshot written: ${outputPath}`);
    console.log(`roles=${snapshot.personRoles.length} warnings=${snapshot.warningCount}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { buildSnapshot, parseMarkdownTables, parseRoster };
