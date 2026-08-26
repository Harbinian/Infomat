const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GovernanceReviewQueue = require('../public/governance-review-queue.js');

const modulePath = path.join(__dirname, '../public/governance-review-queue.js');
const moduleSource = fs.readFileSync(modulePath, 'utf8');
const browserContext = {};
vm.runInNewContext(moduleSource, browserContext);
assert.equal(
  typeof browserContext.GovernanceReviewQueue?.createManager,
  'function',
  'the UMD module must expose its browser API'
);
assert.doesNotMatch(
  moduleSource,
  /localStorage|sessionStorage|indexedDB|document\.cookie/,
  'review queue must remain page-memory-only'
);

function issue(ruleCode, focusRef, focusPath, message = `${ruleCode}问题`) {
  return { ruleCode, focusRef, focusPath, message };
}

{
  const first = issue('DATA_FIELD_NAME_REQUIRED', 'field-a', 'data_objects.0.fields.0.field_name', '旧文案');
  const changedCopy = { ...first, message: '新文案不应改变身份' };
  const anotherObject = { ...first, focusRef: 'field-b' };
  assert.equal(
    GovernanceReviewQueue.stableIssueKey(first),
    GovernanceReviewQueue.stableIssueKey(changedCopy),
    'issue identity must not depend on message text'
  );
  assert.notEqual(
    GovernanceReviewQueue.stableIssueKey(first),
    GovernanceReviewQueue.stableIssueKey(anotherObject),
    'the same rule on different stable refs must remain separate'
  );
  assert.throws(
    () => GovernanceReviewQueue.stableIssueKey({ focusRef: 'field-a', message: '没有规则编码' }),
    /ruleCode is required/
  );
}

{
  const duplicate = issue('FORM_NAME_REQUIRED', 'form-a', 'forms.0.form_name');
  const source = [duplicate, { ...duplicate }, issue('AREA_TYPE_REQUIRED', 'area-a', 'forms.0.areas.0.area_type')];
  const before = JSON.parse(JSON.stringify(source));
  assert.throws(
    () => GovernanceReviewQueue.normalizeIssues(source),
    /identity conflict: FORM_NAME_REQUIRED \/ form-a \/ forms\.0\.form_name/,
    'duplicate rule/ref/path identities must be reported instead of silently dropping an issue'
  );
  assert.deepEqual(source, before, 'failed normalization must not mutate source issues');

  const normalized = GovernanceReviewQueue.normalizeIssues([source[0], source[2]]);
  assert.equal(normalized.length, 2);
  assert.equal(typeof normalized[0].queueKey, 'string');
}

{
  const manager = GovernanceReviewQueue.createManager();
  const issues = [
    issue('RULE_A', 'ref-a', 'path.a'),
    issue('RULE_B', 'ref-b', 'path.b'),
    issue('RULE_C', 'ref-c', 'path.c')
  ];
  const sourceBefore = JSON.parse(JSON.stringify(issues));
  let state = manager.snapshot('candidate-a', issues, { revision: 7 });
  assert.equal(state.total, 3);
  assert.equal(state.currentIndex, 1);
  assert.equal(state.currentIssue.ruleCode, 'RULE_A');
  assert.equal(state.checkedAtRevision, 7);
  assert.equal(state.stale, false);
  assert.deepEqual(issues, sourceBefore, 'snapshotting must not mutate source issues');

  state = manager.next('candidate-a');
  assert.equal(state.currentIssue.ruleCode, 'RULE_B');
  state = manager.previous('candidate-a');
  assert.equal(state.currentIssue.ruleCode, 'RULE_A');
  state = manager.previous('candidate-a');
  assert.equal(state.currentIssue.ruleCode, 'RULE_C', 'previous navigation must wrap');

  state = manager.markStale('candidate-a', { revision: 8 });
  assert.equal(state.stale, true);
  assert.equal(state.total, 3, 'marking stale must retain the previous snapshot');
  assert.equal(state.currentIssue.ruleCode, 'RULE_C');
  assert.equal(state.staleSinceRevision, 8);

  assert.equal(manager.get('candidate-b').total, 0, 'candidate queues must be isolated');
  assert.equal(manager.get('candidate-b').stale, false);
}

{
  const manager = GovernanceReviewQueue.createManager();
  let state = manager.snapshot('candidate-empty', [], { revision: 'empty-rev-1' });
  assert.equal(state.total, 0);
  assert.equal(state.stale, false);
  assert.equal(state.checkedAtRevision, 'empty-rev-1');

  state = manager.markStale('candidate-empty', { revision: 'empty-rev-2' });
  assert.equal(state.total, 0, 'marking a zero-issue snapshot stale must not invent an issue');
  assert.equal(state.stale, true, 'a checked zero-issue snapshot must become stale after the document changes');
  assert.equal(state.staleSinceRevision, 'empty-rev-2');

  state = manager.reconcile('candidate-empty', [], { revision: 'empty-rev-3' });
  assert.equal(state.stale, false, 'rechecking the current zero-issue document must clear stale state');
  assert.equal(state.checkedAtRevision, 'empty-rev-3');
}

{
  const manager = GovernanceReviewQueue.createManager();
  manager.snapshot('candidate-a', [
    issue('RULE_A', 'ref-a', 'path.a'),
    issue('RULE_B', 'ref-b', 'path.b'),
    issue('RULE_C', 'ref-c', 'path.c')
  ]);

  let state = manager.skipCurrent('candidate-a');
  assert.equal(state.currentIssue.ruleCode, 'RULE_B', 'skip must move to the next non-skipped issue');
  assert.equal(state.total, 3, 'skip must not resolve or remove the issue');
  assert.equal(state.issues.find(item => item.ruleCode === 'RULE_A').skipped, true);
  assert.equal(state.changes.resolvedKeys.length, 0, 'skip must not be reported as resolution');
  assert.equal(state.orderedKeys.at(-1), state.issues.find(item => item.ruleCode === 'RULE_A').queueKey);

  state = manager.previous('candidate-a');
  assert.equal(state.currentIssue.ruleCode, 'RULE_A', 'skipped issues must remain navigable');
  state = manager.next('candidate-a');
  assert.equal(state.currentIssue.ruleCode, 'RULE_B');
}

{
  const manager = GovernanceReviewQueue.createManager();
  const oldIssues = [
    issue('RULE_A', 'ref-a', 'path.a'),
    issue('RULE_B', 'ref-b', 'path.b'),
    issue('RULE_C', 'ref-c', 'path.c')
  ];
  manager.snapshot('candidate-a', oldIssues, { revision: 'rev-1' });
  const keyA = GovernanceReviewQueue.stableIssueKey(oldIssues[0]);
  const keyB = GovernanceReviewQueue.stableIssueKey(oldIssues[1]);
  const keyC = GovernanceReviewQueue.stableIssueKey(oldIssues[2]);
  manager.skipCurrent('candidate-a');
  manager.select('candidate-a', keyB);
  manager.markStale('candidate-a', { revision: 'rev-2' });

  const newIssues = [
    { ...oldIssues[0], message: '文案更新但仍是同一问题' },
    oldIssues[2],
    issue('RULE_D', 'ref-d', 'path.d')
  ];
  const keyD = GovernanceReviewQueue.stableIssueKey(newIssues[2]);
  const state = manager.reconcile('candidate-a', newIssues, { revision: 'rev-3' });
  assert.equal(state.stale, false);
  assert.equal(state.checkedAtRevision, 'rev-3');
  assert.equal(state.staleSinceRevision, null);
  assert.equal(state.currentIssue.ruleCode, 'RULE_C', 'when the current issue is resolved, recheck must focus the next retained issue in old order');
  assert.deepEqual(state.changes.resolvedKeys, [keyB]);
  assert.deepEqual(state.changes.retainedKeys, [keyA, keyC]);
  assert.deepEqual(state.changes.addedKeys, [keyD]);
  assert.deepEqual(state.skippedKeys, [keyA], 'skip state must survive only while the issue still exists');

  const retained = manager.reconcile('candidate-a', newIssues, { revision: 'rev-4' });
  assert.equal(retained.currentIssue.ruleCode, 'RULE_C', 'a still-present current issue must retain focus');
  assert.deepEqual(retained.changes.resolvedKeys, []);
  assert.deepEqual(retained.changes.addedKeys, []);
}

{
  const manager = GovernanceReviewQueue.createManager();
  manager.snapshot('candidate-a', [issue('RULE_A', 'ref-a', 'path.a')]);
  manager.snapshot('candidate-b', [issue('RULE_B', 'ref-b', 'path.b')]);
  manager.clear('candidate-a');
  assert.equal(manager.get('candidate-a').total, 0);
  assert.equal(manager.get('candidate-b').total, 1);
  manager.clear();
  assert.equal(manager.get('candidate-b').total, 0);
  assert.throws(() => manager.get(''), /candidateKey is required/);
}

console.log('governance review queue tests passed');
