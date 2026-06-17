const crypto = require('crypto');
const fs = require('fs');

const {
  deriveNodeTypes,
  parseA1Markdown,
  sourceManifestFiles,
  normalizeSourceFile,
  normalizeMdmRequirement,
  normalizeEvidenceRef
} = require('./processGovernanceImport');

const DEPT_DOMAIN = new Map([
  ['工程技术部', '总经理直辖域'],
  ['质量管理部', '总经理直辖域'],
  ['财务部', '总经理直辖域'],
  ['行政人事部', '经营域'],
  ['经营发展部', '经营域'],
  ['物资保障部', '经营域'],
  ['项目管理部', '生产域'],
  ['复材车间', '生产域'],
  ['运维安环部', '生产域']
]);

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function cleanCell(value) {
  return String(value || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
}

function nodeName(node) {
  return cleanCell(typeof node === 'string' ? node : node && (node.name || node.node_key || node.key));
}

function edgeTypeFor(sourceType, targetType) {
  return {
    root_domain: 'root_domain',
    domain_department: 'domain_dept',
    department_l2: 'dept_l2',
    l2_l3: 'l2_l3',
    l3_a1: 'l3_a1',
    l3_system: 'l3_system',
    a1_system: 'a1_system'
  }[`${sourceType}_${targetType}`] || '';
}

function parentMapFromLinks(data) {
  const parentMap = new Map();
  for (const link of asArray(data.links)) {
    const source = cleanCell(link.source || link.source_key);
    const target = cleanCell(link.target || link.target_key);
    if (source && target && !parentMap.has(target)) parentMap.set(target, source);
    if (source && !parentMap.has(source)) parentMap.set(source, null);
  }
  return parentMap;
}

function inferDomainAndDept(name, type, parentKey, nodeIndex) {
  if (type === 'domain') return { domainName: name, deptName: null };
  if (type === 'department') return { domainName: DEPT_DOMAIN.get(name) || null, deptName: name };

  let current = parentKey;
  let domainName = null;
  let deptName = null;
  while (current) {
    const parent = nodeIndex.get(current);
    if (!parent) break;
    if (!deptName && parent.node_type === 'department') deptName = parent.name;
    if (!domainName && parent.node_type === 'domain') domainName = parent.name;
    current = parent.parent_key;
  }
  if (deptName && !domainName) domainName = DEPT_DOMAIN.get(deptName) || null;
  return { domainName, deptName };
}

function normalizeConfirmStatus(value) {
  const text = cleanCell(value);
  if (['confirmed', 'pending', 'needs_review', 'not_mapped'].includes(text)) return text;
  if (text.includes('无文档') || text.includes('未映射')) return 'not_mapped';
  if (text.includes('待复核')) return 'needs_review';
  if (text.includes('待确认') || text.includes('待处理')) return 'pending';
  if (text.includes('已确认') || text.includes('已映射')) return 'confirmed';
  return text ? 'pending' : 'pending';
}

function normalizeRiskLevel(value) {
  const text = cleanCell(value).toLowerCase();
  if (['high', 'medium', 'low'].includes(text)) return text;
  if (text.includes('高')) return 'high';
  if (text.includes('中')) return 'medium';
  if (text.includes('低')) return 'low';
  return 'low';
}

function normalizeChainStatus(value) {
  const text = cleanCell(value).toLowerCase();
  if (text === 'ok') return 'complete';
  if (['complete', 'partial', 'broken'].includes(text)) return text;
  return 'partial';
}

function normalizeNodes(data) {
  const nodeTypes = deriveNodeTypes(data);
  const parentMap = parentMapFromLinks(data);
  const nodeIndex = new Map();

  asArray(data.nodes).forEach((node, index) => {
    const name = nodeName(node);
    if (!name) return;
    nodeIndex.set(name, {
      name,
      label: typeof node === 'object' && node.label || name,
      node_type: nodeTypes[name] || 'l2',
      parent_key: parentMap.get(name) || null,
      source_file: typeof node === 'object' && (node.source_file || node.sourceFile) || null,
      sort_order: index
    });
  });

  return [...nodeIndex.values()].map(node => {
    const { domainName, deptName } = inferDomainAndDept(node.name, node.node_type, node.parent_key, nodeIndex);
    return {
      ...node,
      domain_name: domainName,
      dept_name: deptName
    };
  });
}

function normalizeLinks(data, nodeTypes) {
  return asArray(data.links)
    .map(link => {
      const source = cleanCell(link.source || link.source_key);
      const target = cleanCell(link.target || link.target_key);
      if (!source || !target) return null;
      return {
        source,
        target,
        value: Number.isFinite(Number(link.value)) ? Number(link.value) : 1,
        edge_type: edgeTypeFor(nodeTypes[source], nodeTypes[target]),
        source_file: link.source_file || link.sourceFile || null
      };
    })
    .filter(link => link && link.edge_type);
}

function normalizeCrossDept(data) {
  const crossDept = data.crossDept || {};
  const sourceReport = crossDept.source || null;
  return {
    stats: crossDept.stats || {},
    risks: asArray(crossDept.risks).map(risk => ({
      source: cleanCell(risk.source || risk.source_dept) || null,
      target: cleanCell(risk.target || risk.target_dept) || null,
      a1: cleanCell(risk.a1 || risk.a1_code) || null,
      refs: Number.isFinite(Number(risk.refs)) ? Number(risk.refs) : 0,
      risk: normalizeRiskLevel(risk.risk || risk.risk_level),
      status: normalizeConfirmStatus(risk.status || risk.confirm_status),
      desc: cleanCell(risk.desc || risk.description) || null,
      source_report: risk.source_report || risk.sourceReport || sourceReport
    })),
    interactionChains: asArray(crossDept.interactionChains).map(chain => ({
      name: cleanCell(chain.name) || '未命名交互链',
      status: normalizeChainStatus(chain.status),
      breaks: asArray(chain.breaks).map(cleanCell).filter(Boolean),
      source_report: chain.source_report || chain.sourceReport || sourceReport
    })),
    source: sourceReport
  };
}

function dedupeByKey(items, keyName) {
  const seen = new Set();
  return items.filter(item => {
    if (!item || seen.has(item[keyName])) return false;
    seen.add(item[keyName]);
    return true;
  });
}

function summarizeSourceFiles(files) {
  const byStatus = { '纳入': 0, '排除': 0, '待复核': 0 };
  const byAssetType = {};
  for (const file of files) {
    byStatus[file.process_status] = (byStatus[file.process_status] || 0) + 1;
    if (file.asset_type) byAssetType[file.asset_type] = (byAssetType[file.asset_type] || 0) + 1;
  }
  return { total: files.length, byStatus, byAssetType };
}

function summarizeMdmRequirements(items) {
  const byDept = {};
  for (const item of items) {
    if (item.dept_name) byDept[item.dept_name] = (byDept[item.dept_name] || 0) + 1;
  }
  return { total: items.length, byDept };
}

function summarizeEvidenceRefs(items) {
  const byType = { L3: 0, A1: 0, MDM: 0 };
  for (const item of items) byType[item.ref_type] = (byType[item.ref_type] || 0) + 1;
  return { total: items.length, byType };
}

function loadProcessGovernanceMysqlBundle(sourceJsonPath, options = {}) {
  const sourceText = fs.readFileSync(sourceJsonPath, 'utf8');
  const data = JSON.parse(sourceText);
  const sourceHash = crypto.createHash('sha256').update(sourceText).digest('hex');
  const nodeTypes = deriveNodeTypes(data);
  const crossDept = normalizeCrossDept(data);
  const a1Items = [];
  for (const markdownPath of asArray(options.a1MarkdownPaths || options.a1MarkdownPath)) {
    a1Items.push(...parseA1Markdown(fs.readFileSync(markdownPath, 'utf8'), markdownPath));
  }
  const sourceFiles = dedupeByKey(sourceManifestFiles(data).map(normalizeSourceFile), 'file_key');
  const mdmRequirements = dedupeByKey(asArray(data.mdmRequirements).map(normalizeMdmRequirement), 'requirement_key');
  const evidenceRefs = dedupeByKey(asArray(data.evidenceRefs).map(normalizeEvidenceRef), 'ref_key');

  return {
    source_json_path: sourceJsonPath,
    source_hash: sourceHash,
    generated_at: data.generatedAt || data.generated_at || null,
    imported_by: options.importedBy || options.imported_by || null,
    note: options.note || null,
    stats: {
      ...(data.stats || {}),
      crossDept: crossDept.stats,
      sourceFiles: summarizeSourceFiles(sourceFiles),
      mdmRequirements: summarizeMdmRequirements(mdmRequirements),
      evidenceRefs: summarizeEvidenceRefs(evidenceRefs)
    },
    nodes: normalizeNodes(data),
    links: normalizeLinks(data, nodeTypes),
    a1Items,
    sourceFiles,
    mdmRequirements,
    evidenceRefs,
    crossDept
  };
}

async function importProcessGovernanceMysqlSnapshot({ repository, sourceJsonPath, a1MarkdownPaths = [], importedBy = null, note = null }) {
  const bundle = loadProcessGovernanceMysqlBundle(sourceJsonPath, { a1MarkdownPaths, importedBy, note });
  await repository.initSchema();
  const result = await repository.replaceActiveReadModel(bundle);
  return { ...result, bundle };
}

module.exports = {
  importProcessGovernanceMysqlSnapshot,
  loadProcessGovernanceMysqlBundle
};
