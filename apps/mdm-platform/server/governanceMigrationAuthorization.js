// Explicit deployment-only capability. No environment lookup or connection creation.
// The capability cannot be reconstructed from JSON and never enables runtime writes.
const fs = require('node:fs');
const crypto = require('node:crypto');
const permits = new WeakMap();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const failure = code => Object.assign(new Error(code), { code, statusCode:409 });
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function verifyTargetIdentity(db, expected = {}) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(expected.database || '') || !UUID.test(expected.serverUuid || '')) throw failure('GOVERNANCE_MIGRATION_TARGET_REQUIRED');
  const [[actual]] = await db.execute('SELECT DATABASE() AS name,@@server_uuid AS server_uuid');
  if (actual?.name !== expected.database || actual?.server_uuid !== expected.serverUuid) throw failure('GOVERNANCE_MIGRATION_TARGET_MISMATCH');
  return { database:actual.name, serverUuid:actual.server_uuid };
}
function verifiedFile(file, expected, code) {
  if (!file || !SHA256.test(expected || '')) throw failure(code);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { throw failure(code); }
  if (!bytes.length || sha256(bytes) !== expected) throw failure(code);
  return bytes;
}
function verifyRecoveryEvidence(options) {
  verifiedFile(options.backupFile, options.backupSha256, 'GOVERNANCE_MIGRATION_BACKUP_REQUIRED');
  let receipt;
  try { receipt = JSON.parse(verifiedFile(options.restoreReceiptFile, options.restoreReceiptSha256, 'GOVERNANCE_MIGRATION_RESTORE_REQUIRED')); }
  catch { throw failure('GOVERNANCE_MIGRATION_RESTORE_REQUIRED'); }
  const source = receipt?.source, restored = receipt?.restore_target;
  const separateServer=UUID.test(restored?.server_uuid || '')&&(restored.server_uuid!==source?.server_uuid||restored.database!==source?.database);
  const separateContainer=SHA256.test(source?.container_id||'')&&SHA256.test(restored?.container_id||'')&&source.container_id!==restored.container_id;
  if ((receipt.schema_version || receipt.contract) !== 'governance-backup-restore-v1' || receipt.status !== 'passed'
    || source?.database !== options.database || source?.server_uuid !== options.serverUuid
    || receipt.backup_sha256 !== options.backupSha256 || !(separateServer||separateContainer)
    || !/^[A-Za-z0-9_]{1,64}$/.test(restored?.database || '')
    || receipt.schema_verified !== true || receipt.data_verified !== true
    || !SHA256.test(receipt.source_inventory_sha256 || '')
    || receipt.source_inventory_sha256 !== receipt.restored_inventory_sha256) throw failure('GOVERNANCE_MIGRATION_RESTORE_REQUIRED');
  return receipt;
}
async function createMigrationPermit(db, options = {}, { write = false } = {}) {
  const identity = await verifyTargetIdentity(db, options);
  if (write) {
    if (options.authorizeFormalMigration !== true || typeof options.authorizationReference !== 'string'
      || !options.authorizationReference.trim() || typeof options.writeFenceReference !== 'string'
      || !options.writeFenceReference.trim()) throw failure('GOVERNANCE_MIGRATION_AUTHORIZATION_REQUIRED');
    verifyRecoveryEvidence(options);
  }
  const permit = Object.freeze({});
  permits.set(permit, { ...identity, write, backupSha256:options.backupSha256,
    authorizationReference:options.authorizationReference, expiresAt:Date.now() + 15 * 60 * 1000 });
  return permit;
}
function validateMigrationPermit(permit, { write = false } = {}) {
  const record = permit && typeof permit === 'object' ? permits.get(permit) : null;
  if (!record || record.expiresAt <= Date.now() || (write && !record.write)) throw failure('GOVERNANCE_MIGRATION_PERMIT_REQUIRED');
  return record;
}
async function verifyMigrationPermit(db, permit, { write = false } = {}) {
  const record = validateMigrationPermit(permit,{write});
  await verifyTargetIdentity(db, record);
  return { database:record.database, serverUuid:record.serverUuid, backupSha256:record.backupSha256 };
}
module.exports = { createMigrationPermit, validateMigrationPermit, verifyMigrationPermit, verifyTargetIdentity, verifyRecoveryEvidence, sha256 };
