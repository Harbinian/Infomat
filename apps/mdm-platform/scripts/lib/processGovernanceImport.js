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
      const key = Object.keys(row).find(reviewItem => reviewItem.includes(fuzzyName));
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

function defaultPriorityForSeverity(severity) {
  return severity === 'BLOCK' ? 'high' : 'medium';
}

function departmentIdForName(db, deptName) {
  if (!deptName) return null;
  const dept = db.prepare('SELECT id FROM departments WHERE name=?').get(deptName);
  return dept ? dept.id : null;
}

function addQualityCaseEvent(db, caseId, eventType, actorUserId, note, payload = null) {
  db.prepare(`
    INSERT INTO process_governance_quality_case_events (case_id, event_type, actor_user_id, note, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(caseId, eventType, actorUserId || null, note || null, payload ? JSON.stringify(payload) : null);
}

function stableKey(prefix, parts) {
  return `${prefix}:${crypto.createHash('sha256').update(parts.map(part => cleanCell(part)).join('|')).digest('hex')}`;
}

function normalizeProcessStatus(value) {
  const text = cleanCell(value);
  return ['纳入', '排除', '待复核'].includes(text) ? text : '待复核';
}

function normalizeRefType(value) {
  const text = cleanCell(value).toUpperCase();
  return ['L3', 'A1', 'MDM'].includes(text) ? text : null;
}

function sourceManifestFiles(data) {
  return asArray(data && data.sourceManifest && data.sourceManifest.files);
}

function normalizeSourceFile(file = {}) {
  const filePath = cleanCell(file.path || file.file_path || file.filePath || '');
  if (!filePath) return null;
  const sha256 = cleanCell(file.sha256 || file.hash || '');
  return {
    file_key: stableKey('source-file', [filePath, sha256]),
    file_path: filePath,
    dept_name: cleanCell(file.dept || file.dept_name || file.deptName || '') || null,
    asset_type: cleanCell(file.assetType || file.asset_type || '') || null,
    file_no: cleanCell(file.fileNo || file.file_no || '') || null,
    revision: cleanCell(file.revision || '') || null,
    size_bytes: Number(file.sizeBytes || file.size_bytes || file.size || 0) || null,
    mtime: cleanCell(file.mtime || file.modifiedAt || file.modified_at || '') || null,
    sha256: sha256 || null,
    process_status: normalizeProcessStatus(file.status || file.processStatus || file.process_status),
    process_reason: cleanCell(file.reason || file.processReason || file.process_reason || '') || null,
  };
}

function normalizeMdmRequirement(item = {}) {
  const masterDataObject = cleanCell(item.masterDataObject || item.master_data_object || item.object || '');
  if (!masterDataObject) return null;
  const deptName = cleanCell(item.dept || item.dept_name || item.deptName || '') || null;
  const sourceL2 = cleanCell(item.sourceL2 || item.source_l2 || '') || null;
  const sourceFile = cleanCell(item.sourceFile || item.source_file || '') || null;
  return {
    requirement_key: stableKey('mdm-req', [deptName, masterDataObject, sourceL2, sourceFile]),
    dept_name: deptName,
    master_data_object: masterDataObject,
    source_l2: sourceL2,
    key_fields: cleanCell(item.keyFields || item.key_fields || '') || null,
    responsible_dept: cleanCell(item.responsibleDept || item.responsible_dept || '') || null,
    system_boundary: cleanCell(item.systemBoundary || item.system_boundary || '') || null,
    governance_requirement: cleanCell(item.governanceRequirement || item.governance_requirement || '') || null,
    source_file: sourceFile,
  };
}

function normalizeEvidenceRef(ref = {}) {
  const refType = normalizeRefType(ref.refType || ref.ref_type || ref.type);
  if (!refType) return null;
  const sourceFile = cleanCell(ref.sourceFile || ref.source_file || '');
  if (!sourceFile) return null;
  const deptName = cleanCell(ref.dept || ref.deptName || ref.dept_name || '') || null;
  const l3Name = cleanCell(ref.l3Name || ref.l3_name || '') || null;
  const a1Code = cleanCell(ref.a1Code || ref.a1_code || '') || null;
  const masterDataObject = cleanCell(ref.masterDataObject || ref.master_data_object || '') || null;
  const evidenceType = cleanCell(ref.evidenceType || ref.evidence_type || '') || null;
  const citation = cleanCell(ref.citation || ref.ref || '') || null;
  return {
    ref_key: cleanCell(ref.refKey || ref.ref_key || '') || stableKey('evidence', [
      refType,
      deptName,
      l3Name,
      a1Code,
      masterDataObject,
      sourceFile,
      citation,
      evidenceType,
    ]),
    ref_type: refType,
    dept_name: deptName,
    l3_name: l3Name,
    a1_code: a1Code,
    master_data_object: masterDataObject,
    evidence_type: evidenceType,
    source_file: sourceFile,
    citation,
    note: cleanCell(ref.note || ref.description || '') || null,
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

function syncQualityCases(db, snapshotId, findings, importedBy) {
  const governanceFindings = findings.filter(finding => finding.severity === 'BLOCK' || finding.severity === 'WARN');
  const currentKeys = new Set(governanceFindings.map(finding => finding.finding_key));

  const insertCase = db.prepare(`
    INSERT INTO process_governance_quality_cases (
      finding_key, first_snapshot_id, latest_snapshot_id, latest_finding_id, severity, area, source_file,
      source_line, message, suggestion, dept_name, status, priority, owner_dept_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `);
  const updateCaseSeen = db.prepare(`
    UPDATE process_governance_quality_cases
    SET latest_snapshot_id=?,
        latest_finding_id=?,
        severity=?,
        area=?,
        source_file=?,
        source_line=?,
        message=?,
        suggestion=?,
        dept_name=?,
        owner_dept_id=COALESCE(owner_dept_id, ?),
        priority=CASE WHEN priority IS NULL OR priority='' THEN ? ELSE priority END,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);
  const reopenCase = db.prepare(`
    UPDATE process_governance_quality_cases
    SET status='reopened',
        reopened_count=reopened_count + 1,
        closed_by=NULL,
        closed_at=NULL,
        closure_note=NULL,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);
  const linkFinding = db.prepare('UPDATE process_governance_quality_findings SET case_id=? WHERE id=?');
  const findRawFinding = db.prepare(`
    SELECT id
    FROM process_governance_quality_findings
    WHERE snapshot_id=? AND finding_key=?
  `);
  const findCase = db.prepare('SELECT * FROM process_governance_quality_cases WHERE finding_key=?');

  for (const finding of governanceFindings) {
    const rawFinding = findRawFinding.get(snapshotId, finding.finding_key);
    const latestFindingId = rawFinding ? rawFinding.id : null;
    const ownerDeptId = departmentIdForName(db, finding.dept_name);
    const priority = defaultPriorityForSeverity(finding.severity);
    let qualityCase = findCase.get(finding.finding_key);

    if (!qualityCase) {
      const result = insertCase.run(
        finding.finding_key,
        snapshotId,
        snapshotId,
        latestFindingId,
        finding.severity,
        finding.area,
        finding.source_file,
        finding.source_line,
        finding.message,
        finding.suggestion,
        finding.dept_name,
        priority,
        ownerDeptId
      );
      qualityCase = { id: result.lastInsertRowid, status: 'open' };
      addQualityCaseEvent(db, qualityCase.id, 'import_created', importedBy, '质检导入创建治理问题单', {
        snapshot_id: snapshotId,
        finding_id: latestFindingId,
        severity: finding.severity
      });
    } else {
      updateCaseSeen.run(
        snapshotId,
        latestFindingId,
        finding.severity,
        finding.area,
        finding.source_file,
        finding.source_line,
        finding.message,
        finding.suggestion,
        finding.dept_name,
        ownerDeptId,
        priority,
        qualityCase.id
      );
      addQualityCaseEvent(db, qualityCase.id, 'import_seen', importedBy, '质检导入再次发现该问题', {
        snapshot_id: snapshotId,
        finding_id: latestFindingId,
        previous_status: qualityCase.status
      });
      if (qualityCase.status === 'closed' || qualityCase.status === 'source_resolved') {
        reopenCase.run(qualityCase.id);
        addQualityCaseEvent(db, qualityCase.id, 'reopened', importedBy, '问题在最新质检中再次出现，自动重开', {
          snapshot_id: snapshotId,
          finding_id: latestFindingId,
          previous_status: qualityCase.status
        });
      }
    }

    if (latestFindingId) linkFinding.run(qualityCase.id, latestFindingId);
  }

  const openCases = db.prepare(`
    SELECT id, finding_key, status
    FROM process_governance_quality_cases
    WHERE status NOT IN ('closed','source_resolved')
  `).all();
  const markSourceResolved = db.prepare(`
    UPDATE process_governance_quality_cases
    SET status='source_resolved',
        latest_snapshot_id=?,
        latest_finding_id=NULL,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);
  for (const qualityCase of openCases) {
    if (currentKeys.has(qualityCase.finding_key)) continue;
    markSourceResolved.run(snapshotId, qualityCase.id);
    addQualityCaseEvent(db, qualityCase.id, 'source_resolved', importedBy, '最新质检未再发现该问题，等待治理确认关闭', {
      snapshot_id: snapshotId,
      previous_status: qualityCase.status
    });
  }
}

function mappingRecordKey(recordType, row) {
  if (recordType === 'l3') return stableKey('l3', [row.dept_name, row.l3_name]);
  return stableKey('a1', [row.dept_name, row.l3_name, row.a1_code]);
}

function mappingTodoKey(todoType, row) {
  if (todoType === 'cross_dept') {
    return stableKey('maptodo', [todoType, row.source_dept, row.target_dept, row.a1_code]);
  }
  return stableKey('maptodo', [todoType, row.dept_name, row.l3_name, row.a1_code]);
}

function addMappingTodoEvent(db, todoId, eventType, actorUserId, note, payload = null) {
  db.prepare(`
    INSERT INTO process_mapping_todo_events (todo_id, event_type, actor_user_id, note, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(todoId, eventType, actorUserId || null, note || null, payload ? JSON.stringify(payload) : null);
}

function sourceSystemsJson(row) {
  return JSON.stringify(row.suggested_systems || []);
}

function syncMappingRecord(db, snapshotId, record, importedBy, currentKeys) {
  const key = mappingRecordKey(record.record_type, record);
  currentKeys.add(key);
  const existing = db.prepare('SELECT * FROM process_mapping_records WHERE mapping_key=?').get(key);
  if (!existing) {
    const result = db.prepare(`
      INSERT INTO process_mapping_records (
        mapping_key, record_type, first_snapshot_id, latest_snapshot_id, parent_record_id, latest_a1_item_id,
        dept_name, domain_name, l2_name, l3_name, a1_code, behavior, execution_role, approval_type,
        input_source_dept, output_target_dept, suggested_systems, verification_note, source_file, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      key,
      record.record_type,
      snapshotId,
      snapshotId,
      record.parent_record_id || null,
      record.latest_a1_item_id || null,
      record.dept_name || null,
      record.domain_name || null,
      record.l2_name || null,
      record.l3_name,
      record.a1_code || null,
      record.behavior || null,
      record.execution_role || null,
      record.approval_type || null,
      record.input_source_dept || null,
      record.output_target_dept || null,
      record.record_type === 'a1' ? sourceSystemsJson(record) : null,
      record.verification_note || null,
      record.source_file || null
    );
    return result.lastInsertRowid;
  }

  db.prepare(`
    UPDATE process_mapping_records
    SET latest_snapshot_id=?,
        parent_record_id=?,
        latest_a1_item_id=?,
        dept_name=?,
        domain_name=?,
        l2_name=?,
        l3_name=?,
        a1_code=?,
        behavior=?,
        execution_role=?,
        approval_type=?,
        input_source_dept=?,
        output_target_dept=?,
        suggested_systems=?,
        verification_note=?,
        source_file=?,
        status=CASE WHEN status='source_missing' THEN 'active' ELSE status END,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    snapshotId,
    record.parent_record_id || null,
    record.latest_a1_item_id || null,
    record.dept_name || null,
    record.domain_name || null,
    record.l2_name || null,
    record.l3_name,
    record.a1_code || null,
    record.behavior || null,
    record.execution_role || null,
    record.approval_type || null,
    record.input_source_dept || null,
    record.output_target_dept || null,
    record.record_type === 'a1' ? sourceSystemsJson(record) : null,
    record.verification_note || null,
    record.source_file || null,
    existing.id
  );
  return existing.id;
}

function syncMappingTodo(db, snapshotId, todo, importedBy, currentKeys) {
  const key = mappingTodoKey(todo.todo_type, todo);
  currentKeys.add(key);
  const existing = db.prepare('SELECT * FROM process_mapping_todos WHERE todo_key=?').get(key);
  const priority = todo.priority || 'medium';
  if (!existing) {
    const result = db.prepare(`
      INSERT INTO process_mapping_todos (
        todo_key, mapping_record_id, todo_type, first_snapshot_id, latest_snapshot_id, dept_name,
        target_dept_name, l3_name, a1_code, source_file, source_line, message, suggestion, status,
        priority, owner_dept_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(
      key,
      todo.mapping_record_id || null,
      todo.todo_type,
      snapshotId,
      snapshotId,
      todo.dept_name || todo.source_dept || null,
      todo.target_dept_name || todo.target_dept || null,
      todo.l3_name || null,
      todo.a1_code || null,
      todo.source_file || null,
      todo.source_line || null,
      todo.message,
      todo.suggestion || null,
      priority,
      departmentIdForName(db, todo.dept_name || todo.source_dept)
    );
    addMappingTodoEvent(db, result.lastInsertRowid, 'import_created', importedBy, '导入创建流程映射待办', {
      snapshot_id: snapshotId,
      todo_type: todo.todo_type
    });
    return;
  }

  db.prepare(`
    UPDATE process_mapping_todos
    SET mapping_record_id=?,
        latest_snapshot_id=?,
        dept_name=?,
        target_dept_name=?,
        l3_name=?,
        a1_code=?,
        source_file=?,
        source_line=?,
        message=?,
        suggestion=?,
        priority=CASE WHEN priority IS NULL OR priority='' THEN ? ELSE priority END,
        owner_dept_id=COALESCE(owner_dept_id, ?),
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    todo.mapping_record_id || null,
    snapshotId,
    todo.dept_name || todo.source_dept || null,
    todo.target_dept_name || todo.target_dept || null,
    todo.l3_name || null,
    todo.a1_code || null,
    todo.source_file || null,
    todo.source_line || null,
    todo.message,
    todo.suggestion || null,
    priority,
    departmentIdForName(db, todo.dept_name || todo.source_dept),
    existing.id
  );
  addMappingTodoEvent(db, existing.id, 'import_seen', importedBy, '导入再次发现该流程映射待办', {
    snapshot_id: snapshotId,
    previous_status: existing.status
  });

  if (existing.status === 'closed' || existing.status === 'source_resolved') {
    db.prepare(`
      UPDATE process_mapping_todos
      SET status='reopened',
          reopened_count=reopened_count + 1,
          closed_by=NULL,
          closed_at=NULL,
          closure_note=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(existing.id);
    addMappingTodoEvent(db, existing.id, 'reopened', importedBy, '来源提醒在最新导入中再次出现，自动重开', {
      snapshot_id: snapshotId,
      previous_status: existing.status
    });
  }
}

function syncMissingMappingState(db, snapshotId, recordKeys, todoKeys, importedBy) {
  const staleRecords = db.prepare(`
    SELECT id, mapping_key, status
    FROM process_mapping_records
    WHERE status='active'
  `).all();
  for (const record of staleRecords) {
    if (recordKeys.has(record.mapping_key)) continue;
    db.prepare(`
      UPDATE process_mapping_records
      SET status='source_missing', latest_snapshot_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(snapshotId, record.id);
  }

  const staleTodos = db.prepare(`
    SELECT id, todo_key, status
    FROM process_mapping_todos
    WHERE status NOT IN ('closed','source_resolved','accepted')
  `).all();
  for (const todo of staleTodos) {
    if (todoKeys.has(todo.todo_key)) continue;
    db.prepare(`
      UPDATE process_mapping_todos
      SET status='source_resolved', latest_snapshot_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(snapshotId, todo.id);
    addMappingTodoEvent(db, todo.id, 'source_resolved', importedBy, '最新导入未再发现该流程映射待办，等待确认关闭', {
      snapshot_id: snapshotId,
      previous_status: todo.status
    });
  }
}

function syncMappingWorkspace(db, snapshotId, parsedA1Rows, crossDept, importedBy) {
  const currentRecordKeys = new Set();
  const currentTodoKeys = new Set();
  const l3InfoRows = db.prepare(`
    SELECT l3.node_key, l3.name AS l3_name, l3.domain_name, l3.dept_name, l2.name AS l2_name
    FROM process_governance_nodes l3
    LEFT JOIN process_governance_nodes l2
      ON l2.snapshot_id=l3.snapshot_id AND l2.node_key=l3.parent_key
    WHERE l3.snapshot_id=? AND l3.node_type='l3'
  `).all(snapshotId);
  const l3InfoByName = new Map(l3InfoRows.map(row => [`${row.dept_name || ''}|${row.l3_name}`, row]));
  const l3RecordIds = new Map();

  for (const row of l3InfoRows) {
    const recordId = syncMappingRecord(db, snapshotId, {
      record_type: 'l3',
      dept_name: row.dept_name,
      domain_name: row.domain_name,
      l2_name: row.l2_name,
      l3_name: row.l3_name
    }, importedBy, currentRecordKeys);
    l3RecordIds.set(`${row.dept_name || ''}|${row.l3_name}`, recordId);
  }

  const latestA1Item = db.prepare(`
    SELECT id
    FROM process_a1_items
    WHERE snapshot_id=? AND a1_code=?
    ORDER BY id DESC
    LIMIT 1
  `);

  for (const row of parsedA1Rows) {
    const l3Key = `${row.dept_name || ''}|${row.l3_name}`;
    let l3RecordId = l3RecordIds.get(l3Key);
    if (!l3RecordId) {
      const l3Info = l3InfoByName.get(l3Key) || {};
      l3RecordId = syncMappingRecord(db, snapshotId, {
        record_type: 'l3',
        dept_name: row.dept_name,
        domain_name: l3Info.domain_name || null,
        l2_name: l3Info.l2_name || null,
        l3_name: row.l3_name
      }, importedBy, currentRecordKeys);
      l3RecordIds.set(l3Key, l3RecordId);
    }

    const a1Item = latestA1Item.get(snapshotId, row.a1_code);
    const a1RecordId = syncMappingRecord(db, snapshotId, {
      ...row,
      record_type: 'a1',
      parent_record_id: l3RecordId,
      latest_a1_item_id: a1Item && a1Item.id || null
    }, importedBy, currentRecordKeys);

    if (row.verification_note) {
      syncMappingTodo(db, snapshotId, {
        todo_type: 'verification',
        mapping_record_id: a1RecordId,
        dept_name: row.dept_name,
        l3_name: row.l3_name,
        a1_code: row.a1_code,
        source_file: row.source_file,
        message: `核验提醒：${row.verification_note}`,
        suggestion: '回到制度或表单源文件确认 A1 核验提醒，整改后重新导入 MDM。'
      }, importedBy, currentTodoKeys);
    }
  }

  const crossDeptSource = crossDept || {};
  for (const risk of asArray(crossDeptSource.risks)) {
    const confirmStatus = normalizeConfirmStatus(risk.status);
    if (confirmStatus === 'confirmed') continue;
    const sourceDept = risk.source || risk.source_dept || null;
    const targetDept = risk.target || risk.target_dept || null;
    const a1Code = risk.a1 || risk.a1_code || null;
    syncMappingTodo(db, snapshotId, {
      todo_type: 'cross_dept',
      source_dept: sourceDept,
      target_dept: targetDept,
      a1_code: a1Code,
      source_file: crossDeptSource.source || null,
      message: risk.desc || risk.description || `${sourceDept || '来源部门'} 到 ${targetDept || '目标部门'} 的跨部门衔接待确认`,
      suggestion: '回到制度或表单源文件确认跨部门输入输出是否已有接收流程，整改后重新导入 MDM。',
      priority: normalizeRiskLevel(risk.risk) === 'high' ? 'high' : 'medium'
    }, importedBy, currentTodoKeys);
  }

  syncMissingMappingState(db, snapshotId, currentRecordKeys, currentTodoKeys, importedBy);
}

function importProcessGovernanceSnapshot({ db, sourceJsonPath, a1MarkdownPaths = [], qualityFindings = [], importedBy = null, note = null }) {
  const sourceText = fs.readFileSync(sourceJsonPath, 'utf8');
  const sourceHash = crypto.createHash('sha256').update(sourceText).digest('hex');
  const data = JSON.parse(sourceText);
  const stats = { ...(data.stats || {}), crossDept: (data.crossDept && data.crossDept.stats) || {} };
  const nodeTypes = deriveNodeTypes(data);
  const normalizedSourceFiles = dedupeByKey(sourceManifestFiles(data).map(normalizeSourceFile), 'file_key');
  const normalizedMdmRequirements = dedupeByKey(asArray(data.mdmRequirements).map(normalizeMdmRequirement), 'requirement_key');
  const normalizedEvidenceRefs = dedupeByKey(asArray(data.evidenceRefs).map(normalizeEvidenceRef), 'ref_key');
  const parsedA1Rows = [];
  for (const markdownPath of a1MarkdownPaths) {
    parsedA1Rows.push(...parseA1Markdown(fs.readFileSync(markdownPath, 'utf8'), markdownPath));
  }
  stats.a1Imported = parsedA1Rows.length;
  stats.sourceFiles = summarizeSourceFiles(normalizedSourceFiles);
  stats.mdmRequirements = summarizeMdmRequirements(normalizedMdmRequirements);
  stats.evidenceRefs = summarizeEvidenceRefs(normalizedEvidenceRefs);
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

    const insertSourceFile = db.prepare(`
      INSERT OR IGNORE INTO process_source_files (
        snapshot_id, file_key, file_path, dept_name, asset_type, file_no, revision,
        size_bytes, mtime, sha256, process_status, process_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const file of normalizedSourceFiles) {
      insertSourceFile.run(
        snapshotId,
        file.file_key,
        file.file_path,
        file.dept_name,
        file.asset_type,
        file.file_no,
        file.revision,
        file.size_bytes,
        file.mtime,
        file.sha256,
        file.process_status,
        file.process_reason
      );
    }

    const insertMdmRequirement = db.prepare(`
      INSERT OR IGNORE INTO process_mdm_requirement_items (
        snapshot_id, requirement_key, dept_name, master_data_object, source_l2, key_fields,
        responsible_dept, system_boundary, governance_requirement, source_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of normalizedMdmRequirements) {
      insertMdmRequirement.run(
        snapshotId,
        item.requirement_key,
        item.dept_name,
        item.master_data_object,
        item.source_l2,
        item.key_fields,
        item.responsible_dept,
        item.system_boundary,
        item.governance_requirement,
        item.source_file
      );
    }

    const insertEvidenceRef = db.prepare(`
      INSERT OR IGNORE INTO process_evidence_refs (
        snapshot_id, ref_key, ref_type, dept_name, l3_name, a1_code, master_data_object,
        evidence_type, source_file, citation, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ref of normalizedEvidenceRefs) {
      insertEvidenceRef.run(
        snapshotId,
        ref.ref_key,
        ref.ref_type,
        ref.dept_name,
        ref.l3_name,
        ref.a1_code,
        ref.master_data_object,
        ref.evidence_type,
        ref.source_file,
        ref.citation,
        ref.note
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

    syncQualityCases(db, snapshotId, normalizedQualityFindings, importedBy);
    syncMappingWorkspace(db, snapshotId, parsedA1Rows, crossDept, importedBy);

    return snapshotId;
  })();
}

module.exports = {
  importProcessGovernanceSnapshot,
  parseA1Markdown,
  deriveNodeTypes,
  sourceManifestFiles,
  normalizeSourceFile,
  normalizeMdmRequirement,
  normalizeEvidenceRef,
  normalizeQualityFinding,
};
