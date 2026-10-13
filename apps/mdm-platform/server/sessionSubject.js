// Representation only; this is never a permission grant or a cached identity.
//
// Exact-identity contract (R08 / B02):
//   personId, accountId and authVersion are `number | string | null`.
//   A value inside the JavaScript safe-integer range stays a number; a larger value that is
//   still a valid MySQL BIGINT is carried as its exact decimal string. `null` means the field
//   is genuinely absent (for example an accountless person projection) or the caller supplied
//   a value that cannot be represented exactly.
//   Consumers must compare through `sameIdentityInteger`, never through `Number()`, and must
//   never rebuild a rounded identity by guessing. Callers that require a *present* identity
//   (login, session writes, audit binding) must reject `null` rather than substituting 0 or a
//   fallback person.
function sessionSubject(session = {}, identity = {}) {
  session = session || {};
  identity = identity || {};
  const reference = identity.identityRef || session.userId;
  const system = identity.identityKind === 'system_admin' || session.identityKind === 'system_admin' || /^system-admin:/.test(String(reference || ''));
  const personId = system ? null : session.personId || session.userId || identity.personId || identity.person_id || null;
  const accountId = session.accountId || identity.accountId || identity.account_id || null;
  const principal = system ? (/^system-admin:/.test(String(reference || '')) ? reference : accountId ? `system-admin:${accountId}` : null) : personId;
  return Object.freeze({kind:system?'system_admin':'person',principal,personId,
    accountId,
    authVersion:session.authVersion || identity.authVersion || identity.auth_version || null});
}
// Preserve safe-number compatibility while comparing exact MySQL integer identities.
// Already rounded numbers cannot be recovered and must never match another identity.
function identityInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const integer = BigInt(value);
  if (integer < 1n || integer > 9223372036854775807n) return null;
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : integer.toString();
}
function sameIdentityInteger(left, right) {
  const a = identityInteger(left), b = identityInteger(right);
  return a !== null && b !== null && String(a) === String(b);
}
// Legacy import adapter; IO and current authority belong to the identity repository.
async function readPersonAuthority(...args) {
  return require('./identityMysqlRepository').readPersonAuthority(...args);
}
module.exports = {sessionSubject,identityInteger,sameIdentityInteger,readPersonAuthority};
