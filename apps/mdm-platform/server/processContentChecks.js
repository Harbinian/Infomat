// Pure diagnostics shared with 3001. Never fills source facts or writes governance records.
const RULE_VERSION = 'process-content-checks-v2';
const pointer = value => !value || value.startsWith('/') ? value || ''
  : '/' + value.split('.').map(part => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
function valueAt(document, at) {
  return at.split('/').slice(1).reduce((value, part) => value?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], document);
}
function normalize(document, issue, options = {}) {
  let path = pointer(issue.path || issue.focusPath);
  if (!path && issue.focusRef) {
    const find = (value, at = '') => {
      if (!value || typeof value !== 'object') return null;
      if (Object.entries(value).some(([key, ref]) => key.endsWith('_ref') && ref === issue.focusRef)) return at;
      for (const [key, child] of Object.entries(value)) {
        const found = find(child, at + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'));
        if (found !== null) return found;
      }
      return null;
    };
    path = find(document) || '';
  }
  const absentObjects = issue.category === '数据对象' && !document.data_objects?.length
    || issue.category === '表单结构' && !document.forms?.length;
  const value = valueAt(document, path);
  const actorNeedsCatalog = path.endsWith('/current_actor_role') && typeof value === 'string' && value.trim() && !Array.isArray(options.departments);
  const v9DataRule = document.schema_version === 'process-governance-v9' && /^V9_DATA_[A-Z_]+$/.test(issue.ruleCode || '');
  const pending = absentObjects || actorNeedsCatalog || ['pending_confirmation', 'needs_recheck', 'unspecified'].includes(value)
    || typeof value === 'string' && /待确认|待核对/.test(value)
    || /待确认|尚未确认|尚未回答|需要重新核对/.test(issue.message)
    || v9DataRule && /(?:_PENDING|_ENTRY_UNKNOWN)$/.test(issue.ruleCode);
  const behavior = /^\/behaviors\/(\d+)/.exec(path);
  const relation = /^\/flow_relations\/(\d+)/.exec(path);
  let identity = issue.ruleCode || issue.message.replace(/流程关系\d+|第\d+项/g, '<item>');
  // Messages are evidence; editable names and displayed row numbers are not identity.
  for (const name of [...(document.behaviors || []), ...(document.data_objects || []), ...(document.forms || [])]
    .flatMap(item => [item.behavior_name, item.data_name, item.form_name]).filter(Boolean).sort((a, b) => b.length - a.length)) identity = identity.replaceAll(name, '<subject>');
  return { category: issue.category, message: actorNeedsCatalog ? '执行部门及岗位需要结合3000当前有效部门核对；固定来源分析不推断部门身份。' : issue.message, path,
    group: pending ? 'confirmation' : 'incomplete', rule_code: issue.ruleCode || null, identity,
    // Existence and record-scope unknowns remain visible as confirmations, but
    // cannot pass a formal gate. This flag is derived from the server evaluator,
    // never copied from a field or claimed approval in the uploaded document.
    ...(v9DataRule ? { blocking: true } : {}),
    behavior_ref: issue.focusKind === 'behavior' ? issue.focusRef : behavior ? document.behaviors[Number(behavior[1])]?.behavior_ref : null,
    relation_ref: issue.focusKind === 'relation' ? issue.focusRef : relation ? document.flow_relations[Number(relation[1])]?.relation_ref : null,
    suggestions: issue.suggestions || [],
    check_id: issue.category === '逐动作可执行性' ? 'v7.action_executability'
      : ['判断出口', '行为关系', '回路', '并行结构'].includes(issue.category) ? 'v7.decision_branches' : 'v7.content_completeness' };
}
function collectContentChecks(document, technicalErrors = [], scoring, options = {}) {
  const technical = technicalErrors.map(issue => ({ ...issue, path: pointer(issue.path || issue.field), group: 'technical', category: '技术结构' }));
  let status = technical.length ? 'not_run' : 'ready', content = [];
  if (!technical.length) {
    try {
      const rules = scoring || require('../../structured-output-service/public/structure-score');
      if (!rules?.evaluateContent || !rules?.behaviorExecutabilityDetails) throw new Error('CONTENT_RULES_UNAVAILABLE');
      content = rules.evaluateContent(document, options).issues.map(issue => normalize(document, issue, options));
      // The case's explicit, valid owner assignment satisfies this governance field
      // without filling or rewriting the immutable uploaded body.
      if (options.owningDepartmentName && options.departments?.includes(options.owningDepartmentName)) {
        content = content.filter(issue => issue.path !== '/process/owning_department' || document.process?.owning_department?.trim());
      }
      for (const detail of rules.behaviorExecutabilityDetails(document).issues) {
        const message = detail.reason === 'missing_description'
          ? `“${detail.behaviorLabel}”未填写具体动作说明，无法判断执行人员需要逐步完成哪些动作。`
          : detail.reason === 'abstract_qualitative_description'
            ? `“${detail.behaviorLabel}”的具体动作说明使用“${detail.matchedPattern}”这类抽象、定性表述，不能看出实际执行动作。`
            : `“${detail.behaviorLabel}”的具体动作说明未写出可识别的具体业务动作。`;
        content.push(normalize(document, { category: '逐动作可执行性', message,
          ruleCode: `BEHAVIOR_EXECUTABILITY_${detail.reason.toUpperCase()}`,
          focusPath: `behaviors.${detail.behaviorIndex}.behavior_description`,
          suggestions: ['按实际顺序填写每个动作，写明处理对象和产生的结果。'] }, options));
      }
    } catch {
      status = 'unavailable';
      content = [{ group: 'confirmation', category: '检查状态', path: '',
        message: '业务内容检查未完成，请联系维护人员重新检查。未完成检查不能视为没有问题。', suggestions: [] }];
    }
  }
  const issues = [...new Map([...technical, ...content].map(issue => [JSON.stringify([issue.group, issue.path, issue.message]), issue])).values()];
  return { rule_version: RULE_VERSION, status, issues,
    counts: Object.fromEntries(['technical', 'incomplete', 'confirmation'].map(group => [group, issues.filter(issue => issue.group === group).length])) };
}
function contentBlockingIssues(checks) {
  if (checks.status !== 'ready') return [{ code: 'CONTENT_CHECK_UNAVAILABLE', message: '当前修订的业务内容检查未完成，不能继续正式流转。' }];
  return checks.issues.filter(issue => ['incomplete', 'confirmation'].includes(issue.group) || issue.blocking === true).map(issue => ({ ...issue,
    code: issue.group === 'confirmation' ? 'CONTENT_CONFIRMATION_REQUIRED' : 'CONTENT_INCOMPLETE', message: issue.message }));
}
module.exports = { RULE_VERSION, collectContentChecks, contentBlockingIssues };
