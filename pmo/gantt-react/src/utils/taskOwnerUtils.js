export const TASK_OWNER_BY_GROUP = {
  信息化项目组: '刘春含',
  基础设施工作组: '方嵩荐',
  PLM工作组: '池炳辉、常云龙',
  MDM工作组: '张广懿',
  MES工作组: '范秋南',
};

const ERP_OA_GROUP = 'ERP·OA工作组';
const ERP_OWNER = '李雪';
const OA_OWNER = '陈娟';
const ERP_OA_OWNER = `${ERP_OWNER}、${OA_OWNER}`;

function normalize(value) {
  return String(value || '').trim();
}

function normalizedWbs(task) {
  return normalize(task?.normalizedWbs || task?.wbs);
}

function wbsIn(task, prefixes) {
  const value = normalizedWbs(task);
  return prefixes.some(prefix => value === prefix || value.startsWith(`${prefix}.`));
}

function resolveErpOaOwner(task) {
  const name = normalize(task?.name);

  if (name.includes('ERP/OA')) return ERP_OA_OWNER;
  if (wbsIn(task, ['2.11', '7.6']) || name.includes('OA')) return OA_OWNER;
  if (wbsIn(task, ['2.10', '7.5']) || /ERP|MRP|采购计划|生产计划/.test(name)) return ERP_OWNER;

  return ERP_OA_OWNER;
}

export function resolveTaskOwner(task = {}) {
  const explicitOwner = normalize(task.responsiblePerson || task.owner || task.ownerName);
  if (explicitOwner) return explicitOwner;

  const department = normalize(task.department);
  if (department === ERP_OA_GROUP) return resolveErpOaOwner(task);

  return TASK_OWNER_BY_GROUP[department] || '-';
}
