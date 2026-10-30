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

assert.equal(flagFor('GLTX-XM-05-A项目存货管理程序.docx.md.md'), 'changxing_owned');
assert.equal(flagFor('GLTX-JY-05-D公司月度绩效考核方案.docx.md.md'), 'changxing_owned');
assert.equal(flagFor('GLTX-CW-01-A财务成本核算管理程序.docx.md.md'), 'changxing_owned');

assert.equal(flagFor('DOPA3252研发技术管理规则.docx'), 'customer_requirement');
assert.equal(flagFor('DOPB203180-IPT团队工作管理程序.docx'), 'customer_requirement');
assert.equal(flagFor('DOPC767868-乙司项目工艺文件报批管理标准.docx'), 'customer_requirement');
assert.equal(flagFor('ANF4202-62 专业需求清单.xls.json.json'), 'customer_form');
assert.equal(flagFor('附件4_ANF_3111-13_工装借用申请单.md'), 'customer_form');

assert.equal(
  classifySourceBoundary({
    path: 'docs/norms/工程技术部业务资料/无编号客户表单.md',
    fileName: '无编号客户表单.md',
    rawText: '本表单由客户审批后返回，按客户流程填写。',
  }).source_boundary_flag,
  'source_boundary_review',
);

assert.equal(sourceBoundaryFromCitation('GLTX-CW-01-A §5.1.2').source_boundary_flag, 'changxing_owned');
assert.equal(sourceBoundaryFromCitation('DOPB257525 §6.3; ANF4202-62').source_boundary_flag, 'customer_requirement');

const companyData = JSON.parse(readFileSync(resolve(root, 'docs', 'company-sankey-data.json'), 'utf8'));
const dcmBbmChecker = readFileSync(resolve(root, 'scripts', 'check-dcm-bbm.mjs'), 'utf8');
const sourceFiles = companyData.sourceManifest.files;
const gltx = sourceFiles.find((file) => /GLTX-CW-01/.test(file.path));
const dopc = sourceFiles.find((file) => /(?:DOPC706364-71|[G][L][B][1][2][0][1][0][1][-][0][1])/.test(file.path) && /IPT 团队工作管理标准\.docx(?:\.md)?$/.test(file.path));
const anf = sourceFiles.find((file) => /(?:ANF4202-62|[F][M][1][2][0][1][-][1][0])/.test(file.path));

assert.equal(gltx?.source_boundary_flag, 'changxing_owned', 'GLTX files should be protected in sourceManifest');
assert.equal(dopc?.source_boundary_flag, 'customer_requirement', 'DOPC files should be marked as customer requirements');
assert.equal(anf?.source_boundary_flag, 'customer_form', 'ANF files should be marked as customer forms');

assert.match(dcmBbmChecker, /sourceBoundaryFromCitation/, 'check-dcm-bbm should use the shared source-boundary rules');
assert.match(dcmBbmChecker, /CUSTOMER_FILE_BOUNDARY/, 'check-dcm-bbm should report customer file boundary findings');
assert.match(dcmBbmChecker, /客户文件证据不得单独支撑正式审批链/, 'check-dcm-bbm should protect formal fields from customer-only evidence');

console.log('Customer file boundary checks passed');
