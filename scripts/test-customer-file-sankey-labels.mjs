#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dashboardHtml = readFileSync(resolve(root, 'pmo', 'procedure-management', 'dashboard.html'), 'utf8');
const engineeringSankeyHtml = readFileSync(resolve(root, 'docs', 'norms', '工程技术部部门能力流程系统桑基图.html'), 'utf8');
const rebuildSource = readFileSync(resolve(root, 'scripts', 'rebuild-department-sankey-page.mjs'), 'utf8');
const dashboardCheckSource = readFileSync(resolve(root, 'scripts', 'check-dashboard-data.mjs'), 'utf8');

assert.match(rebuildSource, /sourceBoundaryFromCitation/, 'department Sankey generator should use the shared source-boundary rules');
assert.match(rebuildSource, /customerEvidenceLabel/, 'department Sankey generator should render customer evidence labels');
assert.match(engineeringSankeyHtml, /客户要求-待承接/, 'engineering Sankey page should visibly mark customer requirement evidence');
assert.match(engineeringSankeyHtml, /customer-evidence-tag/, 'engineering Sankey page should contain the customer evidence tag class');

assert.match(dashboardHtml, /id="kpiCustomerAcceptance"/, 'PMO dashboard should expose a customer-file acceptance KPI');
assert.match(dashboardHtml, /客户要求-待承接/, 'PMO dashboard should visibly describe customer requirements awaiting acceptance');
assert.match(dashboardHtml, /customerAcceptance/, 'PMO dashboard should derive customer acceptance metrics from embedded data');
assert.match(dashboardCheckSource, /kpiCustomerAcceptance/, 'dashboard data check should protect the PMO customer-file KPI');

console.log('Customer file Sankey label checks passed');
