// Fixed design snapshots only. No business identity inference or conversion execution.
const { json, digest } = require('./dataMapDefinitionValues');
const VERSION = 'handoff-deterministic-v1', PARSER = 'handoff_deterministic';
const labels = { identity: '对象身份', identifier: '唯一及组合标识', fields: '字段映射', format: '格式', enum: '枚举', unit: '单位', version: '版次', conditions: '交付与接收说明', confirmation: '关系确认', scope: '适用范围', chain: '主链覆盖', coverage: '未覆盖范围说明' };
const CHECKS = Object.keys(labels).map(k => 'handoff.' + k);
const catalog = CHECKS.map(rule_id => ({ rule_id, rule_version: VERSION, title: labels[rule_id.slice(8)], prerequisite: '固定设计交接、台账版本与显式V7映射', not_applicable: '不证明真实接收，不从名称、文件名或历史主链推断关系' }));
function enabledManifest(m) {
  return !m.ai_metadata && m.rule_version === VERSION && Object.keys(m.parser_versions).length === 1 && m.parser_versions[PARSER] === VERSION &&
    m.inputs.every(i => i.snapshot.kind === 'handoff') && m.steps.every(s => s.parser_key === PARSER && s.input_keys.length === 1 && s.check_ids.every(c => CHECKS.includes(c)));
}
function inspect(s) {
  const rows = [], uncovered = [];
  function add(check, message, location = 'relation', type = 'business_question') { rows.push({ rule_id: 'handoff.' + check, finding_type: type, message, semantic_locator: location }); }
  const missing = (check, message) => uncovered.push({ rule_id: 'handoff.' + check, reason: message });
  for (const side of ['source', 'target']) if (!s[side]) add('fields', `${side === 'source' ? '来源' : '目标'}端未登记，连接断点待核实；不能据此认定业务不存在。`, side);
  if (!s.identity_rule || !s.identity_basis) add('identity', '对象身份对应规则或依据缺失；同名对象也不自动合并。');
  if (s.source && s.target && s.source.object_id !== s.target.object_id && (!s.identity_rule || !s.identity_basis)) add('identity', '两端平台对象身份不同，需核对显式对应依据。', 'distinct_objects');
  const ids = s.pairs.filter(p => p.identifier);
  if (s.identifier_kind === 'unknown' || s.identifier_kind === 'single' && ids.length !== 1 || s.identifier_kind === 'composite' && ids.length < 2 || ['source', 'target'].some(side => new Set(ids.map(p => p[side].field_id)).size !== ids.length)) add('identifier', '唯一或组合标识尚未完整对应，需核对各端字段及组合顺序。');
  if (!s.pairs.length) add('fields', '尚无明确字段映射，交接字段完整性待核实。');
  for (const p of s.pairs) {
    const loc = `field=${p.source.field_id}->${p.target.field_id}`;
    for (const dim of ['field', 'format', 'enum', 'unit', 'version']) {
      const c = p.checks[dim], rule = dim === 'field' ? 'fields' : dim;
      if (c.mode === 'pending' || !c.basis || c.mode === 'convert' && !c.rule) add(rule, `${labels[rule]}对应缺少明确规则或依据。`, loc);
      const a = p.source.definition, b = p.target.definition;
      const known = value => value !== null && value !== undefined && value !== '';
      const diff = dim === 'format' ? ['data_type', 'data_format', 'length_precision'].some(k => known(a[k]) && known(b[k]) && json(a[k]) !== json(b[k])) : dim === 'enum' ? Array.isArray(a.enum_values) && Array.isArray(b.enum_values) && json([...a.enum_values].sort()) !== json([...b.enum_values].sort()) : dim === 'version' ? p.source.field_id === p.target.field_id && p.source.field_version_id !== p.target.field_version_id : false;
      if (diff && c.mode === 'same') add(rule, `两端固定${labels[rule]}存在差异，却登记为无需转换，这是确定的登记矛盾。`, loc + ':conflict', 'definite_defect');
      if (dim === 'enum' && (a.enum_values === null || b.enum_values === null)) add(rule, '至少一端枚举允许值未知，不能判定兼容。', loc + ':unknown');
      if (c.mode === 'convert' && c.rule && c.basis) missing(rule, `${loc}：仅核对转换规则和依据已登记，未执行转换或证明业务等价。`);
    }
  }
  if (!s.delivery_condition) add('conditions', '交付条件待补充。', 'source');
  if (!s.reception_requirement) add('conditions', '接收要求待补充。', 'target');
  for (const side of ['source', 'target']) if (!s.evidence.some(e => e.side === side)) add('conditions', `${side === 'source' ? '来源' : '目标'}端证据尚缺定位，需补充原始依据。`, side + ':evidence');
  if (s.claim_status !== 'human_confirmed') add('confirmation', '此关系尚未经人工确认；连接情况仅为材料声明或分析待定。');
  missing('unit', '当前合同仅保存单位文字规则，未提供结构化单位、比例与数值样本；本轮不验证换算结果。');
  missing('scope', '当前交接合同没有结构化适用范围及有权确认依据，适用范围待业务核对。');
  missing('chain', '尚无用户确认的主链框架及完整输入集合；仅展示已登记两端连接，不判断主链完整或业务不存在。');
  return { rule_version: VERSION, rows, uncovered, connection: { source: s.source, target: s.target, confirmed: s.claim_status === 'human_confirmed' } };
}
function analyze(task) {
  const evidence = [], findings = [], checked = new Set(task.step.check_ids);
  for (const input of task.inputs) {
    const r = inspect(input.document), seen = new Set();
    const emit = row => {
      if (!task.step.check_ids.includes(row.rule_id)) return;
      const key = json([input.input_key, row.rule_id, row.semantic_locator]);
      if (seen.has(key)) return; seen.add(key);
      const keys = ['source', 'target'].map(side => {
        const evidence_key = 'e' + digest([key, side]).slice(0, 48);
        evidence.push({ evidence_key, input_key: input.input_key, locator_kind: 'json_pointer', locator: '/' + side, note: `${side === 'source' ? '来源' : '目标'}端固定交接快照；空值表示此端未登记。两端原文定位见同版本evidence。` });
        return evidence_key;
      });
      const evidence_key = 'e' + digest([key, 'details']).slice(0, 48);
      evidence.push({ evidence_key, input_key: input.input_key, locator_kind: 'json_pointer', locator: '', note: '同版本字段映射、转换说明及两端原始证据定位；原文锚点仅为声明，未声称已核对原件。' });
      findings.push({ ...row, subject_input_keys: [input.input_key], evidence_keys: [...keys, evidence_key] });
    };
    r.rows.forEach(emit);
    for (const gap of r.uncovered) {
      checked.delete(gap.rule_id);
      emit({ rule_id: 'handoff.coverage', finding_type: 'not_covered', message: gap.reason, semantic_locator: 'coverage:' + digest(gap.reason) });
    }
  }
  if (evidence.length > 256 || findings.length > 256 || Buffer.byteLength(json({ evidence, findings })) > 800000) return { status: 'failed', checked_ids: [], error_code: 'RESULT_LIMIT_EXCEEDED', evidence: [], findings: [] };
  return { status: checked.size === task.step.check_ids.length ? 'succeeded' : checked.size ? 'partial' : 'failed', checked_ids: [...checked].sort(), error_code: checked.size === task.step.check_ids.length ? null : 'INPUT_INCOMPLETE', evidence: checked.size ? evidence : [], findings: checked.size ? findings : [] };
}
module.exports = { VERSION, PARSER, CHECKS, catalog, enabledManifest, inspect, analyze };
