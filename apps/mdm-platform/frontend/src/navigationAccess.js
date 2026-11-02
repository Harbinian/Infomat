import { canReadDataMap } from './handoffGovernancePresentation.js';

const permissionSet = user => new Set(Array.isArray(user?.permissions) ? user.permissions : []);
const hasAny = (permissions, codes) => codes.some(code => permissions.has(code));
const directoryPermissions = ['directory:read', 'identity:read'];

export function canReadDirectory(user) {
  return hasAny(permissionSet(user), directoryPermissions);
}

function administrator(user) {
  const roles = [
    ...(Array.isArray(user?.roleCodes) ? user.roleCodes : []),
    ...(Array.isArray(user?.rbacRoles) ? user.rbacRoles.map(role => role?.code || role?.role_code) : [])
  ];
  return user?.identityKind === 'system_admin' || roles.includes('admin');
}

// These fixed-page reads have explicit permission requirements. Context pages
// stay reachable: case assignments and office membership are checked per row
// on the server and cannot be inferred from a role name in this navigation.
export function canNavigatePage(page, user) {
  const href = (typeof page === 'string' ? page : page?.href)?.split(/[?#]/)[0].replace(/\/+$/, '');
  const permissions = permissionSet(user);
  if (href === '/app/organization' || href === '/app/roster') return canReadDirectory(user);
  if (href === '/app/accounts' || href === '/app/roles') return permissions.has('identity:read');
  if (href === '/app/access-audit') return permissions.has('identity:read-audit');
  if (href === '/app/data-map') return canReadDataMap(user);
  if (href === '/app/publications') return hasAny(permissions, ['identity:read', 'directory:read', 'governance:read-global']);
  if (href === '/app/quality') return permissions.has('governance:read-global') || Boolean(user?.departmentId && permissions.has('governance:read-department'));
  if (href === '/app/template-import') {
    return !administrator(user) && Boolean(user?.personId && user?.departmentId) && permissions.has('governance:draft-department');
  }
  return true;
}

export function visibleNavigationGroups(groups, user) {
  return groups.map(group => ({ ...group, items: group.items.filter(page => canNavigatePage(page, user)) }))
    .filter(group => group.items.length > 0);
}

export function departmentRoleDirectoryGuidance(user) {
  const contact = '组织及人员资料请联系行政人事核对；本人角色授权、有效期及授权时的负责人登记，请联系管理员在“账号与授权办理”核对。';
  return canReadDirectory(user)
    ? `部门目录及已登记负责人可在“组织架构”查阅。${contact}`
    : `当前账号没有组织及人员目录查阅入口。${contact}`;
}
