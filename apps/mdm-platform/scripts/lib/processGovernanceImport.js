const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT_NODE = '昌兴复材';
const DOMAINS = new Set(['总经理直辖域', '经营域', '生产域']);
const DEPT_DOMAIN = new Map([
  ['工程技术部', '总经理直辖域'],
  ['质量管理部', '总经理直辖域'],
  ['财务部', '总经理直辖域'],
  ['行政人事部', '经营域'],
  ['经营发展部', '经营域'],
  ['物资保障部', '经营域'],
  ['项目管理部', '生产域'],
  ['复材车间', '生产域'],
  ['运维安环部', '生产域'],
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

function nodeKey(name) {
  return cleanCell(name);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function getSystems(data) {
  return new Set(asArray(data.systems).map(item => {
    if (typeof item === 'string') return item;
    return item && (item.name || item.system || item.system_name);
  }).map(cleanCell).filter(Boolean));
}

function deriveNodeTypes(data) {
  const systems = getSystems(data);
  const sourceToTargets = new Map();
  const targetToSources = new Map();

  for (const link of asArray(data.links)) {
    const source = nodeKey(link.source);
    const target = nodeKey(link.target);
    if (!source || !target) continue;
    if (!sourceToTargets.has(source)) sourceToTargets.set(source, new Set());
    if (!targetToSources.has(target)) targetToSources.set(target, new Set());
    sourceToTargets.get(source).add(target);
    targetToSources.get(target).add(source);
  }

  const types = new Map();
  for (const node of asArray(data.nodes)) {
    const name = nodeKey(typeof node === 'string' ? node : node && node.name);
    if (!name) continue;
    if (name === ROOT_NODE) types.set(name, 'root');
    else if (DOMAINS.has(name)) types.set(name, 'domain');
    else if (DEPT_DOMAIN.has(name)) types.set(name, 'department');
    else if (systems.has(name)) types.set(name, 'system');
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [source, targets] of sourceToTargets.entries()) {
      const sourceType = types.get(source);
      for (const target of targets) {
        if (types.has(target)) continue;
        let type = null;
        if (sourceType === 'department') type = 'l2';
        else if (sourceType === 'l2') type = 'l3';
        else if (sourceType === 'l3') type = systems.has(target) ? 'system' : 'a1';
        else if (sourceType === 'a1') type = systems.has(target) ? 'system' : null;
        if (type) {
          types.set(target, type);
          changed = true;
        }
      }
    }
  }

  for (const node of asArray(data.nodes)) {
    const name = nodeKey(typeof node === 'string' ? node : node && node.name);
    if (!name || types.has(name)) continue;
    const parents = [...(targetToSources.get(name) || [])];
    if (parents.some(parent => types.get(parent) === 'department')) types.set(name, 'l2');
    else if (parents.some(parent => types.get(parent) === 'l2')) types.set(name, 'l3');
    else if (parents.some(parent => types.get(parent) === 'l3')) types.set(name, 'a1');
    else types.set(name, 'l2');
  }

  return Object.fromEntries(types.entries());
}

function edgeTypeFor(sourceType, targetType) {
  const key = `${sourceType}_${targetType}`;
  return {
    root_domain: 'root_domain',
    domain_department: 'domain_dept',
    department_l2: 'dept_l2',
    l2_l3: 'l2_l3',
    l3_a1: 'l3_a1',
    l3_system: 'l3_system',
    a1_system: 'a1_system',
  }[key] || null;
}

function inferDomainAndDept(name, type, parentKey, nodesByName) {
  if (type === 'domain') return { domainName: name, deptName: null };
  if (type === 'department') return { domainName: DEPT_DOMAIN.get(name) || null, deptName: name };
  let current = parentKey;
  let deptName = null;
  let domainName = null;
  while (current) {
    const parent = nodesByName.get(current);
    if (!parent) break;
    if (!deptName && parent.type === 'department') deptName = parent.name;
    if (!domainName && parent.type === 'domain') domainName = parent.name;
    current = parent.parentKey;
  }
  if (deptName && !domainName) domainName = DEPT_DOMAIN.get(deptName) || null;
  return { domainName, deptName };
}

function deriveDeptName(sourceFile, titleLine) {
  const base = path.basename(sourceFile || '');
  const fileMatch = base.match(/^(.+?)部门-能力-流程-系统映射关系\.md$/);
  if (fileMatch) return fileMatch[1];
  const titleMatch = String(titleLine || '').match(/^#\s*(.+?)部门-能力-流程-系统映射关系/);
  return titleMatch ? titleMatch[1].trim() : null;
}

function splitSystems(value) {
  return unique(cleanCell(value).split(/[、,，/]/).map(item => item.trim()).filter(Boolean));
}

function parseMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map(cleanCell);
}

function findHeaderIndex(headers, matcher) {
  return headers.findIndex(header => matcher(cleanCell(header)));
}

function hasA1CodeHeader(header) {
  return /^(?:A1编号|业务行为（A1）编号)$/.test(header);
}

function hasBehaviorHeader(header) {
  return /^(?:业务行为|业务行为（A1）)$/.test(header);
}

function isSeparatorRow(cells) {
  return cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function isA1TableHeader(cells) {
  return findHeaderIndex(cells, hasA1CodeHeader) !== -1
    && findHeaderIndex(cells, hasBehaviorHeader) !== -1
    && cells.includes('执行角色');
}

function extractL3Name(line) {
  const match = line.match(/^#{3,6}\s+(.+?)\s*$/);
  if (!match || !match[1].includes('L3')) return null;
  const heading = cleanCell(match[1]);
  const patterns = [
    /^业务流程（L3）[-－—]?\d+\s+(.+)$/,
    /^[A-Z]{1,8}-L3-\d+\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const nameMatch = heading.match(pattern);
    if (nameMatch) return cleanCell(nameMatch[1]);
  }
  return null;
}

function isValidA1Row(a1Code, behavior) {
  const code = cleanCell(a1Code);
  const text = cleanCell(behavior);
  if (!text) return false;
  if (hasA1CodeHeader(code) || hasBehaviorHeader(text)) return false;
  if (/^合计|^总计|小计/.test(code) || /^合计|^总计|小计/.test(text)) return false;
  if (!code) return false;
  return /(?:^|[-_])A\d{1,2}(?:[-_]\d+)?$/i.test(code) || /A1[-_]\d+/i.test(code);
}

function parseA1Markdown(text, sourceFile) {
  const lines = String(text || '').split(/\r?\n/);
  const title = lines.find(line => line.startsWith('# '));
  const deptName = deriveDeptName(sourceFile, title);
  const rows = [];
  let inA1Section = false;
  let currentL3 = null;
  let headers = null;
  let inA1Table = false;

  for (const line of lines) {
    if (/^##\s+业务行为（A1）映射/.test(line)) {
      inA1Section = true;
      headers = null;
      inA1Table = false;
      continue;
    }
    if (inA1Section && /^##\s+/.test(line)) break;
    if (!inA1Section) continue;

    if (/^#{3,6}\s+/.test(line)) {
      const l3Name = extractL3Name(line);
      if (l3Name) currentL3 = l3Name;
      headers = null;
      inA1Table = false;
      continue;
    }

    const cells = parseMarkdownRow(line);
    if (!cells) {
      if (cleanCell(line)) {
        headers = null;
        inA1Table = false;
      }
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    if (isA1TableHeader(cells)) {
      headers = cells;
      inA1Table = true;
      continue;
    }
    if (!inA1Table || !headers || cells.length < headers.length || !currentL3) continue;

    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
    const valueFor = (...names) => {
      for (const name of names) {
        if (row[name]) return row[name];
      }
      const fuzzyName = names.find(name => Object.keys(row).some(key => key.includes(name)));
      if (!fuzzyName) return '';
      const key = Object.keys(row).find(candidate => candidate.includes(fuzzyName));
      return row[key] || '';
    };
    const a1Code = valueFor('A1编号', '业务行为（A1）编号');
    const behavior = valueFor('业务行为', '业务行为（A1）');
    if (!isValidA1Row(a1Code, behavior)) continue;
    rows.push({
      a1_code: a1Code || null,
      dept_name: deptName,
      l3_name: currentL3,
      behavior,
      execution_role: valueFor('执行角色') || null,
      approval_type: valueFor('审批类型') || null,
      input_source_dept: valueFor('输入来源部门') || null,
      output_target_dept: valueFor('输出目标部门') || null,
      suggested_systems: splitSystems(valueFor('应用系统', '应用系统（S1）')),
      verification_note: valueFor('核验提醒') || null,
      source_file: sourceFile || null
    });
  }

  return rows;
}

function normalizeConfirmStatus(value) {
  const text = cleanCell(value);
  if (text.includes('无文档') || text.includes('未映射')) return 'not_mapped';
  if (text.includes('待确认')) return 'pending';
  if (text.includes('待复核')) return 'needs_review';
  return 'confirmed';
}

function normalizeRiskLevel(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'low';
}

function normalizeChainStatus(value) {
  if (value === 'ok') return 'complete';
  return ['complete', 'partial', 'broken'].includes(value) ? value : 'partial';
}

function normalizeSeverity(value) {
  const severity = cleanCell(value).toUpperCase();
  return ['BLOCK', 'WARN', 'INFO'].includes(severity) ? severity : 'INFO';
}

function deriveFindingDeptName(sourceFile) {
  const normalized = String(sourceFile || '').replace(/\\/g, '/');
  const base = path.basename(normalized);
  const canonical = base.match(/^(.+?)部门-能力-流程-系统映射关系\.md$/);
  if (canonical) return canonical[1];
  const normsMatch = normalized.match(/docs\/norms\/(.+?)部门(?:-|能力|$)/);
  return normsMatch ? normsMatch[1] : null;
}

function normalizeQualityFinding(finding) {
  const sourceFile = cleanCell(finding.source_file || finding.file || '');
  const sourceLine = Number(finding.source_line || finding.line || 0) || null;
  const message = cleanCell(finding.message || '');
  const suggestion = cleanCell(finding.suggestion || '');
  const severity = normalizeSeverity(finding.severity);
  const area = cleanCell(finding.area || 'GENERAL') || 'GENERAL';
  const deptName = cleanCell(finding.dept_name || '') || deriveFindingDeptName(sourceFile);
  const keySource = [
    severity,
    area,
    sourceFile,
    sourceLine || '',
    message,
    suggestion,
  ].join('|');

  return {
    severity,
    area,
    source_file: sourceFile || 'unknown',
    source_line: sourceLine,
    message: message || '未命名质量问题',
    suggestion: suggestion || null,
    dept_name: deptName || null,
    finding_key: crypto.createHash('sha256').update(keySource).digest('hex'),
  };
}

function summarizeQualityFindings(findings) {
  const summary = { BLOCK: 0, WARN: 0, INFO: 0 };
  for (const finding of findings) {
    summary[finding.severity] += 1;
  }
  return summary;
}

function importProcessGovernanceSnapshot({ db, sourceJsonPath, a1MarkdownPaths = [], qualityFindings = [], importedBy = null, note = null }) {
  const sourceText = fs.readFileSync(sourceJsonPath, 'utf8');
  const sourceHash = crypto.createHash('sha256').update(sourceText).digest('hex');
  const data = JSON.parse(sourceText);
  const stats = { ...(data.stats || {}), crossDept: (data.crossDept && data.crossDept.stats) || {} };
  const nodeTypes = deriveNodeTypes(data);
  const parsedA1Rows = [];
  for (const markdownPath of a1MarkdownPaths) {
    parsedA1Rows.push(...parseA1Markdown(fs.readFileSync(markdownPath, 'utf8'), markdownPath));
  }
  stats.a1Imported = parsedA1Rows.length;
  const normalizedQualityFindings = qualityFindings.map(normalizeQualityFinding);
  stats.quality = summarizeQualityFindings(normalizedQualityFindings);

  return db.transaction(() => {
    db.prepare("UPDATE process_governance_snapshots SET status='archived' WHERE status='active'").run();
    const snapshotId = db.prepare(`
      INSERT INTO process_governance_snapshots (source_json_path, source_hash, generated_at, imported_by, stats_json, status, note)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).run(sourceJsonPath, sourceHash, data.generatedAt || data.generated_at || null, importedBy, JSON.stringify(stats), note).lastInsertRowid;

    const nodesByName = new Map();
    for (const link of asArray(data.links)) {
      const source = nodeKey(link.source);
      const target = nodeKey(link.target);
      if (source && target && !nodesByName.has(target)) nodesByName.set(target, { parentKey: source });
      if (source && !nodesByName.has(source)) nodesByName.set(source, { parentKey: null });
    }

    const insertNode = db.prepare(`
      INSERT OR IGNORE INTO process_governance_nodes
        (snapshot_id, node_key, node_type, name, domain_name, dept_name, parent_key, source_file, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    asArray(data.nodes).forEach((node, index) => {
      const name = nodeKey(typeof node === 'string' ? node : node && node.name);
      if (!name) return;
      const type = nodeTypes[name] || 'l2';
      const parentKey = nodesByName.get(name) && nodesByName.get(name).parentKey;
      nodesByName.set(name, { name, type, parentKey });
      const { domainName, deptName } = inferDomainAndDept(name, type, parentKey, nodesByName);
      insertNode.run(snapshotId, name, type, name, domainName, deptName, parentKey || null, node.source_file || null, index);
    });

    const insertEdge = db.prepare(`
      INSERT OR IGNORE INTO process_governance_edges (snapshot_id, source_key, target_key, edge_type, value, source_file)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const link of asArray(data.links)) {
      const source = nodeKey(link.source);
      const target = nodeKey(link.target);
      const edgeType = edgeTypeFor(nodeTypes[source], nodeTypes[target]);
      if (!source || !target || !edgeType) continue;
      insertEdge.run(snapshotId, source, target, edgeType, Number(link.value || 1), link.source_file || null);
    }

    const insertA1 = db.prepare(`
      INSERT INTO process_a1_items (
        snapshot_id, a1_code, dept_name, l3_name, behavior, execution_role, approval_type,
        input_source_dept, output_target_dept, suggested_systems, verification_note, source_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of parsedA1Rows) {
      insertA1.run(
        snapshotId,
        row.a1_code,
        row.dept_name,
        row.l3_name,
        row.behavior,
        row.execution_role,
        row.approval_type,
        row.input_source_dept,
        row.output_target_dept,
        JSON.stringify(row.suggested_systems || []),
        row.verification_note,
        row.source_file
      );
    }

    const crossDept = data.crossDept || {};
    const sourceReport = crossDept.source || null;
    const insertRisk = db.prepare(`
      INSERT INTO process_cross_dept_interactions (
        snapshot_id, source_dept, target_dept, a1_code, refs, risk_level, confirm_status, description, source_report
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const risk of asArray(crossDept.risks)) {
      insertRisk.run(
        snapshotId,
        risk.source || null,
        risk.target || null,
        risk.a1 || risk.a1_code || null,
        Number(risk.refs || 0),
        normalizeRiskLevel(risk.risk),
        normalizeConfirmStatus(risk.status),
        risk.desc || risk.description || null,
        sourceReport
      );
    }

    const insertChain = db.prepare(`
      INSERT INTO process_interaction_chains (snapshot_id, name, status, breaks_json, source_report)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const chain of asArray(crossDept.interactionChains)) {
      insertChain.run(
        snapshotId,
        chain.name || '未命名交互链',
        normalizeChainStatus(chain.status),
        JSON.stringify(asArray(chain.breaks)),
        chain.source || sourceReport
      );
    }

    const insertQualityFinding = db.prepare(`
      INSERT OR IGNORE INTO process_governance_quality_findings (
        snapshot_id, severity, area, source_file, source_line, message, suggestion, dept_name, finding_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const finding of normalizedQualityFindings) {
      insertQualityFinding.run(
        snapshotId,
        finding.severity,
        finding.area,
        finding.source_file,
        finding.source_line,
        finding.message,
        finding.suggestion,
        finding.dept_name,
        finding.finding_key
      );
    }

    return snapshotId;
  })();
}

module.exports = {
  importProcessGovernanceSnapshot,
  parseA1Markdown,
  deriveNodeTypes,
  normalizeQualityFinding,
};
