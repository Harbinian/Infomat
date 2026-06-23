#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifySourceBoundary,
  sourceBoundaryFromCitation,
} from './source-boundary-rules.mjs';

const root = resolve(import.meta.dirname, '..');

function flagFor(fileName, rawText = '') {
  return classifySourceBoundary({ path: fileName, fileName, rawText }).source_boundary_flag;
}

assert.equal(flagFor('GLTX-XM-05-A项目存货管理程序.docx'), 'changxing_owned');
assert.equal(flagFor('GLTX-JY-05-D公司月度绩效考核方案.docx'), 'changxing_owned');
assert.equal(flagFor('GLTX-CW-01-A财务成本核算管理程序.docx'), 'changxing_owned');

assert.equal(flagFor('GLG1201研发技术管理规则.docx'), 'customer_requirement');
assert.equal(flagFor('GLC120101-IPT团队工作管理程序.docx'), 'customer_requirement');
assert.equal(flagFor('GLB140410-商飞项目工艺文件报批管理标准.docx'), 'customer_requirement');
assert.equal(flagFor('FM1201-10 专业需求清单.xls'), 'customer_form');
assert.equal(flagFor('附件4_FM_1407-73_工装借用申请单.md'), 'customer_form');

assert.equal(
  classifySourceBoundary({
    path: 'docs/norms/工程技术部业务资料/无编号客户表单.md',
    fileName: '无编号客户表单.md',
    rawText: '本表单由客户审批后返回，按客户流程填写。',
  }).source_boundary_flag,
  'source_boundary_review',
);

assert.equal(sourceBoundaryFromCitation('GLTX-CW-01-A §5.1.2').source_boundary_flag, 'changxing_owned');
assert.equal(sourceBoundaryFromCitation('GLC120101 §6.3; FM1201-10').source_boundary_flag, 'customer_requirement');

const companyData = JSON.parse(readFileSync(resolve(root, 'docs', 'company-sankey-data.json'), 'utf8'));
const dcmBbmChecker = readFileSync(resolve(root, 'scripts', 'check-dcm-bbm.mjs'), 'utf8');
const sourceFiles = companyData.sourceManifest.files;
const gltx = sourceFiles.find((file) => /GLTX-CW-01/.test(file.path));
const glb = sourceFiles.find((file) => /GLB120101-01/.test(file.path) && /IPT 团队工作管理标准\.docx$/.test(file.path));
const fm = sourceFiles.find((file) => /FM1201-10/.test(file.path));

assert.equal(gltx?.source_boundary_flag, 'changxing_owned', 'GLTX files should be protected in sourceManifest');
assert.equal(glb?.source_boundary_flag, 'customer_requirement', 'GLB files should be marked as customer requirements');
assert.equal(fm?.source_boundary_flag, 'customer_form', 'FM files should be marked as customer forms');

assert.match(dcmBbmChecker, /sourceBoundaryFromCitation/, 'check-dcm-bbm should use the shared source-boundary rules');
assert.match(dcmBbmChecker, /CUSTOMER_FILE_BOUNDARY/, 'check-dcm-bbm should report customer file boundary findings');
assert.match(dcmBbmChecker, /客户文件证据不得单独支撑正式审批链/, 'check-dcm-bbm should protect formal fields from customer-only evidence');

console.log('Customer file boundary checks passed');
