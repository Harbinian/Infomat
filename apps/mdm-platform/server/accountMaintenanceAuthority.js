const { identityInteger, sameIdentityInteger } = require('./sessionSubject');
const { readPersonAuthority } = require('./identityMysqlRepository');
const { readonlyWriteViolation } = require('./permissionFieldConstraints');
const { permissionSetHas } = require('./roleDefinitions');

const OPERATION_PERMISSIONS = Object.freeze({
  createAccount: ['identity:manage-account', 'identity:assign-role'],
  assignAccount: ['identity:manage-account'],
  updateAccount: ['identity:manage-account'],
  grantRole: ['identity:assign-role'], revokeRole: ['identity:assign-role'],
  activateAccount: ['identity:manage-account'], enableAccount: ['identity:manage-account'],
  disableAccount: ['identity:manage-account'], resetPassword: ['identity:manage-account']
});

function failure(statusCode, body) {
  const error = new Error(body.error);
  error.statusCode = statusCode;
  error.code = body.code;
  error.accountMaintenanceResponse = body;
  return error;
}

// Only consume requireAuth's verified user and its matching session. Request
// body and cached effectivePermissions never supply identity or authority.
function maintenanceRequestContext(req) {
  const user = req.identity, session = req.session;
  if (!user || !session || user.identityKind === 'system_admin' || session.identityKind === 'system_admin' ||
      !sameIdentityInteger(session.personId, user.personId) ||
      !sameIdentityInteger(session.accountId, user.accountId) ||
      !sameIdentityInteger(session.authVersion, user.authVersion)) {
    throw failure(401, {error:'登录信息已失效，请重新登录', code:'SESSION_IDENTITY_INVALID'});
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? Object.fromEntries(Object.keys(req.body).map(key => [key, true])) : null;
  return Object.freeze({
    kind:'person', personId:identityInteger(user.personId), accountId:identityInteger(user.accountId),
    authVersion:identityInteger(user.authVersion), method:req.method,
    body:body && Object.freeze(body)
  });
}

function assertCurrentMaintenanceAuthority(authority, context, operation, actorPersonId) {
  if (!sameIdentityInteger(context.personId, actorPersonId) || !authority.valid ||
      !authority.user || authority.user.employment_status !== 'active') {
    if (authority.passwordChangeRequired) throw failure(403, {error:'首次登录必须先修改密码',code:'PASSWORD_CHANGE_REQUIRED'});
    throw failure(401, {error:'账号状态或授权已经变化，请重新登录',code:'SESSION_AUTHORIZATION_CHANGED'});
  }
  const permissions = OPERATION_PERMISSIONS[operation];
  if (!permissions) throw new Error('Unknown account maintenance operation');
  for (const code of permissions) {
    if (!permissionSetHas(authority.permissions, code)) throw failure(403, {error:'权限不足'});
    const readonly = readonlyWriteViolation(context, code, authority.fieldConstraints);
    if (readonly.length) throw failure(403, {error:'字段只读，不允许写入',readonly_fields:readonly});
  }
}

async function lockAndAssertMaintenanceAuthority(db, context, operation, actorPersonId) {
  if (!context) return; // Explicit non-HTTP repository compatibility calls only.
  if (context.kind !== 'person' || !identityInteger(context.personId) ||
      !identityInteger(context.accountId) || !identityInteger(context.authVersion) ||
      !sameIdentityInteger(context.personId, actorPersonId)) {
    throw failure(401, {error:'登录信息已失效，请重新登录',code:'SESSION_IDENTITY_INVALID'});
  }
  // Maintenance chains: actor account X -> actor person X -> qualification S
  // -> original target chain. X avoids a self-maintenance S-to-X upgrade.
  // Reciprocal operations can deadlock; the existing transaction owns rollback
  // and service-error propagation, with no automatic request replay.
  await db.execute('SELECT CAST(account_id AS CHAR) AS account_id FROM user_accounts WHERE account_id=CAST(? AS SIGNED) FOR UPDATE', [String(context.accountId)]);
  await db.execute('SELECT CAST(person_id AS CHAR) AS person_id FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE', [String(context.personId)]);
  const authority = await readPersonAuthority(db, context, context.personId, {currentRead:true,includeFieldConstraints:true});
  assertCurrentMaintenanceAuthority(authority, context, operation, actorPersonId);
}

module.exports = {maintenanceRequestContext,assertCurrentMaintenanceAuthority,lockAndAssertMaintenanceAuthority};
