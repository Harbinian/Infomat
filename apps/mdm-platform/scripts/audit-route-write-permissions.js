const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', 'server', 'routes');

function routeKey(file, method, routePath) {
  return `${file} ${method.toUpperCase()} ${routePath}`;
}

const businessGuarded = new Map([
  ['conflicts.js POST /:id/assign', '冲突指派通过 conflict:manage/review/admin 权限检查'],
  ['conflicts.js PUT /:id/assign', '冲突改派通过 conflict:manage/review/admin 权限检查'],
  ['conflicts.js POST /:id/coordination', '冲突协调记录要求当前指派人或管理权限'],
  ['conflicts.js POST /:id/final-decide', '冲突终裁通过 conflict:final_decide_escalated/review/admin 权限检查'],
  ['conflicts.js POST /:id/escalate', '冲突升级通过 conflict:escalate/review/admin 权限检查'],
  ['conflicts.js POST /:id/reopen', '冲突重开通过 conflict:manage/review/admin 权限检查'],
  ['conflicts.js POST /:id/archive', '冲突归档通过 admin:access 权限检查'],
  ['conflicts.js POST /:id/resolve', '字段冲突解决要求当前指派人或管理权限'],
  ['conflicts.js POST /term/:id/resolve', '术语冲突解决要求当前指派人或管理权限'],
  ['fieldEntries.js POST /', '字段台账创建通过提交人/管理员和映射提交人检查'],
  ['fieldEntries.js PUT /:id', '字段台账编辑通过 owner/reviewer/admin 或本人提交检查'],
  ['fieldEntries.js DELETE /:id', '字段台账删除通过 admin 或本人提交检查'],
  ['fieldIdentities.js PUT /:fieldEntryId', '黄金源维护通过字段 owner/admin 检查'],
  ['fieldIdentities.js POST /:fieldEntryId/confirm', '黄金源确认通过字段 owner/admin 检查'],
  ['import.js POST /field-entries', '字段台账导入通过 submitter/admin 和映射提交人检查'],
  ['integration.js POST /credentials/generate', '集成凭据生成在路由内执行 requireAuth + admin 检查'],
  ['mappings.js POST /', '映射草稿创建要求报送人或管理员'],
  ['mappings.js PUT /:id', '映射草稿更新要求创建人或管理员'],
  ['mappings.js DELETE /:id', '映射草稿删除要求创建人或管理员'],
  ['mappings.js POST /:id/submit', '映射提交要求本人提交的草稿'],
  ['mappings.js POST /:id/review', '映射审核要求当前审批任务指派给本人'],
  ['mappings.js POST /:id/publish', '映射发布要求 admin:access'],
  ['mappings.js POST /:id/reject', '映射驳回要求当前审批任务指派给本人'],
  ['processGovernance.js POST /quality-cases/:id/assign', '质量案例指派通过流程治理管理权限检查'],
  ['processGovernance.js POST /quality-cases/:id/status', '质量案例状态变更通过负责人/管理权限检查'],
  ['processGovernance.js POST /quality-cases/:id/comment', '质量案例评论通过可见性检查'],
  ['processGovernance.js POST /quality-cases/:id/submit', '质量案例提交通过负责人/管理权限检查'],
  ['processGovernance.js POST /quality-cases/:id/close', '质量案例关闭通过关闭/审核/管理权限检查'],
  ['processGovernance.js POST /quality-cases/:id/reopen', '质量案例重开通过管理权限检查'],
  ['processGovernance.js POST /mapping-todos/:id/assign', '映射待办指派通过流程治理管理权限检查'],
  ['processGovernance.js POST /mapping-todos/:id/status', '映射待办状态变更通过负责人/管理权限检查'],
  ['processGovernance.js POST /mapping-todos/:id/comment', '映射待办评论通过可见性检查'],
  ['processGovernance.js POST /mapping-todos/:id/submit', '映射待办提交通过负责人/管理权限检查'],
  ['processGovernance.js POST /mapping-todos/:id/close', '映射待办关闭通过关闭/审核/管理权限检查'],
  ['processGovernance.js POST /mapping-todos/:id/reopen', '映射待办重开通过管理权限检查'],
  ['processGovernance.js PUT /candidate-review/runs/:runId/candidates/:stableKey/review', '候选复核决策保存要求登录用户，会话 reviewer 覆盖请求体 reviewer'],
  ['terminology.js POST /', '术语创建通过本部门流程治理范围检查'],
  ['terminology.js PUT /:id', '术语编辑要求本人待审术语或管理员'],
  ['todos.js POST /', '待办创建在路由内限制管理员'],
  ['todos.js POST /:id/done', '待办完成通过目标部门或管理员检查'],
  ['todos.js DELETE /:id', '待办删除通过目标部门或管理员检查']
]);

const followUp = new Map();

const publicOrSelfService = new Map([
  ['org.js POST /login', '登录入口'],
  ['org.js POST /logout', '登出入口'],
  ['org.js POST /me/password', '当前用户自助修改密码']
]);

function parseRoutes() {
  const routeFiles = fs.readdirSync(ROUTES_DIR)
    .filter(name => name.endsWith('.js'))
    .sort();
  const routes = [];

  for (const file of routeFiles) {
    const fullPath = path.join(ROUTES_DIR, file);
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(/router\.(post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2\s*,\s*(.*)$/);
      if (!match) return;
      const [, method, , routePath, rest] = match;
      routes.push({
        file,
        line: index + 1,
        method,
        path: routePath,
        signature: line.trim(),
        rest
      });
    });
  }

  return routes;
}

function permissionFromSignature(signature) {
  const match = signature.match(/require(?:Org)?Permission\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  if (match) return match[1];
  if (signature.includes('...adminGate') || signature.includes('...adminOnly')) return 'admin:access';
  return '';
}

function classify(route) {
  const key = routeKey(route.file, route.method, route.path);
  const permission = permissionFromSignature(route.signature);
  if (permission) return { bucket: 'permissionGuarded', permission };
  if (route.signature.includes('apiKeyAuth') || route.signature.includes('requireIntegrationPermission')) {
    return { bucket: 'integrationGuarded', reason: 'API Key + integration permission' };
  }
  if (businessGuarded.has(key)) {
    return { bucket: 'businessGuarded', reason: businessGuarded.get(key) };
  }
  if (followUp.has(key)) {
    return { bucket: 'followUp', reason: followUp.get(key) };
  }
  if (publicOrSelfService.has(key)) {
    return { bucket: 'publicOrSelfService', reason: publicOrSelfService.get(key) };
  }
  return { bucket: 'unclassified', reason: '未分类写接口' };
}

function buildAudit() {
  const audit = {
    permissionGuarded: [],
    integrationGuarded: [],
    businessGuarded: [],
    followUp: [],
    publicOrSelfService: [],
    unclassified: []
  };

  for (const route of parseRoutes()) {
    const classification = classify(route);
    const entry = {
      file: route.file,
      line: route.line,
      method: route.method,
      path: route.path,
      signature: route.signature
    };
    if (classification.permission) entry.permission = classification.permission;
    if (classification.reason) entry.reason = classification.reason;
    audit[classification.bucket].push(entry);
  }

  audit.counts = Object.fromEntries(
    Object.entries(audit).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])
  );
  return audit;
}

function printText(audit) {
  console.log('Route write permission audit');
  for (const key of ['permissionGuarded', 'integrationGuarded', 'businessGuarded', 'followUp', 'publicOrSelfService', 'unclassified']) {
    console.log(`\n${key}: ${audit[key].length}`);
    audit[key].forEach(route => {
      const detail = route.permission || route.reason || '';
      console.log(`- ${route.file}:${route.line} ${route.method.toUpperCase()} ${route.path}${detail ? ` - ${detail}` : ''}`);
    });
  }
}

const audit = buildAudit();
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
} else {
  printText(audit);
}

if (audit.unclassified.length > 0) {
  process.exitCode = 1;
}
