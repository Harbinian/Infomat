const keys = new Set(['type', 'voucher', 'productionNumber', 'productionOrder', 'salesOrder', 'inventory', 'qualityNumber', 'partNumber', 'qualityCheck', 'status', 'difference', 'dateFrom', 'dateTo', 'page', 'pageSize']);
export function parseQuery(search) {
  const value = {};
  for (const [key, input] of search) {
    if (!keys.has(key) || Object.hasOwn(value, key)) throw new Error('查询参数不支持或重复。');
    if (input.length > 120 || /[\u0000-\u001f]/.test(input)) throw new Error('查询内容过长或含无效字符。');
    value[key] = input.trim();
  }
  for (const [key, options] of Object.entries({type: ['', '10', '11'], status: ['', 'resolved', 'pending'], difference: ['', 'different', 'same', 'unknown'], qualityCheck: ['', 'same', 'different', 'missing', 'reference_unconfirmed']})) {
    if (!options.includes(value[key] || '')) throw new Error('筛选选项无效。');
  }
  for (const key of ['dateFrom', 'dateTo']) {
    const date = value[key];
    const parsed = date ? new Date(`${date}T00:00:00Z`) : null;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1753-01-01' || date > '9998-12-31' || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)) throw new Error('单据日期无效。');
  }
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) throw new Error('开始日期不能晚于结束日期。');
  for (const [key, fallback, maximum] of [['page', 1, 1000000], ['pageSize', 20, 100]]) {
    const raw = value[key] || String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > maximum) throw new Error('分页参数无效。');
    value[key] = Number(raw);
  }
  return value;
}

export function parseQualityQuery(search, details = false) {
  const allowed = new Set(details ? ['drawing','qualityNumber','page','pageSize'] : ['drawing','qualityNumber','status','page','pageSize']);
  const value = {};
  for (const [key,input] of search) {
    if (!allowed.has(key) || Object.hasOwn(value,key)) throw new Error('查询参数不支持或重复。');
    if (input.length > 120 || /[\u0000-\u001f]/.test(input)) throw new Error('查询内容过长或含无效字符。');
    value[key] = input.trim();
  }
  if (details && (!Object.hasOwn(value,'drawing') || !Object.hasOwn(value,'qualityNumber'))) throw new Error('请指定产品图号与质量编号组合，空号用空值表示。');
  if (!details) {
    value.status ||= 'duplicate';
    if (!['all','duplicate','unique','pending'].includes(value.status)) throw new Error('核查结果选项无效。');
  }
  for (const [key,fallback,maximum] of [['page',1,1000000],['pageSize',details?50:20,100]]) {
    const raw = value[key] || String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw)<1 || Number(raw)>maximum) throw new Error('分页参数无效。');
    value[key] = Number(raw);
  }
  return value;
}
