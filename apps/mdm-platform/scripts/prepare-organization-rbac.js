// Read an explicitly selected employee workbook and prepare a local RBAC review.
// No database, account, permission, publication or source-workbook writes.
// Output must be a new directory under repository artifacts; personnel values
// stay in the local JSON. Role appointments and platform IDs are never inferred.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { getAccessModel } = require('../server/roleDefinitions');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const text = value => String(value ?? '').trim();

async function prepareOrganizationRbac(buffer, filename, confirmations = {}) {
  if (confirmations.source_sha256 && confirmations.source_sha256 !== digest(buffer)) throw new Error('确认记录绑定的原件摘要不一致，请重新核对来源。');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const model = getAccessModel();
  const people = [], sheets = [], issues = [], seen = new Map();
  for (const sheet of workbook.worksheets) {
    const sheetName = sheet.name;
    const headers = Array.from({ length: sheet.columnCount }, (_, index) => text(sheet.getRow(1).getCell(index + 1).value));
    const column = label => headers.indexOf(label);
    for (const label of ['姓名', '员工编号', '部门', '职务']) {
      if (column(label) < 0) throw new Error(`${sheetName}缺少明确的${label}列，不能推断替代字段。`);
    }
    let count = 0;
    for (let sourceRow = 2; sourceRow <= sheet.rowCount; sourceRow += 1) {
      const value = label => {
        if (column(label) < 0) return null;
        const cell = sheet.getRow(sourceRow).getCell(column(label) + 1);
        if (cell.value && typeof cell.value === 'object') {
          if (cell.value.formula || cell.value.sharedFormula || cell.value.error) throw new Error(`${sheetName}!${cell.address}需要明确的${label}值，不能使用公式或错误。`);
          if (cell.value.richText) return cell.value.richText.map(part => part.text).join('');
          if (cell.value.hyperlink) return cell.value.text;
          throw new Error(`${sheetName}!${cell.address}不是明确的${label}文本。`);
        }
        if (label === '员工编号' && typeof cell.value === 'number') {
          if (!Number.isSafeInteger(cell.value)) throw new Error(`${sheetName}!${cell.address}员工编号不能无损解释。`);
          if (/^0+$/.test(cell.numFmt)) return String(cell.value).padStart(cell.numFmt.length, '0');
        }
        return cell.value;
      };
      const employeeNo = text(value('员工编号'));
      const personName = text(value('姓名'));
      const departmentName = text(value('部门'));
      const positionName = text(value('职务'));
      if (![employeeNo, personName, departmentName, positionName].some(Boolean)) continue;
      const source = { sheet: sheetName, row: sourceRow };
      for (const [field, current] of Object.entries({ employee_no: employeeNo, person_name: personName, department_name: departmentName, position_name: positionName })) {
        if (!current) issues.push({ code: 'SOURCE_FIELD_REQUIRED', field, source });
      }
      if (employeeNo) {
        const key = employeeNo.toLowerCase();
        if (seen.has(key)) issues.push({ code: 'SOURCE_EMPLOYEE_NO_DUPLICATE', source, previous_source: seen.get(key) });
        else seen.set(key, source);
      }
      people.push({
        source, employee_no: employeeNo, person_name: personName,
        department_name: departmentName, position_name: positionName,
        office_name: text(value('办公室')) || null,
        work_area_name: text(value('工区')) || null,
        team_name: text(value('班组')) || null,
        source_values: { employee_no: value('员工编号'), person_name: value('姓名'), department_name: value('部门'), position_name: value('职务') },
        person_id: null, department_id: null, employment_status: null,
        account_action: null, role_assignments: [], authorization_basis: null
      });
      count += 1;
    }
    sheets.push({ name: sheetName, records: count, headers });
  }
  const excluded = new Map();
  for (const exclusion of confirmations.excluded_people || []) {
    if (!confirmations.source_sha256 || !text(exclusion.basis)) throw new Error('排除人员须有原件摘要和明确确认依据。');
    const matches = people.filter(person => person.source.sheet === exclusion.sheet && person.source.row === exclusion.row && person.employee_no === exclusion.employee_no && person.person_name === exclusion.person_name);
    if (matches.length !== 1) throw new Error('排除记录的工作表、行号、员工编号和姓名不一致，停止准备。');
    excluded.set(`${exclusion.sheet}:${exclusion.row}`, { ...matches[0], exclusion_basis: exclusion.basis });
  }
  const excludedSource = source => excluded.has(`${source.sheet}:${source.row}`);
  const reviewPeople = people.filter(person => !excludedSource(person.source));
  const remainingIssues = issues.filter(issue => !excludedSource(issue.source) && !(issue.previous_source && excludedSource(issue.previous_source)));
  const departments = [...new Set(reviewPeople.map(person => person.department_name).filter(Boolean))].sort().map(name => ({
    name, records: reviewPeople.filter(person => person.department_name === name).length,
    offices: [...new Set(reviewPeople.filter(person => person.department_name === name).map(person => person.office_name).filter(Boolean))].sort(),
    positions: [...new Set(reviewPeople.filter(person => person.department_name === name).map(person => person.position_name).filter(Boolean))].sort()
  }));
  return {
    schema_version: 'organization-rbac-preparation-v1', preparation_only: true, executable: false,
    source: { file_name: filename, sha256: digest(buffer), sheets },
    role_model: { version: model.modelVersion, roles: model.roles.map(role => ({ code: role.code, name: role.name })) },
    summary: { source_records: people.length, records: reviewPeople.length, excluded_records: excluded.size, departments: departments.length, source_issues: issues.length, remaining_source_issues: remainingIssues.length },
    departments, people: reviewPeople, excluded_people: [...excluded.values()], issues, remaining_issues: remainingIssues,
    required_decisions: [
      { code: 'PLATFORM_DIRECTORY_RECONCILIATION_REQUIRED', detail: '按员工编号核对现有人与账号，明确部门对应关系；不能仅按同名覆盖或新建。' },
      { code: 'MDM_ROLE_APPOINTMENTS_REQUIRED', detail: '七类MDM角色须逐人明确任命及授权依据，岗位不自动转换为MDM角色。' },
      { code: 'EMPLOYMENT_STATUS_REQUIRED', detail: '此表没有在职状态列，不据记录存在默认人员在职或启用账号。' },
      { code: 'WORK_AREA_TEAM_OFFICE_MAPPING_REQUIRED', detail: '工区、班组与办公室分别保留，未经明确确认不合并为办公室。' },
      { code: 'RESPONSIBILITY_APPOINTMENTS_REQUIRED', detail: '办公室负责人和部门最终负责人须有明确任命，不能从岗位推定。' }
    ]
  };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
  const input = option('--input'), output = option('--output');
  if (!input || !output) throw new Error('用法：--input <明确原件.xlsx> --output <artifacts内全新目录>');
  const sourcePath = path.resolve(input), outputPath = path.resolve(output);
  const artifacts = path.resolve(__dirname, '../../../artifacts');
  if (!outputPath.startsWith(artifacts + path.sep) || fs.existsSync(outputPath)) throw new Error('输出必须是仓库artifacts内尚不存在的新目录。');
  const before = fs.readFileSync(sourcePath);
  const confirmationsPath = option('--confirmations');
  const confirmations = confirmationsPath ? JSON.parse(fs.readFileSync(path.resolve(confirmationsPath), 'utf8')) : {};
  const report = await prepareOrganizationRbac(before, path.basename(sourcePath), confirmations);
  if (digest(fs.readFileSync(sourcePath)) !== digest(before)) throw new Error('读取期间原件已变化，停止保存本次准备。');
  report.source.path = sourcePath;
  fs.mkdirSync(outputPath, { recursive: true });
  fs.writeFileSync(path.join(outputPath, 'authorization-review.json'), JSON.stringify(report, null, 2) + '\n');
  const rows = report.departments.map(department => `| ${department.name} | ${department.records} | ${department.offices.join('、') || '原表未列办公室'} | 待指定 | 待指定 |`).join('\n');
  fs.writeFileSync(path.join(outputPath, 'authorization-review.md'), `# 新组织RBAC授权准备\n\n状态：待确认人员任命、目录对应关系和有效状态，未写入3000。\n\n真源：${sourcePath}\n\n原件SHA-256：${report.source.sha256}\n\n原表共${report.summary.source_records}条人员记录；按明确确认排除${report.summary.excluded_records}条，本次纳入${report.summary.records}条，涉及${report.summary.departments}个部门。原件来源问题${report.summary.source_issues}项，排除后剩余${report.summary.remaining_source_issues}项。角色模型沿用${report.role_model.version}。\n\n${report.excluded_people.map(person => `排除：${person.source.sheet}!${person.source.row} ${person.person_name}（员工编号${person.employee_no}）。依据：${person.exclusion_basis}`).join('\n\n')}\n\n| 原表部门 | 本次人员记录数 | 原表办公室 | 部门主对接人 | 部门MDM审核员 |\n| --- | ---: | --- | --- | --- |\n${rows}\n\n工区和班组保留原层级，未转换为办公室。人员记录不表示已开通账号或已任命MDM角色。完整逐人准备记录保存在同目录JSON中，角色、授权依据和平台标识未确认时保持空值。\n\n${report.required_decisions.map(decision => '- ' + decision.detail).join('\n')}\n`);
  console.log(JSON.stringify({ output: outputPath, ...report.summary, preparation_only: true, executable: false }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepareOrganizationRbac };
