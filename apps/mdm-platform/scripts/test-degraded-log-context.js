// 降级分类日志的调用上下文回归：合成会话、合成仓储工厂与随机回环端口，不连接真实数据库或私有配置。
//
// 背景（R06 修复回归）：`securityLog(res)` 与 `securityLog(req)` 都要求被传入的标识在当前作用域内声明。
// 实际缺陷是 `loadProcessDataGovernanceWorkItems(identity)` 与 `inputBaselineReviewRepositoryOrNull()`
// 的 catch 直接引用了未声明的 `res`，抛出的 ReferenceError 取代了原错误：`dependency_degraded`
// 分类永远不会写入，原错误码与状态映射一并丢失（其中一个入口由 503 退化为 500）。
//
// 本脚本覆盖两部分：
//   1. 运行期：两个降级入口都写入 dependency_degraded，并保留原错误码与状态映射。
//   2. 静态：按语法树和词法作用域检查 server/ 下 securityLog(<标识>) 的自由变量。
//      声明可以来自参数、所在块或外层闭包；其他函数或兄弟块的局部变量不能提供绑定。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.PROCESS_CANDIDATE_REVIEW_STORE = 'mysql';
process.env.PROCESS_DATA_GOVERNANCE_ENABLED = '1';
process.env.PROCESS_V7_PREVIEW_ENABLED = '0';

const express = require('express');
const APP_ROOT = path.join(__dirname, '..');
const workbench = require('../server/routes/roleWorkbench');
const offices = require('../server/routes/offices');
const governance = require('../server/routes/processGovernance');
const auth = require('../server/auth');

const originalWrite = process.stdout.write.bind(process.stdout);
// 安全日志写入 stdout；只在断言时捕获，不改动产品写入方式或字段过滤。
function captureLogs(action) {
  const chunks = [];
  process.stdout.write = (chunk, ...rest) => { chunks.push(String(chunk)); return originalWrite(chunk, ...rest); };
  return Promise.resolve()
    .then(action)
    .finally(() => { process.stdout.write = originalWrite; })
    .then(result => ({ result, logs: chunks.join('') }));
}

// stdout 同时承载测试运行器自身的输出，行边界不保证对齐。按 `{"at":` 起点和配对右括号切出记录，
// 只接受能解析成对象的片段；提取不到记录时断言会以空数组失败，不会静默通过。
function parseRecords(logs) {
  const records = [];
  for (let start = logs.indexOf('{"at":"'); start >= 0; start = logs.indexOf('{"at":"', start + 1)) {
    let depth = 0, end = -1;
    for (let i = start; i < logs.length; i += 1) {
      if (logs[i] === '{') depth += 1;
      else if (logs[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    try { records.push(JSON.parse(logs.slice(start, end + 1))); } catch { /* 非记录片段 */ }
    start = end;
  }
  return records;
}

async function withServer(mount, session, action) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  for (const [prefix, router] of mount) app.use(prefix, router);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try { return await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

auth.setIdentityRepositoryFactory(() => ({
  async validateSession(session) { return { valid: true, user: { personId: session.personId, must_change_password: false } }; }
}));

test('governance work items degrade with a classification and keep the source error', async () => {
  workbench.setIdentityRepositoryFactory(() => ({
    async getCurrentUserPayload() {
      return { id: 42, personId: 42, roleCodes: ['mdm_lead'], permissions: ['governance:read-global'] };
    }
  }));
  offices.setRepositoryFactory(() => ({ async personalWorkItems() { return []; }, async closureWorkItems() { return []; } }));
  workbench.setProcessDataGovernanceRepositoryFactory(async () => {
    throw Object.assign(new Error('synthetic governance failure'), { code: 'MYSQL_DEADLINE', statusCode: 503 });
  });
  try {
    const { result, logs } = await captureLogs(() => withServer([['/api/role-workbench', workbench]],
      { personId: 42, accountId: 42, authVersion: 1 },
      async base => {
        const response = await fetch(base + '/api/role-workbench?mode=todo');
        return { status: response.status, body: await response.json() };
      }));
    const records = parseRecords(logs);
    const degraded = records.filter(r => r.event === 'dependency_degraded');
    assert.equal(result.status, 503, JSON.stringify(result.body));
    assert.equal(result.body.code, 'MYSQL_RUNTIME_UNAVAILABLE');
    assert(!JSON.stringify(result.body).includes('synthetic governance failure'));
    assert.equal(degraded.length, 1, JSON.stringify(records));
    assert.equal(degraded[0].code, 'PROCESS_DATA_GOVERNANCE_ITEMS_UNAVAILABLE');
    assert.equal(degraded[0].actor_ref, '42', '分类记录必须保留请求上下文，而不是退化为无字段的全局日志');
    assert.equal(records.filter(r => r.event === 'request_failed' && r.code === 'MYSQL_DEADLINE').length, 1,
      JSON.stringify(records.filter(r => r.event === 'request_failed')));
    assert(!logs.includes('synthetic governance failure'));
  } finally {
    workbench.resetIdentityRepositoryFactory(); workbench.resetProcessDataGovernanceRepositoryFactory();
    workbench.clearWorkbenchCaches();
  }
});

test('input baseline degradation keeps the source status instead of a generic 500', async () => {
  governance.setInputBaselineReviewRepositoryFactory(async () => {
    throw Object.assign(new Error('synthetic baseline failure'), { code: 'MYSQL_DEADLINE', statusCode: 503 });
  });
  try {
    const { result, logs } = await captureLogs(() => withServer([['/api/process-governance', governance]],
      { personId: 42, accountId: 42, authVersion: 1 },
      async base => {
        const response = await fetch(base + '/api/process-governance/input-baseline-review/runs');
        return { status: response.status, body: await response.json() };
      }));
    const records = parseRecords(logs);
    assert.equal(result.status, 503, JSON.stringify(result.body));
    assert.equal(result.body.code, 'MYSQL_RUNTIME_UNAVAILABLE');
    assert(!JSON.stringify(result.body).includes('synthetic baseline failure'));
    assert.equal(records.filter(r => r.event === 'dependency_degraded' && r.code === 'INPUT_BASELINE_READ_UNAVAILABLE').length, 1,
      JSON.stringify(records));
    assert.equal(records.filter(r => r.event === 'request_failed' && r.code === 'MYSQL_DEADLINE').length, 1,
      JSON.stringify(records));
  } finally { governance.resetInputBaselineReviewRepositoryFactory(); }
});

// This guard checks lexical binding, not initialization order or runtime values.
// Acorn is a development dependency; production requests never load the parser.
function serverFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') serverFiles(abs, acc); }
    else if (entry.name.endsWith('.js')) acc.push(abs);
  }
  return acc;
}

function scanForUnboundArguments(source, relative) {
  const tree = require('acorn').parse(source, { ecmaVersion: 'latest', locations: true, sourceType: 'script' });
  const scope = (parent, functionScope = false) => ({ parent, functionScope, bindings: new Set() });
  const root = scope(null, true), calls = [];
  function bind(pattern, current) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') current.bindings.add(pattern.name);
    else if (pattern.type === 'RestElement') bind(pattern.argument, current);
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, current);
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(item => bind(item, current));
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(item => bind(item.type === 'RestElement' ? item.argument : item.value, current));
  }
  function children(node, current) {
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => { if (child?.type) visit(child, current); });
      else if (value?.type) visit(value, current);
    }
  }
  function visit(node, current) {
    if (!node) return;
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) {
      if (node.type === 'FunctionDeclaration') bind(node.id, current);
      const inner = scope(current, true);
      bind(node.id, inner);
      node.params.forEach(param => bind(param, inner));
      node.params.forEach(param => visit(param, inner));
      visit(node.body, inner);
      return;
    }
    if (node.type === 'CatchClause') {
      const inner = scope(current); bind(node.param, inner); visit(node.body, inner); return;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.type === 'ClassDeclaration') bind(node.id, current);
      const inner = scope(current); bind(node.id, inner);
      visit(node.superClass, current); visit(node.body, inner); return;
    }
    if (node.type === 'BlockStatement' || node.type === 'SwitchStatement' || /^For(In|Of)?Statement$/.test(node.type)) {
      children(node, scope(current)); return;
    }
    if (node.type === 'VariableDeclaration') {
      let target = current;
      if (node.kind === 'var') while (!target.functionScope) target = target.parent;
      node.declarations.forEach(declaration => bind(declaration.id, target));
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'securityLog' && node.arguments[0]?.type === 'Identifier') {
      calls.push({ current, identifier: node.arguments[0].name, line: node.loc.start.line });
    }
    children(node, current);
  }
  visit(tree, root);
  // Resolve after collecting declarations so function/var hoisting and outer
  // bindings declared after a function definition are not mistaken for free variables.
  return calls.filter(call => {
    for (let current = call.current; current; current = current.parent) {
      if (current.bindings.has(call.identifier)) return false;
    }
    return true;
  }).map(({ identifier, line }) => ({ file: relative, line, identifier }));
}

test('the guard rejects sibling locals, property names, comments and inline free arguments', () => {
  for (const source of [
    'function unrelated() { const res = {}; } function broken() { securityLog(res); }',
    'function broken() { securityLog(res); }',
    'function broken() { if (true) { const res = {}; } securityLog(res); }',
    'function unrelated() { var res = {}; } function broken() { securityLog(res); }',
    'function broken({ res: other }) { securityLog(res); }',
    'function broken() { /* function(res) {} */ const text = "const res = {}"; securityLog(res); }',
    'function broken() { for (const res of []) {} securityLog(res); }',
    'function broken() { try {} catch (res) {} securityLog(res); }',
    'const unrelated = res => res; const broken = () => securityLog(res);'
  ]) {
    assert.equal(scanForUnboundArguments(source, 'synthetic-free.js').length, 1, source);
  }
  assert.equal(scanForUnboundArguments('function broken() { securityLog(req); securityLog(res); }', 'two.js').length, 2);
});

test('the guard accepts parameters, lexical declarations, closures and destructured bindings', () => {
  for (const source of [
    'function helper(res) { securityLog(res); }',
    'const helper = res => securityLog(res);',
    'function outer(res) { return () => securityLog(res); }',
    'function helper({ response: res }) { securityLog(res); }',
    'const { response: res } = context; function helper() { securityLog(res); }',
    'function helper() { const res = {}; securityLog(res); }',
    'function helper() { if (true) { var res = {}; } securityLog(res); }',
    'function helper() { try {} catch (res) { securityLog(res); } }',
    'function helper() { for (const res of []) { securityLog(res); } }',
    'const handler = { send(res) { securityLog(res); } };',
    'function helper() { securityLog(res); } const res = {};',
    'const ignored = "securityLog(res)"; /* securityLog(req) */'
  ]) {
    assert.deepEqual(scanForUnboundArguments(source, 'synthetic-bound.js'), [], source);
  }
  assert.throws(() => scanForUnboundArguments('function (', 'invalid.js'), SyntaxError);
});

test('the guard discriminates a bound argument from the free variable it was written for', () => {
  const bound = [
    "const { securityLog } = require('../securityLog');",
    'async function helper(identity, res) {',
    '  try { return await load(); }',
    '  catch (error) {',
    "    securityLog(res).write({ event: 'dependency_degraded', code: 'X' });",
    '    throw error;',
    '  }',
    '}'
  ].join('\n');
  // 缺陷形态：helper 没有 res 形参，catch 里的 res 是自由变量。
  const free = bound.replace('function helper(identity, res)', 'function helper(identity)');
  assert.deepEqual(scanForUnboundArguments(bound, 'synthetic-bound.js'), []);
  const findings = scanForUnboundArguments(free, 'synthetic-free.js');
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].identifier, 'res');
  assert.equal(findings[0].line, 5);
});

test('every securityLog(<identifier>) argument is bound in the enclosing scope', () => {
  const findings = serverFiles(path.join(APP_ROOT, 'server'))
    .flatMap(file => scanForUnboundArguments(fs.readFileSync(file, 'utf8'), path.relative(APP_ROOT, file).split(path.sep).join('/')));
  assert.deepEqual(findings, []);
});
