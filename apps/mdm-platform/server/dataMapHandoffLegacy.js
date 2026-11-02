// Append-only legacy intake and corrections. All writes use the caller's MySQL
// transaction; this module never opens a connection, commits, or migrates a DB.
const crypto = require('node:crypto');
const { digest, stableValue, COMPLETE_DETAIL_STATUSES, DETAIL_STATUSES } = require('./processDataGovernance');
const { identityInteger, sessionSubject } = require('./sessionSubject');
const { supports } = require('./processNativeFormats');

// The maintenance/schema owner consumes this text explicitly. Importing this
// module or starting the application never executes DDL.
const LEGACY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS process_data_governance_detail_versions (
  detail_version_id CHAR(36) PRIMARY KEY,
  detail_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  source_digest CHAR(64) NOT NULL,
  actor_json JSON NOT NULL,
  history_completeness VARCHAR(48) NOT NULL,
  request_id CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_handoff_detail_revision(detail_id,revision_no),
  CONSTRAINT fk_handoff_detail_version FOREIGN KEY(detail_id) REFERENCES process_data_governance_details(id) ON DELETE RESTRICT,
  CONSTRAINT chk_handoff_detail_revision CHECK(revision_no>=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_data_governance_intakes (
  intake_id CHAR(36) PRIMARY KEY,
  package_id BIGINT NOT NULL,
  current_revision INT NOT NULL DEFAULT 1,
  state VARCHAR(24) NOT NULL DEFAULT 'prepared',
  original_review_id BIGINT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  review_json JSON NULL,
  request_id CHAR(36) NOT NULL,
  prepared_by_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_handoff_intake_request(request_id),
  CONSTRAINT fk_handoff_intake_package FOREIGN KEY(package_id) REFERENCES process_data_governance_work_packages(id) ON DELETE RESTRICT,
  CONSTRAINT fk_handoff_intake_original_review FOREIGN KEY(original_review_id) REFERENCES process_data_governance_reviews(id) ON DELETE RESTRICT,
  CONSTRAINT chk_handoff_intake_state CHECK(state IN ('prepared','reviewed')),
  CONSTRAINT chk_handoff_intake_revision CHECK(current_revision>=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_data_governance_corrections (
  correction_id CHAR(36) PRIMARY KEY,
  package_id BIGINT NOT NULL,
  replaces_binding_id CHAR(36) NOT NULL,
  current_revision INT NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'draft',
  created_by_json JSON NOT NULL,
  request_id CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_handoff_correction_request(request_id),
  CONSTRAINT fk_handoff_correction_package FOREIGN KEY(package_id) REFERENCES process_data_governance_work_packages(id) ON DELETE RESTRICT,
  CONSTRAINT chk_handoff_correction_state CHECK(state IN ('draft','reviewed')),
  CONSTRAINT chk_handoff_correction_revision CHECK(current_revision>=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_data_governance_correction_revisions (
  correction_revision_id CHAR(36) PRIMARY KEY,
  correction_id CHAR(36) NOT NULL,
  revision_no INT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  reason_text TEXT NOT NULL,
  evidence_json JSON NOT NULL,
  actor_json JSON NOT NULL,
  request_id CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_handoff_correction_revision(correction_id,revision_no),
  CONSTRAINT fk_handoff_correction_revision FOREIGN KEY(correction_id) REFERENCES process_data_governance_corrections(correction_id) ON DELETE RESTRICT,
  CONSTRAINT chk_handoff_correction_rev CHECK(revision_no>=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_data_governance_fact_versions (
  fact_version_id CHAR(36) PRIMARY KEY,
  fact_id VARCHAR(96) NOT NULL,
  package_id BIGINT NOT NULL,
  correction_id CHAR(36) NULL,
  intake_id CHAR(36) NULL,
  revision_no INT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  actor_json JSON NOT NULL,
  request_id CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_handoff_fact_revision(fact_id,revision_no),
  CONSTRAINT fk_handoff_fact_package FOREIGN KEY(package_id) REFERENCES process_data_governance_work_packages(id) ON DELETE RESTRICT,
  CONSTRAINT fk_handoff_fact_correction FOREIGN KEY(correction_id) REFERENCES process_data_governance_corrections(correction_id) ON DELETE RESTRICT,
  CONSTRAINT fk_handoff_fact_intake FOREIGN KEY(intake_id) REFERENCES process_data_governance_intakes(intake_id) ON DELETE RESTRICT,
  CONSTRAINT chk_handoff_fact_parent CHECK(correction_id IS NULL OR intake_id IS NULL),
  CONSTRAINT chk_handoff_fact_revision CHECK(revision_no>=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_data_governance_review_bindings (
  binding_id CHAR(36) PRIMARY KEY,
  package_id BIGINT NOT NULL,
  binding_kind VARCHAR(32) NOT NULL,
  native_review_id BIGINT NULL,
  intake_id CHAR(36) NULL,
  correction_revision_id CHAR(36) NULL,
  review_record_id CHAR(36) NULL,
  source_hash CHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL,
  binding_digest CHAR(64) NOT NULL,
  request_id CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_handoff_binding_native(native_review_id),
  UNIQUE KEY uq_handoff_binding_intake(intake_id),
  UNIQUE KEY uq_handoff_binding_correction(correction_revision_id),
  UNIQUE KEY uq_handoff_binding_request(request_id),
  CONSTRAINT fk_handoff_binding_package FOREIGN KEY(package_id) REFERENCES process_data_governance_work_packages(id) ON DELETE RESTRICT,
  CONSTRAINT fk_handoff_binding_native FOREIGN KEY(native_review_id) REFERENCES process_data_governance_reviews(id) ON DELETE RESTRICT,
  CONSTRAINT fk_handoff_binding_intake FOREIGN KEY(intake_id) REFERENCES process_data_governance_intakes(intake_id) ON DELETE RESTRICT,
  CONSTRAINT fk_handoff_binding_correction FOREIGN KEY(correction_revision_id) REFERENCES process_data_governance_correction_revisions(correction_revision_id) ON DELETE RESTRICT,
  CONSTRAINT chk_handoff_binding_basis CHECK(
    (binding_kind='native_review' AND native_review_id IS NOT NULL AND intake_id IS NULL AND correction_revision_id IS NULL AND review_record_id IS NOT NULL) OR
    (binding_kind='legacy_intake' AND native_review_id IS NULL AND intake_id IS NOT NULL AND correction_revision_id IS NULL AND review_record_id IS NULL) OR
    (binding_kind='correction_review' AND native_review_id IS NULL AND intake_id IS NULL AND correction_revision_id IS NOT NULL AND review_record_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS data_map_handoff_generation_tasks (
  task_id CHAR(36) PRIMARY KEY,
  package_id BIGINT NOT NULL,
  binding_id CHAR(36) NOT NULL,
  system_request_id CHAR(36) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'pending',
  attempt INT NOT NULL DEFAULT 0,
  last_error VARCHAR(96) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_handoff_generation_binding(package_id,binding_id),
  UNIQUE KEY uq_handoff_generation_system_request(system_request_id),
  CONSTRAINT fk_handoff_generation_package FOREIGN KEY(package_id) REFERENCES process_data_governance_work_packages(id) ON DELETE RESTRICT,
  CONSTRAINT fk_handoff_generation_binding FOREIGN KEY(binding_id) REFERENCES process_data_governance_review_bindings(binding_id) ON DELETE RESTRICT,
  CONSTRAINT chk_handoff_generation_state CHECK(state IN ('pending','running','generated','needs_rebase','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

function fail(statusCode, code, message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, { statusCode, code, payload: { error: message, code, ...extra } });
  return error;
}
function text(value) { return String(value == null ? '' : value).trim(); }
function id(value, label = '标识') {
  const result = identityInteger(value);
  if (result === null) throw fail(422, 'HANDOFF_ID_INVALID', `${label}须为完整的正整数标识`);
  return String(result);
}
function uuid(value, label = '标识') {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(text(value))) {
    throw fail(422, 'HANDOFF_UUID_INVALID', `${label}须为UUID`);
  }
  return text(value).toLowerCase();
}
function parseJson(value) {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { throw fail(409, 'HANDOFF_LEGACY_JSON_UNREADABLE', '旧记录JSON无法解析，保留原值并停止接入'); }
  }
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(422, 'HANDOFF_PAYLOAD_INVALID', `${label}须为对象`);
  return structuredClone(value);
}
function refs(value, label = '证据引用') {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !text(item))) {
    throw fail(422, 'HANDOFF_EVIDENCE_REQUIRED', `${label}不能为空`);
  }
  return [...new Set(value.map(text))].sort();
}
function inputFields(input, fields, context = {}) {
  object(input,'输入');
  const allowed=new Set(['request_id','expected_revision',...fields]);
  if(Object.keys(input).some(key=>!allowed.has(key))) throw fail(422,'HANDOFF_PAYLOAD_FIELD_DENIED','输入含当前动作不支持的字段');
  if(input.request_id && uuid(input.request_id)!==uuid(context.request_id)) throw fail(409,'HANDOFF_REQUEST_PAYLOAD_CONFLICT','请求标识与当前事务不一致');
  for(const key of ['package_id','intake_id','correction_id','fact_id']) {
    if(input[key] && context[key] && String(input[key])!==String(context[key])) throw fail(409,'HANDOFF_SCOPE_CONFLICT','输入资源与路径范围不一致');
  }
}
function expected(value, actual) {
  if (!Number.isSafeInteger(value) || value !== Number(actual)) throw fail(409, 'HANDOFF_REVISION_CONFLICT', '记录修订已变化，请保留输入并核对', { current_revision: Number(actual) });
}
function actorSnapshot(actor) {
  const subject = sessionSubject(actor);
  const roles = actor.roleCodes instanceof Set ? actor.roleCodes : new Set(actor.roleCodes || []);
  if (subject.kind !== 'person' || roles.has('admin')) throw fail(403, 'HANDOFF_ADMIN_READ_ONLY', '管理员对数据治理只读');
  return { person_id: id(subject.personId, '人员'), account_id: id(subject.accountId, '账号'),
    auth_version: id(subject.authVersion, '会话版本'), role_code: text(actor.roleCode) || null,
    role_codes:[...roles].sort(), qualification:actor.qualificationSnapshot || null };
}
async function rows(db, sql, params = []) { const [result] = await db.execute(sql, params); return result; }
async function one(db, sql, params = []) { return (await rows(db, sql, params))[0] || null; }
function requireTransaction(db, context) {
  if (!db || typeof db.execute !== 'function' || typeof db.getConnection === 'function' || !context || !context.request_id) {
    throw fail(503, 'HANDOFF_TRANSACTION_REQUIRED', '接入和更正须由调用方提供受控事务及原请求标识');
  }
  return uuid(context.request_id, '请求标识');
}
function assertComplete(snapshot) {
  if (!snapshot.detail_versions.length) throw fail(422, 'HANDOFF_DETAILS_REQUIRED', '缺少治理明细');
  const incomplete = snapshot.detail_versions.filter(detail => !COMPLETE_DETAIL_STATUSES.has(detail.status) || !text(detail.governance && detail.governance.basis));
  const unresolved = (snapshot.facts || []).filter(fact => !['closed', 'cancelled'].includes(fact.status));
  if (incomplete.length || unresolved.length) throw fail(422, 'HANDOFF_GATE_BLOCKED', '存在未确认明细或未关闭事实，不能完成本次审核', {
    detail_refs: incomplete.map(detail => detail.detail_ref), fact_ids: unresolved.map(fact => fact.fact_id)
  });
}

function createDataMapHandoffLegacy(options = {}) {
  const nextId = options.idFactory || crypto.randomUUID;
  async function authorize(db, actor, action, packageRow, scope = {}) {
    actorSnapshot(actor);
    if (typeof options.authorize !== 'function') throw fail(503, 'HANDOFF_AUTHORITY_ADAPTER_REQUIRED', '缺少当前资格和范围核验适配，拒绝办理');
    const current = await options.authorize(db, actor, action, packageRow, scope);
    if (current === false) throw fail(403, 'HANDOFF_ACCESS_DENIED', '当前没有此事项的办理资格');
    return current && typeof current === 'object' ? current : actor;
  }
  async function loadPackage(db, packageId, actor, action, scope = {}) {
    actorSnapshot(actor);
    if (typeof options.authorize !== 'function') throw fail(503, 'HANDOFF_AUTHORITY_ADAPTER_REQUIRED', '缺少当前资格和范围核验适配，拒绝办理');
    const packageRow = await one(db, `SELECT p.*, CAST(p.id AS CHAR) id, CAST(p.process_version_id AS CHAR) process_version_id,
      CAST(p.owning_department_id AS CHAR) owning_department_id,CAST(p.source_document_id AS CHAR) source_document_id,
      CAST(p.created_by_person_id AS CHAR) created_by_person_id,CAST(p.updated_by_person_id AS CHAR) updated_by_person_id
      FROM process_data_governance_work_packages p WHERE p.id=? FOR UPDATE`, [id(packageId, '工作包')]);
    if (!packageRow) throw fail(404, 'HANDOFF_PACKAGE_NOT_FOUND', '工作包不存在或不可见');
    const source = typeof options.loadSource === 'function' ? await options.loadSource(db, packageRow) : await one(db,
      'SELECT v.*, CAST(v.id AS CHAR) id FROM process_design_versions v WHERE v.id=? FOR SHARE', [packageRow.process_version_id]);
    if (!source || !['published', 'superseded'].includes(source.status)) throw fail(409, 'HANDOFF_SOURCE_NOT_FIXED', '来源必须是明确的已发布固定版本');
    const document = parseJson(source.process_content_json == null ? source.content_json : source.process_content_json);
    if (!supports(source.schema_version) || !document || document.schema_version !== source.schema_version) throw fail(409, 'HANDOFF_SOURCE_UNSUPPORTED', '只支持原生V8和受支持V7，正文格式须一致');
    if (digest(document) !== source.content_hash || source.content_hash !== packageRow.source_content_hash || id(source.id) !== packageRow.process_version_id) {
      throw fail(409, 'HANDOFF_SOURCE_DIGEST_MISMATCH', '固定来源摘要或身份异常，不能重算覆盖旧摘要');
    }
    actor = await authorize(db, actor, action, packageRow, scope);
    return { packageRow, actor, source };
  }
  async function captureDetail(db, detail, actor, requestId, completeness) {
    return require('./dataMapNativeHistory').captureDetail(db,detail,actor,requestId,completeness);
  }
  async function capture(db, loaded, requestId, completeness = 'current_snapshot_only') {
    const { packageRow, actor, source } = loaded;
    const details = await rows(db, `SELECT d.*, CAST(d.id AS CHAR) id, CAST(d.responsible_department_id AS CHAR) responsible_department_id
      ,CAST(d.work_package_id AS CHAR) work_package_id,CAST(d.created_by_person_id AS CHAR) created_by_person_id,
      CAST(d.updated_by_person_id AS CHAR) updated_by_person_id
      FROM process_data_governance_details d WHERE work_package_id=? ORDER BY d.id FOR UPDATE`, [packageRow.id]);
    const facts = await rows(db, `SELECT f.*, CAST(f.id AS CHAR) id, CAST(f.detail_id AS CHAR) detail_id,
      CAST(f.target_department_id AS CHAR) target_department_id, CAST(f.requested_by_person_id AS CHAR) requested_by_person_id,
      CAST(f.answered_by_person_id AS CHAR) answered_by_person_id, CAST(f.closed_by_person_id AS CHAR) closed_by_person_id,
      CAST(f.work_package_id AS CHAR) work_package_id
      FROM process_data_governance_fact_requests f WHERE work_package_id=? ORDER BY f.id FOR UPDATE`, [packageRow.id]);
    const reviews = await rows(db, `SELECT r.*, CAST(r.id AS CHAR) id, CAST(r.actor_person_id AS CHAR) actor_person_id,
      CAST(r.replaces_review_id AS CHAR) replaces_review_id, CAST(r.scope_department_id AS CHAR) scope_department_id
      ,CAST(r.work_package_id AS CHAR) work_package_id
      FROM process_data_governance_reviews r WHERE work_package_id=? ORDER BY r.id FOR SHARE`, [packageRow.id]);
    const events = await rows(db, `SELECT e.*, CAST(e.id AS CHAR) id, CAST(e.actor_person_id AS CHAR) actor_person_id,
      CAST(e.work_package_id AS CHAR) work_package_id,CAST(e.detail_id AS CHAR) detail_id,CAST(e.fact_request_id AS CHAR) fact_request_id,
      CAST(e.actor_department_id AS CHAR) actor_department_id
      FROM process_data_governance_events e WHERE work_package_id=? ORDER BY e.id`, [packageRow.id]);
    const detailVersions = [];
    for (const detail of details) detailVersions.push(await captureDetail(db, detail, actor, requestId, completeness));
    // MySQL TIMESTAMP values arrive as Date objects. Persisted JSON uses ISO
    // strings; normalize before hashing so rereading JSON verifies the same bytes.
    return JSON.parse(JSON.stringify({
      schema_version: 'data-map-review-binding-v1', package_id: packageRow.id, package_revision: Number(packageRow.revision_no),
      process_version_id: packageRow.process_version_id, source_hash: source.content_hash, source_schema_version: source.schema_version,
      rule_version: packageRow.rule_version, original_package_status: packageRow.status,
      detail_versions: detailVersions, facts: facts.map(fact => ({ ...fact, fact_id: id(fact.id), legacy_record: true })),
      original_package:packageRow,original_details:details,original_reviews: reviews, original_events: events,
      evidence_refs: [], history_completeness: completeness
    }));
  }
  async function preserveRegistry(db, snapshot) {
    const versionRef = `r${snapshot.package_revision}`;
    const old = await one(db, 'SELECT snapshot_digest FROM data_map_legacy_registry WHERE asset_kind=? AND asset_id=? AND version_ref=? FOR SHARE', ['work_package',snapshot.package_id,versionRef]);
    const original = { ...snapshot, detail_versions: snapshot.detail_versions.map(({ detail_version_id, ...detail }) => detail) };
    const snapshotDigest = digest(original);
    if (old && old.snapshot_digest !== snapshotDigest) throw fail(409, 'HANDOFF_LEGACY_SNAPSHOT_DRIFT', '相同旧包身份和修订发生内容漂移，保全快照不能覆盖');
    if (!old) await db.execute(`INSERT INTO data_map_legacy_registry
      (asset_kind,asset_id,version_ref,snapshot_json,snapshot_digest,original_status,history_completeness,captured_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6))`, ['work_package',snapshot.package_id,versionRef,JSON.stringify(original),snapshotDigest,snapshot.original_package_status,snapshot.history_completeness]);
    return snapshotDigest;
  }
  async function bindReview(db, snapshot, actor, context) {
    snapshot=JSON.parse(JSON.stringify(snapshot));
    if (typeof options.bindReview === 'function') return options.bindReview(db, snapshot, actor, context);
    const requestId = requireTransaction(db, context);
    const bindingId = nextId(), taskId = nextId(), systemRequestId = nextId();
    const bindingDigest = digest(snapshot);
    await db.execute(`INSERT INTO process_data_governance_review_bindings
      (binding_id,package_id,binding_kind,native_review_id,intake_id,correction_revision_id,review_record_id,
       source_hash,snapshot_json,binding_digest,request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [bindingId,snapshot.package_id,snapshot.binding_kind,snapshot.native_review_id || null,snapshot.intake_id || null,
      snapshot.correction_revision_id || null,snapshot.review_record_id || null,snapshot.source_hash,JSON.stringify(snapshot),bindingDigest,requestId]);
    await db.execute(`INSERT INTO data_map_handoff_generation_tasks
      (task_id,package_id,binding_id,system_request_id,state) VALUES (?,?,?,?,'pending')`, [taskId,snapshot.package_id,bindingId,systemRequestId]);
    return { binding_id:bindingId, binding_digest:bindingDigest, task_id:taskId, system_request_id:systemRequestId,
      business_outcome:'review_bound_pending_draft', publication_id:null };
  }
  async function prepareIntake(db, input, actor, context) {
    const requestId = requireTransaction(db, context);
    inputFields(input,['package_id'],context);
    expected(input.expected_revision, 0);
    const loaded = await loadPackage(db, context.package_id || input.package_id, actor, 'prepare');
    if (loaded.packageRow.status !== 'completed') throw fail(409, 'HANDOFF_LEGACY_PACKAGE_NOT_COMPLETED', '旧包接入只接收已完成包；未完成包继续原审核流程');
    const snapshot = await capture(db, loaded, requestId);
    await preserveRegistry(db, snapshot);
    const intakeId = nextId();
    const originalReview = snapshot.original_reviews.filter(review => review.review_type === 'mdm_workgroup' && review.decision === 'approved').at(-1);
    await db.execute(`INSERT INTO process_data_governance_intakes
      (intake_id,package_id,current_revision,state,original_review_id,snapshot_json,snapshot_digest,request_id,prepared_by_json)
      VALUES (?,?,1,'prepared',?,?,?,?,?)`, [intakeId,snapshot.package_id,originalReview ? originalReview.id : null,
      JSON.stringify(snapshot),digest(snapshot),requestId,JSON.stringify(actorSnapshot(loaded.actor))]);
    return { intake_id:intakeId, package_id:snapshot.package_id, revision:1, state:'prepared',
      history_completeness:snapshot.history_completeness, original_review_id:originalReview ? originalReview.id : null,
      required_detail_evidence:snapshot.detail_versions.map(detail => ({ detail_id:detail.detail_id,detail_version_id:detail.detail_version_id })),
      business_outcome:'intake_prepared', publication_id:null };
  }
  async function loadIntake(db, intakeId, actor, action, scope = {}) {
    const row = await one(db, 'SELECT i.*, CAST(i.package_id AS CHAR) package_id FROM process_data_governance_intakes i WHERE intake_id=? FOR UPDATE', [uuid(intakeId)]);
    if (!row) throw fail(404, 'HANDOFF_INTAKE_NOT_FOUND', '当前接入核验不存在或不可见');
    const loaded = await loadPackage(db, row.package_id, actor, action, scope);
    const snapshot = parseJson(row.snapshot_json);
    if (digest(snapshot) !== row.snapshot_digest || snapshot.source_hash !== loaded.source.content_hash) throw fail(409, 'HANDOFF_INTAKE_SNAPSHOT_DRIFT', '接入快照或固定来源发生漂移');
    return { row, loaded, snapshot };
  }
  async function scopedFacts(db, parentColumn, parentId) {
    const result = await rows(db, `SELECT f.* FROM process_data_governance_fact_versions f JOIN
      (SELECT fact_id,MAX(revision_no) revision_no FROM process_data_governance_fact_versions WHERE ${parentColumn}=? GROUP BY fact_id) h
      ON f.fact_id=h.fact_id AND f.revision_no=h.revision_no ORDER BY f.fact_id`, [parentId]);
    return result.map(row => {
      const snapshot=parseJson(row.snapshot_json);
      if(digest(snapshot)!==row.snapshot_digest || snapshot.fact_id!==row.fact_id) throw fail(409,'HANDOFF_FACT_SNAPSHOT_DRIFT','事实版本摘要或身份异常，不能继续审核');
      return {...snapshot,fact_version_id:row.fact_version_id,revision_no:Number(row.revision_no)};
    });
  }
  function mergeFacts(original, current) {
    const resolved = new Set(current.filter(fact => fact.status === 'closed' && fact.resolves_legacy_fact_id).map(fact => fact.resolves_legacy_fact_id));
    return [...original.map(fact => resolved.has(fact.fact_id) ? { ...fact, current_resolution_fact_id:current.find(item => item.resolves_legacy_fact_id === fact.fact_id && item.status === 'closed').fact_id, original_status:fact.status, status:'closed' } : fact), ...current];
  }
  async function reviewIntake(db, input, actor, context) {
    requireTransaction(db, context);
    inputFields(input,['intake_id','basis','detail_evidence'],context);
    const { row, loaded, snapshot } = await loadIntake(db, context.intake_id || input.intake_id, actor, 'review');
    expected(input.expected_revision, row.current_revision);
    if (row.state !== 'prepared') throw fail(409, 'HANDOFF_INTAKE_ALREADY_REVIEWED', '当前接入核验已确认，不能覆盖原核验');
    const evidence = Array.isArray(input.detail_evidence) ? input.detail_evidence : [];
    const evidenceMap = new Map(evidence.map(item => [id(item.detail_id), item]));
    if (evidenceMap.size !== evidence.length || evidenceMap.size !== snapshot.detail_versions.length) throw fail(422, 'HANDOFF_INTAKE_EVIDENCE_INCOMPLETE', '当前核验必须逐条覆盖准确明细，不得漏项或重复');
    for (const detail of snapshot.detail_versions) {
      const item = evidenceMap.get(detail.detail_id);
      if(item && Object.keys(item).some(key=>!['detail_id','detail_version_id','basis','evidence_refs'].includes(key))) throw fail(422,'HANDOFF_PAYLOAD_FIELD_DENIED','当前明细核验含不支持字段');
      if (!item || item.detail_version_id !== detail.detail_version_id || !text(item.basis)) throw fail(422, 'HANDOFF_INTAKE_EVIDENCE_INCOMPLETE', '当前核验未绑定准确明细修订及依据');
      refs(item.evidence_refs);
    }
    const currentFacts = await scopedFacts(db, 'intake_id', row.intake_id);
    const currentSnapshot = { ...snapshot, facts:mergeFacts(snapshot.facts,currentFacts), current_fact_versions:currentFacts };
    assertComplete(currentSnapshot);
    const basis = text(input.basis);
    if (!basis) throw fail(422, 'HANDOFF_REVIEW_BASIS_REQUIRED', '当前接入核验依据不能为空');
    const review = { review_record_id:nextId(),basis,detail_evidence:stableValue(evidence),actor:actorSnapshot(loaded.actor),reviewed_at:new Date().toISOString() };
    const binding = { ...currentSnapshot,binding_kind:'legacy_intake',intake_id:row.intake_id,intake_revision:Number(row.current_revision),review_record_id:null,
      current_intake_review:review,evidence_refs:[...new Set(evidence.flatMap(item => refs(item.evidence_refs)))].sort() };
    const result = await bindReview(db, binding, loaded.actor, context);
    await db.execute("UPDATE process_data_governance_intakes SET state='reviewed',current_revision=current_revision+1,review_json=? WHERE intake_id=?", [JSON.stringify(review),row.intake_id]);
    return { ...result,intake_id:row.intake_id,revision:Number(row.current_revision)+1,state:'reviewed' };
  }
  async function loadCorrection(db, correctionId, actor, action, scope = {}) {
    const row = await one(db, 'SELECT c.*, CAST(c.package_id AS CHAR) package_id FROM process_data_governance_corrections c WHERE correction_id=? FOR UPDATE', [uuid(correctionId)]);
    if (!row) throw fail(404, 'HANDOFF_CORRECTION_NOT_FOUND', '更正不存在或不可见');
    const loaded = await loadPackage(db, row.package_id, actor, action, scope);
    const revision = await one(db, 'SELECT * FROM process_data_governance_correction_revisions WHERE correction_id=? AND revision_no=?', [row.correction_id,row.current_revision]);
    if (!revision) throw fail(503, 'HANDOFF_CORRECTION_REVISION_MISSING', '更正修订缺失，拒绝继续办理');
    const snapshot = parseJson(revision.snapshot_json);
    if (digest(snapshot) !== revision.snapshot_digest || snapshot.source_hash !== loaded.source.content_hash) throw fail(409, 'HANDOFF_CORRECTION_SNAPSHOT_DRIFT', '更正或固定来源发生漂移');
    return { row,loaded,revision,snapshot };
  }
  async function appendCorrectionRevision(db, row, snapshot, input, actor, context) {
    const reason = text(input.reason || input.basis);
    if (!reason) throw fail(422, 'HANDOFF_CORRECTION_REASON_REQUIRED', '更正原因不能为空');
    const evidence = refs(input.evidence_refs);
    const revisionNo = Number(row.current_revision)+1, revisionId = nextId();
    await db.execute(`INSERT INTO process_data_governance_correction_revisions
      (correction_revision_id,correction_id,revision_no,snapshot_json,snapshot_digest,reason_text,evidence_json,actor_json,request_id)
      VALUES (?,?,?,?,?,?,?,?,?)`, [revisionId,row.correction_id,revisionNo,JSON.stringify(snapshot),digest(snapshot),reason,
      JSON.stringify(evidence),JSON.stringify(actorSnapshot(actor)),context.request_id]);
    await db.execute('UPDATE process_data_governance_corrections SET current_revision=? WHERE correction_id=?', [revisionNo,row.correction_id]);
    return { correction_id:row.correction_id,correction_revision_id:revisionId,package_id:row.package_id,revision:revisionNo,state:'draft',business_outcome:'correction_saved',publication_id:null };
  }
  async function createCorrection(db, input, actor, context) {
    const requestId = requireTransaction(db, context);
    inputFields(input,['package_id','replaces_binding_id','reason','basis','evidence_refs'],context);
    expected(input.expected_revision, 0);
    const loaded = await loadPackage(db, context.package_id || input.package_id, actor, 'prepare');
    if (loaded.packageRow.status !== 'completed') throw fail(409, 'HANDOFF_CORRECTION_PACKAGE_NOT_COMPLETED', '审核后更正只接收原已完成包');
    const binding = await one(db, 'SELECT b.*, CAST(b.package_id AS CHAR) package_id FROM process_data_governance_review_bindings b WHERE binding_id=? FOR SHARE', [uuid(input.replaces_binding_id)]);
    if (!binding || binding.package_id !== loaded.packageRow.id) throw fail(404, 'HANDOFF_BINDING_NOT_FOUND', '原审核绑定不属于当前包');
    const snapshot = parseJson(binding.snapshot_json);
    if (digest(snapshot) !== binding.binding_digest || snapshot.source_hash !== loaded.source.content_hash) throw fail(409, 'HANDOFF_BINDING_STALE', '原绑定内容或来源不一致');
    const correctionId = nextId();
    await db.execute(`INSERT INTO process_data_governance_corrections
      (correction_id,package_id,replaces_binding_id,current_revision,state,created_by_json,request_id)
      VALUES (?,?,?,1,'draft',?,?)`, [correctionId,loaded.packageRow.id,binding.binding_id,JSON.stringify(actorSnapshot(loaded.actor)),requestId]);
    // Insert revision 1 through the same append path; no original package update.
    return appendCorrectionRevision(db, { correction_id:correctionId,package_id:loaded.packageRow.id,current_revision:0 },
      { ...snapshot,replaces_binding_id:binding.binding_id },input,loaded.actor,context);
  }
  async function saveCorrection(db, input, actor, context) {
    requireTransaction(db, context);
    inputFields(input,['correction_id','details','reason','basis','evidence_refs'],context);
    const { row,loaded,snapshot } = await loadCorrection(db, context.correction_id || input.correction_id, actor, 'prepare');
    expected(input.expected_revision,row.current_revision);
    if (row.state !== 'draft') throw fail(409, 'HANDOFF_CORRECTION_REVIEWED', '已审核更正不可改写，请新建更正');
    if (!Array.isArray(input.details) || input.details.length === 0) throw fail(422, 'HANDOFF_CORRECTION_DETAILS_REQUIRED', '须明确本次更正明细');
    const patches = new Map();
    for (const patch of input.details) {
      const detailId = id(patch.detail_id);
      if (patches.has(detailId)) throw fail(422, 'HANDOFF_CORRECTION_DUPLICATE_DETAIL', '同一明细不能重复更正');
      if (Object.keys(patch).some(key => !['detail_id','expected_detail_version_id','status','governance','evidence_refs'].includes(key))) throw fail(422, 'HANDOFF_CORRECTION_FIELD_DENIED', '不能更改固定来源或候选字段');
      patches.set(detailId,patch);
    }
    const nextDetails = [];
    for (const previous of snapshot.detail_versions) {
      const patch = patches.get(previous.detail_id);
      if (!patch) { nextDetails.push(previous); continue; }
      if (patch.expected_detail_version_id !== previous.detail_version_id) throw fail(409, 'HANDOFF_REVISION_CONFLICT', '被更正明细修订已变化');
      if (!DETAIL_STATUSES.includes(patch.status)) throw fail(422, 'HANDOFF_DETAIL_STATUS_INVALID', '更正明细状态无效');
      const governance = object(patch.governance,'治理结论');
      if (COMPLETE_DETAIL_STATUSES.has(patch.status) && !text(governance.basis)) throw fail(422, 'HANDOFF_DETAIL_BASIS_REQUIRED', '完成处置必须有依据');
      const evidenceRefs = refs(patch.evidence_refs);
      const head = await one(db, 'SELECT MAX(revision_no) revision_no FROM process_data_governance_detail_versions WHERE detail_id=?', [previous.detail_id]);
      const revision = Number(head.revision_no)+1, versionId=nextId();
      const { detail_version_id:_oldId,revision_no:_oldRevision,...original } = previous;
      const changed = { ...original,status:patch.status,governance,evidence_refs:evidenceRefs,replaces_detail_version_id:previous.detail_version_id };
      await db.execute(`INSERT INTO process_data_governance_detail_versions
        (detail_version_id,detail_id,revision_no,snapshot_json,snapshot_digest,source_digest,actor_json,history_completeness,request_id)
        VALUES (?,?,?,?,?,?,?,?,?)`, [versionId,previous.detail_id,revision,JSON.stringify(changed),digest(changed),previous.source_digest,
        JSON.stringify(actorSnapshot(loaded.actor)),'append_only_since_intake',context.request_id]);
      nextDetails.push({ ...changed,detail_version_id:versionId,revision_no:revision });
      patches.delete(previous.detail_id);
    }
    if (patches.size) throw fail(404, 'HANDOFF_CORRECTION_DETAIL_NOT_FOUND', '更正包含原包之外的明细');
    return appendCorrectionRevision(db,row,{ ...snapshot,detail_versions:nextDetails },input,loaded.actor,context);
  }
  async function reviewCorrection(db, input, actor, context) {
    requireTransaction(db,context);
    inputFields(input,['correction_id','basis','evidence_refs'],context);
    const { row,loaded,revision,snapshot } = await loadCorrection(db,context.correction_id || input.correction_id,actor,'review');
    expected(input.expected_revision,row.current_revision);
    if (row.state !== 'draft') throw fail(409, 'HANDOFF_CORRECTION_REVIEWED', '更正已经审核，不可重写审核');
    const currentFacts = await scopedFacts(db,'correction_id',row.correction_id);
    const currentSnapshot = { ...snapshot,facts:mergeFacts(snapshot.facts,currentFacts),current_fact_versions:currentFacts };
    assertComplete(currentSnapshot);
    const basis = text(input.basis), evidence = refs(input.evidence_refs);
    if (!basis) throw fail(422, 'HANDOFF_REVIEW_BASIS_REQUIRED', '更正审核依据不能为空');
    const recordId = nextId();
    const binding = { ...currentSnapshot,binding_kind:'correction_review',native_review_id:null,intake_id:null,
      correction_revision_id:revision.correction_revision_id,review_record_id:recordId,
      correction_review:{ review_record_id:recordId,basis,evidence_refs:evidence,actor:actorSnapshot(loaded.actor),reviewed_at:new Date().toISOString() },
      evidence_refs:[...new Set([...(snapshot.evidence_refs || []),...evidence])].sort() };
    const result = await bindReview(db,binding,loaded.actor,context);
    await db.execute("UPDATE process_data_governance_corrections SET state='reviewed' WHERE correction_id=?",[row.correction_id]);
    return { ...result,correction_id:row.correction_id,correction_revision_id:revision.correction_revision_id,revision:Number(row.current_revision),state:'reviewed' };
  }
  async function captureNativeReview(db, input, actor, context) {
    const requestId = requireTransaction(db,context);
    inputFields(input,['package_id','native_review_id'],context);
    const loaded = await loadPackage(db,context.package_id || input.package_id,actor,'review');
    if (loaded.packageRow.status !== 'completed') throw fail(409,'HANDOFF_NATIVE_REVIEW_NOT_COMPLETED','必须在原审核事务完成包状态变更后绑定');
    const review = await one(db,'SELECT r.*, CAST(r.id AS CHAR) id FROM process_data_governance_reviews r WHERE id=? AND work_package_id=? FOR SHARE',[id(input.native_review_id),loaded.packageRow.id]);
    if (!review || review.review_type !== 'mdm_workgroup' || review.decision !== 'approved' || Number(review.package_revision_no)!==Number(loaded.packageRow.revision_no)) throw fail(409,'HANDOFF_NATIVE_REVIEW_STALE','原生审核须对应本包本次准确审核修订');
    // A historical completed review must enter through intake, never this hook.
    // The completion hook supplies the ID captured from the INSERT in this transaction.
    if (String(context.native_review_id) !== review.id || context.native_completion !== true) throw fail(503,'HANDOFF_NATIVE_COMPLETION_CONTEXT_REQUIRED','原生绑定只接受当前审核事务内部上下文');
    const snapshot = await capture(db,loaded,requestId,'append_only_since_native_review');
    const nativeHistory=require('./dataMapNativeHistory');
    const factVersions=[];
    for(const original of snapshot.facts) factVersions.push(await nativeHistory.captureFact(db,
      await nativeHistory.fact(db,original.fact_id),loaded.actor,requestId,'captured_current_only'));
    snapshot.current_fact_versions=factVersions;
    snapshot.facts=factVersions.map(fact=>({...fact,legacy_record:true}));
    assertComplete(snapshot);
    return bindReview(db,{ ...snapshot,binding_kind:'native_review',native_review_id:review.id,review_record_id:nextId(),
      native_review:review,evidence_refs:[`process_data_governance_review:${review.id}`] },loaded.actor,context);
  }
  async function factParent(db,input,actor,action,scope = {}) {
    if (input.correction_id) {
      const result=await loadCorrection(db,input.correction_id,actor,action,scope);
      if(result.row.state!=='draft') throw fail(409,'HANDOFF_CORRECTION_REVIEWED','已审核更正不可新增事实');
      return {...result,parent_column:'correction_id',parent_id:result.row.correction_id};
    }
    const result=await loadIntake(db,input.intake_id,actor,action,scope);
    if(result.row.state!=='prepared') throw fail(409,'HANDOFF_INTAKE_ALREADY_REVIEWED','已审核接入核验不可新增事实');
    return {...result,parent_column:'intake_id',parent_id:result.row.intake_id};
  }
  async function writeFact(db,snapshot,parent,actor,context,revisionNo) {
    const versionId=nextId();
    await db.execute(`INSERT INTO process_data_governance_fact_versions
      (fact_version_id,fact_id,package_id,correction_id,intake_id,revision_no,snapshot_json,snapshot_digest,actor_json,request_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,[versionId,snapshot.fact_id,parent.loaded.packageRow.id,
      parent.parent_column==='correction_id'?parent.parent_id:null,parent.parent_column==='intake_id'?parent.parent_id:null,
      revisionNo,JSON.stringify(snapshot),digest(snapshot),JSON.stringify(actorSnapshot(actor)),context.request_id]);
    // Facts alter the reviewed content. Append a correction revision or advance
    // the intake header, so a stale review cannot silently accept a new answer.
    const factualEvidence=snapshot.closure_evidence_refs?.length?snapshot.closure_evidence_refs:snapshot.evidence_refs;
    if(parent.parent_column==='correction_id') await appendCorrectionRevision(db,parent.row,{...parent.snapshot,
      fact_change:{fact_id:snapshot.fact_id,fact_version_id:versionId,revision_no:revisionNo}},
      {reason:snapshot.close_basis || snapshot.request_reason || '记录定向事实答复',evidence_refs:factualEvidence?.length?factualEvidence:[`process_data_governance_fact_version:${versionId}`]},actor,context);
    else await db.execute('UPDATE process_data_governance_intakes SET current_revision=current_revision+1 WHERE intake_id=?',[parent.parent_id]);
    return {fact_id:snapshot.fact_id,fact_version_id:versionId,revision:revisionNo,parent_revision:Number(parent.row.current_revision)+1,
      status:snapshot.status,business_outcome:'fact_saved',publication_id:null};
  }
  async function createFact(db,input,actor,context) {
    requireTransaction(db,context);expected(input.expected_revision,0);
    inputFields(input,['correction_id','intake_id','expected_parent_revision','detail_id','target_department_id','question_text','request_reason','requested_fact_type','resolves_legacy_fact_id'],context);
    if(Boolean(input.correction_id)===Boolean(input.intake_id)) throw fail(422,'HANDOFF_FACT_PARENT_INVALID','须明确一个更正或接入核验作为事实来源');
    const parent=await factParent(db,input,actor,'prepare');
    expected(input.expected_parent_revision,parent.row.current_revision);
    const detailId=id(input.detail_id),detail=parent.snapshot.detail_versions.find(item=>item.detail_id===detailId);
    if(!detail) throw fail(404,'HANDOFF_FACT_DETAIL_NOT_FOUND','事实问题必须指向本包已绑定明细');
    const target=id(input.target_department_id),question=text(input.question_text),reason=text(input.request_reason);
    if(!question || !reason || !text(input.requested_fact_type)) throw fail(422,'HANDOFF_FACT_INCOMPLETE','问题、事实类型和原因不能为空');
    const department=await one(db,"SELECT CAST(id AS CHAR) id FROM departments WHERE id=? AND status='active' FOR SHARE",[target]);
    if(!department) throw fail(422,'HANDOFF_FACT_TARGET_INVALID','目标部门无效');
    const resolves=input.resolves_legacy_fact_id ? id(input.resolves_legacy_fact_id):null;
    if(resolves && !parent.snapshot.facts.some(fact=>fact.fact_id===resolves && fact.detail_id===detailId)) throw fail(422,'HANDOFF_FACT_RESOLUTION_INVALID','旧事实补核必须对应同一明细的原事实');
    const snapshot={fact_id:nextId(),detail_id:detailId,detail_ref:detail.detail_ref,target_department_id:target,
      requested_fact_type:text(input.requested_fact_type),question_text:question,request_reason:reason,status:'open',
      resolves_legacy_fact_id:resolves,requested_by:actorSnapshot(parent.loaded.actor),evidence_refs:[]};
    return writeFact(db,snapshot,parent,parent.loaded.actor,context,1);
  }
  async function updateFact(db,input,actor,context,close) {
    requireTransaction(db,context);
    inputFields(input,close?['fact_id','expected_parent_revision','basis','evidence_refs']:['fact_id','expected_parent_revision','answer_text','evidence_refs'],context);
    const factId=uuid(context.fact_id || input.fact_id);
    const current=await one(db,'SELECT * FROM process_data_governance_fact_versions WHERE fact_id=? ORDER BY revision_no DESC LIMIT 1 FOR SHARE',[factId]);
    if(!current) throw fail(404,'HANDOFF_FACT_NOT_FOUND','事实问题不存在或不可见');
    const fact=parseJson(current.snapshot_json);
    if(digest(fact)!==current.snapshot_digest || fact.fact_id!==factId) throw fail(409,'HANDOFF_FACT_SNAPSHOT_DRIFT','事实版本摘要或身份异常，不能继续办理');
    const scope={target_department_id:fact.target_department_id,fact,factRequestId:factId,factKind:'handoff_correction'};
    const parent=await factParent(db,{correction_id:current.correction_id,intake_id:current.intake_id},actor,close?'prepare':'fact_answer',scope);
    expected(input.expected_revision,current.revision_no);
    expected(input.expected_parent_revision,parent.row.current_revision);
    if(!close) {
      if(fact.status!=='open') throw fail(409,'HANDOFF_FACT_NOT_OPEN','事实问题当前不能答复');
      actor=await authorize(db,actor,'fact_answer',parent.loaded.packageRow,scope);
      if(id(actor.departmentId,'当前部门')!==fact.target_department_id) throw fail(403,'HANDOFF_FACT_DEPARTMENT_DENIED','只能答复明确发给本人当前部门的问题');
      const answer=text(input.answer_text);if(!answer) throw fail(422,'HANDOFF_FACT_ANSWER_REQUIRED','事实答复不能为空');
      return writeFact(db,{...fact,status:'answered',answer_text:answer,evidence_refs:refs(input.evidence_refs),answered_by:actorSnapshot(actor)},parent,actor,context,Number(current.revision_no)+1);
    }
    if(fact.status!=='answered') throw fail(409,'HANDOFF_FACT_NOT_ANSWERED','事实未答复不能关闭，answered不能自动等同closed');
    const basis=text(input.basis);if(!basis) throw fail(422,'HANDOFF_FACT_CLOSE_BASIS_REQUIRED','须记录事实采用或不采用的依据');
    return writeFact(db,{...fact,status:'closed',close_basis:basis,closure_evidence_refs:refs(input.evidence_refs),closed_by:actorSnapshot(parent.loaded.actor)},parent,parent.loaded.actor,context,Number(current.revision_no)+1);
  }
  return { prepareIntake,reviewIntake,createCorrection,saveCorrection,reviewCorrection,captureNativeReview,
    createFact,answerFact:(db,input,actor,context)=>updateFact(db,input,actor,context,false),
    closeFact:(db,input,actor,context)=>updateFact(db,input,actor,context,true),bindReview };
}

module.exports={ LEGACY_SCHEMA_SQL,createDataMapHandoffLegacy,legacyError:fail,assertComplete,canonicalDigest:digest };
