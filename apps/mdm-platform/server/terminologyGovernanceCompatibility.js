// Compatibility uses the old ID namespace only. New terms are created exclusively
// through the versioned API; no same-name match, inferred context or ID backfill.
const { enabled, projection, hash } = require('./terminologyGovernancePolicy');
const { MIGRATION_KEY } = require('./terminologyGovernanceSchema');
const { sameIdentityInteger } = require('./sessionSubject');
const fail = (code,message,statusCode=409) => Object.assign(new Error(message),{code,statusCode});
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
function assertLegacyWriteAllowed(env=process.env) {
  if (enabled(env)) throw fail('TERMINOLOGY_LEGACY_WRITE_RETIRED','公司统一术语治理已启用，旧入口仅作历史读取，请通过术语治理入口提报、修订和确认。');
}
async function assertReady(db) {
  const [[marker]] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]);
  if (!marker) throw fail('TERM_GOVERNANCE_MIGRATION_REQUIRED','术语治理显式迁移尚未就绪，不能退回旧写入。',503);
}
function mayReadPrivate(row,scope) {
  if (!scope) return false;
  if (scope.canViewAll) return true;
  if (sameIdentityInteger(row.created_by_person_id || row.created_by,scope.personId || scope.userId)) return true;
  if (sameIdentityInteger(row.process_owner_dept_id,scope.departmentId)) return true;
  return Boolean(scope.departmentName && [row.process_dept_name,row.input_source_dept,row.output_target_dept].includes(scope.departmentName));
}
async function getLegacyTerm(db,legacyId,scope=null,options={}) {
  await assertReady(db);
  const [[link]] = await db.execute('SELECT term_id,version_id,snapshot_json FROM tg_legacy_links WHERE legacy_table=? AND legacy_id=?',[ 'terminology_terms',String(legacyId) ]);
  if (!link) return null;
  const current = (await require('./terminologyGovernanceMigration').sourceRows(db,'terminology_terms',options.forShare,String(legacyId)))[0];
  if (!current || hash(current)!==hash(parse(link.snapshot_json))) throw fail('TERM_GOVERNANCE_LEGACY_SOURCE_CHANGED','旧术语与迁移快照不同，请核对来源变化；系统不会覆盖新词典或静默回退。');
  const [[legacy]] = await db.execute(`SELECT CAST(t.id AS CHAR) AS id,CAST(t.created_by AS CHAR) AS created_by,CAST(t.created_by_person_id AS CHAR) AS created_by_person_id,
    CAST(d.id AS CHAR) AS process_owner_dept_id,r.dept_name AS process_dept_name,r.input_source_dept,r.output_target_dept,r.l3_name AS process_name
    FROM terminology_terms t LEFT JOIN process_mapping_records r ON r.id=t.process_mapping_record_id LEFT JOIN departments d ON d.name=r.dept_name
    WHERE t.id=?${options.forShare?' FOR SHARE':''}`,[String(legacyId)]);
  if (!legacy) throw fail('TERM_GOVERNANCE_LEGACY_SOURCE_MISSING','历史术语来源发生变化，请核对显式迁移记录。');
  const [[head]] = await db.execute('SELECT * FROM tg_terms WHERE term_id=?'+(options.forShare?' FOR SHARE':''),[link.term_id]);
  if (!head) throw fail('TERM_GOVERNANCE_LEGACY_MAPPING_INVALID','历史术语映射不完整，请核对迁移记录。',503);
  if (!head.current_version_id && !mayReadPrivate(legacy,scope)) return null;
  const versionId = head.current_version_id || head.pending_version_id || link.version_id;
  const [[version]] = await db.execute('SELECT * FROM tg_term_versions WHERE version_id=? AND term_id=?',[versionId,head.term_id]);
  if (!version) throw fail('TERM_GOVERNANCE_LEGACY_MAPPING_INVALID','历史术语定义版本不可用，请核对迁移记录。',503);
  const p = projection(head,version), snapshot = parse(link.snapshot_json);
  return { ...snapshot, ...p, definition:p.legacy_unverified ? parse(version.content_json).definition : p.definition,
    id:String(legacyId), governance_term_id:p.term_id, governance_version_id:p.version_id,
    process_id:snapshot.process_mapping_record_id, process_name:legacy.process_name, process_owner_dept_id:legacy.process_owner_dept_id,
    process_dept_name:legacy.process_dept_name, scope:p.context, legacy_scope:snapshot.scope ?? null,
    status:snapshot.status, legacy_original_status:snapshot.status,
    legacy_notice:p.legacy_unverified ? '历史沿用，来源及适用依据待核；旧状态不等于按新治理规则已采纳。' : '旧编号已映射公司词典当前版本；旧状态及原字段仅用于历史追溯。',
    write_token:hash({namespace:'terminology_terms',id:String(legacyId),usage_token:p.usage_token}) };
}
async function listLegacyTerms(db,filters={}) {
  await assertReady(db);
  const [links] = await db.execute('SELECT legacy_id FROM tg_legacy_links WHERE legacy_table=? ORDER BY legacy_id',['terminology_terms']);
  const items=[];
  for (const link of links) {
    const item=await getLegacyTerm(db,link.legacy_id,filters);
    if (item && (!filters.status || item.status===filters.status)) items.push(item);
  }
  return items.sort((a,b)=>String(a.term).localeCompare(String(b.term),'zh-CN'));
}
module.exports={enabled,assertLegacyWriteAllowed,assertReady,mayReadPrivate,getLegacyTerm,listLegacyTerms};
