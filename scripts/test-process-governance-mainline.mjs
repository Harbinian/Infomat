/**
 * 聚合流程治理主线只读校验。
 *
 * 用法: node scripts/test-process-governance-mainline.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function readRepoFile(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function assertSourceContract() {
  const mainlineSync = readRepoFile('scripts/sync-process-governance-mainline.mjs');
  const appPackage = JSON.parse(readRepoFile('apps/mdm-platform/package.json'));
  const orgSync = readRepoFile('apps/mdm-platform/scripts/sync-process-governance-org.js');
  const appImport = readRepoFile('apps/mdm-platform/scripts/import-process-governance-mysql.js');
  const checker = readRepoFile('scripts/check-dcm-bbm.mjs');
  const parser = readRepoFile('scripts/parse-sankey-data.mjs');
  const normalizer = readRepoFile('scripts/normalize-norms-sankey-h5.mjs');
  const mergeNorms = readRepoFile('scripts/merge_norms.py');
  const renderGantt = readRepoFile('scripts/render_gantt_h5_png.mjs');
  const generateGantt = readRepoFile('scripts/generate_digital_project_gantt_8k.py');
  const generateWbsJs = readRepoFile('scripts/gen_wbs_report.js');
  const generateWbsPy = readRepoFile('scripts/gen_wbs_report.py');

  assert.match(mainlineSync, /requiredMysqlEnvNames/, '主线同步脚本必须显式检查 MySQL 环境变量');
  assert.doesNotMatch(mainlineSync, /MDM_DB_PATH/, '正式主线同步脚本不得依赖 SQLite 数据库路径');
  assert.match(mainlineSync, /import:process-governance-mysql/, '正式主线同步必须使用现有 MySQL 导入器');
  assert.doesNotMatch(mainlineSync, /sync:process-org/, '正式主线同步不得调用 SQLite 组织同步');
  assert.doesNotMatch(mainlineSync, /['"]import:process-governance['"]/, '正式主线同步不得调用 SQLite 流程导入');
  assert.doesNotMatch(mainlineSync, /check:process-governance/, '正式主线同步不得调用 SQLite 流程检查');
  assert.match(mainlineSync, /--snapshot/, '主线同步导入 MDM 快照时必须显式传入 snapshot');

  assert.equal(appPackage.scripts['import:process-governance-mysql'], 'node scripts/import-process-governance-mysql.js');
  assert.equal(appPackage.scripts['legacy-sqlite:init-db'], 'node scripts/init-legacy-sqlite-db.js');
  assert.equal(appPackage.scripts['legacy-sqlite:sync-process-org'], 'node scripts/sync-process-governance-org.js');
  assert.equal(appPackage.scripts['legacy-sqlite:import-process-governance'], 'node scripts/import-process-governance.js');
  assert.equal(appPackage.scripts['legacy-sqlite:check-process-governance'], 'node scripts/check-process-governance.js');
  for (const ambiguousCommand of ['init-db', 'sync:process-org', 'import:process-governance', 'check:process-governance']) {
    assert.equal(appPackage.scripts[ambiguousCommand], undefined, `SQLite 遗留命令不得继续使用含糊名称: ${ambiguousCommand}`);
  }

  assert.match(orgSync, /--archive-non-canonical/, '组织同步归档非标准部门必须使用显式开关');
  assert.match(orgSync, /dryRun/, '组织同步必须支持默认预览模式');

  assert.match(appImport, /--snapshot/, 'MDM 流程治理导入脚本必须使用 --snapshot 输入');
  assert.doesNotMatch(appImport, /readdirSync\(normsDir\)/, 'MDM 导入脚本默认不得扫描 docs/norms');
  assert.doesNotMatch(appImport, /check-dcm-bbm/, 'MDM 导入脚本默认不得调用根目录质量检查');

  assert.match(checker, /docs['"], ['"]reports['"], ['"]dcm-bbm-quality-report\.md/, 'DCM/BBM 默认报告必须写入 docs/reports');
  assert.doesNotMatch(checker, /docs['"], ['"]norms['"], ['"]_quality-report\.md/, 'DCM/BBM 默认报告不得写入 docs/norms');

  assert.match(parser, /sankeyDataBlocks/, 'Sankey 解析脚本必须校验 sankey-data 标签唯一性');
  assert.match(parser, /Expected exactly one sankey-data/, 'Sankey 解析脚本必须在缺失或重复标签时失败');

  assert.match(normalizer, /--write/, '部门 Sankey H5 规范化脚本必须通过 --write 才能写入');
  assert.match(normalizer, /dry-run/, '部门 Sankey H5 规范化脚本默认必须是 dry-run');

  assert.doesNotMatch(mergeNorms, /E:\\\\CA001|E:\/CA001/, 'merge_norms.py 不得写死本机仓库路径');
  assert.doesNotMatch(renderGantt, /Program Files\\\\Google\\\\Chrome/, 'Gantt 渲染脚本不得写死 Chrome 安装路径');
  assert.doesNotMatch(generateGantt, /C:\\\\Windows\\\\Fonts/, 'Gantt 生成脚本不得写死 Windows 字体路径');
  for (const [fileName, source] of [['gen_wbs_report.js', generateWbsJs], ['gen_wbs_report.py', generateWbsPy]]) {
    assert.doesNotMatch(source, /E:\\\\CA001|E:\/CA001/, `${fileName} 不得写死本机仓库路径`);
    assert.match(source, /--output/, `${fileName} 必须提供显式 --output 参数`);
    assert.match(source, /artifacts[\\'", )\/]+pmo[\\'", )\/]+wbs/, `${fileName} 默认输出必须进入 artifacts/pmo/wbs`);
  }
  const jsSyntaxCheck = spawnSync(process.execPath, ['--check', resolve(root, 'scripts/gen_wbs_report.js')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(jsSyntaxCheck.status, 0, jsSyntaxCheck.stderr || 'gen_wbs_report.js syntax check failed');
  const pySyntaxCheck = spawnSync('python', [
    '-c',
    "import ast, pathlib; ast.parse(pathlib.Path('scripts/gen_wbs_report.py').read_text(encoding='utf-8'))",
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(pySyntaxCheck.status, 0, pySyntaxCheck.stderr || 'gen_wbs_report.py syntax check failed');
}

function assertMainlineSyncRequiresExplicitMysqlConfig() {
  const envWithoutMysql = { ...process.env, MDM_DB_PATH: 'legacy-must-not-count.db' };
  for (const name of ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
    delete envWithoutMysql[name];
  }
  const missing = spawnSync(process.execPath, [resolve(root, 'scripts/sync-process-governance-mainline.mjs')], {
    cwd: root,
    env: envWithoutMysql,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.notStrictEqual(missing.status, 0, '缺少 MySQL 环境变量时主线同步必须失败');
  assert.match(`${missing.stdout}\n${missing.stderr}`, /MYSQL_HOST.*MYSQL_PORT.*MYSQL_USER.*MYSQL_PASSWORD.*MYSQL_DATABASE/s, '缺少 MySQL 配置的失败信息必须列出变量名');
  assert.doesNotMatch(`${missing.stdout}\n${missing.stderr}`, /MDM_DB_PATH/, '正式入口不得提示 SQLite 数据库路径');

  const passwordSentinel = 'must-not-appear-in-output';
  const configured = spawnSync(process.execPath, [resolve(root, 'scripts/sync-process-governance-mainline.mjs'), '--check-env'], {
    cwd: root,
    env: {
      ...process.env,
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: '3307',
      MYSQL_USER: 'static-check',
      MYSQL_PASSWORD: passwordSentinel,
      MYSQL_DATABASE: 'static_check',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.strictEqual(configured.status, 0, configured.stderr || configured.stdout);
  assert.match(configured.stdout, /"target":"mysql"/, '环境自检必须明确正式目标是 MySQL');
  assert.doesNotMatch(configured.stdout, new RegExp(passwordSentinel), '环境自检不得输出密码');
}

const checks = [
  ['Codex 上下文', ['npm', 'run', 'test:codex-context']],
  ['禁用术语', 'apps/mdm-platform/scripts/test-no-banned-terminology.js'],
  ['脚本边界合约', assertSourceContract],
  ['流程治理结构块解析', 'scripts/test-parse-sankey-structure-block.mjs'],
  ['主线同步 MySQL 配置保护', assertMainlineSyncRequiresExplicitMysqlConfig],
  ['主线合约', 'scripts/test-process-governance-mainline-contract.mjs'],
  ['项目治理升级', ['npm', 'run', 'test:project-governance-upgrade']],
  ['PMO 驾驶舱数据', 'scripts/check-dashboard-data.mjs'],
  ['部门域映射', 'scripts/check-dept-domain-mapping.mjs'],
  ['工程技术部源文件清单', 'scripts/check-engineering-source-manifest.mjs'],
  ['源文件指纹', 'scripts/check-source-manifest-hashes.mjs'],
  ['流程输入基线清单', 'scripts/check-norms-source-manifest.mjs'],
  ['PMO 执行标准库', 'scripts/check-pmo-execution-standards.mjs'],
  ['PMO 标准缺口治理', 'scripts/check-pmo-standard-gap-operations.mjs'],
  ['PMO 任务数据', 'scripts/check-pmo-task-data.mjs'],
];

for (const [label, script] of checks) {
  console.log(`\n[process-governance-mainline] ${label}`);
  if (typeof script === 'function') {
    script();
    continue;
  }
  const command = Array.isArray(script) ? script[0] : process.execPath;
  const args = Array.isArray(script) ? script.slice(1) : [resolve(root, script)];
  const executable = command === 'npm' && process.platform !== 'win32' ? 'npm' : command;
  const childArgs = command === 'npm' && process.platform === 'win32'
    ? ['/d', '/s', '/c', ['npm', ...args].join(' ')]
    : args;
  const result = spawnSync(command === 'npm' && process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : executable, childArgs, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('\nProcess governance mainline checks passed');
