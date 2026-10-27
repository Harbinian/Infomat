import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(frontend, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = await import(pathToFileURL(path.join(frontend, 'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({ load(url, context, next) {
  if (url.startsWith(pathToFileURL(frontend).href) && url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true};
  if (url.startsWith(pathToFileURL(frontend).href) && url.endsWith('.jsx')) return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};
  return next(url,context);
} });
const { DepartmentAccountability, accountabilityFailureText, accountabilitySnapshot } = await import('../src/DepartmentAccountability.jsx');

test('unqualified responsibility messages identify the actual support role without exposing technical identity or creating a misleading directory link', () => {
  for (const [reason, expected] of [
    ['DEPARTMENT_INACTIVE', /联系行政人事/],
    ['DEPARTMENT_FINAL_RESPONSIBLE_UNSET', /联系行政人事.*管理员/],
    ['DEPARTMENT_ACCOUNTABILITY_ROLE_REQUIRED', /联系管理员.*授权有效期/],
    ['DEPARTMENT_ACCOUNTABILITY_PERMISSION_REQUIRED', /联系管理员/]
  ]) {
    const value = {eligible:false,reason,department_id:'9007199254740993',actor_person_id:'9007199254740999'};
    const before = structuredClone(value);
    const html = renderToStaticMarkup(React.createElement(DepartmentAccountability,{value}));
    assert.match(html,expected);
    assert.doesNotMatch(html,/9007199254740993|9007199254740999|DEPARTMENT_|href=|<button|<form/);
    assert.deepEqual(value,before);
    assert.equal(accountabilityFailureText({code:reason}), html.replace(/<[^>]+>/g,'').split('部门负责人办理条件')[1]);
  }
});

test('support copy does not replace current qualification checks or alter the source snapshot', () => {
  const value = {eligible:true,policy_version:'kept-policy',department_id:'9007199254740993',actor_person_id:'9007199254740999',final_responsible_person_id:'9007199254740999',role_assignment_id:'9007199254740997'};
  const before = structuredClone(value), snapshot = accountabilitySnapshot(value);
  const html = renderToStaticMarkup(React.createElement(DepartmentAccountability,{value}));
  assert.match(html,/每次提交仍核对最新资格及材料状态/);
  assert.doesNotMatch(html,/kept-policy|900719925474099/);
  assert.equal(accountabilitySnapshot(value),snapshot);
  assert.deepEqual(value,before);
  const unavailable = renderToStaticMarkup(React.createElement(DepartmentAccountability,{value:null}));
  assert.match(unavailable,/不能据此认定有最终确认权/);
  assert.equal(accountabilityFailureText({code:'UNRECOGNIZED_REASON'}),null);
});
