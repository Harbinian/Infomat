const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const crypto = require('crypto');

const ALLOWED_EDGE_TYPES = new Set([
  'root_domain',
  'domain_dept',
  'dept_l2',
  'l2_l3',
  'l3_a1',
  'l3_system',
  'a1_system'
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
}

function stableKey(prefix, parts) {
  const hash = crypto.createHash('sha1')
    .update(parts.map(part => cleanText(part)).join('|'))
    .digest('hex')
    .slice(0, 16);
  return `${prefix}-${hash}`;
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function emptySankey() {
  return {
    nodes: [],
    links: [],
    systems: [],
    stats: {},
    crossDept: { stats: {}, risks: [], interactionChains: [], source: null }
  };
}

function normalizeNodeKey(value) {
  return String(value || '').trim();
}

function normalizeRiskLevel(value) {
  const risk = String(value || '').trim();
  return ['high', 'medium', 'low'].includes(risk) ? risk : 'low';
}

function normalizeConfirmStatus(value) {
  const status = String(value || '').trim();
  return ['confirmed', 'pending', 'needs_review', 'not_mapped'].includes(status) ? status : 'pending';
}

function normalizeChainStatus(value) {
  const status = String(value || '').trim();
  return ['complete', 'partial', 'broken'].includes(status) ? status : 'partial';
}

function normalizeProcessStatus(value) {
  const status = cleanText(value);
  return ['纳入', '排除', '待复核'].includes(status) ? status : '待复核';
}

function normalizeRefType(value) {
  const refType = cleanText(value).toUpperCase();
  return ['L3', 'A1', 'MDM'].includes(refType) ? refType : '';
}

function edgeTypeFromNodes(sourceType, targetType) {
  if (sourceType === 'root' && targetType === 'domain') return 'root_domain';
  if (sourceType === 'domain' && targetType === 'department') return 'domain_dept';
  if (sourceType === 'department' && targetType === 'l2') return 'dept_l2';
  if (sourceType === 'l2' && targetType === 'l3') return 'l2_l3';
  if (sourceType === 'l3' && targetType === 'a1') return 'l3_a1';
  if (sourceType === 'l3' && targetType === 'system') return 'l3_system';
  if (sourceType === 'a1' && targetType === 'system') return 'a1_system';
  return '';
}

function normalizeNode(node, index) {
  const raw = typeof node === 'string' ? { name: node } : (node || {});
  const nodeKey = normalizeNodeKey(raw.node_key || raw.key || raw.name);
  if (!nodeKey) return null;
  return {
    node_key: nodeKey,
    node_type: raw.node_type || raw.type || 'l2',
    name: raw.label || raw.name || nodeKey,
    domain_name: raw.domain_name || raw.domainName || null,
    dept_name: raw.dept_name || raw.deptName || null,
    parent_key: raw.parent_key || raw.parentKey || null,
    source_file: raw.source_file || raw.sourceFile || null,
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : index
  };
}

function normalizeEdge(link, nodeTypes) {
  const source = normalizeNodeKey(link && (link.source_key || link.source));
  const target = normalizeNodeKey(link && (link.target_key || link.target));
  if (!source || !target) return null;
  const edgeType = link.edge_type || link.type || edgeTypeFromNodes(nodeTypes.get(source), nodeTypes.get(target));
  if (!ALLOWED_EDGE_TYPES.has(edgeType)) return null;
  return {
    source_key: source,
    target_key: target,
    edge_type: edgeType,
    value: Number.isFinite(Number(link.value)) ? Number(link.value) : 1,
    source_file: link.source_file || link.sourceFile || null
  };
}

function normalizeRisk(risk) {
  return {
    source_dept: risk.source_dept || risk.source || null,
    target_dept: risk.target_dept || risk.target || null,
    a1_code: risk.a1_code || risk.a1 || null,
    refs: Number.isFinite(Number(risk.refs)) ? Number(risk.refs) : 0,
    risk_level: normalizeRiskLevel(risk.risk_level || risk.risk),
    confirm_status: normalizeConfirmStatus(risk.confirm_status || risk.status),
    description: risk.description || risk.desc || null,
    source_report: risk.source_report || risk.sourceReport || null
  };
}

function normalizeChain(chain) {
  return {
    name: String(chain.name || '').trim(),
    status: normalizeChainStatus(chain.status),
    breaks_json: JSON.stringify(asArray(chain.breaks)),
    source_report: chain.source_report || chain.sourceReport || null
  };
}

function normalizeA1Item(item) {
  const systems = asArray(item.suggested_systems || item.suggestedSystems);
  return {
    a1_code: item.a1_code || item.a1Code || null,
    dept_name: item.dept_name || item.deptName || null,
    l3_name: item.l3_name || item.l3Name || null,
    behavior: item.behavior || '',
    execution_role: item.execution_role || item.executionRole || null,
    approval_type: item.approval_type || item.approvalType || null,
    input_source_dept: item.input_source_dept || item.inputSourceDept || null,
    output_target_dept: item.output_target_dept || item.outputTargetDept || null,
    suggested_systems: JSON.stringify(systems),
    verification_note: item.verification_note || item.verificationNote || null,
    source_file: item.source_file || item.sourceFile || null
  };
}

function normalizeSourceFile(file) {
  const filePath = cleanText(file.file_path || file.filePath || file.path);
  if (!filePath) return null;
  const sha256 = cleanText(file.sha256 || file.hash);
  return {
    file_key: cleanText(file.file_key || file.fileKey) || stableKey('source-file', [filePath, sha256]),
    file_path: filePath,
    dept_name: cleanText(file.dept_name || file.deptName || file.dept) || null,
    asset_type: cleanText(file.asset_type || file.assetType) || null,
    file_no: cleanText(file.file_no || file.fileNo) || null,
    revision: cleanText(file.revision) || null,
    size_bytes: Number(file.size_bytes || file.sizeBytes || file.size || 0) || null,
    mtime: cleanText(file.mtime || file.modified_at || file.modifiedAt) || null,
    sha256: sha256 || null,
    process_status: normalizeProcessStatus(file.process_status || file.processStatus || file.status),
    process_reason: cleanText(file.process_reason || file.processReason || file.reason) || null
  };
}

function normalizeMdmRequirement(item) {
  const masterDataObject = cleanText(item.master_data_object || item.masterDataObject || item.object);
  if (!masterDataObject) return null;
  const deptName = cleanText(item.dept_name || item.deptName || item.dept) || null;
  const sourceL2 = cleanText(item.source_l2 || item.sourceL2) || null;
  const sourceFile = cleanText(item.source_file || item.sourceFile) || null;
  return {
    requirement_key: cleanText(item.requirement_key || item.requirementKey) || stableKey('mdm-req', [deptName, masterDataObject, sourceL2, sourceFile]),
    dept_name: deptName,
    master_data_object: masterDataObject,
    source_l2: sourceL2,
    key_fields: cleanText(item.key_fields || item.keyFields) || null,
    responsible_dept: cleanText(item.responsible_dept || item.responsibleDept) || null,
    system_boundary: cleanText(item.system_boundary || item.systemBoundary) || null,
    governance_requirement: cleanText(item.governance_requirement || item.governanceRequirement) || null,
    source_file: sourceFile
  };
}

function normalizeEvidenceRef(ref) {
  const refType = normalizeRefType(ref.ref_type || ref.refType || ref.type);
  const sourceFile = cleanText(ref.source_file || ref.sourceFile);
  if (!refType || !sourceFile) return null;
  const deptName = cleanText(ref.dept_name || ref.deptName || ref.dept) || null;
  const l3Name = cleanText(ref.l3_name || ref.l3Name) || null;
  const a1Code = cleanText(ref.a1_code || ref.a1Code) || null;
  const masterDataObject = cleanText(ref.master_data_object || ref.masterDataObject) || null;
  const evidenceType = cleanText(ref.evidence_type || ref.evidenceType) || null;
  const citation = cleanText(ref.citation || ref.ref) || null;
  return {
    ref_key: cleanText(ref.ref_key || ref.refKey) || stableKey('evidence', [refType, deptName, l3Name, a1Code, masterDataObject, sourceFile, citation, evidenceType]),
    ref_type: refType,
    dept_name: deptName,
    l3_name: l3Name,
    a1_code: a1Code,
    master_data_object: masterDataObject,
    evidence_type: evidenceType,
    source_file: sourceFile,
    citation,
    note: cleanText(ref.note || ref.description) || null
  };
}

function summarizeRisks(risks) {
  if (!risks.length) return {};
  return risks.reduce((summary, risk) => {
    const key = `${risk.risk}Risk`;
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function makeStats(stats = {}) {
  return {
    ...stats,
    mappings: stats.mappings || 0,
    a1: stats.a1 || 0,
    departmentsWithData: stats.departmentsWithData || 0,
    departmentsEmpty: stats.departmentsEmpty || 0
  };
}

function emptyQualitySummary() {
  return { BLOCK: 0, WARN: 0, INFO: 0 };
}

function emptySourceFileSummary() {
  return { total: 0, byStatus: { '纳入': 0, '排除': 0, '待复核': 0 }, byAssetType: {} };
}

function emptyMdmRequirementSummary() {
  return { total: 0, byDept: {} };
}

function emptyEvidenceSummary() {
  return { total: 0, byType: { L3: 0, A1: 0, MDM: 0 } };
}

function normalizeLimit(value, fallback = 500, max = 1000) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.trunc(limit), max);
}

function activeSnapshotSql() {
  return `
    SELECT s.*
    FROM process_governance_snapshots s
    WHERE s.status='active'
    ORDER BY EXISTS (
      SELECT 1
      FROM process_a1_items a
      WHERE a.snapshot_id=s.id
      LIMIT 1
    ) DESC,
    s.imported_at DESC,
    s.id DESC
    LIMIT 1`;
}

function sourceFileSummaryFromRows(rows) {
  const summary = emptySourceFileSummary();
  rows.forEach(row => {
    const count = Number(row.count || 0);
    summary.total += count;
    if (row.process_status) summary.byStatus[row.process_status] = (summary.byStatus[row.process_status] || 0) + count;
    if (row.asset_type) summary.byAssetType[row.asset_type] = (summary.byAssetType[row.asset_type] || 0) + count;
  });
  return summary;
}

function mdmRequirementSummaryFromRows(rows) {
  const summary = emptyMdmRequirementSummary();
  rows.forEach(row => {
    const count = Number(row.count || 0);
    summary.total += count;
    if (row.dept_name) summary.byDept[row.dept_name] = (summary.byDept[row.dept_name] || 0) + count;
  });
  return summary;
}

function evidenceSummaryFromRows(rows) {
  const summary = emptyEvidenceSummary();
  rows.forEach(row => {
    const count = Number(row.count || 0);
    summary.total += count;
    if (row.ref_type) summary.byType[row.ref_type] = (summary.byType[row.ref_type] || 0) + count;
  });
  return summary;
}

function qualityCaseSummary(items) {
  const bySeverity = { BLOCK: 0, WARN: 0 };
  const byStatus = {
    open: 0,
    assigned: 0,
    rectifying: 0,
    submitted: 0,
    source_resolved: 0,
    closed: 0,
    reopened: 0
  };
  items.forEach(item => {
    if (Object.prototype.hasOwnProperty.call(bySeverity, item.severity)) bySeverity[item.severity] += 1;
    if (Object.prototype.hasOwnProperty.call(byStatus, item.status)) byStatus[item.status] += 1;
  });
  return { total: items.length, bySeverity, byStatus };
}

function mappingRecordSummaryFromRows(rows) {
  const summary = {
    total: 0,
    byType: { l3: 0, a1: 0 },
    byStatus: { active: 0, source_missing: 0, published: 0, archived: 0 }
  };
  rows.forEach(row => {
    const count = Number(row.count || 0);
    if (Object.prototype.hasOwnProperty.call(summary.byType, row.record_type)) summary.byType[row.record_type] += count;
    if (Object.prototype.hasOwnProperty.call(summary.byStatus, row.status)) summary.byStatus[row.status] += count;
    summary.total += count;
  });
  return summary;
}

function mappingTodoSummaryFromRows(rows) {
  const summary = {
    total: 0,
    byType: { dept_confirm: 0, verification: 0, adjustment: 0, cross_dept: 0, evidence: 0 },
    byStatus: {
      open: 0,
      assigned: 0,
      rectifying: 0,
      submitted: 0,
      source_resolved: 0,
      closed: 0,
      reopened: 0,
      accepted: 0
    }
  };
  rows.forEach(row => {
    const count = Number(row.count || 0);
    if (Object.prototype.hasOwnProperty.call(summary.byType, row.todo_type)) summary.byType[row.todo_type] += count;
    if (Object.prototype.hasOwnProperty.call(summary.byStatus, row.status)) summary.byStatus[row.status] += count;
    summary.total += count;
  });
  return summary;
}

function eventRow(row) {
  return {
    ...row,
    payload: parseJsonObject(row.payload_json, null)
  };
}

function personIdFromPayload(payload = {}, fallback = null) {
  return payload.actor_person_id || payload.actorPersonId || payload.person_id || payload.personId || fallback || null;
}

function ownerPersonIdFromPayload(payload = {}) {
  return payload.owner_person_id || payload.ownerPersonId || payload.owner_user_id || payload.ownerUserId || null;
}

function makeProcessGovernanceMysqlRepository(pool) {
  return {
    async initSchema() {
      for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
        await pool.execute(statement);
      }
    },

    async replaceActiveReadModel(bundle = {}) {
      await pool.execute("UPDATE process_governance_snapshots SET status='archived' WHERE status='active'");
      const stats = { ...(bundle.stats || {}) };
      if (!stats.crossDept && bundle.crossDept && bundle.crossDept.stats) {
        stats.crossDept = bundle.crossDept.stats;
      }

      const [snapshotResult] = await pool.execute(
        `INSERT INTO process_governance_snapshots
          (source_json_path, source_hash, generated_at, imported_by, stats_json, status, note)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [
          bundle.source_json_path || bundle.sourceJsonPath || '',
          bundle.source_hash || bundle.sourceHash || '',
          bundle.generated_at || bundle.generatedAt || null,
          bundle.imported_by || bundle.importedBy || null,
          JSON.stringify(stats),
          bundle.note || null
        ]
      );
      const snapshotId = snapshotResult.insertId;

      const normalizedNodes = asArray(bundle.nodes).map(normalizeNode).filter(Boolean);
      const nodeTypes = new Map(normalizedNodes.map(node => [node.node_key, node.node_type]));
      for (const node of normalizedNodes) {
        await pool.execute(
          `INSERT INTO process_governance_nodes
            (snapshot_id, node_key, node_type, name, domain_name, dept_name, parent_key, source_file, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            snapshotId,
            node.node_key,
            node.node_type,
            node.name,
            node.domain_name,
            node.dept_name,
            node.parent_key,
            node.source_file,
            node.sort_order
          ]
        );
      }

      const normalizedEdges = asArray(bundle.links).map(link => normalizeEdge(link, nodeTypes)).filter(Boolean);
      for (const edge of normalizedEdges) {
        await pool.execute(
          `INSERT INTO process_governance_edges
            (snapshot_id, source_key, target_key, edge_type, value, source_file)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [snapshotId, edge.source_key, edge.target_key, edge.edge_type, edge.value, edge.source_file]
        );
      }

      for (const item of asArray(bundle.a1Items || bundle.a1_items).map(normalizeA1Item).filter(row => row.behavior)) {
        await pool.execute(
          `INSERT INTO process_a1_items
            (snapshot_id, a1_code, dept_name, l3_name, behavior, execution_role, approval_type,
             input_source_dept, output_target_dept, suggested_systems, verification_note, source_file)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            snapshotId,
            item.a1_code,
            item.dept_name,
            item.l3_name,
            item.behavior,
            item.execution_role,
            item.approval_type,
            item.input_source_dept,
            item.output_target_dept,
            item.suggested_systems,
            item.verification_note,
            item.source_file
          ]
        );
      }

      for (const file of asArray(bundle.sourceFiles || bundle.source_files).map(normalizeSourceFile).filter(Boolean)) {
        await pool.execute(
          `INSERT INTO process_source_files
            (snapshot_id, file_key, file_path, dept_name, asset_type, file_no, revision,
             size_bytes, mtime, sha256, process_status, process_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
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
          ]
        );
      }

      for (const item of asArray(bundle.mdmRequirements || bundle.mdm_requirements).map(normalizeMdmRequirement).filter(Boolean)) {
        await pool.execute(
          `INSERT INTO process_mdm_requirement_items
            (snapshot_id, requirement_key, dept_name, master_data_object, source_l2, key_fields,
             responsible_dept, system_boundary, governance_requirement, source_file)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
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
          ]
        );
      }

      for (const ref of asArray(bundle.evidenceRefs || bundle.evidence_refs).map(normalizeEvidenceRef).filter(Boolean)) {
        await pool.execute(
          `INSERT INTO process_evidence_refs
            (snapshot_id, ref_key, ref_type, dept_name, l3_name, a1_code, master_data_object,
             evidence_type, source_file, citation, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
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
          ]
        );
      }

      const crossDept = bundle.crossDept || {};
      for (const risk of asArray(crossDept.risks || bundle.risks).map(normalizeRisk)) {
        await pool.execute(
          `INSERT INTO process_cross_dept_interactions
            (snapshot_id, source_dept, target_dept, a1_code, refs, risk_level, confirm_status, description, source_report)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            snapshotId,
            risk.source_dept,
            risk.target_dept,
            risk.a1_code,
            risk.refs,
            risk.risk_level,
            risk.confirm_status,
            risk.description,
            risk.source_report
          ]
        );
      }

      for (const chain of asArray(crossDept.interactionChains || bundle.interactionChains).map(normalizeChain).filter(item => item.name)) {
        await pool.execute(
          `INSERT INTO process_interaction_chains
            (snapshot_id, name, status, breaks_json, source_report)
           VALUES (?, ?, ?, ?, ?)`,
          [snapshotId, chain.name, chain.status, chain.breaks_json, chain.source_report]
        );
      }

      return { snapshot_id: snapshotId };
    },

    async listSnapshots() {
      const [rows] = await pool.execute(
        `SELECT id, source_json_path, source_hash, generated_at, imported_at, status, note
         FROM process_governance_snapshots
         ORDER BY imported_at DESC, id DESC`
      );
      return rows;
    },

    async getCurrentSnapshot() {
      const [snapshots] = await pool.execute(activeSnapshotSql());
      const snapshot = snapshots[0];
      if (!snapshot) return {};

      const qualitySummary = emptyQualitySummary();
      const [qualityRows] = await pool.execute(
        `SELECT severity, COUNT(*) AS count
         FROM process_governance_quality_findings
         WHERE snapshot_id=?
         GROUP BY severity`,
        [snapshot.id]
      );
      for (const row of qualityRows) {
        if (Object.prototype.hasOwnProperty.call(qualitySummary, row.severity)) {
          qualitySummary[row.severity] = Number(row.count) || 0;
        }
      }

      return {
        id: snapshot.id,
        source_json_path: snapshot.source_json_path,
        source_hash: snapshot.source_hash,
        generated_at: snapshot.generated_at,
        imported_at: snapshot.imported_at,
        status: snapshot.status,
        note: snapshot.note,
        stats: makeStats(parseJsonObject(snapshot.stats_json, {})),
        qualitySummary
      };
    },

    async getA1Items(filters = {}) {
      const [snapshots] = await pool.execute(activeSnapshotSql());
      const snapshot = snapshots[0];
      if (!snapshot) return [];

      const params = [snapshot.id];
      let sql = `
        SELECT *
        FROM process_a1_items
        WHERE snapshot_id=?
      `;

      if (filters.dept) {
        sql += ' AND dept_name=?';
        params.push(String(filters.dept));
      }
      if (filters.l3) {
        sql += ' AND l3_name=?';
        params.push(String(filters.l3));
      }
      if (filters.system) {
        sql += ' AND suggested_systems LIKE ?';
        params.push(`%"${String(filters.system)}"%`);
      }

      sql += ' ORDER BY dept_name, l3_name, a1_code, id';
      const [rows] = await pool.execute(sql, params);
      return rows.map(row => ({
        ...row,
        suggested_systems: parseJsonArray(row.suggested_systems)
      }));
    },

    async getSourceFiles(filters = {}, limit = 20) {
      const safeLimit = normalizeLimit(limit, 20, 200);
      const [snapshots] = await pool.execute(activeSnapshotSql());
      const snapshot = snapshots[0];
      if (!snapshot) return { summary: { ...emptySourceFileSummary(), returned: 0, limit: safeLimit }, items: [] };

      const params = [snapshot.id];
      let whereSql = 'WHERE snapshot_id=?';
      if (filters.dept) {
        whereSql += ' AND dept_name=?';
        params.push(String(filters.dept));
      }
      if (filters.status && ['纳入', '排除', '待复核'].includes(String(filters.status))) {
        whereSql += ' AND process_status=?';
        params.push(String(filters.status));
      }
      if (filters.assetType) {
        whereSql += ' AND asset_type=?';
        params.push(String(filters.assetType));
      }

      const [summaryRows] = await pool.execute(
        `SELECT process_status, asset_type, COUNT(*) AS count
         FROM process_source_files
         ${whereSql}
         GROUP BY process_status, asset_type`,
        params
      );
      const [items] = await pool.execute(
        `SELECT file_path, dept_name, asset_type, file_no, revision, size_bytes, mtime, sha256, process_status, process_reason
         FROM process_source_files
         ${whereSql}
         ORDER BY dept_name, process_status, asset_type, file_path
         LIMIT ${safeLimit}`,
        params
      );
      return { summary: { ...sourceFileSummaryFromRows(summaryRows), returned: items.length, limit: safeLimit }, items };
    },

    async getMdmRequirements(filters = {}, limit = 500) {
      const safeLimit = normalizeLimit(limit);
      const [snapshots] = await pool.execute(activeSnapshotSql());
      const snapshot = snapshots[0];
      if (!snapshot) return { summary: { ...emptyMdmRequirementSummary(), returned: 0, limit: safeLimit }, items: [] };

      const params = [snapshot.id];
      let whereSql = 'WHERE snapshot_id=?';
      if (filters.dept) {
        whereSql += ' AND dept_name=?';
        params.push(String(filters.dept));
      }
      if (filters.object) {
        whereSql += ' AND master_data_object=?';
        params.push(String(filters.object));
      }

      const [summaryRows] = await pool.execute(
        `SELECT dept_name, COUNT(*) AS count
         FROM process_mdm_requirement_items
         ${whereSql}
         GROUP BY dept_name`,
        params
      );
      const [items] = await pool.execute(
        `SELECT dept_name, master_data_object, source_l2, key_fields, responsible_dept,
                system_boundary, governance_requirement, source_file
         FROM process_mdm_requirement_items
         ${whereSql}
         ORDER BY dept_name, source_l2, master_data_object, id
         LIMIT ${safeLimit}`,
        params
      );
      return { summary: { ...mdmRequirementSummaryFromRows(summaryRows), returned: items.length, limit: safeLimit }, items };
    },

    async getEvidenceRefs(filters = {}, limit = 500) {
      const safeLimit = normalizeLimit(limit);
      const [snapshots] = await pool.execute(activeSnapshotSql());
      const snapshot = snapshots[0];
      if (!snapshot) return { summary: { ...emptyEvidenceSummary(), returned: 0, limit: safeLimit }, items: [] };

      const params = [snapshot.id];
      let whereSql = 'WHERE snapshot_id=?';
      if (filters.dept) {
        whereSql += ' AND dept_name=?';
        params.push(String(filters.dept));
      }
      if (filters.l3) {
        whereSql += ' AND l3_name=?';
        params.push(String(filters.l3));
      }
      if (filters.a1) {
        if (filters.l3) {
          whereSql += " AND (a1_code=? OR (ref_type='L3' AND (a1_code IS NULL OR a1_code='')))";
          params.push(String(filters.a1));
        } else {
          whereSql += ' AND a1_code=?';
          params.push(String(filters.a1));
        }
      }
      if (filters.object) {
        whereSql += ' AND master_data_object=?';
        params.push(String(filters.object));
      }
      const refType = String(filters.type || '').toUpperCase();
      if (['L3', 'A1', 'MDM'].includes(refType)) {
        whereSql += ' AND ref_type=?';
        params.push(refType);
      }

      const [summaryRows] = await pool.execute(
        `SELECT ref_type, COUNT(*) AS count
         FROM process_evidence_refs
         ${whereSql}
         GROUP BY ref_type`,
        params
      );
      const [items] = await pool.execute(
        `SELECT ref_type, dept_name, l3_name, a1_code, master_data_object,
                evidence_type, source_file, citation, note
         FROM process_evidence_refs
         ${whereSql}
         ORDER BY CASE ref_type WHEN 'L3' THEN 0 WHEN 'A1' THEN 1 ELSE 2 END,
                  dept_name, l3_name, a1_code, master_data_object, id
         LIMIT ${safeLimit}`,
        params
      );
      return { summary: { ...evidenceSummaryFromRows(summaryRows), returned: items.length, limit: safeLimit }, items };
    },

    async getInteractionChains() {
      const [snapshots] = await pool.execute(activeSnapshotSql());
      const snapshot = snapshots[0];
      if (!snapshot) return [];

      const [rows] = await pool.execute(
        `SELECT *
         FROM process_interaction_chains
         WHERE snapshot_id=?
         ORDER BY id`,
        [snapshot.id]
      );
      return rows.map(row => ({
        ...row,
        breaks: parseJsonArray(row.breaks_json)
      }));
    },

    async getCrossDeptInteractions(filters = {}) {
      const [snapshots] = await pool.execute(activeSnapshotSql());
      const snapshot = snapshots[0];
      if (!snapshot) return [];

      const params = [snapshot.id];
      let sql = `
        SELECT *
        FROM process_cross_dept_interactions
        WHERE snapshot_id=?
      `;
      if (filters.risk) {
        sql += ' AND risk_level=?';
        params.push(String(filters.risk));
      }
      if (filters.status) {
        sql += ' AND confirm_status=?';
        params.push(String(filters.status));
      }
      if (filters.dept) {
        sql += ' AND (source_dept=? OR target_dept=?)';
        params.push(String(filters.dept), String(filters.dept));
      }
      sql += " ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id";
      const [rows] = await pool.execute(sql, params);
      return rows;
    },

    async getQualityFindings(filters = {}) {
      const [snapshots] = await pool.execute(activeSnapshotSql());
      const snapshot = snapshots[0];
      if (!snapshot) return { summary: emptyQualitySummary(), items: [] };

      const summary = emptyQualitySummary();
      const [summaryRows] = await pool.execute(
        `SELECT severity, COUNT(*) AS count
         FROM process_governance_quality_findings
         WHERE snapshot_id=?
         GROUP BY severity`,
        [snapshot.id]
      );
      summaryRows.forEach(row => {
        if (Object.prototype.hasOwnProperty.call(summary, row.severity)) summary[row.severity] = Number(row.count) || 0;
      });

      const params = [snapshot.id];
      let sql = `
        SELECT id, severity, area, source_file, source_line, message, suggestion, dept_name, imported_at
        FROM process_governance_quality_findings
        WHERE snapshot_id=?
      `;
      if (['BLOCK', 'WARN', 'INFO'].includes(String(filters.severity || '').toUpperCase())) {
        sql += ' AND severity=?';
        params.push(String(filters.severity).toUpperCase());
      }
      if (filters.area) {
        sql += ' AND area=?';
        params.push(String(filters.area));
      }
      if (filters.dept) {
        sql += ' AND dept_name=?';
        params.push(String(filters.dept));
      }
      sql += `
        ORDER BY CASE severity WHEN 'BLOCK' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END,
                 area, source_file, COALESCE(source_line, 0), id
      `;
      const [items] = await pool.execute(sql, params);
      return { summary, items };
    },

    async getQualityCases(filters = {}) {
      const params = [];
      let whereSql = 'WHERE 1=1';
      const severity = String(filters.severity || '').toUpperCase();
      if (['BLOCK', 'WARN'].includes(severity)) {
        whereSql += ' AND severity=?';
        params.push(severity);
      }
      if (filters.status) {
        whereSql += ' AND status=?';
        params.push(String(filters.status));
      }
      if (filters.area) {
        whereSql += ' AND area=?';
        params.push(String(filters.area));
      }
      if (filters.dept) {
        whereSql += ' AND dept_name=?';
        params.push(String(filters.dept));
      }
      if (filters.owner === 'me') {
        whereSql += ' AND COALESCE(owner_person_id, owner_user_id)=?';
        params.push(filters.personId || filters.userId || 0);
      } else if (filters.owner) {
        whereSql += ' AND COALESCE(owner_person_id, owner_user_id)=?';
        params.push(Number(filters.owner));
      }
      if (filters.snapshot === 'active') {
        const [snapshots] = await pool.execute(activeSnapshotSql());
        if (snapshots[0]) {
          whereSql += ' AND latest_snapshot_id=?';
          params.push(snapshots[0].id);
        }
      }
      if (!filters.canViewAll) {
        whereSql += ` AND (
          COALESCE(owner_person_id, owner_user_id)=?
          OR owner_dept_id=?
          OR dept_name=?
          OR dept_name IS NULL
        )`;
        params.push(filters.personId || filters.userId || 0, filters.departmentId || -1, filters.departmentName || '__none__');
      }

      const [items] = await pool.execute(
        `SELECT *
         FROM process_governance_quality_cases
         ${whereSql}
         ORDER BY CASE status
                    WHEN 'open' THEN 0
                    WHEN 'reopened' THEN 1
                    WHEN 'assigned' THEN 2
                    WHEN 'rectifying' THEN 3
                    WHEN 'submitted' THEN 4
                    WHEN 'source_resolved' THEN 5
                    WHEN 'closed' THEN 6
                    ELSE 7
                  END,
                  CASE severity WHEN 'BLOCK' THEN 0 ELSE 1 END,
                  dept_name IS NULL,
                  dept_name,
                  updated_at DESC,
                  id`,
        params
      );
      return { summary: qualityCaseSummary(items), items };
    },

    async getQualityCase(caseId) {
      const [rows] = await pool.execute(
        `SELECT *
         FROM process_governance_quality_cases
         WHERE id=?
         LIMIT 1`,
        [caseId]
      );
      return rows[0] || null;
    },

    async getQualityCaseEvents(caseId) {
      const [rows] = await pool.execute(
        `SELECT *
         FROM process_governance_quality_case_events
         WHERE case_id=?
         ORDER BY id`,
        [caseId]
      );
      return rows.map(eventRow);
    },

    async addQualityCaseEvent(caseId, eventType, actorUserId, note, payload) {
      const actorPersonId = personIdFromPayload(payload || {}, actorUserId);
      await pool.execute(
        `INSERT INTO process_governance_quality_case_events
          (case_id, event_type, actor_user_id, actor_person_id, note, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [caseId, eventType, actorUserId || null, actorPersonId, note || null, payload ? JSON.stringify(payload) : null]
      );
    },

    async qualityCaseWithEvents(caseId) {
      return { case: await this.getQualityCase(caseId), events: await this.getQualityCaseEvents(caseId) };
    },

    async assignQualityCase(caseId, payload = {}) {
      const ownerPersonId = ownerPersonIdFromPayload(payload);
      await pool.execute(
        `UPDATE process_governance_quality_cases
         SET owner_user_id=COALESCE(?, owner_user_id),
             owner_person_id=COALESCE(?, owner_person_id),
             owner_dept_id=COALESCE(?, owner_dept_id),
             priority=?,
             due_date=?,
             status='assigned',
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [payload.owner_user_id || null, ownerPersonId, payload.owner_dept_id || null, payload.priority || 'medium', payload.due_date || null, caseId]
      );
      await this.addQualityCaseEvent(caseId, 'assigned', payload.actor_user_id, payload.note || '已分派治理问题单', {
        owner_user_id: payload.owner_user_id || null,
        owner_person_id: ownerPersonId,
        owner_dept_id: payload.owner_dept_id || null,
        priority: payload.priority || 'medium',
        due_date: payload.due_date || null,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.qualityCaseWithEvents(caseId);
    },

    async updateQualityCaseStatus(caseId, payload = {}) {
      await pool.execute(
        `UPDATE process_governance_quality_cases
         SET status=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [payload.status, caseId]
      );
      await this.addQualityCaseEvent(caseId, 'status_changed', payload.actor_user_id, payload.note || null, {
        from_status: payload.from_status,
        to_status: payload.status,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.qualityCaseWithEvents(caseId);
    },

    async addQualityCaseComment(caseId, payload = {}) {
      await this.addQualityCaseEvent(caseId, 'commented', payload.actor_user_id, payload.note, {
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      await pool.execute('UPDATE process_governance_quality_cases SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [caseId]);
      return this.qualityCaseWithEvents(caseId);
    },

    async submitQualityCase(caseId, payload = {}) {
      await pool.execute(
        `UPDATE process_governance_quality_cases
         SET status='submitted', updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [caseId]
      );
      await this.addQualityCaseEvent(caseId, 'submitted', payload.actor_user_id, payload.note || '已提交整改说明，等待重新质检', {
        from_status: payload.from_status,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.qualityCaseWithEvents(caseId);
    },

    async closeQualityCase(caseId, payload = {}) {
      await pool.execute(
        `UPDATE process_governance_quality_cases
         SET status='closed',
             closed_by=?,
             closed_by_person_id=?,
             closed_at=CURRENT_TIMESTAMP,
             closure_note=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [payload.actor_user_id || null, personIdFromPayload(payload, payload.actor_user_id), payload.note, caseId]
      );
      await this.addQualityCaseEvent(caseId, 'closed', payload.actor_user_id, payload.note, {
        from_status: payload.from_status,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.qualityCaseWithEvents(caseId);
    },

    async reopenQualityCase(caseId, payload = {}) {
      await pool.execute(
        `UPDATE process_governance_quality_cases
         SET status='reopened',
             reopened_count=reopened_count + CASE WHEN status='reopened' THEN 0 ELSE 1 END,
             closed_by=NULL,
             closed_at=NULL,
             closure_note=NULL,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [caseId]
      );
      await this.addQualityCaseEvent(caseId, 'reopened', payload.actor_user_id, payload.note || '手动重开治理问题单', {
        from_status: payload.from_status,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.qualityCaseWithEvents(caseId);
    },

    async getMappingWorkspace(filters = {}, limit = 500) {
      const safeLimit = normalizeLimit(limit);
      const params = [];
      let whereSql = 'WHERE 1=1';
      if (['l3', 'a1'].includes(String(filters.type || ''))) {
        whereSql += ' AND r.record_type=?';
        params.push(String(filters.type));
      }
      if (['active', 'source_missing', 'published', 'archived'].includes(String(filters.status || ''))) {
        whereSql += ' AND r.status=?';
        params.push(String(filters.status));
      }
      if (filters.dept) {
        whereSql += ' AND r.dept_name=?';
        params.push(String(filters.dept));
      }
      if (!filters.canViewAll) {
        whereSql += ' AND (r.dept_name=? OR r.input_source_dept=? OR r.output_target_dept=?)';
        params.push(filters.departmentName || '__none__', filters.departmentName || '__none__', filters.departmentName || '__none__');
      }

      const [summaryRows] = await pool.execute(
        `SELECT r.record_type, r.status, COUNT(*) AS count
         FROM process_mapping_records r
         ${whereSql}
         GROUP BY r.record_type, r.status`,
        params
      );
      const [items] = await pool.execute(
        `SELECT r.*, parent.l3_name AS parent_l3_name
         FROM process_mapping_records r
         LEFT JOIN process_mapping_records parent ON parent.id = r.parent_record_id
         ${whereSql}
         ORDER BY CASE r.record_type WHEN 'l3' THEN 0 ELSE 1 END,
                  r.dept_name, r.l2_name, r.l3_name, r.a1_code, r.id
         LIMIT ${safeLimit}`,
        params
      );
      return {
        summary: { ...mappingRecordSummaryFromRows(summaryRows), returned: items.length, limit: safeLimit },
        items: items.map(item => ({ ...item, suggested_systems: parseJsonArray(item.suggested_systems) }))
      };
    },

    async getMappingTodos(filters = {}, limit = 500) {
      const safeLimit = normalizeLimit(limit);
      const params = [];
      let whereSql = 'WHERE 1=1';
      const type = String(filters.type || '');
      if (['dept_confirm', 'verification', 'adjustment', 'cross_dept', 'evidence'].includes(type)) {
        whereSql += ' AND t.todo_type=?';
        params.push(type);
      }
      const status = String(filters.status || '');
      if (['open', 'assigned', 'rectifying', 'submitted', 'source_resolved', 'closed', 'reopened', 'accepted'].includes(status)) {
        whereSql += ' AND t.status=?';
        params.push(status);
      }
      if (filters.dept) {
        whereSql += ' AND (t.dept_name=? OR t.target_dept_name=?)';
        params.push(String(filters.dept), String(filters.dept));
      }
      if (filters.owner === 'me') {
        whereSql += ' AND COALESCE(t.owner_person_id, t.owner_user_id)=?';
        params.push(filters.personId || filters.userId || 0);
      } else if (filters.owner) {
        whereSql += ' AND COALESCE(t.owner_person_id, t.owner_user_id)=?';
        params.push(Number(filters.owner));
      }
      if (!filters.canViewAll) {
        whereSql += ` AND (
          COALESCE(t.owner_person_id, t.owner_user_id)=?
          OR t.owner_dept_id=?
          OR t.dept_name=?
          OR t.target_dept_name=?
          OR t.dept_name IS NULL
        )`;
        params.push(filters.personId || filters.userId || 0, filters.departmentId || -1, filters.departmentName || '__none__', filters.departmentName || '__none__');
      }

      const [summaryRows] = await pool.execute(
        `SELECT t.todo_type, t.status, COUNT(*) AS count
         FROM process_mapping_todos t
         ${whereSql}
         GROUP BY t.todo_type, t.status`,
        params
      );
      const [items] = await pool.execute(
        `SELECT t.*, r.record_type, r.behavior AS mapping_behavior
         FROM process_mapping_todos t
         LEFT JOIN process_mapping_records r ON r.id = t.mapping_record_id
         ${whereSql}
         ORDER BY CASE t.status
                    WHEN 'open' THEN 0
                    WHEN 'reopened' THEN 1
                    WHEN 'assigned' THEN 2
                    WHEN 'rectifying' THEN 3
                    WHEN 'submitted' THEN 4
                    WHEN 'source_resolved' THEN 5
                    WHEN 'accepted' THEN 6
                    WHEN 'closed' THEN 7
                    ELSE 8
                  END,
                  CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                  t.due_date IS NULL, t.due_date, t.dept_name, t.id
         LIMIT ${safeLimit}`,
        params
      );
      return { summary: { ...mappingTodoSummaryFromRows(summaryRows), returned: items.length, limit: safeLimit }, items };
    },

    async getMappingTodo(todoId) {
      const [rows] = await pool.execute(
        `SELECT t.*, r.record_type, r.behavior AS mapping_behavior
         FROM process_mapping_todos t
         LEFT JOIN process_mapping_records r ON r.id = t.mapping_record_id
         WHERE t.id=?
         LIMIT 1`,
        [todoId]
      );
      return rows[0] || null;
    },

    async getMappingTodoEvents(todoId) {
      const [rows] = await pool.execute(
        `SELECT *
         FROM process_mapping_todo_events
         WHERE todo_id=?
         ORDER BY id`,
        [todoId]
      );
      return rows.map(eventRow);
    },

    async addMappingTodoEvent(todoId, eventType, actorUserId, note, payload) {
      const actorPersonId = personIdFromPayload(payload || {}, actorUserId);
      await pool.execute(
        `INSERT INTO process_mapping_todo_events
          (todo_id, event_type, actor_user_id, actor_person_id, note, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [todoId, eventType, actorUserId || null, actorPersonId, note || null, payload ? JSON.stringify(payload) : null]
      );
    },

    async mappingTodoWithEvents(todoId) {
      return { todo: await this.getMappingTodo(todoId), events: await this.getMappingTodoEvents(todoId) };
    },

    async assignMappingTodo(todoId, payload = {}) {
      const ownerPersonId = ownerPersonIdFromPayload(payload);
      await pool.execute(
        `UPDATE process_mapping_todos
         SET owner_user_id=COALESCE(?, owner_user_id),
             owner_person_id=COALESCE(?, owner_person_id),
             owner_dept_id=COALESCE(?, owner_dept_id),
             priority=?,
             due_date=?,
             status='assigned',
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [payload.owner_user_id || null, ownerPersonId, payload.owner_dept_id || null, payload.priority || 'medium', payload.due_date || null, todoId]
      );
      await this.addMappingTodoEvent(todoId, 'assigned', payload.actor_user_id, payload.note || '已分派流程映射待办', {
        owner_user_id: payload.owner_user_id || null,
        owner_person_id: ownerPersonId,
        owner_dept_id: payload.owner_dept_id || null,
        priority: payload.priority || 'medium',
        due_date: payload.due_date || null,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.mappingTodoWithEvents(todoId);
    },

    async updateMappingTodoStatus(todoId, payload = {}) {
      await pool.execute(
        `UPDATE process_mapping_todos
         SET status=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [payload.status, todoId]
      );
      await this.addMappingTodoEvent(todoId, 'status_changed', payload.actor_user_id, payload.note || null, {
        from_status: payload.from_status,
        to_status: payload.status,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.mappingTodoWithEvents(todoId);
    },

    async addMappingTodoComment(todoId, payload = {}) {
      await this.addMappingTodoEvent(todoId, 'commented', payload.actor_user_id, payload.note, {
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      await pool.execute('UPDATE process_mapping_todos SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [todoId]);
      return this.mappingTodoWithEvents(todoId);
    },

    async submitMappingTodo(todoId, payload = {}) {
      await pool.execute(
        `UPDATE process_mapping_todos
         SET status='submitted', updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [todoId]
      );
      await this.addMappingTodoEvent(todoId, 'submitted', payload.actor_user_id, payload.note || '已提交流程映射处理说明', {
        from_status: payload.from_status,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.mappingTodoWithEvents(todoId);
    },

    async closeMappingTodo(todoId, payload = {}) {
      await pool.execute(
        `UPDATE process_mapping_todos
         SET status='closed',
             closed_by=?,
             closed_by_person_id=?,
             closed_at=CURRENT_TIMESTAMP,
             closure_note=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [payload.actor_user_id || null, personIdFromPayload(payload, payload.actor_user_id), payload.note, todoId]
      );
      await this.addMappingTodoEvent(todoId, 'closed', payload.actor_user_id, payload.note, {
        from_status: payload.from_status,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.mappingTodoWithEvents(todoId);
    },

    async reopenMappingTodo(todoId, payload = {}) {
      await pool.execute(
        `UPDATE process_mapping_todos
         SET status='reopened',
             reopened_count=reopened_count + CASE WHEN status='reopened' THEN 0 ELSE 1 END,
             closed_by=NULL,
             closed_at=NULL,
             closure_note=NULL,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [todoId]
      );
      await this.addMappingTodoEvent(todoId, 'reopened', payload.actor_user_id, payload.note || '手动重开流程映射待办', {
        from_status: payload.from_status,
        actor_person_id: personIdFromPayload(payload, payload.actor_user_id)
      });
      return this.mappingTodoWithEvents(todoId);
    },

    async getActiveSankey() {
      const [snapshots] = await pool.execute(activeSnapshotSql());
      const snapshot = snapshots[0];
      if (!snapshot) return emptySankey();

      const [nodeRows] = await pool.execute(
        `SELECT node_key AS name, name AS label, node_type, domain_name, dept_name, parent_key, source_file
         FROM process_governance_nodes
         WHERE snapshot_id=?
         ORDER BY sort_order, id`,
        [snapshot.id]
      );
      const nodes = nodeRows.map(node => ({
        name: node.name,
        label: node.label,
        node_type: node.node_type,
        domain_name: node.domain_name || null,
        dept_name: node.dept_name || null,
        parent_key: node.parent_key || null,
        source_file: node.source_file || null
      }));

      const [edgeRows] = await pool.execute(
        `SELECT source_key AS source, target_key AS target, value
         FROM process_governance_edges
         WHERE snapshot_id=?
         ORDER BY id`,
        [snapshot.id]
      );
      const links = edgeRows.map(link => ({
        source: link.source,
        target: link.target,
        value: Number.isFinite(Number(link.value)) ? Number(link.value) : 1
      }));

      const systems = nodes
        .filter(node => node.node_type === 'system')
        .map(node => node.name)
        .sort((left, right) => left.localeCompare(right, 'zh-CN'));

      const [riskRows] = await pool.execute(
        `SELECT source_dept AS source, target_dept AS target, a1_code AS a1, refs,
                risk_level AS risk, confirm_status AS status, description AS \`desc\`, source_report
         FROM process_cross_dept_interactions
         WHERE snapshot_id=?
         ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id`,
        [snapshot.id]
      );
      const risks = riskRows.map(({ source_report, ...risk }) => risk);

      const [chainRows] = await pool.execute(
        `SELECT name, status, breaks_json, source_report
         FROM process_interaction_chains
         WHERE snapshot_id=?
         ORDER BY id`,
        [snapshot.id]
      );
      const interactionChains = chainRows.map(row => ({
        name: row.name,
        status: row.status,
        breaks: parseJsonArray(row.breaks_json),
        source_report: row.source_report || null
      }));

      const stats = makeStats(parseJsonObject(snapshot.stats_json, {}));
      return {
        nodes,
        links,
        systems,
        stats,
        crossDept: {
          stats: stats.crossDept || summarizeRisks(riskRows),
          risks,
          interactionChains,
          source: riskRows[0] && riskRows[0].source_report || interactionChains[0] && interactionChains[0].source_report || null
        }
      };
    }
  };
}

module.exports = {
  makeProcessGovernanceMysqlRepository
};
