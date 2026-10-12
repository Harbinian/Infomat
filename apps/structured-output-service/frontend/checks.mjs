// Page-memory diagnostics only. Shared content rules do not change the document or block draft download.
import { catalog, readPath } from './model.mjs';

export const CHECK_GROUPS = Object.freeze([
  { key: 'technical', label: '技术错误', color: 'error', description: '文件结构、枚举、标识及引用错误。' },
  { key: 'incomplete', label: '编制缺项', color: 'warning', description: '需要补充的编制内容、分支定义及具体动作说明。' },
  { key: 'confirmation', label: '待确认事项', color: 'processing', description: '需要结合实际业务确认的内容；不自动补造事实。' }
]);

const pointer = path => !path || path.startsWith('/') ? path || ''
  : `/${path.split('.').map(part => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
const targetOf = entry => entry && ({ kind: entry.kind, ref: entry.ref, parentRef: entry.parentRef,
  formRef: entry.formRef, areaRef: entry.areaRef, dataRef: entry.dataRef, routeRef: entry.routeRef });

function contentIssue(document, issue, entries) {
  const path = pointer(issue.path || issue.focusPath);
  const owner = entries.filter(entry => path === entry.path || path.startsWith(`${entry.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0]
    || entries.find(entry => entry.ref === issue.focusRef && entry.kind === issue.focusKind);
  const value = issue.focusPath ? readPath(document, issue.focusPath) : undefined;
  const absentObjects = !owner && (issue.category === '数据对象' && !document.data_objects?.length
    || issue.category === '表单结构' && !document.forms?.length);
  const pending = absentObjects || ['pending_confirmation', 'needs_recheck', 'unspecified'].includes(value)
    || typeof value === 'string' && /待确认|待核对/.test(value)
    || /待确认|尚未确认|尚未回答|需要重新核对/.test(issue.message);
  return { ...issue, path, group: pending ? 'confirmation' : 'incomplete', severity: 'warning',
    target: targetOf(owner),
    focusField: owner && path.startsWith(`${owner.path}/`) ? path.slice(owner.path.length + 1).replaceAll('/', '.') : '',
    navigation: !owner ? issue.processSection || (issue.editorSection === 'forms' ? 'forms' : 'process') : null };
}

export function collectWorkbenchChecks(document, validation, scoring) {
  const technical = (validation.errors || []).map(issue => ({ ...issue, group: 'technical', severity: 'error' }));
  const warnings = (validation.warnings || []).map(issue => ({ ...issue, group: 'confirmation', severity: 'warning' }));
  let contentStatus = 'ready', content = [];
  try {
    if (!scoring?.evaluateContent || !scoring?.behaviorExecutabilityDetails) throw new Error('Content rules unavailable');
    const entries = catalog(document);
    content = scoring.evaluateContent(document).issues.map(issue => contentIssue(document, issue, entries));
    for (const detail of scoring.behaviorExecutabilityDetails(document).issues) {
      const missing = detail.reason === 'missing_description';
      const message = missing ? `“${detail.behaviorLabel}”未填写具体动作说明，无法判断执行人员需要逐步完成哪些动作。`
        : detail.reason === 'abstract_qualitative_description'
          ? `“${detail.behaviorLabel}”的具体动作说明使用“${detail.matchedPattern}”这类抽象、定性表述，不能看出实际执行动作。`
          : `“${detail.behaviorLabel}”的具体动作说明未写出可识别的具体业务动作。`;
      content.push(contentIssue(document, { category: '逐动作可执行性', message,
        ruleCode: `BEHAVIOR_EXECUTABILITY_${detail.reason.toUpperCase()}`,
        focusPath: `behaviors.${detail.behaviorIndex}.behavior_description`,
        suggestions: ['按实际顺序填写每个动作，写明处理对象和产生的结果。'] }, entries));
    }
  } catch {
    contentStatus = 'unavailable';
    content = [{ group: 'confirmation', severity: 'warning', category: '检查状态',
      message: '业务内容检查未完成。请先处理技术错误；没有技术错误时，请重新检查或联系维护人员。', suggestions: [] }];
  }
  const issues = [...new Map([...technical, ...warnings, ...content].map(issue => [
    JSON.stringify([issue.group, issue.path || issue.focusPath, issue.message]), issue
  ])).values()];
  const counts = Object.fromEntries(CHECK_GROUPS.map(group => [group.key, issues.filter(issue => issue.group === group.key).length]));
  return { issues, counts, contentStatus, valid: validation.valid };
}
