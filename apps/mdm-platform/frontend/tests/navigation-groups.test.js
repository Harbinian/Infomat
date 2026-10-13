import test from 'node:test';
import assert from 'node:assert/strict';
import { navigation, navigationGroups, pages } from '../src/protocol.js';

test('sidebar groups present every module exactly once under a declared parent, in business-flow order', () => {
  assert.deepEqual(navigationGroups.map(group => group.title), ['我的工作', '流程治理', '数据治理', '成果查阅', '管理与辅助']);
  const flattened = navigationGroups.flatMap(group => group.items.map(page => page.href));
  // Each module appears once, and the flattened order matches the routed order.
  assert.equal(flattened.length, navigation.length);
  assert.equal(new Set(flattened).size, flattened.length);
  assert.deepEqual(flattened, navigation.map(page => page.href));
  for (const group of navigationGroups) assert.ok(group.items.length >= 1, `${group.code} must not be empty`);
  // Workbench root and password editing are registered outside the navigation groups.
  assert.equal(Object.keys(pages).length, navigation.length + 2);
  assert.equal(pages['/app/password'], '修改本人密码');
});
