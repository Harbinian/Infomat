const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const {
  LEADERSHIP_OFFICE_ASSIGNMENTS,
  ORGANIZATION_STRUCTURE_UNITS,
  syncOrganizationStructure,
  validateOrganizationStructureUnits
} = require('./sync-organization-structure');

const sourcePath = path.join(__dirname, '..', '..', '..', 'docs', 'organization', '组织架构和部门职责.md');
const EXPECTED_STRUCTURE_CODES = new Map([
  ['沈阳昌兴复材航空科技有限责任公司', { code: 'OU-COM-CXF', mnemonic: 'CXF', parent: null }],
  ['工程技术部', { code: 'OU-DEP-ENG', mnemonic: 'ENG', parent: 'OU-COM-CXF' }],
  ['质量管理部', { code: 'OU-DEP-QMS', mnemonic: 'QMS', parent: 'OU-COM-CXF' }],
  ['财务部', { code: 'OU-DEP-FIN', mnemonic: 'FIN', parent: 'OU-COM-CXF' }],
  ['行政人事部', { code: 'OU-DEP-AHR', mnemonic: 'AHR', parent: 'OU-COM-CXF' }],
  ['经营发展部', { code: 'OU-DEP-BDV', mnemonic: 'BDV', parent: 'OU-COM-CXF' }],
  ['物资保障部', { code: 'OU-DEP-MAT', mnemonic: 'MAT', parent: 'OU-COM-CXF' }],
  ['项目管理部', { code: 'OU-DEP-PMO', mnemonic: 'PMO', parent: 'OU-COM-CXF' }],
  ['复材车间', { code: 'OU-DEP-CMP', mnemonic: 'CMP', parent: 'OU-COM-CXF' }],
  ['运维安环部', { code: 'OU-DEP-EHS', mnemonic: 'EHS', parent: 'OU-COM-CXF' }],
  ['总经理办公室', { code: 'OU-OFC-CXF-CEO', mnemonic: 'CEO', parent: 'OU-COM-CXF' }],
  ['经营副总办公室', { code: 'OU-OFC-CXF-BVP', mnemonic: 'BVP', parent: 'OU-COM-CXF' }],
  ['生产副总办公室', { code: 'OU-OFC-CXF-MVP', mnemonic: 'MVP', parent: 'OU-COM-CXF' }]
]);

const RETIRED_STRUCTURE_CODES = [
  'ORG-COMPANY-CXFC',
  'ORG-OFFICE-GM',
  'ORG-DEPT-GCJS',
  'ORG-DEPT-ZLGL',
  'ORG-DEPT-CW',
  'ORG-OFFICE-BIZVP',
  'ORG-DEPT-XZRS',
  'ORG-DEPT-JYFZ',
  'ORG-DEPT-WZBZ',
  'ORG-OFFICE-PRODVP',
  'ORG-DEPT-XMGL',
  'ORG-DEPT-FCCJ',
  'ORG-DEPT-YWAH',
  'ORG-C00',
  'ORG-L10',
  'ORG-D11',
  'ORG-D12',
  'ORG-D13',
  'ORG-L20',
  'ORG-D21',
  'ORG-D22',
  'ORG-D23',
  'ORG-L30',
  'ORG-D31',
  'ORG-D32',
  'ORG-D33',
  'ORG-COM',
  'ORG-CEO',
  'ORG-ENG',
  'ORG-QMS',
  'ORG-FIN',
  'ORG-BIZ',
  'ORG-AHR',
  'ORG-BDV',
  'ORG-MAT',
  'ORG-MFG',
  'ORG-PMO',
  'ORG-CMP',
  'ORG-EHS',
  'CXFC',
  'GCJS',
  'ZLGL',
  'BIZVP',
  'XZRS',
  'JYFZ',
  'WZBZ',
  'PRODVP',
  'XMGL',
  'FCCJ',
  'YWAH',
  'C00',
  'L10',
  'D11',
  'D12',
  'D13',
  'L20',
  'D21',
  'D22',
  'D23',
  'L30',
  'D31',
  'D32',
  'D33'
];

const LEADERSHIP_TITLES = ['总经理', '经营副总', '生产副总'];

function rowByName(name) {
  return db.prepare(`
    SELECT child.*, parent.org_unit_name AS parent_name, parent.org_unit_code AS parent_code
    FROM org_unit child
    LEFT JOIN org_unit parent ON child.parent_org_unit_id = parent.org_unit_id
    WHERE child.org_unit_name = ?
  `).get(name);
}

function countByCode(code) {
  return db.prepare('SELECT COUNT(*) AS count FROM org_unit WHERE org_unit_code = ?').get(code).count;
}

function assignmentByOfficePositionPerson(officeCode, positionCode, employeeNo) {
  return db.prepare(`
    SELECT
      office.org_unit_id AS office_id,
      office.org_unit_code,
      office.org_unit_name,
      office.manager_person_id,
      position.position_id,
      position.position_code,
      position.position_name,
      person.person_id,
      person.employee_no,
      person.person_name,
      assignment.is_primary,
      assignment.status
    FROM org_unit office
    JOIN position ON position.org_unit_id = office.org_unit_id
    JOIN person_position_assignment assignment ON assignment.position_id = position.position_id
    JOIN person ON person.person_id = assignment.person_id
    WHERE office.org_unit_code = ?
      AND position.position_code = ?
      AND person.employee_no = ?
      AND assignment.status = 'active'
  `).get(officeCode, positionCode, employeeNo);
}

function childCountByParentCode(parentCode) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM org_unit child
    JOIN org_unit parent ON child.parent_org_unit_id = parent.org_unit_id
    WHERE parent.org_unit_code = ?
      AND child.status = 'active'
  `).get(parentCode).count;
}

function assertOfficeCodeRules() {
  const futureOfficeUnits = ORGANIZATION_STRUCTURE_UNITS.concat([
    {
      code: 'OU-OFC-ENG-GEN',
      name: '工程技术部办公室',
      type: 'office',
      mnemonic: 'GEN',
      parentCode: 'OU-DEP-ENG',
      sourceLabel: '工程技术部办公室'
    }
  ]);
  assert.doesNotThrow(() => validateOrganizationStructureUnits(futureOfficeUnits));

  const orphanOfficeUnits = ORGANIZATION_STRUCTURE_UNITS.concat([
    {
      code: 'OU-OFC-CEO',
      name: '总经理办公室',
      type: 'office',
      mnemonic: 'CEO',
      parentCode: 'OU-COM-CXF',
      sourceLabel: '总经理办公室'
    }
  ]);
  assert.throws(
    () => validateOrganizationStructureUnits(orphanOfficeUnits),
    /办公室编码必须包含父级组织简称/
  );
}

function main() {
  try {
    assert.ok(fs.existsSync(sourcePath), 'organization source document should exist');
    assertOfficeCodeRules();

    const sourceText = fs.readFileSync(sourcePath, 'utf8');
    [
      '总经理',
      '工程技术部（直辖）',
      '质量管理部（直辖）',
      '财务部（直辖）',
      '经营副总',
      '行政人事部',
      '经营发展部',
      '物资保障部',
      '生产副总',
      '项目管理部',
      '复材车间（一、二车间）',
      '运维安环部'
    ].forEach(label => assert.ok(sourceText.includes(label), `source document missing ${label}`));
    [
      '经理办公室当前建制',
      'OU-OFC-CXF-CEO',
      'OU-OFC-CXF-BVP',
      'OU-OFC-CXF-MVP',
      'POS-CXF-CEO',
      'POS-CXF-BVP',
      'POS-CXF-MVP',
      '马成文',
      '李洪哲',
      '赵亮'
    ].forEach(label => assert.ok(sourceText.includes(label), `source document missing ${label}`));
    EXPECTED_STRUCTURE_CODES.forEach(({ code, mnemonic, parent }) => {
      assert.ok(sourceText.includes(code), `source document missing structure code ${code}`);
      assert.ok(sourceText.includes(mnemonic), `source document missing structure mnemonic ${mnemonic}`);
      if (parent) assert.ok(sourceText.includes(parent), `source document missing parent code ${parent}`);
    });
    RETIRED_STRUCTURE_CODES.forEach(code => {
      assert.ok(!sourceText.includes(code), `source document should not keep retired org_unit code or mnemonic ${code}`);
    });
    assert.ok(sourceText.includes('OU-OFC-CXF-CEO'), 'source document should show a company-level leadership office example');
    assert.ok(sourceText.includes('OU-OFC-ENG-GEN'), 'source document should show a department office example');
    assert.ok(sourceText.includes('不允许出现孤立的 `OU-OFC-CEO`'), 'source document should forbid orphan office codes');
    assert.ok(!sourceText.includes('当前组织架构尚未设立办公室建制'), 'source document should not keep the old no-office wording');
    assert.ok(sourceText.includes('每个经理办公室当前先保留一个主岗位和一名人员'), 'source document should explain the one-person office scaffold');
    assert.ok(sourceText.includes('经理办公室只承载领导岗位及其配套人员，不作为部门上级'), 'source document should separate offices from department hierarchy');
    assert.ok(sourceText.includes('分管关系在领导层职责中表达'), 'source document should keep supervisory relations out of org_unit hierarchy');
    LEADERSHIP_TITLES.forEach(title => {
      assert.ok(!sourceText.includes(`| ${title} | office |`), `${title} should not be documented as an org_unit office`);
    });

    assert.deepStrictEqual(
      ORGANIZATION_STRUCTURE_UNITS.map(unit => [unit.name, unit.code, unit.mnemonic, unit.parentCode || null]),
      Array.from(EXPECTED_STRUCTURE_CODES, ([name, expected]) => [name, expected.code, expected.mnemonic, expected.parent])
    );

    db.prepare(`
      INSERT INTO org_unit (org_unit_code, org_unit_name, org_type, org_mnemonic, status)
      VALUES
        ('ORG-CEO', '总经理', 'office', 'CEO', 'active'),
        ('ORG-BIZ', '经营副总', 'office', 'BIZ', 'active'),
        ('ORG-MFG', '生产副总', 'office', 'MFG', 'active')
    `).run();

    const first = syncOrganizationStructure({ db, sourcePath });
    const second = syncOrganizationStructure({ db, sourcePath });

    assert.strictEqual(first.synced, ORGANIZATION_STRUCTURE_UNITS.length);
    assert.strictEqual(second.synced, ORGANIZATION_STRUCTURE_UNITS.length);
    assert.strictEqual(first.positions, LEADERSHIP_OFFICE_ASSIGNMENTS.length);
    assert.strictEqual(first.persons, LEADERSHIP_OFFICE_ASSIGNMENTS.length);
    assert.strictEqual(first.assignments, LEADERSHIP_OFFICE_ASSIGNMENTS.length);

    const activeCount = db.prepare("SELECT COUNT(*) AS count FROM org_unit WHERE status = 'active'").get().count;
    assert.strictEqual(activeCount, ORGANIZATION_STRUCTURE_UNITS.length);

    const duplicateMnemonics = db.prepare(`
      SELECT org_mnemonic, COUNT(*) AS count
      FROM org_unit
      GROUP BY org_mnemonic
      HAVING COUNT(*) > 1
    `).all();
    assert.deepStrictEqual(duplicateMnemonics, []);

    EXPECTED_STRUCTURE_CODES.forEach((expected, name) => {
      const row = rowByName(name);
      assert.strictEqual(row.org_unit_code, expected.code, `${name} code should include org-unit type namespace`);
      assert.strictEqual(row.org_mnemonic, expected.mnemonic, `${name} mnemonic should use the scoped English abbreviation`);
      assert.strictEqual(row.parent_code || null, expected.parent, `${name} parent should be a real org_unit`);
    });

    assert.strictEqual(rowByName('沈阳昌兴复材航空科技有限责任公司').org_type, 'company');
    LEADERSHIP_TITLES.forEach(title => {
      const row = rowByName(title);
      assert.ok(!row || row.status === 'inactive', `${title} should not be an active org_unit`);
    });

    ['工程技术部', '质量管理部', '财务部'].forEach(name => {
      const row = rowByName(name);
      assert.strictEqual(row.org_type, 'department');
      assert.strictEqual(row.parent_name, '沈阳昌兴复材航空科技有限责任公司');
    });

    ['行政人事部', '经营发展部', '物资保障部'].forEach(name => {
      const row = rowByName(name);
      assert.strictEqual(row.org_type, 'department');
      assert.strictEqual(row.parent_name, '沈阳昌兴复材航空科技有限责任公司');
    });

    ['项目管理部', '复材车间', '运维安环部'].forEach(name => {
      const row = rowByName(name);
      assert.strictEqual(row.org_type, 'department');
      assert.strictEqual(row.parent_name, '沈阳昌兴复材航空科技有限责任公司');
    });

    ['总经理办公室', '经营副总办公室', '生产副总办公室'].forEach(name => {
      const row = rowByName(name);
      assert.strictEqual(row.org_type, 'office');
      assert.strictEqual(row.parent_name, '沈阳昌兴复材航空科技有限责任公司');
    });

    LEADERSHIP_OFFICE_ASSIGNMENTS.forEach(assignment => {
      const row = assignmentByOfficePositionPerson(
        assignment.officeCode,
        assignment.positionCode,
        assignment.employeeNo
      );
      assert.ok(row, `${assignment.officeCode} should have active position/person assignment`);
      assert.strictEqual(row.position_name, assignment.positionName);
      assert.strictEqual(row.person_name, assignment.personName);
      assert.strictEqual(row.is_primary, 1);
      assert.strictEqual(row.manager_person_id, row.person_id);
      assert.strictEqual(childCountByParentCode(assignment.officeCode), 0, `${assignment.officeCode} should not manage department org_units`);
    });

    ORGANIZATION_STRUCTURE_UNITS.forEach(unit => {
      assert.strictEqual(countByCode(unit.code), 1, `${unit.code} should be idempotent`);
    });

    console.log('Organization structure sync test passed');
  } finally {
    try {
      db.close();
    } finally {
      cleanupDb();
    }
  }
}

main();
