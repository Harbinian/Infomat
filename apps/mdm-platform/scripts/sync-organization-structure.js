const fs = require('fs');
const path = require('path');

const DEFAULT_SOURCE_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'organization', '组织架构和部门职责.md');

const ORGANIZATION_STRUCTURE_UNITS = [
  {
    code: 'OU-COM-CXF',
    name: '沈阳昌兴复材航空科技有限责任公司',
    type: 'company',
    mnemonic: 'CXF',
    sourceLabel: '沈阳昌兴复材航空科技有限责任公司'
  },
  {
    code: 'OU-DEP-ENG',
    name: '工程技术部',
    type: 'department',
    mnemonic: 'ENG',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '工程技术部（直辖）'
  },
  {
    code: 'OU-DEP-QMS',
    name: '质量管理部',
    type: 'department',
    mnemonic: 'QMS',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '质量管理部（直辖）'
  },
  {
    code: 'OU-DEP-FIN',
    name: '财务部',
    type: 'department',
    mnemonic: 'FIN',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '财务部（直辖）'
  },
  {
    code: 'OU-DEP-AHR',
    name: '行政人事部',
    type: 'department',
    mnemonic: 'AHR',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '行政人事部'
  },
  {
    code: 'OU-DEP-BDV',
    name: '经营发展部',
    type: 'department',
    mnemonic: 'BDV',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '经营发展部'
  },
  {
    code: 'OU-DEP-MAT',
    name: '物资保障部',
    type: 'department',
    mnemonic: 'MAT',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '物资保障部'
  },
  {
    code: 'OU-DEP-PMO',
    name: '项目管理部',
    type: 'department',
    mnemonic: 'PMO',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '项目管理部'
  },
  {
    code: 'OU-DEP-CMP',
    name: '复材车间',
    type: 'department',
    mnemonic: 'CMP',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '复材车间（一、二车间）'
  },
  {
    code: 'OU-DEP-EHS',
    name: '运维安环部',
    type: 'department',
    mnemonic: 'EHS',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '运维安环部'
  },
  {
    code: 'OU-OFC-CXF-CEO',
    name: '总经理办公室',
    type: 'office',
    mnemonic: 'CEO',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '总经理办公室'
  },
  {
    code: 'OU-OFC-CXF-BVP',
    name: '经营副总办公室',
    type: 'office',
    mnemonic: 'BVP',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '经营副总办公室'
  },
  {
    code: 'OU-OFC-CXF-MVP',
    name: '生产副总办公室',
    type: 'office',
    mnemonic: 'MVP',
    parentCode: 'OU-COM-CXF',
    sourceLabel: '生产副总办公室'
  }
];

const LEADERSHIP_OFFICE_ASSIGNMENTS = [
  {
    officeCode: 'OU-OFC-CXF-CEO',
    positionCode: 'POS-CXF-CEO',
    positionName: '总经理',
    posMnemonic: 'CEO',
    employeeNo: '100000',
    personName: '马成文',
    employmentStatus: 'active'
  },
  {
    officeCode: 'OU-OFC-CXF-BVP',
    positionCode: 'POS-CXF-BVP',
    positionName: '经营副总',
    posMnemonic: 'BVP',
    employeeNo: '100002',
    personName: '李洪哲',
    employmentStatus: 'active'
  },
  {
    officeCode: 'OU-OFC-CXF-MVP',
    positionCode: 'POS-CXF-MVP',
    positionName: '生产副总',
    posMnemonic: 'MVP',
    employeeNo: '51568',
    personName: '赵亮',
    employmentStatus: 'active'
  }
];

const ORG_UNIT_CODE_PATTERNS = {
  company: /^OU-COM-[A-Z0-9]{3}$/,
  department: /^OU-DEP-[A-Z0-9]{3}$/,
  office: /^OU-OFC-[A-Z0-9]{3}-[A-Z0-9]{3}$/,
  team: /^OU-TEM-[A-Z0-9]{3}-[A-Z0-9]{3}$/
};

function validateOrganizationStructureUnits(units = ORGANIZATION_STRUCTURE_UNITS) {
  const byCode = new Map(units.map(unit => [unit.code, unit]));
  const seenCodes = new Set();
  const seenMnemonics = new Set();

  for (const unit of units) {
    const pattern = ORG_UNIT_CODE_PATTERNS[unit.type];
    if (unit.type === 'office' || unit.type === 'team') {
      const parent = byCode.get(unit.parentCode);
      const expectedPrefix = unit.type === 'office'
        ? `OU-OFC-${parent ? parent.mnemonic : ''}-`
        : `OU-TEM-${parent ? parent.mnemonic : ''}-`;
      if (!parent || !unit.code.startsWith(expectedPrefix)) {
        throw new Error(`办公室编码必须包含父级组织简称：${unit.code}`);
      }
    }
    if (!pattern || !pattern.test(unit.code)) {
      throw new Error(`组织编码不符合 ${unit.type} 规则：${unit.code}`);
    }
    if (seenCodes.has(unit.code)) {
      throw new Error(`组织编码重复：${unit.code}`);
    }
    if (seenMnemonics.has(unit.mnemonic)) {
      throw new Error(`组织简称重复：${unit.mnemonic}`);
    }
    seenCodes.add(unit.code);
    seenMnemonics.add(unit.mnemonic);

    if (unit.parentCode && !byCode.has(unit.parentCode)) {
      throw new Error(`组织父级不存在：${unit.parentCode}`);
    }
  }
}

function readSource(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`组织架构真源不存在：${sourcePath}`);
  }
  return fs.readFileSync(sourcePath, 'utf8');
}

function assertSourceCoversOrganization(sourceText) {
  const missingLabels = ORGANIZATION_STRUCTURE_UNITS
    .map(unit => unit.sourceLabel)
    .filter(label => !sourceText.includes(label));
  const missingCodes = ORGANIZATION_STRUCTURE_UNITS
    .map(unit => unit.code)
    .filter(code => !sourceText.includes(code));
  if (missingLabels.length || missingCodes.length) {
    const missing = missingLabels.concat(missingCodes);
    throw new Error(`组织架构真源缺少：${missing.join('、')}`);
  }
}

function syncOrganizationStructure(options = {}) {
  const database = options.db || require('../server/db');
  const sourcePath = options.sourcePath || DEFAULT_SOURCE_PATH;
  const sourceText = readSource(sourcePath);
  validateOrganizationStructureUnits();
  assertSourceCoversOrganization(sourceText);

  const findByCode = database.prepare('SELECT org_unit_id FROM org_unit WHERE org_unit_code = ?');
  const findByMnemonic = database.prepare('SELECT org_unit_id FROM org_unit WHERE org_mnemonic = ?');
  const findByName = database.prepare('SELECT org_unit_id FROM org_unit WHERE org_unit_name = ? ORDER BY org_unit_id LIMIT 1');
  const updateUnit = database.prepare(`
    UPDATE org_unit
    SET org_unit_code = ?,
        org_unit_name = ?,
        org_type = ?,
        org_mnemonic = ?,
        parent_org_unit_id = ?,
        status = 'active',
        effective_from = COALESCE(effective_from, CURRENT_DATE),
        effective_to = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE org_unit_id = ?
  `);
  const insertUnit = database.prepare(`
    INSERT INTO org_unit (
      org_unit_code,
      org_unit_name,
      org_type,
      org_mnemonic,
      parent_org_unit_id,
      status,
      effective_from
    ) VALUES (?, ?, ?, ?, ?, 'active', CURRENT_DATE)
  `);
  const findPositionByCode = database.prepare('SELECT position_id FROM position WHERE position_code = ?');
  const findPositionByOrgMnemonic = database.prepare('SELECT position_id FROM position WHERE org_unit_id = ? AND pos_mnemonic = ?');
  const updatePosition = database.prepare(`
    UPDATE position
    SET position_code = ?,
        position_name = ?,
        pos_mnemonic = ?,
        org_unit_id = ?,
        status = 'active',
        effective_from = COALESCE(effective_from, CURRENT_DATE),
        effective_to = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE position_id = ?
  `);
  const insertPosition = database.prepare(`
    INSERT INTO position (
      position_code,
      position_name,
      pos_mnemonic,
      org_unit_id,
      status,
      effective_from
    ) VALUES (?, ?, ?, ?, 'active', CURRENT_DATE)
  `);
  const findPersonByEmployeeNo = database.prepare('SELECT person_id FROM person WHERE employee_no = ?');
  const updatePerson = database.prepare(`
    UPDATE person
    SET person_name = ?,
        employment_status = ?,
        status = 'active',
        effective_from = COALESCE(effective_from, CURRENT_DATE),
        effective_to = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE person_id = ?
  `);
  const insertPerson = database.prepare(`
    INSERT INTO person (
      employee_no,
      person_name,
      employment_status,
      status,
      effective_from
    ) VALUES (?, ?, ?, 'active', CURRENT_DATE)
  `);
  const findActiveAssignment = database.prepare(`
    SELECT assignment_id
    FROM person_position_assignment
    WHERE person_id = ? AND position_id = ? AND status = 'active'
    ORDER BY assignment_id
    LIMIT 1
  `);
  const updateAssignment = database.prepare(`
    UPDATE person_position_assignment
    SET is_primary = 1,
        end_date = NULL,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    WHERE assignment_id = ?
  `);
  const insertAssignment = database.prepare(`
    INSERT INTO person_position_assignment (
      person_id,
      position_id,
      is_primary,
      status,
      start_date
    ) VALUES (?, ?, 1, 'active', CURRENT_DATE)
  `);
  const clearPrimaryAssignment = database.prepare(`
    UPDATE person_position_assignment
    SET is_primary = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE person_id = ? AND status = 'active'
  `);
  const updateOfficeManager = database.prepare(`
    UPDATE org_unit
    SET manager_person_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE org_unit_id = ?
  `);

  const sync = database.transaction(() => {
    const idByCode = new Map();
    const canonicalIds = [];
    const canonicalPositionIds = [];
    const syncedPersonIds = [];

    for (const unit of ORGANIZATION_STRUCTURE_UNITS) {
      const parentId = unit.parentCode ? idByCode.get(unit.parentCode) : null;
      if (unit.parentCode && !parentId) {
        throw new Error(`组织架构父级未同步：${unit.parentCode}`);
      }

      const existing =
        findByCode.get(unit.code) ||
        findByMnemonic.get(unit.mnemonic) ||
        findByName.get(unit.name);

      let orgUnitId;
      if (existing) {
        orgUnitId = existing.org_unit_id;
        updateUnit.run(unit.code, unit.name, unit.type, unit.mnemonic, parentId, orgUnitId);
      } else {
        orgUnitId = insertUnit.run(unit.code, unit.name, unit.type, unit.mnemonic, parentId).lastInsertRowid;
      }
      idByCode.set(unit.code, Number(orgUnitId));
      canonicalIds.push(Number(orgUnitId));
    }

    if (canonicalIds.length) {
      database.prepare(`
        UPDATE org_unit
        SET status = 'inactive',
            effective_to = CURRENT_DATE,
            updated_at = CURRENT_TIMESTAMP
        WHERE status = 'active'
          AND org_unit_id NOT IN (${canonicalIds.map(() => '?').join(', ')})
      `).run(...canonicalIds);
    }

    for (const assignment of LEADERSHIP_OFFICE_ASSIGNMENTS) {
      const officeId = idByCode.get(assignment.officeCode);
      if (!officeId) {
        throw new Error(`经理办公室未同步：${assignment.officeCode}`);
      }

      const existingPosition =
        findPositionByCode.get(assignment.positionCode) ||
        findPositionByOrgMnemonic.get(officeId, assignment.posMnemonic);
      let positionId;
      if (existingPosition) {
        positionId = Number(existingPosition.position_id);
        updatePosition.run(
          assignment.positionCode,
          assignment.positionName,
          assignment.posMnemonic,
          officeId,
          positionId
        );
      } else {
        positionId = Number(insertPosition.run(
          assignment.positionCode,
          assignment.positionName,
          assignment.posMnemonic,
          officeId
        ).lastInsertRowid);
      }
      canonicalPositionIds.push(positionId);

      const existingPerson = findPersonByEmployeeNo.get(assignment.employeeNo);
      let personId;
      if (existingPerson) {
        personId = Number(existingPerson.person_id);
        updatePerson.run(assignment.personName, assignment.employmentStatus, personId);
      } else {
        personId = Number(insertPerson.run(
          assignment.employeeNo,
          assignment.personName,
          assignment.employmentStatus
        ).lastInsertRowid);
      }
      syncedPersonIds.push(personId);

      clearPrimaryAssignment.run(personId);
      const existingAssignment = findActiveAssignment.get(personId, positionId);
      if (existingAssignment) {
        updateAssignment.run(existingAssignment.assignment_id);
      } else {
        insertAssignment.run(personId, positionId);
      }
      updateOfficeManager.run(personId, officeId);
    }
  });

  sync();
  return {
    synced: ORGANIZATION_STRUCTURE_UNITS.length,
    positions: LEADERSHIP_OFFICE_ASSIGNMENTS.length,
    persons: LEADERSHIP_OFFICE_ASSIGNMENTS.length,
    assignments: LEADERSHIP_OFFICE_ASSIGNMENTS.length,
    sourcePath
  };
}

module.exports = {
  DEFAULT_SOURCE_PATH,
  ORGANIZATION_STRUCTURE_UNITS,
  LEADERSHIP_OFFICE_ASSIGNMENTS,
  validateOrganizationStructureUnits,
  syncOrganizationStructure
};

if (require.main === module) {
  const result = syncOrganizationStructure();
  console.log(`Organization structure synchronized: ${result.synced} org units`);
}
