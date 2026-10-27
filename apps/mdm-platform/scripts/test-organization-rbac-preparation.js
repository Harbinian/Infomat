// In-memory synthetic workbook only; no original files, services or database.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { prepareOrganizationRbac } = require('./prepare-organization-rbac');

async function fixture() {
  const workbook = new ExcelJS.Workbook();
  const staff = workbook.addWorksheet('职员');
  staff.addRow(['总序号', '姓名', '员工编号', '部门', '办公室', '职务']);
  staff.addRow([{ formula: 'ROW()-1', result: 1 }, '合成人员', '000123', '合成甲部', '合成办公室', '主管']);
  const workers = workbook.addWorksheet('工人');
  workers.addRow(['总序号', '姓名', '员工编号', '部门', '工区', '班组', '职务']);
  workers.addRow([1, '合成甲人', 100206, '合成乙部', '合成工区', '合成班组', '班长']);
  workers.addRow([2, '合成乙人', 100206, '合成乙部', '合成工区', '另一班组', '操作工']);
  return { workbook, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}

test('source retains identifiers and distinct organization layers without inventing permissions or employment state', async () => {
  const { buffer } = await fixture();
  const report = await prepareOrganizationRbac(buffer, 'synthetic.xlsx');
  assert.equal(report.role_model.version, 'rbac-raci-v5-2026-10-19');
  assert.equal(report.role_model.roles.length, 9);
  assert.equal(report.people[0].employee_no, '000123');
  assert.equal(report.summary.source_records, 3);
  assert.equal(report.summary.remaining_source_issues, 1);
  assert.equal(report.issues[0].code, 'SOURCE_EMPLOYEE_NO_DUPLICATE');
  assert.deepEqual(report.issues[0].previous_source, { sheet: '工人', row: 2 });
  assert.equal(report.people[1].office_name, null);
  assert.equal(report.people[1].work_area_name, '合成工区');
  assert.equal(report.people[1].team_name, '合成班组');
  for (const person of report.people) {
    assert.deepEqual(person.role_assignments, []);
    assert.equal(person.person_id, null);
    assert.equal(person.department_id, null);
    assert.equal(person.employment_status, null);
    assert.equal(person.account_action, null);
  }
  assert.equal(report.executable, false);
});

test('explicit exclusion binds original digest and all four person locators, preserves original conflict and included person', async () => {
  const { buffer } = await fixture();
  const confirmations = { source_sha256: crypto.createHash('sha256').update(buffer).digest('hex'), excluded_people: [{ sheet: '工人', row: 3, employee_no: '100206', person_name: '合成乙人', basis: '合成明确确认' }] };
  const report = await prepareOrganizationRbac(buffer, 'synthetic.xlsx', confirmations);
  assert.equal(report.summary.records, 2);
  assert.equal(report.summary.excluded_records, 1);
  assert.equal(report.summary.source_issues, 1);
  assert.equal(report.summary.remaining_source_issues, 0);
  assert.equal(report.people.find(person => person.employee_no === '100206').person_name, '合成甲人');
  assert.equal(report.excluded_people[0].person_name, '合成乙人');
  assert.equal(report.excluded_people[0].exclusion_basis, '合成明确确认');
  for (const patch of [{ person_name: '合成甲人' }, { row: 4 }, { employee_no: '100207' }, { basis: '' }]) {
    await assert.rejects(prepareOrganizationRbac(buffer, 'synthetic.xlsx', { ...confirmations, excluded_people: [{ ...confirmations.excluded_people[0], ...patch }] }));
  }
  await assert.rejects(prepareOrganizationRbac(buffer, 'synthetic.xlsx', { ...confirmations, source_sha256: 'changed' }));
});

test('needed formula values fail while unused sequence formulas remain irrelevant; numeric code formatting is preserved', async () => {
  const { workbook } = await fixture();
  const staff = workbook.getWorksheet('职员');
  staff.getCell('C2').value = 123;
  staff.getCell('C2').numFmt = '000000';
  const report = await prepareOrganizationRbac(Buffer.from(await workbook.xlsx.writeBuffer()), 'synthetic.xlsx');
  assert.equal(report.people[0].employee_no, '000123');
  staff.getCell('C2').value = { formula: '100+23', result: 123 };
  await assert.rejects(prepareOrganizationRbac(Buffer.from(await workbook.xlsx.writeBuffer()), 'synthetic.xlsx'), /员工编号/);
});
