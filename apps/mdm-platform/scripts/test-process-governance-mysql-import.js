const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  importProcessGovernanceMysqlSnapshot,
  loadProcessGovernanceMysqlBundle
} = require('./lib/processGovernanceMysqlImport');

async function main() {
  const sourceJsonPath = path.join(__dirname, 'fixtures', 'process-governance-snapshot.json');
  const a1MarkdownPath = path.join(__dirname, 'fixtures', 'process-governance-a1.md');
  const bundle = loadProcessGovernanceMysqlBundle(sourceJsonPath, {
    a1MarkdownPaths: [a1MarkdownPath],
    importedBy: 9,
    note: 'mysql import test'
  });

  assert.strictEqual(bundle.source_json_path, sourceJsonPath);
  assert.strictEqual(bundle.source_hash.length, 64);
  assert.strictEqual(bundle.imported_by, 9);
  assert.strictEqual(bundle.note, 'mysql import test');
  assert.strictEqual(bundle.stats.mappings, 1);
  assert.strictEqual(bundle.stats.crossDept.highRisk, 1);

  const byName = new Map(bundle.nodes.map(node => [node.name, node]));
  assert.strictEqual(byName.get('昌兴复材').node_type, 'root');
  assert.strictEqual(byName.get('经营域').node_type, 'domain');
  assert.strictEqual(byName.get('经营发展部').node_type, 'department');
  assert.strictEqual(byName.get('合同管理').node_type, 'l2');
  assert.strictEqual(byName.get('销售订单评审和执行管理').node_type, 'l3');
  assert.strictEqual(byName.get('接收订单并组织评审').node_type, 'a1');
  assert.strictEqual(byName.get('ERP').node_type, 'system');
  assert.strictEqual(byName.get('销售订单评审和执行管理').parent_key, '合同管理');
  assert.strictEqual(byName.get('销售订单评审和执行管理').dept_name, '经营发展部');
  assert.strictEqual(byName.get('销售订单评审和执行管理').domain_name, '经营域');

  assert.ok(bundle.links.some(link => link.source === '经营发展部' && link.target === '合同管理'));
  assert.ok(bundle.links.some(link => link.source === '销售订单评审和执行管理' && link.target === 'ERP'));
  assert.strictEqual(bundle.links.find(link => link.target === 'ERP').edge_type, 'l3_system');

  assert.strictEqual(bundle.crossDept.risks[0].status, 'not_mapped');
  assert.strictEqual(bundle.crossDept.risks[0].source_report, 'docs/norms/流程治理/跨部门完整性检查报告.md');
  assert.strictEqual(bundle.crossDept.interactionChains[0].source_report, 'docs/norms/流程治理/跨部门完整性检查报告.md');
  assert.strictEqual(bundle.a1Items.length, 1);
  assert.strictEqual(bundle.a1Items[0].a1_code, 'JY-L3-01-A1-001');
  assert.deepStrictEqual(bundle.a1Items[0].suggested_systems, ['OA', 'ERP']);
  assert.strictEqual(bundle.sourceFiles.length, 2);
  assert.strictEqual(bundle.sourceFiles[0].file_no, 'GLTX-JY-23');
  assert.strictEqual(bundle.sourceFiles[1].process_status, '排除');
  assert.strictEqual(bundle.mdmRequirements.length, 1);
  assert.strictEqual(bundle.mdmRequirements[0].master_data_object, '客户订单');
  assert.strictEqual(bundle.evidenceRefs.length, 3);
  assert.deepStrictEqual(bundle.evidenceRefs.map(item => item.ref_type), ['L3', 'A1', 'MDM']);

  const repo = {
    initSchemaCalls: 0,
    replacedBundle: null,
    async initSchema() {
      this.initSchemaCalls += 1;
    },
    async replaceActiveReadModel(nextBundle) {
      this.replacedBundle = nextBundle;
      return { snapshot_id: 42 };
    }
  };
  const result = await importProcessGovernanceMysqlSnapshot({
    repository: repo,
    sourceJsonPath,
    a1MarkdownPaths: [a1MarkdownPath],
    importedBy: 9,
    note: 'mysql import test'
  });

  assert.strictEqual(repo.initSchemaCalls, 1);
  assert.strictEqual(repo.replacedBundle.source_hash, bundle.source_hash);
  assert.strictEqual(repo.replacedBundle.sourceFiles.length, 2);
  assert.strictEqual(repo.replacedBundle.mdmRequirements.length, 1);
  assert.strictEqual(repo.replacedBundle.evidenceRefs.length, 3);
  assert.strictEqual(result.snapshot_id, 42);
  assert.strictEqual(result.bundle.nodes.length, bundle.nodes.length);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-process-governance-mysql-import-'));
  const okStatusJson = path.join(tmp, 'snapshot.json');
  fs.writeFileSync(okStatusJson, JSON.stringify({
    nodes: [{ name: '昌兴复材' }, { name: '经营域' }, { name: '经营发展部' }, { name: '合同管理' }, { name: 'OA' }],
    links: [
      { source: '昌兴复材', target: '经营域', value: 1 },
      { source: '经营域', target: '经营发展部', value: 1 },
      { source: '经营发展部', target: '合同管理', value: 1 },
      { source: '合同管理', target: 'OA', value: 1 }
    ],
    systems: ['OA'],
    stats: { mappings: 1, a1: 0 },
    crossDept: {
      source: 'docs/norms/流程治理/跨部门完整性检查报告.md',
      interactionChains: [{ name: '已闭环链路', status: 'ok', breaks: [] }]
    }
  }, null, 2), 'utf8');
  try {
    const okBundle = loadProcessGovernanceMysqlBundle(okStatusJson);
    assert.strictEqual(okBundle.crossDept.interactionChains[0].status, 'complete');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const cliSource = fs.readFileSync(path.join(__dirname, 'import-process-governance-mysql.js'), 'utf8');
  assert.ok(cliSource.includes('mysql2/promise'), 'MySQL import CLI should use mysql2');
  assert.ok(cliSource.includes('--a1-source'), 'MySQL import CLI should accept A1 markdown sources');
  assert.ok(!cliSource.includes("require('../server/db')"), 'MySQL import CLI must not load SQLite db');
  assert.ok(!cliSource.includes('MDM_DB_PATH'), 'MySQL import CLI must not use MDM_DB_PATH');

  console.log('Process governance MySQL import test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
