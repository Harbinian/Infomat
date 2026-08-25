const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { normalizeProcessGovernanceDocument } = require('./processGovernanceV2');

const FORMAL_TABLES = Object.freeze([
  'process_design_documents',
  'process_design_drafts',
  'process_design_versions'
]);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex');
}

function fileDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function splitTopLevel(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const previous = value[index - 1];
    if (quote) {
      if (character === quote && previous !== '\\') quote = '';
      continue;
    }
    if (character === '`' || character === '\'' || character === '"') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function normalizeSql(value) {
  return text(value)
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/current_timestamp\(\)/g, 'current_timestamp')
    .replace(/_utf8mb4(?=')/g, '')
    .replace(/\bindex\b/g, 'key')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .trim();
}

function stripOuterParentheses(value) {
  let result = text(value);
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0;
    let closesAtEnd = true;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === '(') depth += 1;
      else if (result[index] === ')') depth -= 1;
      if (depth === 0 && index < result.length - 1) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd || depth !== 0) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function normalizeExpression(value) {
  const normalized = normalizeSql(value)
    .replace(/^\((case\b.*\bend)\)$/i, '$1')
    .replace(/\(([a-z0-9_]+\s*(?:<>|=|!=)\s*(?:'[^']*'|[a-z0-9_]+))\)/gi, '$1')
    .replace(/\(([a-z0-9_]+\s+is\s+(?:not\s+)?null)\)/gi, '$1')
    .replace(/\(([a-z0-9_]+\s+in\s*\([^)]*\))\)/gi, '$1')
    .trim();
  return stripOuterParentheses(normalized);
}

function createBody(statement) {
  const start = statement.indexOf('(');
  const end = statement.lastIndexOf(')');
  return start >= 0 && end > start ? statement.slice(start + 1, end) : '';
}

function columnComponent(definition) {
  const normalized = normalizeSql(definition);
  const match = normalized.match(/^([a-z0-9_]+)\s+([a-z]+(?:\s*\([^)]*\))?(?:\s+unsigned)?)(.*)$/i);
  if (!match) return null;
  const remainder = match[3];
  const defaultMatch = remainder.match(/\bdefault\s+((?:'[^']*')|(?:"[^"]*")|[^\s,]+)/i);
  const generatedMatch = remainder.match(/generated\s+always\s+as\s*\((.*)\)\s*(virtual|stored)?/i);
  return {
    key: `column:${match[1]}`,
    value: {
      name: match[1],
      type: normalizeSql(match[2]),
      nullable: !/\bnot\s+null\b/i.test(remainder) && !/\bprimary\s+key\b/i.test(remainder),
      default: defaultMatch && !/^null$/i.test(defaultMatch[1])
        ? normalizeSql(defaultMatch[1]).replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')
        : null,
      auto_increment: /\bauto_increment\b/i.test(remainder),
      on_update: /\bon\s+update\s+current_timestamp/i.test(remainder),
      generated: generatedMatch ? normalizeExpression(generatedMatch[1]) : null
    },
    inlinePrimary: /\bprimary\s+key\b/i.test(remainder)
  };
}

function indexComponent(definition) {
  const normalized = normalizeSql(definition);
  const primary = normalized.match(/^primary\s+key\s*\(([^)]*)\)/i);
  if (primary) return { key: 'index:primary', value: { name: 'primary', unique: true, columns: normalizeSql(primary[1]).split(',') } };
  const match = normalized.match(/^(unique\s+)?key\s+([a-z0-9_]+)\s*\(([^)]*)\)/i);
  if (!match) return null;
  return {
    key: `index:${match[2]}`,
    value: { name: match[2], unique: Boolean(match[1]), columns: normalizeSql(match[3]).split(',') }
  };
}

function checkComponent(definition) {
  const normalized = normalizeSql(definition);
  const match = normalized.match(/^(?:constraint\s+[a-z0-9_]+\s+)?check\s*\((.*)\)$/i);
  if (!match) return null;
  const expression = normalizeExpression(match[1]);
  return { key: `check:${digest(expression).slice(0, 16)}`, value: { expression } };
}

function foreignKeyComponent(definition) {
  const normalized = normalizeSql(definition);
  const match = normalized.match(/^constraint\s+([a-z0-9_]+)\s+foreign\s+key\s*\(([^)]*)\)\s+references\s+([a-z0-9_]+)\s*\(([^)]*)\)(.*)$/i);
  if (!match) return null;
  const tail = match[5];
  const deleteMatch = tail.match(/on\s+delete\s+(restrict|cascade|set null|no action)/i);
  const updateMatch = tail.match(/on\s+update\s+(restrict|cascade|set null|no action)/i);
  return {
    key: `foreign_key:${match[1]}`,
    value: {
      name: match[1],
      columns: normalizeSql(match[2]).split(','),
      referenced_table: match[3],
      referenced_columns: normalizeSql(match[4]).split(','),
      on_delete: deleteMatch ? normalizeSql(deleteMatch[1]) : 'restrict',
      on_update: updateMatch ? normalizeSql(updateMatch[1]) : 'restrict'
    }
  };
}

function schemaComponents(statement) {
  const components = new Map();
  for (const definition of splitTopLevel(createBody(statement))) {
    const normalized = normalizeSql(definition);
    const component = /^constraint\b|^foreign\s+key\b/i.test(normalized)
      ? foreignKeyComponent(definition) || checkComponent(definition)
      : /^check\b/i.test(normalized)
        ? checkComponent(definition)
        : /^(?:unique\s+)?(?:key|index)\b|^primary\s+key\b/i.test(normalized)
          ? indexComponent(definition)
          : columnComponent(definition);
    if (!component) continue;
    components.set(component.key, component.value);
    if (component.inlinePrimary) {
      components.set('index:primary', { name: 'primary', unique: true, columns: [component.value.name] });
    }
  }
  return components;
}

function compareCreateStatements(expectedStatement, actualStatement) {
  const expected = schemaComponents(expectedStatement);
  const actual = schemaComponents(actualStatement);
  const keys = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  const differences = [];
  for (const key of keys) {
    const expectedValue = expected.get(key);
    const actualValue = actual.get(key);
    if (!expectedValue) differences.push({ component: key, difference: 'unexpected', actual: actualValue });
    else if (!actualValue) differences.push({ component: key, difference: 'missing', expected: expectedValue });
    else if (digest(expectedValue) !== digest(actualValue)) {
      differences.push({ component: key, difference: 'changed', expected: expectedValue, actual: actualValue });
    }
  }
  return {
    matching: differences.length === 0,
    expected_component_digest: digest(Object.fromEntries(expected)),
    actual_component_digest: digest(Object.fromEntries(actual)),
    differences
  };
}

function expectedCreateStatement(tableName) {
  return splitSqlStatements(mdmMysqlSchemaSql())
    .find(statement => new RegExp(`^CREATE TABLE IF NOT EXISTS ${tableName}\\b`, 'i').test(statement)) || '';
}

function jsonHashEvidence(row, tableName) {
  const raw = tableName === 'process_design_drafts'
    ? row.process_content_json
    : row.process_content_json || row.content_json;
  const storedHash = text(row.content_hash) || null;
  if (!text(raw)) {
    return {
      id: Number(row.id),
      schema_version: text(row.schema_version) || null,
      stored_content_hash: storedHash,
      calculated_content_hash: null,
      result: storedHash ? 'content_missing' : 'not_available'
    };
  }
  let candidate;
  try {
    candidate = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_error) {
    return {
      id: Number(row.id),
      schema_version: text(row.schema_version) || null,
      stored_content_hash: storedHash,
      calculated_content_hash: null,
      result: 'invalid_json'
    };
  }
  let calculatedHash;
  if (text(row.schema_version) === 'process-governance-v7') {
    calculatedHash = digest(candidate);
  } else {
    const normalized = normalizeProcessGovernanceDocument(candidate);
    if (normalized.errors.length) {
      return {
        id: Number(row.id),
        schema_version: text(row.schema_version) || null,
        stored_content_hash: storedHash,
        calculated_content_hash: null,
        result: 'normalization_failed',
        error_count: normalized.errors.length
      };
    }
    calculatedHash = normalized.content_hash;
  }
  return {
    id: Number(row.id),
    schema_version: text(row.schema_version) || null,
    stored_content_hash: storedHash,
    calculated_content_hash: calculatedHash,
    result: !storedHash ? 'stored_hash_missing' : storedHash === calculatedHash ? 'matching' : 'mismatch'
  };
}

function countsBy(rows, field) {
  return Object.fromEntries([...rows.reduce((counts, row) => {
    const key = text(row[field]) || '(null)';
    counts.set(key, Number(counts.get(key) || 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

function tableProfile(rows, fields) {
  return {
    row_count: rows.length,
    min_id: rows.length ? Math.min(...rows.map(row => Number(row.id))) : null,
    max_id: rows.length ? Math.max(...rows.map(row => Number(row.id))) : null,
    status_counts: countsBy(rows, 'status'),
    schema_version_counts: rows.some(row => Object.prototype.hasOwnProperty.call(row, 'schema_version'))
      ? countsBy(rows, 'schema_version')
      : null,
    stable_key_digest: digest(rows.map(row => Object.fromEntries(fields.map(field => [field, row[field]])))),
    full_row_digest: digest(rows)
  };
}

function referenceEvidence(documents, drafts, versions) {
  const documentById = new Map(documents.map(row => [Number(row.id), row]));
  const draftById = new Map(drafts.map(row => [Number(row.id), row]));
  const versionById = new Map(versions.map(row => [Number(row.id), row]));
  const draftDocumentOrphans = drafts.filter(row => row.document_id != null && !documentById.has(Number(row.document_id))).map(row => Number(row.id));
  const draftBaseVersionOrphans = drafts.filter(row => row.base_version_id != null && !versionById.has(Number(row.base_version_id))).map(row => Number(row.id));
  const draftBaseVersionCrossDocument = drafts.filter(row => {
    const version = row.base_version_id == null ? null : versionById.get(Number(row.base_version_id));
    return version && row.document_id != null && Number(version.document_id) !== Number(row.document_id);
  }).map(row => Number(row.id));
  const versionDraftOrphans = versions.filter(row => row.draft_id != null && !draftById.has(Number(row.draft_id))).map(row => Number(row.id));
  const versionDocumentOrphans = versions.filter(row => row.document_id != null && !documentById.has(Number(row.document_id))).map(row => Number(row.id));
  const supersedesOrphans = versions.filter(row => row.supersedes_version_id != null && !versionById.has(Number(row.supersedes_version_id))).map(row => Number(row.id));
  const supersedesCrossDocument = versions.filter(row => {
    const previous = row.supersedes_version_id == null ? null : versionById.get(Number(row.supersedes_version_id));
    return previous && Number(previous.document_id) !== Number(row.document_id);
  }).map(row => Number(row.id));
  const currentVersionMismatches = documents.filter(row => {
    if (row.current_version_id == null) return false;
    const version = versionById.get(Number(row.current_version_id));
    return !version || Number(version.document_id) !== Number(row.id);
  }).map(row => Number(row.id));
  const supersedesCycles = [];
  for (const version of versions) {
    const visited = new Set();
    let current = version;
    while (current && current.supersedes_version_id != null) {
      const id = Number(current.id);
      if (visited.has(id)) {
        supersedesCycles.push(Number(version.id));
        break;
      }
      visited.add(id);
      current = versionById.get(Number(current.supersedes_version_id));
    }
  }
  return {
    draft_document_orphan_ids: draftDocumentOrphans,
    draft_base_version_orphan_ids: draftBaseVersionOrphans,
    draft_base_version_cross_document_ids: draftBaseVersionCrossDocument,
    version_draft_orphan_ids: versionDraftOrphans,
    version_document_orphan_ids: versionDocumentOrphans,
    supersedes_orphan_ids: supersedesOrphans,
    supersedes_cross_document_ids: supersedesCrossDocument,
    current_version_mismatch_document_ids: currentVersionMismatches,
    supersedes_cycle_start_ids: [...new Set(supersedesCycles)].sort((left, right) => left - right),
    non_null_reference_orphan_count: draftDocumentOrphans.length + draftBaseVersionOrphans.length +
      versionDraftOrphans.length + versionDocumentOrphans.length + supersedesOrphans.length,
    cross_document_reference_count: draftBaseVersionCrossDocument.length + supersedesCrossDocument.length + currentVersionMismatches.length
  };
}

function applicationCommit(repositoryRoot) {
  try {
    return text(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }));
  } catch (_error) {
    return null;
  }
}

async function query(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function inspectProcessV7M0Baseline(pool, options = {}) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, '../../..');
  const runtimeRows = await query(pool, `
    SELECT DATABASE() AS database_name, VERSION() AS mysql_version,
           @@transaction_isolation AS transaction_isolation
  `);
  const runtime = runtimeRows[0] || {};
  const tableRows = {};
  const schema = {};
  for (const tableName of FORMAL_TABLES) {
    tableRows[tableName] = await query(pool, `SELECT * FROM \`${tableName}\` ORDER BY id`);
    const createRows = await query(pool, `SHOW CREATE TABLE \`${tableName}\``);
    const actual = createRows[0] && createRows[0]['Create Table'] || '';
    schema[tableName] = compareCreateStatements(expectedCreateStatement(tableName), actual);
  }
  const documents = tableRows.process_design_documents;
  const drafts = tableRows.process_design_drafts;
  const versions = tableRows.process_design_versions;
  const draftHashes = drafts.map(row => jsonHashEvidence(row, 'process_design_drafts'));
  const versionHashes = versions.map(row => jsonHashEvidence(row, 'process_design_versions'));
  const references = referenceEvidence(documents, drafts, versions);
  const migrationPath = path.join(__dirname, 'processV7PreviewReviewMigration.js');
  const historicalExceptions = {
    draft_ids_with_null_document_id: drafts.filter(row => row.document_id == null).map(row => Number(row.id)),
    version_ids_with_null_document_id: versions.filter(row => row.document_id == null).map(row => Number(row.id)),
    active_document_ids_without_current_version: documents
      .filter(row => text(row.status) === 'active' && row.current_version_id == null)
      .map(row => Number(row.id))
  };
  const hashProblems = [...draftHashes, ...versionHashes].filter(item => !['matching', 'not_available'].includes(item.result));
  const backupRestore = options.backupRestoreEvidence || {
    status: 'not_verified',
    message: '当前执行没有取得全库备份在隔离位置成功恢复的可核验证据。'
  };
  const blockers = [];
  if (backupRestore.status !== 'verified') blockers.push('BACKUP_RESTORE_NOT_VERIFIED');
  if (references.non_null_reference_orphan_count) blockers.push('NON_NULL_REFERENCE_ORPHANS');
  if (references.cross_document_reference_count) blockers.push('CROSS_DOCUMENT_REFERENCE_ERRORS');
  if (references.supersedes_cycle_start_ids.length) blockers.push('SUPERSEDES_CYCLE');
  if (hashProblems.length) blockers.push('CONTENT_HASH_INCONSISTENCY');
  return {
    generated_at: new Date().toISOString(),
    mode: 'read-only',
    target: {
      database_name: runtime.database_name,
      mysql_version: runtime.mysql_version,
      transaction_isolation: runtime.transaction_isolation,
      application_commit: applicationCommit(repositoryRoot),
      migration_script_sha256: fileDigest(fs.readFileSync(migrationPath))
    },
    formal_tables: {
      process_design_documents: tableProfile(documents, ['id', 'document_no', 'owning_department_id', 'current_edition', 'current_version_id', 'status']),
      process_design_drafts: tableProfile(drafts, ['id', 'document_id', 'document_no', 'planned_edition', 'base_version_id', 'department_id', 'schema_version', 'content_hash', 'revision_no', 'status']),
      process_design_versions: tableProfile(versions, ['id', 'draft_id', 'document_id', 'document_no', 'edition', 'version_no', 'department_id', 'schema_version', 'content_hash', 'source_revision_no', 'supersedes_version_id', 'status'])
    },
    content_hash_evidence: {
      drafts: draftHashes,
      versions: versionHashes,
      problem_count: hashProblems.length
    },
    reference_evidence: references,
    live_schema_comparison: schema,
    historical_exceptions: historicalExceptions,
    backup_restore_evidence: backupRestore,
    gate: {
      status: blockers.length ? 'blocked' : 'passed',
      blockers,
      ddl_allowed: blockers.length === 0
    }
  };
}

module.exports = {
  FORMAL_TABLES,
  compareCreateStatements,
  digest,
  fileDigest,
  inspectProcessV7M0Baseline,
  jsonHashEvidence,
  referenceEvidence,
  schemaComponents,
  splitTopLevel,
  stableValue
};
