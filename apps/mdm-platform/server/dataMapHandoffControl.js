// Persistent cutover is authoritative. Feature flags never revive legacy writes.
const CONTRACT_VERSION = 'data-map-handoff-v1';
function failure(code, statusCode = 503, details = {}) {
  return Object.assign(new Error(code), { code, statusCode, ...details });
}
async function readControl(db, { lock = false } = {}) {
  try {
    const [[row]] = await db.execute(`SELECT cutover_state,CAST(cutover_epoch AS CHAR) cutover_epoch,
      CAST(graph_revision AS CHAR) graph_revision,CAST(next_definition_version_id AS CHAR) next_definition_version_id,contract_version
      FROM data_map_governance_control WHERE control_id=1${lock ? ' FOR UPDATE' : ' FOR SHARE'}`);
    if (!row || row.contract_version !== CONTRACT_VERSION || !['legacy','prepared','controlled'].includes(row.cutover_state)
      || ['cutover_epoch','graph_revision','next_definition_version_id'].some(key => !/^\d+$/.test(String(row[key])))
      || BigInt(row.next_definition_version_id)<1n || BigInt(row.next_definition_version_id)>9223372036854775807n) throw failure('HANDOFF_CONTROL_UNAVAILABLE');
    return row;
  } catch (error) {
    if (String(error.code || '').startsWith('HANDOFF_')) throw error;
    throw failure('HANDOFF_CONTROL_UNAVAILABLE');
  }
}
async function assertLegacyWriteAllowed(db, { entryId = null } = {}) {
  await readControl(db);
  throw failure('HANDOFF_REQUIRED', 409, { entry_id: entryId, handoff_url: '/api/data-map-handoffs/capabilities' });
}
async function lockGraph(db) {
  const row = await readControl(db, { lock: true });
  if (row.cutover_state !== 'controlled') throw failure('HANDOFF_MAINTENANCE', 503);
  return row;
}
async function withGraphWriteLock(db, action) {
  const control = await lockGraph(db);
  return action(control);
}
async function assertGraphWriteEnabled(db,env=process.env) {
  require('./dataMapHandoffPolicy').writable(env);
  return lockGraph(db);
}
async function readSnapshot(db,action) {
  if(typeof db.getConnection!=='function')return action(db);
  const connection=await db.getConnection();
  try {await connection.beginTransaction();const result=await action(connection);await connection.commit();return result;}
  catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
function clientUpgrade() { throw failure('HANDOFF_CLIENT_UPGRADE_REQUIRED', 409); }
module.exports = { CONTRACT_VERSION, failure, readControl, assertLegacyWriteAllowed, lockGraph, withGraphWriteLock, assertGraphWriteEnabled, readSnapshot, clientUpgrade };
