// Pure, versioned material checks. No DB, network or governance writes.
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const { validateProcessGovernanceV7, validateProcessGovernanceV8, validateProcessGovernanceV9 } = require('../../../scripts/process-governance/v7-validator');
const { SUPPORTED_SCHEMAS } = require('./processNativeFormats');
const { json, digest } = require('./dataMapDefinitionValues');
const { collectContentChecks } = require('./processContentChecks');
const { collectContentChecks: collectV4ContentChecks } = require('./rules/v7-content-v4');
const VERSION = 'v7-deterministic-v5';
const CONTENT_V4_VERSION = 'v7-deterministic-v4';
const PREVIOUS_VERSION = 'v7-deterministic-v3';
const V2_VERSION = 'v7-deterministic-v2';
const LEGACY_VERSION = 'v7-deterministic-v1';
const PARSER = 'v7_deterministic';
const NATIVE_SCHEMA = 'process-governance-v7';
// Historical rule admission is independent of the current product's default.
const V8_SCHEMA = 'process-governance-v8';
const V9_SCHEMA = 'process-governance-v9';
// Admission is separate from material validity. Missing declarations and failed
// JSON parsing still reach the original format checks; declared other formats do not.
function inputFormat(input, ruleVersion = VERSION) {
  const d = input.document, stored = input.snapshot || {};
  const hasDocument = Object.hasOwn(input, 'document');
  const declared = hasDocument ? !!d && typeof d === 'object' && Object.hasOwn(d, 'schema_version') : Object.hasOwn(stored, 'schema_version');
  const value = hasDocument ? d?.schema_version : stored.schema_version;
  const schema_version = typeof value === 'string' ? value : null;
  const format_state = stored.validation_status === 'parse_failed' ? 'parse_failed' : !declared ? 'undeclared'
    : schema_version === NATIVE_SCHEMA ? 'native_v7'
      : schema_version === V8_SCHEMA && [PREVIOUS_VERSION, CONTENT_V4_VERSION, VERSION].includes(ruleVersion) ? 'native_v8'
        : schema_version === V9_SCHEMA && ruleVersion === VERSION ? 'native_v9' : 'unsupported';
  return { schema_version, format_state, supported: format_state !== 'unsupported', format_basis: hasDocument ? 'authorized_fixed_document' : 'fixed_snapshot' };
}
function assertSourceFormats(manifest, inputs) {
  const keys = new Set(manifest.steps.filter(s => s.parser_key === PARSER).flatMap(s => s.input_keys));
  const version = manifest.parser_versions[PARSER];
  if (inputs.some(i => keys.has(i.input_key) && (i.format_state === 'unsupported'
    || i.format_state === 'native_v8' && ![PREVIOUS_VERSION, CONTENT_V4_VERSION, VERSION].includes(version)
    || i.format_state === 'native_v9' && version !== VERSION
    || !i.format_state && inputFormat(i, version).format_state === 'unsupported'))) {
    throw Object.assign(new Error('DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED'), { code: 'DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED', statusCode: 409 });
  }
}
const knownVersion = v => [LEGACY_VERSION, V2_VERSION, PREVIOUS_VERSION, CONTENT_V4_VERSION, VERSION].includes(v);
const catalog = [
  ['v7.format', '技术结构格式', '固定原生V9或受支持V8/V7及待诊断JSON；按实际版本检查技术结构', '声明不支持的格式时拒绝；解析失败仅记录字节级格式证据'],
  ['v7.required', '明确必填属性', '可解析的原生V9/V8/V7或未声明格式JSON；仅检查Schema required', '允许的空字符串、空字段数组不视为缺失'],
  ['v7.duplicate', '重复标识及重复定义', 'Schema通过后调用共享纯校验器', '不按业务名称自动合并对象'],
  ['v7.local_integrity', '局部引用和关系约束', 'Schema通过后调用共享纯校验器', '只说明原生版本技术约束，不代表业务错误'],
  ['v7.field_binding', '表单对象字段绑定', 'Schema通过；存在明确字段引用', '未声明字段引用不推断必填'],
  ['v7.isolated', '孤立行为待核实', '引用完整、标识唯一且行为多于一个', '单节点、结构缺失或引用歧义不适用'],
  ['v7.exit', '分支出口待核实', '引用完整、标识唯一；decision或parallel_split节点', 'action末节点、parallel_join末节点和未知类型不判错'],
  ['v7.branch_condition', '条件说明待核实', '引用完整、标识唯一；显式condition或loop关系', 'sequence、parallel关系不要求条件']
].map(([rule_id, title, prerequisite, not_applicable]) => ({ rule_id, rule_version: VERSION, title, prerequisite, not_applicable, enabled: true }));
catalog.push({ rule_id: 'v7.unreachable', rule_version: VERSION, title: '不可达检查', enabled: false,
  prerequisite: '须有明确入口及完整执行语义', not_applicable: '本项不可达规则未开启；V9入口用于数据引用校验，受支持V8/V7不推断入口或结束节点' });
const CHECKS = catalog.filter(r => r.enabled).map(r => r.rule_id).sort();
const LEGACY_CHECKS = [...CHECKS];
catalog.push(...[
  ['v7.content_completeness', '业务编制完整性', '技术结构及局部引用通过；复用3001内容规则', '空数据对象、空表单及显式待确认内容仅提示核实，不补造事实'],
  ['v7.decision_branches', '判断分支与关系完整性', '技术结构及局部引用通过；检查声明的分支、条件及关系', '不从名称或排列推断入口、出口及业务判断结果'],
  ['v7.action_executability', '逐动作可执行性', '技术结构及局部引用通过；仅检查action的具体动作说明', '关键词检查是修订提示，需人工核对实际动作，不表示业务验收']
].map(([rule_id, title, prerequisite, not_applicable]) => ({ rule_id, rule_version: VERSION, title, prerequisite, not_applicable, enabled: true })));
CHECKS.push(...catalog.filter(r => r.enabled && !CHECKS.includes(r.rule_id)).map(r => r.rule_id));
CHECKS.sort();
const checksForVersion = version => [CONTENT_V4_VERSION, VERSION].includes(version) ? CHECKS : knownVersion(version) ? LEGACY_CHECKS : [];
const schemaFiles = [1, 2, 7, 8, 9].map(v => path.resolve(__dirname, `../../../docs/contracts/process-governance-v${v}.schema.json`));
let compiledSchemas;
function schema(document) {
  // Queue admission/status/recovery must not pay CPU compilation cost. Compile
  // only inside rule evaluation, which the worker runs in a cancellable thread.
  if (!compiledSchemas) {
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    for (const file of schemaFiles.slice(0, 2)) ajv.addSchema(JSON.parse(fs.readFileSync(file, 'utf8')));
    const v7 = ajv.compile(JSON.parse(fs.readFileSync(schemaFiles[2], 'utf8')));
    const v8 = ajv.compile(JSON.parse(fs.readFileSync(schemaFiles[3], 'utf8')));
    const v9 = ajv.compile(JSON.parse(fs.readFileSync(schemaFiles[4], 'utf8')));
    compiledSchemas = { 'process-governance-v7': v7, 'process-governance-v8': v8, 'process-governance-v9': v9 };
  }
  const compiledSchema = compiledSchemas[document?.schema_version] || compiledSchemas[NATIVE_SCHEMA];
  const valid = compiledSchema(document); schema.errors = compiledSchema.errors; return valid;
}
const escape = s => String(s).replace(/~/g, '~0').replace(/\//g, '~1');
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Canonical traversal makes duplicate selection deterministic. Positions are mapped
// back to the original fixed document for evidence, never used as finding identity.
function canonical(document) {
  const pointers = new Map();
  function walk(value, at = '', original = '', semantic = 'document') {
    pointers.set(at, { original, semantic });
    if (Array.isArray(value)) return value.map((v, i) => ({ v, i })).sort((a, b) => cmp(json(a.v), json(b.v))).map(({ v, i }, n) => {
      const refKey = v && typeof v === 'object' && ['record_ref', 'archive_ref', 'call_ref', 'event_ref', 'route_ref', 'area_ref', 'link_ref', 'source_link_ref', 'relation_ref', 'field_ref', 'item_ref', 'behavior_ref', 'data_ref', 'form_ref', 'term_ref', 'material_ref'].find(k => typeof v[k] === 'string' && v[k]);
      const identity = refKey ? `${refKey}=${encodeURIComponent(v[refKey])}` : `value=${digest(v)}`;
      return walk(v, `${at}/${n}`, `${original}/${i}`, `${semantic}[${identity}]`);
    });
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, walk(value[k], `${at}/${escape(k)}`, `${original}/${escape(k)}`, `${semantic}.${k}`)]));
    return value;
  }
  return { document: walk(document), pointers };
}
function enabledManifest(manifest) {
  return !manifest.ai_metadata && knownVersion(manifest.rule_version) &&
    Object.keys(manifest.parser_versions).length === 1 && manifest.parser_versions[PARSER] === manifest.rule_version &&
    manifest.inputs.every(i => i.snapshot.kind === 'v7_source') &&
    manifest.steps.every(s => s.parser_key === PARSER && s.input_keys.length === 1 && s.check_ids.every(id => checksForVersion(manifest.rule_version).includes(id)));
}
function analyze(task) {
  const ruleVersion = task.parser_version || task.rule_version || VERSION;
  if (!knownVersion(ruleVersion) || task.step.check_ids.some(id => !checksForVersion(ruleVersion).includes(id))) return { status: 'failed', checked_ids: [], error_code: 'RULE_VERSION_CHECK_SCOPE_MISMATCH', evidence: [], findings: [] };
  // Applies to direct calls and CPU threads, including old queued/recovered runs.
  // A refusal has zero coverage and no material finding; it is not a business defect.
  if (task.inputs.some(i => Object.hasOwn(i.snapshot || {}, 'schema_version') && i.snapshot.schema_version !== (typeof i.document?.schema_version === 'string' ? i.document.schema_version : null))) return { status: 'failed', checked_ids: [], error_code: 'SOURCE_FORMAT_METADATA_MISMATCH', evidence: [], findings: [] };
  if (task.inputs.some(i => inputFormat(i, task.parser_version || task.rule_version || VERSION).format_state === 'unsupported')) return { status: 'failed', checked_ids: [], error_code: 'SOURCE_FORMAT_UNSUPPORTED', evidence: [], findings: [] };
  const requested = task.step.check_ids;
  const evidence = [], findings = [], completed = new Set(requested);
  const seen = new Set();
  for (const input of task.inputs) {
    const { document, pointers } = canonical(input.document);
    const label = document?.schema_version === V9_SCHEMA ? 'V9' : document?.schema_version === V8_SCHEMA ? 'V8' : 'V7';
    const covered = new Set(), notes = new Map();
    function add(rule, pointer, detail, qualifier = '', type = 'material_constraint') {
      if (!requested.includes(rule)) return;
      let p = pointer === '/' ? '' : pointer;
      while (!pointers.has(p)) p = p.slice(0, p.lastIndexOf('/'));
      const location = pointers.get(p);
      const semantic = `${location.semantic}:${qualifier}`;
      const semantic_locator = semantic.length <= 512 ? semantic : `location-sha256=${digest(semantic)}`;
      const identity = json([input.input_key, rule, semantic_locator]);
      if (seen.has(identity)) return;
      seen.add(identity);
      const evidence_key = 'e' + digest(identity).slice(0, 48);
      evidence.push({ evidence_key, input_key: input.input_key, locator_kind: document === null ? 'document_anchor' : 'json_pointer', locator: document === null ? 'parsed-null' : location.original, note: detail });
      findings.push({ rule_id: rule, finding_type: type, message: detail, subject_input_keys: [input.input_key], semantic_locator, evidence_keys: [evidence_key] });
    }
    if (input.snapshot.validation_status === 'parse_failed') {
      // No parsed JSON pointer can prove a byte-level parse failure. Keep a declared
      // anchor plus a covered format finding; all other checks remain missing.
      if (requested.includes('v7.format')) {
        const evidence_key = 'e' + digest([input.input_key, 'parse']).slice(0, 48);
        evidence.push({ evidence_key, input_key: input.input_key, locator_kind: 'document_anchor', locator: 'raw-upload', note: '固定来源登记为无法解析；引用原始字节摘要，未伪造JSON位置。' });
        findings.push({ rule_id: 'v7.format', finding_type: 'material_constraint', message: '固定来源未能解析为JSON，其余V7检查未执行，需核对原件。', subject_input_keys: [input.input_key], semantic_locator: 'document:parse', evidence_keys: [evidence_key] });
        covered.add('v7.format');
      }
    } else {
      const valid = schema(document);
      covered.add('v7.format'); covered.add('v7.required');
      for (const error of schema.errors || []) {
        const rule = error.keyword === 'required' ? 'v7.required' : 'v7.format';
        add(rule, error.instancePath, error.keyword === 'required' ? `${label}技术结构缺少明确必填属性：${error.params.missingProperty}；不据此推断业务事实。` : `材料不符合${label}技术结构约束（${error.keyword}），请核对固定位置。`,
          `${error.keyword}:${json(error.params)}`);
      }
      if (valid) {
        const validate = document.schema_version === V9_SCHEMA ? validateProcessGovernanceV9
          : document.schema_version === V8_SCHEMA ? validateProcessGovernanceV8 : validateProcessGovernanceV7;
        const local = validate(document, { schemaValidator: schema });
        const shared = ['v7.duplicate', 'v7.local_integrity', 'v7.field_binding'];
        shared.forEach(r => covered.add(r));
        for (const error of local.errors) {
          const rule = /重复/.test(error.message) ? 'v7.duplicate' : /data_field_ref|item_type/.test(error.path) ? 'v7.field_binding' : 'v7.local_integrity';
          add(rule, error.path, rule === 'v7.duplicate' ? `共享${label}校验发现重复标识或重复定义，需核对该固定位置。` : rule === 'v7.field_binding' ? `表单字段引用、所属对象或字段类型不符合共享${label}绑定约束。` : `固定位置的局部引用或关系不符合共享${label}技术约束，需核对材料。`, `${error.keyword}:${error.rule_code || ''}:${json(error.params)}`);
        }
        if (local.valid) {
          const nodes = document.behaviors, edges = document.flow_relations;
          for (const r of ['v7.isolated', 'v7.exit', 'v7.branch_condition']) covered.add(r);
          nodes.forEach((n, i) => {
            const out = edges.filter(e => e.from_behavior_ref === n.behavior_ref), incoming = edges.filter(e => e.to_behavior_ref === n.behavior_ref);
            if (nodes.length > 1 && !out.length && !incoming.length) add('v7.isolated', `/behaviors/${i}`, '该行为在材料中没有相连流程关系；是否为独立行为或遗漏关系，待业务核实。', 'isolated', 'needs_verification');
            if (['decision', 'parallel_split'].includes(n.node_type) && !out.length) add('v7.exit', `/behaviors/${i}`, '材料将该节点标为判断或并行分支，但未声明出口；具体分支语义待核实。', 'no-declared-exit', 'needs_verification');
          });
          edges.forEach((e, i) => { if (['condition', 'loop'].includes(e.relation_type) && !e.condition.trim()) add('v7.branch_condition', `/flow_relations/${i}/condition`, '材料声明条件或循环关系，但条件说明为空；是否缺少触发或返回条件，待核实。', 'empty-condition', 'needs_verification'); });
          notes.set('v7.isolated', nodes.length <= 1 ? '不适用：零或单行为不判孤立。' : '已按材料声明的关系检查；发现仅待核实。');
          notes.set('v7.exit', '仅检查decision和parallel_split是否声明出口；不推断开始或结束节点。');
          notes.set('v7.branch_condition', '仅检查condition和loop关系；sequence和parallel不要求条件。');
          if ([CONTENT_V4_VERSION, VERSION].includes(ruleVersion)) {
            // Recovered v4 runs retain their original scoring and normalization.
            // A new default evaluator must not silently reinterpret their manifest.
            const content = ruleVersion === CONTENT_V4_VERSION
              ? collectV4ContentChecks(document) : collectContentChecks(document);
            if (content.status === 'ready') {
              for (const id of CHECKS.filter(id => !LEGACY_CHECKS.includes(id))) {
                covered.add(id); notes.set(id, '已复用3001内容规则核对固定正文；缺项需修订，待确认内容不自动补造。');
              }
              for (const issue of content.issues) add(issue.check_id, issue.path, `${issue.group === 'confirmation' ? '待确认事项' : '编制缺项'}：${issue.message}`, issue.identity, 'needs_verification');
            }
          }
        }
      }
      for (const rule of requested.filter(r => covered.has(r))) evidence.push({ evidence_key: 'c' + digest([input.input_key, rule]).slice(0, 48), input_key: input.input_key,
        locator_kind: document === null ? 'document_anchor' : 'json_pointer', locator: document === null ? 'parsed-null' : '', note: `${rule}：${notes.get(rule) || '已检查固定来源的技术材料；无发现不代表业务正确。'}` });
    }
    for (const rule of requested) if (!covered.has(rule)) completed.delete(rule);
  }
  const checked_ids = [...completed].sort();
  // A rule is covered only if all its fixed inputs were evaluated. Never persist
  // a subset as a complete cross-input check.
  const kept = findings.filter(f => completed.has(f.rule_id));
  const status = checked_ids.length === requested.length ? 'succeeded' : checked_ids.length ? 'partial' : 'failed';
  if (evidence.length > 256 || kept.length > 256 || Buffer.byteLength(json({ evidence, findings: kept })) > 900000) return { status: 'failed', checked_ids: [], error_code: 'RESULT_LIMIT_EXCEEDED', evidence: [], findings: [] };
  return { status, checked_ids, error_code: status === 'succeeded' ? null : 'INPUT_INCOMPLETE', evidence: status === 'failed' ? [] : evidence.sort((a, b) => cmp(a.evidence_key, b.evidence_key)), findings: status === 'failed' ? [] : kept.sort((a, b) => cmp(json(a), json(b))) };
}
module.exports = { VERSION, LEGACY_VERSION, PREVIOUS_VERSION, CONTENT_V4_VERSION, V2_VERSION, PARSER, NATIVE_SCHEMA, NATIVE_SCHEMAS: SUPPORTED_SCHEMAS, CHECKS, LEGACY_CHECKS, checksForVersion, catalog, analyze, enabledManifest, schemaFiles, inputFormat, assertSourceFormats, knownVersion };
