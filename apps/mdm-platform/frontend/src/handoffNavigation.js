// Only precise resource identities and known 3000 page contexts may cross pages.
const resourceKinds = ['package', 'handoff', 'conflict', 'fact', 'publication'];
const positiveId = value => typeof value === 'string' && /^[1-9]\d*$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const versionRef = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const returnPages = {
  '/app/workbench': {},
  '/app/todos': {status: value => ['pending', 'done'].includes(value), type: value => ['field_confirm','gold_source','conflict_resolution','terminology','general'].includes(value)},
  '/app/data-governance': {package: positiveId, factRequest: positiveId},
  '/app/data-map': {context: positiveId, view: value => ['current','history','legacy_in_use'].includes(value), version: versionRef, identityField: positiveId}
};

export function safeHandoffReturn(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/app/') || /[\\#\u0000-\u0020]/.test(value)) return null;
  let url;
  try { url = new URL(value, 'https://local.invalid'); } catch { return null; }
  if (url.origin !== 'https://local.invalid' || url.pathname !== value.split('?')[0] || !Object.hasOwn(returnPages, url.pathname)) return null;
  const validators = returnPages[url.pathname];
  for (const [key, item] of url.searchParams) {
    if (!Object.hasOwn(validators, key) || url.searchParams.getAll(key).length !== 1 || !validators[key](item)) return null;
  }
  if (url.pathname === '/app/data-map' && url.searchParams.has('version') && (!url.searchParams.has('context') || !['history','legacy_in_use'].includes(url.searchParams.get('view')))) return null;
  if (url.pathname === '/app/data-governance' && url.searchParams.has('package') && url.searchParams.has('factRequest')) return null;
  return url.pathname + url.search;
}

export function parseHandoffSelection(search) {
  const query = new URLSearchParams(search);
  const keys = resourceKinds.filter(kind => query.has(kind));
  if (keys.length !== 1 || [...query.keys()].some(key => ![...resourceKinds,'revision','return_to'].includes(key))) return null;
  const kind = keys[0], id = query.get(kind);
  if (query.getAll(kind).length !== 1 || !(kind === 'package' ? positiveId(id) : uuid(id))) return null;
  if (query.has('revision') && (kind !== 'handoff' || query.getAll('revision').length !== 1 || !positiveId(query.get('revision')) || !Number.isSafeInteger(Number(query.get('revision'))))) return null;
  return {kind,id,...(query.has('revision') ? {revision:Number(query.get('revision'))} : {})};
}

export function sameHandoffSelection(left, right) {
  return Boolean(left && right && left.kind === right.kind && String(left.id) === String(right.id) && (left.revision || null) === (right.revision || null));
}

export function handoffWorkspaceHref(selection, returnTo = null) {
  if (!selection || !resourceKinds.includes(selection.kind)) return null;
  const query = new URLSearchParams({[selection.kind]:String(selection.id)});
  if (selection.revision != null) query.set('revision',String(selection.revision));
  if (!parseHandoffSelection(query)) return null;
  const safeReturn = safeHandoffReturn(returnTo);
  if (safeReturn) query.set('return_to',safeReturn);
  return '/app/data-map-handoffs?' + query;
}

export function handoffTargetWithReturn(target, returnTo) {
  if (typeof target !== 'string' || target.split('?')[0] !== '/app/data-map-handoffs') return null;
  return handoffWorkspaceHref(parseHandoffSelection(target.slice(target.indexOf('?') + 1)), returnTo);
}

export function handoffReturnLabel(path) {
  return {'/app/workbench':'返回我的工作台','/app/todos':'返回待办收到','/app/data-governance':'返回原工作包','/app/data-map':'返回数据地图台账'}[safeHandoffReturn(path)?.split('?')[0]] || null;
}
