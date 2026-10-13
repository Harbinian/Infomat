import test from 'node:test';
import assert from 'node:assert/strict';
import { protocol } from '../src/protocol.js';
test('historical stored targets resolve to current pages with exact identifiers', () => {
  for (const [before, after] of [
    ['#/rbac', '/app/accounts'], ['#/dataMap?context=9007199254740993', '/app/data-map?context=9007199254740993'],
    ['#/officeWorkbench?office_id=9007199254740993', '/app/offices?office_id=9007199254740993'],
    ['#/processGovernance?workspace=v7Preview&v7Case=9007199254740993', '/app/process-preview?case=9007199254740993'],
    ['#/processGovernance?workspace=dataGovernance&factRequest=17', '/app/data-governance?factRequest=17'],
    ['roleWorkbench', '/app/workbench'], ['/app/process-formal?case=17', '/app/process-formal?case=17'],
    ['/app/analysis#run=1&finding=2', '/app/analysis#run=1&finding=2']
  ]) assert.equal(protocol.targetHref(before), after);
});
test('unregistered and unsafe targets cannot open another frontend or a remote page', () => {
  for (const target of ['/', '/index.html', '#/unknown', '#/processGovernance?workspace=canonical',
    'javascript:alert(1)', '//outside.invalid/app/todos', '/app/../index.html', '/app/unknown', '/app/todos\\bad'])
    assert.equal(protocol.targetHref(target), null);
});
