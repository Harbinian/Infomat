import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { canNavigatePage, canReadDirectory, departmentRoleDirectoryGuidance, visibleNavigationGroups } from '../src/navigationAccess.js';
import { navigationGroups } from '../src/protocol.js';

const require = createRequire(import.meta.url);
const model = require('../../server/roleDefinitions.js').getAccessModel();
const person = (permissions = [], roleCodes = []) => ({ personId:'9007199254740999', departmentId:'9007199254740993', permissions, roleCodes });
const userFor = code => person(model.roles.find(role => role.code === code).permissions, [code]);
const management = ['/app/organization','/app/roster','/app/accounts','/app/roles','/app/access-audit','/app/template-import'];
const visibleManagement = user => management.filter(href => canNavigatePage(href,user));

test('fixed role navigation follows effective read permissions, not the model visible-tab descriptions', () => {
  const expected = {
    admin: management.slice(0,5),
    mdm_lead: [], mdm_steward: [],
    department_contact: ['/app/template-import'], department_mdm_reviewer: [],
    data_conflict_handler: [], data_quality_auditor: [], decision_group: [],
    hr_directory_manager: management.slice(0,4)
  };
  for (const [role, pages] of Object.entries(expected)) assert.deepEqual(visibleManagement(userFor(role)),pages,role);
  assert.deepEqual(visibleManagement(person([],['admin','hr_directory_manager','department_contact'])), []);
});

test('read-only directory access and identity access are separate from audit and import', () => {
  const directory = person(['directory:read']);
  assert(canReadDirectory(directory));
  assert(canNavigatePage({href:'/app/organization'},directory));
  assert(canNavigatePage('/app/roster/?search=合成#row',directory));
  assert(!canNavigatePage('/app/accounts',directory));
  assert(!canNavigatePage('/app/roles',directory));
  assert(!canNavigatePage('/app/access-audit',directory));
  const audit = person(['identity:read-audit']);
  assert(canNavigatePage('/app/access-audit',audit));
  assert(!canNavigatePage('/app/accounts',audit));
  assert(!canReadDirectory(audit));
});

test('template import requires a current person, department and effective drafting permission; administrator combinations remain read-only', () => {
  const contact = userFor('department_contact');
  assert(canNavigatePage('/app/template-import',contact));
  for (const value of [
    {...contact,personId:null}, {...contact,departmentId:null}, {...contact,permissions:[]},
    {...contact,roleCodes:['department_contact','admin']},
    {...contact,roleCodes:[],rbacRoles:[{code:'admin'}]},
    {...contact,roleCodes:[],rbacRoles:[{role_code:'admin'}]},
    {...contact,identityKind:'system_admin',roleCodes:[]}
  ]) assert(!canNavigatePage('/app/template-import',value));
});

test('per-case assignment and office membership routes remain reachable without granting static global reads', () => {
  const input = person([],[]), before = structuredClone(input);
  for (const href of ['/app/offices?office_id=73','/app/process-preview?case=91','/app/process-formal?case=91','/app/process-authoring?case=91','/app/data-map-handoffs?fact=synthetic-context','/app/workbench','/app/todos','/app/role-guide']) {
    assert(canNavigatePage(href,input),href);
  }
  for (const href of management) assert(!canNavigatePage(href,input),href);
  assert.deepEqual(input,before);
});

test('quality and publication navigation follows their independent fixed read contracts', () => {
  assert(canNavigatePage('/app/quality',person(['governance:read-global'])));
  assert(canNavigatePage('/app/quality',person(['governance:read-department'])));
  assert(!canNavigatePage('/app/quality',{...person(['governance:read-department']),departmentId:null}));
  assert(!canNavigatePage('/app/quality',person(['directory:read'])));
  for (const permission of ['governance:read-global','identity:read','directory:read']) assert(canNavigatePage('/app/publications',person([permission])));
  assert(!canNavigatePage('/app/publications',person(['governance:read-assigned-context'])));
  assert(canNavigatePage('/app/data-map',person(['governance:read-department'])));
  assert(!canNavigatePage('/app/data-map',person(['governance:read-assigned-context'])));
});

test('filtering preserves source page contracts and business order, removes empty groups, and recomputes after identity changes', () => {
  const before = structuredClone(navigationGroups);
  const admin = visibleNavigationGroups(navigationGroups,userFor('admin'));
  const lead = visibleNavigationGroups(navigationGroups,userFor('mdm_lead'));
  const steward = visibleNavigationGroups(navigationGroups,userFor('mdm_steward'));
  assert(admin.flatMap(group=>group.items).some(page=>page.href==='/app/accounts'));
  assert(!lead.flatMap(group=>group.items).some(page=>page.href==='/app/accounts'));
  assert(!steward.some(group=>group.code==='outcomes'));
  for(const groups of [admin,lead,steward]) {
    assert(groups.every(group=>group.items.length));
    const actual = groups.flatMap(group=>group.items);
    const expected = navigationGroups.flatMap(group=>group.items).filter(page=>actual.includes(page));
    assert.deepEqual(actual,expected);
  }
  assert.deepEqual(navigationGroups,before);
});

test('directory guidance names the actual handoff roles and does not send an unqualified reader to organization', () => {
  const hidden = departmentRoleDirectoryGuidance(userFor('mdm_lead'));
  assert.match(hidden,/没有组织及人员目录查阅入口/);
  assert.match(hidden,/联系行政人事/); assert.match(hidden,/联系管理员/);
  assert.doesNotMatch(hidden,/在“组织架构”查阅|请在组织架构/);
  const readable = departmentRoleDirectoryGuidance(userFor('hr_directory_manager'));
  assert.match(readable,/在“组织架构”查阅/);
  assert.match(readable,/授权有效期|有效期/);
});
