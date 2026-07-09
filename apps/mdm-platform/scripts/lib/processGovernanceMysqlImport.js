const crypto = require('crypto');
const fs = require('fs');

const {
  deriveNodeTypes,
  parseA1Markdown,
  sourceManifestFiles,
  normalizeSourceFile,
  normalizeMdmRequirement,
  normalizeEvidenceRef,
  normalizeQualityFinding
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

function stableImportKey(prefix, parts) {
  const raw = parts.map(part => cleanCell(part)).join('|');
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
  return `${prefix}-${hash}`;
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

function mappingTodoKey(todoType, row) {
  if (todoType === 'cross_dept') {
    return stableImportKey('maptodo', [todoType, row.source_dept, row.target_dept, row.a1_code]);
  }
  return stableImportKey('maptodo', [todoType, row.dept_name, row.l3_name, row.a1_code]);
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

function summarizeQualityFindings(findings) {
  const summary = { BLOCK: 0, WARN: 0, INFO: 0 };
  for (const finding of findings) {
    summary[finding.severity] = (summary[finding.severity] || 0) + 1;
  }
  return summary;
}

function buildMappingTodos(a1Items, crossDept) {
  const todos = [];
  for (const row of a1Items) {
    if (!cleanCell(row.verification_note)) continue;
    todos.push({
      todo_key: mappingTodoKey('verification', row),
      todo_type: 'verification',
      dept_name: row.dept_name || null,
      l3_name: row.l3_name || null,
      a1_code: row.a1_code || null,
      source_file: row.source_file || null,
      message: `核验提醒：${row.verification_note}`,
      suggestion: '回到制度或表单源文件确认 A1 核验提醒，整改后重新导入 MDM。'
    });
  }

  for (const risk of asArray(crossDept && crossDept.risks)) {
    if (normalizeConfirmStatus(risk.status) === 'confirmed') continue;
    const sourceDept = risk.source || risk.source_dept || null;
    const targetDept = risk.target || risk.target_dept || null;
    const a1Code = risk.a1 || risk.a1_code || null;
    const todo = {
      source_dept: sourceDept,
      target_dept: targetDept,
      a1_code: a1Code
    };
    todos.push({
      todo_key: mappingTodoKey('cross_dept', todo),
      todo_type: 'cross_dept',
      dept_name: sourceDept,
      target_dept_name: targetDept,
      a1_code: a1Code,
      source_file: risk.source_report || crossDept.source || null,
      message: risk.desc || risk.description || `${sourceDept || '来源部门'} 到 ${targetDept || '目标部门'} 的跨部门衔接待确认`,
      suggestion: '回到制度或表单源文件确认跨部门输入输出是否已有接收流程，整改后重新导入 MDM。',
      priority: normalizeRiskLevel(risk.risk) === 'high' ? 'high' : 'medium'
    });
  }

  return dedupeByKey(todos, 'todo_key');
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
  const qualityFindings = asArray(options.qualityFindings || options.quality_findings).map(normalizeQualityFinding);
  const mappingTodos = buildMappingTodos(a1Items, crossDept);

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
      evidenceRefs: summarizeEvidenceRefs(evidenceRefs),
      quality: summarizeQualityFindings(qualityFindings),
      mappingTodos: { total: mappingTodos.length }
    },
    nodes: normalizeNodes(data),
    links: normalizeLinks(data, nodeTypes),
    a1Items,
    sourceFiles,
    mdmRequirements,
    evidenceRefs,
    qualityFindings,
    mappingTodos,
    crossDept
  };
}

async function importProcessGovernanceMysqlSnapshot({ repository, sourceJsonPath, a1MarkdownPaths = [], qualityFindings = [], importedBy = null, note = null }) {
  const bundle = loadProcessGovernanceMysqlBundle(sourceJsonPath, { a1MarkdownPaths, qualityFindings, importedBy, note });
  await repository.initSchema();
  const result = await repository.replaceActiveReadModel(bundle);
  return { ...result, bundle };
}

module.exports = {
  importProcessGovernanceMysqlSnapshot,
  loadProcessGovernanceMysqlBundle
};
