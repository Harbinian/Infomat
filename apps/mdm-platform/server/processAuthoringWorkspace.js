// Explicitly saved compiler drafts. Preview submissions are immutable snapshots;
// the existing preview/formal repositories retain every business gate.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const schema = require('./processAuthoringWorkspaceSchema');
const { sessionSubject, identityInteger, sameIdentityInteger: same } = require('./sessionSubject');
const { readPersonAuthority } = require('./identityMysqlRepository');
const authoring = require('./processV7Authoring');
const governance = require('./processCaseGovernance');
const { contentHash, validateAndProjectProcess } = require('./processPreviewReview');
const { makeProcessPreviewReviewRepository } = require('./processPreviewReviewRepository');
const { SUPPORTED_SCHEMAS } = require('./processNativeFormats');
const validators = require('../../../scripts/process-governance/v7-validator');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enabled = () => process.env.PROCESS_AUTHORING_WORKSPACE_ENABLED === '1';
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const text = value => String(value == null ? '' : value).trim();
const fail = (code, message, statusCode = 409, extra = {}) => Object.assign(new Error(message), {
  code: 'PROCESS_AUTHORING_' + code, statusCode, payload: { code: 'PROCESS_AUTHORING_' + code, error: message, ...extra }
});
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const contracts = path.resolve(__dirname, '../../../docs/contracts');
for (const version of [1, 2]) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(contracts, `process-governance-v${version}.schema.json`), 'utf8')));
const structural = new Map(SUPPORTED_SCHEMAS.map(name => [name, ajv.compile(JSON.parse(fs.readFileSync(path.join(contracts, name + '.schema.json'), 'utf8')))]));

function validateDraftDocument(value) {
  const validator = structural.get(value?.schema_version);
  if (!validator) throw fail('FORMAT_UNSUPPORTED', '请通过编辑器兼容导入受支持的V9、V8或V7流程JSON', 422);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 8 * 1024 * 1024) throw fail('CONTENT_TOO_LARGE', '流程草稿超过8MB保存大小限制', 413);
  if (!validator(value)) throw fail('CONTENT_INVALID', '草稿JSON结构无效，当前已保存内容保持不变', 422, { details: validator.errors });
  const version = value.schema_version.slice(-1);
  const validation = validators['validateProcessGovernanceV' + version](value, { schemaValidator: validator });
  if (!validation.valid) throw fail('CONTENT_INVALID', '草稿结构或稳定引用无效，当前已保存内容保持不变', 422, { details: validation.errors });
  return structuredClone(value);
}
function inputSubmission(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 128000) throw fail('SUBMISSION_INVALID', '提交材料须为JSON对象且不超过128KB', 422);
  return structuredClone(value);
}
async function one(db, sql, params = []) { return (await db.execute(sql, params))[0][0] || null; }
const columns = `*,CAST(owning_department_id AS CHAR) owning_department_id,CAST(created_by_person_id AS CHAR) created_by_person_id,
  CAST(updated_by_person_id AS CHAR) updated_by_person_id,UNIX_TIMESTAMP(created_at) created_epoch,UNIX_TIMESTAMP(updated_at) updated_epoch`;
function publicDraft(row, includeDocument = true) {
  if (!row) return null;
  const document = parse(row.document_json), submission = parse(row.submission_json);
  return {
    id: row.draft_id, owning_department_id: identityInteger(row.owning_department_id),
    created_by_person_id: identityInteger(row.created_by_person_id), updated_by_person_id: identityInteger(row.updated_by_person_id),
    revision_no: Number(row.revision_no), content_hash: row.content_hash,
    case_id: row.case_id == null ? null : Number(row.case_id),
    source_case_revision_no: row.source_case_revision_no == null ? null : Number(row.source_case_revision_no),
    source_case_content_hash: row.source_case_content_hash,
    last_submitted_revision_no: row.last_submitted_revision_no == null ? null : Number(row.last_submitted_revision_no),
    last_submission_case_id: row.last_submission_case_id == null ? null : Number(row.last_submission_case_id),
    schema_version: document.schema_version, process_ref: document.process.process_ref, process_name: document.process.process_name,
    created_at: new Date(Number(row.created_epoch) * 1000).toISOString(), updated_at: new Date(Number(row.updated_epoch) * 1000).toISOString(),
    ...(includeDocument ? { document, submission } : {})
  };
}
async function currentActor(db, actor, write = false) {
  const subject = sessionSubject(actor);
  if (subject.kind === 'system_admin') {
    if (write) throw fail('ADMIN_READ_ONLY', '管理员对流程编制材料只读', 403);
    return { ...actor, personId: null, departmentId: null, roleCodes: new Set(['admin']), permissions: new Set(['governance:read-global']), admin: true };
  }
  const authority = await readPersonAuthority(db, actor, subject.personId, { currentRead: true });
  if (!authority.valid) throw fail('SESSION_CHANGED', '当前账号或人员资格已变化，请重新登录', 401);
  if (write && authority.readOnly) throw fail('ADMIN_READ_ONLY', '管理员对流程编制材料只读', 403);
  return { ...actor, userId: authority.user.personId, personId: authority.user.personId, departmentId: authority.user.current_department_id,
    departmentName: authority.user.departmentName, roleCodes: authority.roleCodes, permissions: authority.permissions,
    canReadGlobal: authority.permissions.has('governance:read-global'), admin: authority.readOnly,
    roleCode: ['mdm_lead', 'department_mdm_reviewer', 'department_contact'].find(code => authority.roleCodes.has(code)) || null };
}
function contact(actor, ownerId) {
  return !actor.admin && same(actor.departmentId, ownerId) && actor.roleCodes.has('department_contact') && actor.permissions.has('governance:draft-department') && actor.permissions.has('governance:submit-department');
}
async function compiler(db, actor, caseRow, establishedBinding = undefined) {
  if (!caseRow || actor.admin || !same(actor.departmentId, caseRow.owning_department_id) || !authoring.enabled()) return false;
  const binding = establishedBinding === undefined ? await authoring.state(db, caseRow.id, true) : establishedBinding;
  if (!binding || !same(binding.compiler_person_id, actor.personId)) return false;
  actor.compilerAuthority ||= await authoring.activeActor(db, actor);
  return authoring.isCompiler(actor.compilerAuthority, caseRow, binding);
}
async function access(db, actor, row) {
  const caseRow = row.case_id == null ? null : await one(db, 'SELECT id,CAST(owning_department_id AS CHAR) owning_department_id,status FROM process_v7_preview_cases WHERE id=? FOR UPDATE', [row.case_id]);
  const currentOwner = !caseRow || same(caseRow.owning_department_id, row.owning_department_id);
  const managed = caseRow && await authoring.state(db, caseRow.id, true);
  const isCompiler = currentOwner && await compiler(db, actor, caseRow, managed);
  const isContact = currentOwner && contact(actor, row.owning_department_id);
  const ownNewDraft = currentOwner && row.case_id == null && same(actor.personId, row.created_by_person_id) && isContact;
  const save = !actor.admin && currentOwner && (caseRow ? isCompiler || !managed && isContact && same(actor.personId, row.created_by_person_id) : ownNewDraft) && caseRow?.status !== 'closed';
  const view = actor.permissions.has('governance:read-global') || isCompiler || isContact ||
    currentOwner && same(actor.departmentId, row.owning_department_id) && actor.permissions.has('governance:read-department');
  return { view, save, submit: isContact && caseRow?.status !== 'closed' };
}
async function describe(db, row, actor, includeDocument = true, knownRights = null) {
  const rights = knownRights || await access(db, actor, row);
  if (!rights.view) throw fail('SCOPE_DENIED', '无权读取该流程编制草稿', 403);
  const draft = publicDraft(row, includeDocument);
  if (row.case_id != null) {
    const source = await one(db, 'SELECT current_revision_no,current_content_hash FROM process_v7_preview_cases WHERE id=?', [row.case_id]);
    draft.source_changed = !source || Number(source.current_revision_no) !== Number(row.source_case_revision_no) || source.current_content_hash !== row.source_case_content_hash;
  } else draft.source_changed = false;
  return { draft, allowed_actions: ['view', ...(rights.save ? ['save'] : []), ...(rights.submit ? ['submit'] : [])] };
}
async function transaction(pool, action) {
  for (let attempt = 0; ; attempt++) {
    const db = await pool.getConnection();
    try { await db.beginTransaction(); const result = await action(db); await db.commit(); return result; }
    catch (error) { await db.rollback(); if (error.code === 'ER_LOCK_DEADLOCK' && attempt < 2) continue; throw error; }
    finally { db.release(); }
  }
}
// Reuse existing transaction-owning repositories without committing this outer
// draft transaction. All SQL and nested locks run on exactly this connection.
function transactionalPool(db) {
  const nested = { execute: (...args) => db.execute(...args), query: (...args) => db.query(...args),
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
  return { ...nested, getConnection: async () => nested };
}
async function assertReady(db) {
  if (!enabled()) throw fail('DISABLED', '3000内流程编制候选功能尚未开启', 503);
  if (!(await schema.inspectSchema(db)).ready) throw fail('SCHEMA_REQUIRED', '流程编制草稿结构尚未显式准备，保存入口保持关闭', 503);
}
async function draftRow(db, id) {
  if (!UUID.test(String(id))) throw fail('NOT_FOUND', '流程编制草稿不存在', 404);
  const row = await one(db, `SELECT ${columns} FROM process_authoring_drafts WHERE draft_id=? FOR UPDATE`, [id]);
  if (!row) throw fail('NOT_FOUND', '流程编制草稿不存在', 404);
  return row;
}
function assertExpected(row, body) {
  if (!Number.isSafeInteger(body.expected_revision_no) || body.expected_revision_no !== Number(row.revision_no) || body.expected_content_hash !== row.content_hash) {
    throw fail('REVISION_CONFLICT', '草稿已被其他操作保存，请保留本地输入并核对最新草稿', 409, { actual_revision_no: Number(row.revision_no) });
  }
}
async function request(db, body, actor, operation, action) {
  if (!UUID.test(String(body.request_id || ''))) throw fail('REQUEST_REQUIRED', '请提供唯一操作请求标识', 422);
  const hash = contentHash({ operation, actor_person_id: String(actor.personId), body });
  await db.execute('INSERT IGNORE INTO process_authoring_requests(request_id,actor_person_id,request_hash) VALUES (?,?,?)', [body.request_id, String(actor.personId), hash]);
  const prior = await one(db, 'SELECT CAST(actor_person_id AS CHAR) actor_person_id,request_hash,response_json FROM process_authoring_requests WHERE request_id=? FOR UPDATE', [body.request_id]);
  if (!same(prior.actor_person_id, actor.personId) || prior.request_hash !== hash) throw fail('IDEMPOTENCY_CONFLICT', '同一请求标识对应的内容或操作者不同');
  if (prior.response_json) return { ...parse(prior.response_json), idempotent: true };
  const result = { ...await action(), idempotent: false };
  await db.execute('UPDATE process_authoring_requests SET response_json=? WHERE request_id=?', [JSON.stringify(result), body.request_id]);
  return result;
}
async function snapshot(db, row, actor, operation) {
  await db.execute(`INSERT INTO process_authoring_revisions(draft_id,revision_no,content_hash,document_json,submission_json,actor_person_id,operation,case_id,case_revision_no,case_content_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [row.draft_id, row.revision_no, row.content_hash, typeof row.document_json === 'string' ? row.document_json : JSON.stringify(row.document_json),
    row.submission_json == null ? null : typeof row.submission_json === 'string' ? row.submission_json : JSON.stringify(row.submission_json), String(actor.personId), operation, row.case_id, row.source_case_revision_no, row.source_case_content_hash]);
}

function makeProcessAuthoringWorkspace(pool) {
  return {
    async status() { return { enabled: enabled(), schema_ready: enabled() ? (await schema.inspectSchema(pool)).ready : false, supported_schemas: SUPPORTED_SCHEMAS }; },
    async list(actor, options = {}) {
      return transaction(pool, async db => {
        await assertReady(db); actor = await currentActor(db, actor);
        const limit = Math.floor(Math.min(100, Math.max(1, Number(options.limit) || 50)));
        const global = actor.permissions.has('governance:read-global');
        const [rows] = await db.execute(`SELECT ${columns} FROM process_authoring_drafts WHERE (?=1 OR owning_department_id=CAST(? AS SIGNED)) ORDER BY updated_at DESC,draft_id DESC LIMIT ${limit + 1}`, [global ? 1 : 0, String(actor.departmentId || 0)]);
        const items = [];
        for (const row of rows.slice(0, limit)) {
          const rights = await access(db, actor, row);
          if (rights.view) items.push((await describe(db, row, actor, false, rights)).draft);
        }
        return { items, truncated: rows.length > limit, allowed_actions: contact(actor, actor.departmentId) ? ['create_draft'] : [] };
      });
    },
    async get(id, actor) { return transaction(pool, async db => { await assertReady(db); const row = await draftRow(db, id); actor = await currentActor(db, actor); return describe(db, row, actor); }); },
    async create(body, actor, fromCaseId = null) {
      return transaction(pool, async db => {
        await assertReady(db);
        let source = null, binding = null, document, submission;
        if (fromCaseId != null) {
          if (!identityInteger(String(fromCaseId))) throw fail('CASE_NOT_FOUND', '流程案例不存在', 404);
          source = await one(db, 'SELECT *,CAST(owning_department_id AS CHAR) owning_department_id FROM process_v7_preview_cases WHERE id=? FOR UPDATE', [String(fromCaseId)]);
          if (!source) throw fail('CASE_NOT_FOUND', '流程案例不存在', 404);
        }
        actor = await currentActor(db, actor, true);
        if (source) {
          if (!contact(actor, source.owning_department_id) && !await compiler(db, actor, source)) throw fail('SCOPE_DENIED', '仅当前归口主对接人或明确编制人可以续修案例', 403);
          if (source.status === 'closed') throw fail('CASE_CLOSED', '历史关闭案例不能继续编制');
          const row = await one(db, 'SELECT content_json FROM process_v7_preview_revisions WHERE id=? AND case_id=?', [source.current_revision_id, source.id]);
          if (!row) throw fail('SOURCE_CONFLICT', '来源修订不存在，请先核对案例');
          document = validateDraftDocument(parse(row.content_json));
          submission = (await governance.read(db, source)).submission;
          binding = { case_id: source.id, source_case_revision_no: source.current_revision_no, source_case_content_hash: source.current_content_hash };
        } else {
          if (!contact(actor, actor.departmentId)) throw fail('SCOPE_DENIED', '须由本部门当前有效主对接人建立流程编制草稿', 403);
          document = validateDraftDocument(body.document); submission = inputSubmission(body.submission);
        }
        return request(db, body, actor, 'create:' + (fromCaseId || 'new'), async () => {
          if (source && (!Number.isSafeInteger(body.expected_revision_no) || body.expected_revision_no !== Number(source.current_revision_no) || body.expected_content_hash !== source.current_content_hash)) {
            throw fail('SOURCE_CONFLICT', '所选案例修订已变化，请核对最新案例后再建立续修草稿');
          }
          const id = crypto.randomUUID();
          await db.execute(`INSERT INTO process_authoring_drafts(draft_id,owning_department_id,created_by_person_id,updated_by_person_id,case_id,source_case_revision_no,source_case_content_hash,revision_no,content_hash,document_json,submission_json)
            VALUES (?,?,?,?,?,?,?,1,?,?,?)`, [id, String(source?.owning_department_id || actor.departmentId), String(actor.personId), String(actor.personId), binding?.case_id || null,
            binding?.source_case_revision_no || null, binding?.source_case_content_hash || null, contentHash(document), JSON.stringify(document), submission == null ? null : JSON.stringify(submission)]);
          const row = await draftRow(db, id); await snapshot(db, row, actor, 'create'); return describe(db, row, actor);
        });
      });
    },
    async save(id, body, actor) {
      return transaction(pool, async db => {
        await assertReady(db); const row = await draftRow(db, id); actor = await currentActor(db, actor, true);
        if (!(await access(db, actor, row)).save) throw fail('SCOPE_DENIED', '当前人员不是该草稿的编制人', 403);
        return request(db, body, actor, 'save:' + id, async () => {
          assertExpected(row, body); const document = validateDraftDocument(body.document);
          const previous = parse(row.document_json);
          if (document.process.process_ref !== previous.process.process_ref || document.export_meta.package_ref !== previous.export_meta.package_ref) throw fail('STABLE_REFERENCE_CHANGED', '同一草稿须保留流程及材料包稳定标识；其他流程请另建草稿', 422);
          const submission = body.submission === undefined ? parse(row.submission_json) : inputSubmission(body.submission);
          if (row.case_id != null) {
            const source = await one(db, 'SELECT id,owning_department_id,status FROM process_v7_preview_cases WHERE id=? FOR UPDATE', [row.case_id]);
            if (await authoring.state(db, row.case_id, true)) await authoring.assertCompiler(db, source, actor, { start: true });
          }
          await db.execute(`UPDATE process_authoring_drafts SET document_json=?,submission_json=?,content_hash=?,revision_no=revision_no+1,updated_by_person_id=?,updated_at=CURRENT_TIMESTAMP(3) WHERE draft_id=?`,
            [JSON.stringify(document), submission == null ? null : JSON.stringify(submission), contentHash(document), String(actor.personId), id]);
          const saved = await draftRow(db, id); await snapshot(db, saved, actor, 'save'); return describe(db, saved, actor);
        });
      });
    },
    async submit(id, body, actor) {
      return transaction(pool, async db => {
        await assertReady(db); const row = await draftRow(db, id); actor = await currentActor(db, actor, true);
        if (!(await access(db, actor, row)).submit) throw fail('SCOPE_DENIED', '须由实际归口部门当前有效主对接人本人提交', 403);
        return request(db, body, actor, 'submit:' + id, async () => {
          assertExpected(row, body);
          const repo = makeProcessPreviewReviewRepository(transactionalPool(db));
          const departments = await repo.listDepartments(), document = parse(row.document_json);
          const projected = validateAndProjectProcess(document, departments);
          if (projected.errors.length) throw fail('CONTENT_INVALID', '正文未通过现有流程校验，已保存草稿保留', 422, { details: projected.errors });
          if (!projected.owningDepartment || !same(projected.owningDepartment.id, row.owning_department_id)) throw fail('OWNER_MISMATCH', '正文归口须与草稿实际归口部门一致；归口变化按现有交接规则办理', 422);
          governance.assertSubmitter(actor, row.owning_department_id);
          const submission = body.submission === undefined ? parse(row.submission_json) : inputSubmission(body.submission);
          let result;
          if (row.case_id == null) result = await repo.createCase(projected, { sourceFileName: 'authoring-workspace.json', submission: submission || {} }, actor);
          else {
            const source = await one(db, 'SELECT *,CAST(owning_department_id AS CHAR) owning_department_id FROM process_v7_preview_cases WHERE id=? FOR UPDATE', [row.case_id]);
            if (!source || Number(source.current_revision_no) !== Number(row.source_case_revision_no) || source.current_content_hash !== row.source_case_content_hash) throw fail('SOURCE_CONFLICT', '原案例已形成新修订，请保留草稿并核对最新来源后再续修');
            if (source.process_ref !== document.process.process_ref) throw fail('STABLE_REFERENCE_CHANGED', '流程稳定标识与原案例不一致', 422);
            result = await repo.addRevision(source, projected, { sourceFileName: 'authoring-workspace.json', submission: submission || {},
              expectedRevisionNo: Number(row.source_case_revision_no), expectedContentHash: row.source_case_content_hash }, actor);
          }
          await db.execute(`UPDATE process_authoring_drafts SET case_id=?,source_case_revision_no=?,source_case_content_hash=?,last_submitted_revision_no=?,last_submission_case_id=?,
            submission_json=?,revision_no=revision_no+1,updated_by_person_id=?,updated_at=CURRENT_TIMESTAMP(3) WHERE draft_id=?`,
          [result.case.id, result.case.current_revision_no, result.case.current_content_hash, row.revision_no, result.case.id,
            submission == null ? null : JSON.stringify(submission), String(actor.personId), id]);
          if (row.case_id == null && authoring.enabled()) await authoring.markStarted(db, result.case.id);
          const saved = await draftRow(db, id); await snapshot(db, saved, actor, 'submit');
          return { ...await describe(db, saved, actor), case_detail: await repo.getCaseDetail(result.case.id) };
        });
      });
    }
  };
}
module.exports = { makeProcessAuthoringWorkspace, enabled, validateDraftDocument, transactionalPool };
