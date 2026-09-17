// Pure, versioned material checks. No DB, network or governance writes.
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const { validateProcessGovernanceV7 } = require('../../../scripts/process-governance/v7-validator');
const { json, digest } = require('./dataMapDefinitionValues');
const VERSION = 'v7-deterministic-v1';
const PARSER = 'v7_deterministic';
const catalog = [
  ['v7.format', '技术结构格式', '可解析的JSON；仅检查现有V7技术结构', '原字节无法解析时不适用'],
  ['v7.required', '明确必填属性', '可解析的JSON；仅检查Schema required', '允许的空字符串、空字段数组不视为缺失'],
  ['v7.duplicate', '重复标识及重复定义', 'Schema通过后调用共享纯校验器', '不按业务名称自动合并对象'],
  ['v7.local_integrity', '局部引用和关系约束', 'Schema通过后调用共享纯校验器', '只说明V7技术约束，不代表业务错误'],
  ['v7.field_binding', '表单对象字段绑定', 'Schema通过；存在明确字段引用', '未声明字段引用不推断必填'],
  ['v7.isolated', '孤立行为待核实', '引用完整、标识唯一且行为多于一个', '单节点、结构缺失或引用歧义不适用'],
  ['v7.exit', '分支出口待核实', '引用完整、标识唯一；decision或parallel_split节点', 'action末节点、parallel_join末节点和未知类型不判错'],
  ['v7.branch_condition', '条件说明待核实', '引用完整、标识唯一；显式condition或loop关系', 'sequence、parallel关系不要求条件']
].map(([rule_id, title, prerequisite, not_applicable]) => ({ rule_id, rule_version: VERSION, title, prerequisite, not_applicable, enabled: true }));
catalog.push({ rule_id: 'v7.unreachable', rule_version: VERSION, title: '不可达检查', enabled: false,
  prerequisite: '须有明确入口及完整执行语义', not_applicable: '现有V7没有开始/结束节点合同；不得由入度、排列或名称推断入口' });
const CHECKS = catalog.filter(r => r.enabled).map(r => r.rule_id).sort();
const schemaFiles = [1, 2, 7].map(v => path.resolve(__dirname, `../../../docs/contracts/process-governance-v${v}.schema.json`));
let compiledSchema;
function schema(document) {
  // Queue admission/status/recovery must not pay CPU compilation cost. Compile
  // only inside rule evaluation, which the worker runs in a cancellable thread.
  if (!compiledSchema) {
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    for (const file of schemaFiles.slice(0, 2)) ajv.addSchema(JSON.parse(fs.readFileSync(file, 'utf8')));
    compiledSchema = ajv.compile(JSON.parse(fs.readFileSync(schemaFiles[2], 'utf8')));
  }
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
  return !manifest.ai_metadata && manifest.rule_version === VERSION &&
    Object.keys(manifest.parser_versions).length === 1 && manifest.parser_versions[PARSER] === VERSION &&
    manifest.inputs.every(i => i.snapshot.kind === 'v7_source') &&
    manifest.steps.every(s => s.parser_key === PARSER && s.input_keys.length === 1 && s.check_ids.every(id => CHECKS.includes(id)));
}
function analyze(task) {
  const requested = task.step.check_ids;
  const evidence = [], findings = [], completed = new Set(requested);
  const seen = new Set();
  for (const input of task.inputs) {
    const { document, pointers } = canonical(input.document);
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
        add(rule, error.instancePath, error.keyword === 'required' ? `V7技术结构缺少明确必填属性：${error.params.missingProperty}；不据此推断业务事实。` : `材料不符合V7技术结构约束（${error.keyword}），请核对固定位置。`,
          `${error.keyword}:${json(error.params)}`);
      }
      if (valid) {
        const local = validateProcessGovernanceV7(document, { schemaValidator: schema });
        const shared = ['v7.duplicate', 'v7.local_integrity', 'v7.field_binding'];
        shared.forEach(r => covered.add(r));
        for (const error of local.errors) {
          const rule = /重复/.test(error.message) ? 'v7.duplicate' : /data_field_ref|item_type/.test(error.path) ? 'v7.field_binding' : 'v7.local_integrity';
          add(rule, error.path, rule === 'v7.duplicate' ? '共享V7校验发现重复标识或重复定义，需核对该固定位置。' : rule === 'v7.field_binding' ? '表单字段引用、所属对象或字段类型不符合共享V7绑定约束。' : '固定位置的局部引用或关系不符合共享V7技术约束，需核对材料。', `${error.keyword}:${error.rule_code || ''}:${json(error.params)}`);
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
module.exports = { VERSION, PARSER, CHECKS, catalog, analyze, enabledManifest, schemaFiles };
