import { fieldLabel, tableLabel } from '/field-presentation.js';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const dictionaryNames = {
  AA_ColumnDic: '当前栏目字典', AA_ColumnDic_base: '基线栏目字典', GC_FIELD: '存货字段定义',
  RP_TableField: '表字段说明', voucheritems: '单据字段字典',
  'voucheritems + vouchers': '单据主明细与字段分区定义',
  'Sys_TableInfo + Sys_TableColumn': 'KFU表字段字典',
};

export function bindAuditViews({ request }) {
  const byId = id => document.getElementById(id);
  const dialog = byId('name-reference-dialog');
  let nameTicket = 0;
  let selected;
  async function readName(field) {
    selected = field;
    const ticket = ++nameTicket;
    byId('name-reference-title').textContent = fieldLabel(field);
    byId('name-reference-context').textContent = field.system + ' / ' + tableLabel(field);
    byId('name-reference-status').textContent = '正在读取名称依据…';
    byId('name-reference-list').replaceChildren();
    byId('name-reference-technical').textContent = field.system + ' / ' + field.table + '.' + field.name;
    byId('retry-name-reference').hidden = true;
    try {
      const info = await request('/api/fields/' + encodeURIComponent(field.id) + '/name-reference');
      if (ticket !== nameTicket) return;
      byId('name-reference-status').textContent = info.labelStatus === 'needs_verification' ?
        '含义待核实 · ' + info.labelSource : '名称依据 · ' + info.labelSource;
      byId('name-reference-status').classList.toggle('name-pending', info.labelStatus === 'needs_verification');
      const rows = info.evidence.map(item => {
        const card = node('section', undefined, 'name-evidence-card');
        card.append(node('h3', item.caption || '待补中文定义'),
          node('p', dictionaryNames[item.dictionary] || '数据库字段来源元数据', 'muted'));
        if (item.context) card.append(node('p', '字典上下文：' + item.context, 'muted'));
        if (item.section) card.append(node('p', '字段分区：' + (item.section === 'T' ? '单据主表' : '单据明细'), 'muted'));
        return card;
      });
      if (!rows.length) rows.push(node('p', info.labelStatus === 'native_name' ?
        '沿用数据库中的中文字段名，业务含义仍可在现场核对。' : '暂无可列出的字典条目，名称来源以上述说明为准。', 'muted'));
      byId('name-reference-list').replaceChildren(...rows);
    } catch (error) {
      if (ticket !== nameTicket) return;
      byId('name-reference-status').textContent = error.message || '名称依据读取失败，请重试。';
      byId('retry-name-reference').hidden = false;
    }
  }
  byId('retry-name-reference').addEventListener('click', () => { if (selected) readName(selected); });
  return {
    showName(field) {
      if (!dialog.open) dialog.showModal();
      readName(field);
    },
    async refreshAudit() {
      const status = byId('audit-summary');
      status.textContent = '正在读取结构与名称核查结果…';
      try {
        const audit = await request('/api/catalog-audit');
        if (audit.available === false) { status.textContent = '当前版本未加载结构核查快照。'; return; }
        status.textContent = audit.tables.length + ' 个表/视图 · ' + audit.expectedSelectableFields + ' 个可见字段 · 字段含义待核实 ' + audit.pendingNameCount + ' 项';
        byId('audit-rows').replaceChildren(...audit.summary.map(system => {
          const row = node('tr');
          for (const value of [system.system, system.tables, system.fields, system.addedFields, system.namesPending]) row.append(node('td', value));
          return row;
        }));
        byId('audit-table').hidden = false;
        byId('audit-download').hidden = false;
        byId('audit-source').textContent = '核查快照：' + new Date(audit.snapshotAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) +
          '（北京时间）。范围为当前底册、候选、父级参考及9997已引用对象；排除 ' + audit.excludedTables.length + ' 个ES对象和 ' + audit.excludedColumns + ' 个ExcelServer列。';
      } catch (error) { status.textContent = (error.message || '核查结果读取失败。') + ' 可关闭后重新打开重试。'; }
    },
  };
}
