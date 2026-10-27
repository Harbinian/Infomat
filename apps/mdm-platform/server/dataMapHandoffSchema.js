// Explicit additive structure only. Never called by application startup.
const { compareCreateStatements } = require('./processV7M0Baseline');
const CONTRACT_VERSION = 'data-map-handoff-v1';
const MIGRATION_KEY = '2026-10-20-data-map-handoff-v1';
const tail = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const definitions = {
  data_map_governance_control: `control_id TINYINT PRIMARY KEY,
    cutover_state VARCHAR(16) NOT NULL, cutover_epoch BIGINT NOT NULL DEFAULT 0,
    graph_revision BIGINT NOT NULL DEFAULT 0, next_definition_version_id BIGINT NOT NULL,
    contract_version VARCHAR(64) NOT NULL,
    CHECK(control_id=1), CHECK(cutover_state IN ('legacy','prepared','controlled')),
    CHECK(next_definition_version_id>0), CHECK(graph_revision>=0)`,
  data_map_handoff_binding_heads: `package_id BIGINT PRIMARY KEY, binding_id CHAR(36) NOT NULL, head_revision INT NOT NULL, CHECK(head_revision>0), FOREIGN KEY(package_id) REFERENCES process_data_governance_work_packages(id)`,
  data_map_handoff_drafts: `handoff_id CHAR(36) PRIMARY KEY, package_id BIGINT NOT NULL,
    current_revision INT NOT NULL, state VARCHAR(24) NOT NULL, active_slot TINYINT NULL,
    submitted_by BIGINT NULL, current_approval_id CHAR(36) NULL, created_by BIGINT NULL, created_actor_json JSON NOT NULL, created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_handoff_active(package_id,active_slot),
    CHECK(state IN ('draft','submitted','approved','published')), CHECK(current_revision>0),
    CHECK(active_slot IS NULL OR active_slot=1),
    FOREIGN KEY(package_id) REFERENCES process_data_governance_work_packages(id)`,
  data_map_handoff_revisions: `revision_id CHAR(36) PRIMARY KEY, handoff_id CHAR(36) NOT NULL,
    revision_no INT NOT NULL, scope_mode VARCHAR(16) NOT NULL, binding_id CHAR(36) NOT NULL,
    snapshot_json JSON NOT NULL, content_digest CHAR(64) NOT NULL,
    dependency_manifest_json JSON NOT NULL, impact_manifest_json JSON NOT NULL,
    created_by BIGINT NULL, created_actor_json JSON NOT NULL, created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_handoff_revision(handoff_id,revision_no),
    CHECK(scope_mode IN ('current','historical')), CHECK(revision_no>0),
    FOREIGN KEY(handoff_id) REFERENCES data_map_handoff_drafts(handoff_id)`,
  data_map_handoff_approvals: `approval_id CHAR(36) PRIMARY KEY, action VARCHAR(32) NOT NULL,
    revision_id CHAR(36) NULL, publication_id CHAR(36) NULL, binding_digest CHAR(64) NOT NULL,
    decision VARCHAR(24) NOT NULL, basis TEXT NOT NULL, actor_json JSON NOT NULL,
    request_id CHAR(36) NOT NULL UNIQUE, created_at DATETIME(3) NOT NULL,
    CHECK(action IN ('publish','withdraw_publication')),
    CHECK((action='publish' AND revision_id IS NOT NULL AND publication_id IS NULL) OR
      (action='withdraw_publication' AND revision_id IS NULL AND publication_id IS NOT NULL)),
    CHECK(decision IN ('approved','needs_changes')), INDEX idx_handoff_approval_revision(revision_id)`,
  data_map_handoff_requests: `request_id CHAR(36) PRIMARY KEY, actor_kind VARCHAR(16) NOT NULL,
    actor_ref VARCHAR(64) NOT NULL, action VARCHAR(48) NOT NULL, scope_kind VARCHAR(24) NOT NULL,
    scope_id VARCHAR(64) NOT NULL, scope_json JSON NOT NULL, payload_digest CHAR(64) NOT NULL,
    state VARCHAR(16) NOT NULL, result_json JSON NULL, created_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NULL, CHECK(actor_kind IN ('person','system')),
    CHECK(state IN ('prepared','committed','rejected')),
    CHECK((state='prepared' AND result_json IS NULL) OR (state<>'prepared' AND result_json IS NOT NULL))`,
  data_map_handoff_events: `event_id CHAR(36) PRIMARY KEY, handoff_id CHAR(36) NOT NULL,
    event_type VARCHAR(48) NOT NULL, payload_json JSON NOT NULL, actor_json JSON NOT NULL,
    request_id CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
    INDEX idx_handoff_event(handoff_id,created_at),
    FOREIGN KEY(handoff_id) REFERENCES data_map_handoff_drafts(handoff_id)`,
  data_map_handoff_conflicts: `conflict_id CHAR(36) PRIMARY KEY, handoff_id CHAR(36) NOT NULL,
    package_id BIGINT NOT NULL, revision_no INT NOT NULL, state VARCHAR(24) NOT NULL,
    kind VARCHAR(32) NOT NULL, assignee_person_id BIGINT NULL, decision_person_id BIGINT NULL,
    payload_json JSON NOT NULL, CHECK(revision_no>0),
    CHECK(state IN ('open','resolved','verified','escalated')),
    FOREIGN KEY(handoff_id) REFERENCES data_map_handoff_drafts(handoff_id)`,
  data_map_handoff_conflict_events: `event_id CHAR(36) PRIMARY KEY, conflict_id CHAR(36) NOT NULL,
    revision_no INT NOT NULL, payload_json JSON NOT NULL, actor_json JSON NOT NULL,
    request_id CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_handoff_conflict_event(conflict_id,revision_no),
    FOREIGN KEY(conflict_id) REFERENCES data_map_handoff_conflicts(conflict_id)`,
  data_map_publications: `publication_id CHAR(36) PRIMARY KEY,
    handoff_revision_id CHAR(36) NOT NULL UNIQUE, approval_id CHAR(36) NOT NULL,
    scope_mode VARCHAR(16) NOT NULL, manifest_json JSON NOT NULL, manifest_digest CHAR(64) NOT NULL,
    request_id CHAR(36) NOT NULL UNIQUE, published_at DATETIME(3) NOT NULL,
    CHECK(scope_mode IN ('current','historical')),
    FOREIGN KEY(handoff_revision_id) REFERENCES data_map_handoff_revisions(revision_id),
    FOREIGN KEY(approval_id) REFERENCES data_map_handoff_approvals(approval_id)`,
  data_map_publication_items: `publication_id CHAR(36) NOT NULL, item_ref VARCHAR(160) NOT NULL,
    target_kind VARCHAR(24) NOT NULL, target_id VARCHAR(64) NOT NULL,
    target_version_ref VARCHAR(96) NOT NULL, operation VARCHAR(24) NOT NULL,
    produces_version TINYINT NOT NULL, payload_json JSON NOT NULL,
    source_detail_versions_json JSON NOT NULL,
    PRIMARY KEY(publication_id,item_ref),
    INDEX idx_handoff_target(target_kind,target_id,target_version_ref),
    CHECK(target_kind IN ('object','field','data_element','context','rule','authority')),
    CHECK(operation IN ('create','modify','reuse','context_link','rule','authority')),
    CHECK(produces_version IN (0,1)),
    FOREIGN KEY(publication_id) REFERENCES data_map_publications(publication_id)`,
  data_map_effective_heads: `subject_kind VARCHAR(24) NOT NULL, subject_id VARCHAR(64) NOT NULL,
    effective_version_ref VARCHAR(96) NULL, publication_id CHAR(36) NULL,
    head_revision INT NOT NULL, availability VARCHAR(24) NOT NULL,
    PRIMARY KEY(subject_kind,subject_id), CHECK(head_revision>0),
    CHECK(availability IN ('active','withdrawn','unavailable')),
    CHECK((availability='active' AND effective_version_ref IS NOT NULL AND publication_id IS NOT NULL)
      OR availability<>'active'),
    FOREIGN KEY(publication_id) REFERENCES data_map_publications(publication_id)`,
  data_map_publication_events: `publication_id CHAR(36) NOT NULL, event_no INT NOT NULL,
    event_type VARCHAR(48) NOT NULL, payload_json JSON NOT NULL, request_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL, PRIMARY KEY(publication_id,event_no), CHECK(event_no>0),
    FOREIGN KEY(publication_id) REFERENCES data_map_publications(publication_id)`,
  data_map_legacy_registry: `asset_kind VARCHAR(48) NOT NULL, asset_id VARCHAR(96) NOT NULL,
    version_ref VARCHAR(128) NOT NULL, snapshot_json JSON NOT NULL, snapshot_digest CHAR(64) NOT NULL,
    original_status VARCHAR(64) NULL, history_completeness VARCHAR(32) NOT NULL,
    captured_at DATETIME(3) NOT NULL, PRIMARY KEY(asset_kind,asset_id,version_ref)`,
  data_map_data_elements: `element_id CHAR(36) PRIMARY KEY, created_at DATETIME(3) NOT NULL`,
  data_map_data_element_versions: `element_version_id CHAR(36) PRIMARY KEY, element_id CHAR(36) NOT NULL,
    definition_json JSON NOT NULL, content_digest CHAR(64) NOT NULL,
    publication_id CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
    INDEX idx_handoff_element(element_id), FOREIGN KEY(element_id) REFERENCES data_map_data_elements(element_id)`,
  data_map_field_element_bindings: `binding_id CHAR(36) PRIMARY KEY, field_version_id BIGINT NOT NULL,
    element_version_id CHAR(36) NOT NULL, context_version_ref VARCHAR(96) NOT NULL,
    basis TEXT NOT NULL, publication_id CHAR(36) NOT NULL,
    FOREIGN KEY(field_version_id) REFERENCES data_map_definition_versions(version_id),
    FOREIGN KEY(element_version_id) REFERENCES data_map_data_element_versions(element_version_id),
    FOREIGN KEY(publication_id) REFERENCES data_map_publications(publication_id)`
};
function completeDDL(sql) {
  const {splitTopLevel,schemaComponents}=require('./processV7M0Baseline');
  const table=sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1];
  const start=sql.indexOf('('),end=sql.lastIndexOf(')');
  let sequence=0;
  const extras=[];
  const parts=splitTopLevel(sql.slice(start+1,end)).map(part=>{
    if(/^FOREIGN KEY/i.test(part))part='CONSTRAINT fk_dmh_'+require('node:crypto').createHash('sha256').update(table+':'+(++sequence)).digest('hex').slice(0,16)+' '+part;
    const inline=part.match(/^(\w+)\s+.*\bUNIQUE\b/i);
    if(inline&&!/^(UNIQUE|CONSTRAINT|KEY|INDEX|CHECK|PRIMARY)\b/i.test(part)){
      part=part.replace(/\s+UNIQUE\b/i,'');extras.push('UNIQUE KEY '+inline[1]+' ('+inline[1]+')');
    }
    return part.replace(/('[^']*')|([<>!=]+)/g,(whole,quoted,operator)=>quoted||' '+operator+' ');
  }).concat(extras);
  // Spell out InnoDB's required FK indexes so SHOW CREATE comparison can
  // distinguish real drift from server-generated index/constraint names.
  const components=schemaComponents(sql.slice(0,start+1)+parts.join(',')+')');
  const indexes=[...components.entries()].filter(([k])=>k.startsWith('index:')).map(([,v])=>v.columns);
  for(const [key,foreign] of components)if(key.startsWith('foreign_key:')&&!indexes.some(cols=>foreign.columns.every((col,i)=>cols[i]===col))){
    parts.push('KEY '+foreign.name+' ('+foreign.columns.join(',')+')');indexes.push(foreign.columns);
  }
  return sql.slice(0,start+1)+parts.join(',\n')+sql.slice(end);
}
let contractStatements;
function statements() {
  // Only the immutable source contract is memoized. Every inspection still
  // reads every actual table, constraint, collation and migration marker.
  if(!contractStatements)contractStatements=Object.freeze(Object.entries(definitions).map(([table, body]) => `CREATE TABLE IF NOT EXISTS ${table} (${body})${tail}`)
    .concat(require('./mysqlSchema').splitSqlStatements(require('./dataMapHandoffLegacy').LEGACY_SCHEMA_SQL)).map(completeDDL));
  return [...contractStatements];
}
function metadataTables() {
  return [...statements().map(sql=>sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1]),'data_map_definition_versions','schema_migrations'].sort();
}
async function inspectHandoffSchema(db,{pinMetadata=false}={}) {
  const expected=statements(),names=metadataTables(),placeholders=names.map(()=>'?').join(',');
  let metadataPinned=!pinMetadata;
  if(pinMetadata){
    // A SELECT keeps shared metadata locks until this transaction ends, even
    // when its predicate has no rows. One statement opens the complete set in
    // a stable order; it neither scans history nor takes business row locks.
    // The caller must keep this transaction through the graph write/receipt.
    try{await db.query('SELECT 1 FROM '+names.map((table,n)=>'`'+table+'` AS mdl'+n).join(',')+' WHERE 1=0');metadataPinned=true;}
    catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;}
  }
  const [installed]=await db.execute(`SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,names);
  const present=new Set(installed.map(row=>row.TABLE_NAME));
  const [wrongCollations]=await db.execute(`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders}) AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?`,[...names,'utf8mb4_unicode_ci']);
  const collationColumns=new Map();
  for(const row of wrongCollations){if(!collationColumns.has(row.TABLE_NAME))collationColumns.set(row.TABLE_NAME,[]);collationColumns.get(row.TABLE_NAME).push(row.COLUMN_NAME);}
  const result = [];
  for (const sql of expected) {
    const table = sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    if (!present.has(table)) { result.push({table,status:'missing'}); continue; }
    const [[row]] = await db.query('SHOW CREATE TABLE `'+table+'`');
    const compared = compareCreateStatements(sql, row['Create Table']);
    const collations=collationColumns.get(table)||[];
    const storage=/ENGINE=InnoDB\b/i.test(row['Create Table'])&&/COLLATE=utf8mb4_unicode_ci\b/i.test(row['Create Table'])&&!/NOT ENFORCED/i.test(row['Create Table'])&&!collations.length;
    result.push({table,status:compared.matching&&storage?'matching':'drifted',differences:compared.differences,...(!storage?{storage_or_constraint_drift:true,columns:collations}:{})});
  }
  // The reused immutable version table is part of this contract too. Accept
  // only its exact previous CHECK as a pending additive upgrade; unrelated
  // drift and disabled constraints are never treated as a completed migration.
  const oldVersionDDL=require('./dataMapDefinitionSchema').statements().find(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_definition_versions ('));
  if(!present.has('data_map_definition_versions'))result.push({table:'data_map_definition_versions',status:'missing'});
  else {
    const [[actual]]=await db.query('SHOW CREATE TABLE data_map_definition_versions');
    const desired=oldVersionDDL.replace("source_kind IN ('legacy','manual')","source_kind IN ('legacy','manual','governance')");
    const compared=compareCreateStatements(desired,actual['Create Table']),previous=compareCreateStatements(oldVersionDDL,actual['Create Table']);
    const storage=/ENGINE=InnoDB\b/i.test(actual['Create Table'])&&/COLLATE=utf8mb4_unicode_ci\b/i.test(actual['Create Table'])&&!/NOT ENFORCED/i.test(actual['Create Table'])&&!(collationColumns.get('data_map_definition_versions')||[]).length;
    result.push({table:'data_map_definition_versions',status:storage&&compared.matching?'matching':storage&&previous.matching?'requires_source_kind_extension':'drifted',differences:compared.differences});
  }
  const [markers]=await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?'+(pinMetadata?' FOR SHARE':''),[MIGRATION_KEY]);
  return {contract_version:CONTRACT_VERSION,migration_marked:markers.length===1,ready:metadataPinned&&markers.length===1&&result.every(x=>x.status==='matching'),tables:result};
}
// Existing isolated targets retain their guard. Formal callers must present the
// non-serializable deployment capability; neither path activates controlled mode.
async function applyHandoffSchema(db, options = {}) {
  const {owner, database, formalTargetPermit} = options;
  if (formalTargetPermit) {
    const verified=await require('./governanceMigrationAuthorization').verifyMigrationPermit(db,formalTargetPermit,{write:true});
    if(verified.database!==database) throw Object.assign(new Error('正式数据库不匹配'),{code:'HANDOFF_FORMAL_TARGET_MISMATCH',statusCode:409});
  } else if (!/^[0-9a-f-]{36}$/.test(owner||'') || !/^stage\d{2}_isolated_[0-9a-f]{32}$/.test(database||'') || !database.endsWith(owner.replaceAll('-',''))) {
    throw Object.assign(new Error('隔离目标标识不匹配'),{code:'HANDOFF_ISOLATED_TARGET_REQUIRED',statusCode:409});
  }
  const [[current]] = await db.execute('SELECT DATABASE() AS name');
  if(current.name!==database) throw Object.assign(new Error('隔离数据库不匹配'),{code:'HANDOFF_ISOLATED_TARGET_REQUIRED',statusCode:409});
  const before=await inspectHandoffSchema(db);
  if(before.tables.some(x=>x.status==='drifted')) throw Object.assign(new Error('承接结构存在漂移'),{code:'HANDOFF_SCHEMA_DRIFT',statusCode:409});
  for(const sql of statements()) await db.execute(sql);
  const [checks]=await db.execute(`SELECT tc.CONSTRAINT_NAME,cc.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME='data_map_definition_versions' AND tc.CONSTRAINT_TYPE='CHECK'`);
  const oldChecks=checks.filter(c=>/source_kind.*in\s*\(/i.test(c.CHECK_CLAUSE)&&!/governance/.test(c.CHECK_CLAUSE));
  for(const c of oldChecks)if(!/^\w+$/.test(c.CONSTRAINT_NAME))throw new Error('Unsafe check identity');
  const [[sourceCheck]]=await db.execute("SELECT COUNT(*) n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_dm_definition_source_governance'");
  const alterations=oldChecks.map(c=>'DROP CHECK `'+c.CONSTRAINT_NAME+'`');
  if(!Number(sourceCheck.n))alterations.push("ADD CONSTRAINT chk_dm_definition_source_governance CHECK (source_kind IN ('legacy','manual','governance'))");
  // One atomic ALTER avoids exposing a constraint-free intermediate structure
  // after interruption between DROP and ADD. Existing source rows stay intact.
  if(alterations.length)await db.execute('ALTER TABLE data_map_definition_versions '+alterations.join(', '));
  const [[max]]=await db.execute('SELECT CAST(COALESCE(MAX(version_id),0)+1 AS CHAR) n FROM data_map_definition_versions');
  const [[auto]]=await db.execute("SELECT CAST(AUTO_INCREMENT AS CHAR) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='data_map_definition_versions'");
  const next=(BigInt(max.n)>BigInt(auto.n||'1')?BigInt(max.n):BigInt(auto.n||'1')).toString();
  await db.execute(`INSERT INTO data_map_governance_control(control_id,cutover_state,next_definition_version_id,contract_version)
    VALUES(1,'prepared',?,?) ON DUPLICATE KEY UPDATE control_id=control_id`,[next,CONTRACT_VERSION]);
  await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)',[MIGRATION_KEY]);
  return inspectHandoffSchema(db);
}
module.exports={CONTRACT_VERSION,MIGRATION_KEY,definitions,statements,metadataTables,inspectHandoffSchema,applyHandoffSchema};
