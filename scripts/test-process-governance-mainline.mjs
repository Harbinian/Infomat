/**
 * 聚合流程治理主线只读校验。
 *
 * 用法: node scripts/test-process-governance-mainline.mjs
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const checks = [
  ['主线合约', 'scripts/test-process-governance-mainline-contract.mjs'],
  ['PMO 驾驶舱数据', 'scripts/check-dashboard-data.mjs'],
  ['部门域映射', 'scripts/check-dept-domain-mapping.mjs'],
  ['工程技术部源文件清单', 'scripts/check-engineering-source-manifest.mjs'],
  ['流程真源清单', 'scripts/check-norms-source-manifest.mjs'],
  ['PMO 任务数据', 'scripts/check-pmo-task-data.mjs'],
];

for (const [label, script] of checks) {
  console.log(`\n[process-governance-mainline] ${label}`);
  const result = spawnSync(process.execPath, [resolve(root, script)], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('\nProcess governance mainline checks passed');
