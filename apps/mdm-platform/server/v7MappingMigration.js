const {MIGRATION_KEY,tables,statements}=require('./v7MappingSchema');
const {MIGRATION_KEY:dependency}=require('./dataMapDefinitionSchema');
const {compareCreateStatements}=require('./processV7M0Baseline');
const {failure}=require('./dataMapDefinitionValues');
async function inspectV7Mappings(db){
  const missing=[],drift=[];
  const [markers]=await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key IN (?,?)',[dependency,MIGRATION_KEY]);
  if(!markers.some(m=>m.migration_key===dependency))drift.push('DEFINITION_MIGRATION_REQUIRED');
  for(const sql of statements()){
    const table=sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [present]=await db.execute('SELECT TABLE_NAME,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    if(!present.length){missing.push(table);continue;}
    const [[ddl]]=await db.query(`SHOW CREATE TABLE ${table}`);
    const comparison=compareCreateStatements(sql,ddl['Create Table']);
    const [collations]=await db.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?',[table,'utf8mb4_unicode_ci']);
    if(!comparison.matching||!/ENGINE=InnoDB/i.test(ddl['Create Table'])||/NOT ENFORCED/i.test(ddl['Create Table'])||present[0].TABLE_COLLATION!=='utf8mb4_unicode_ci'||collations.length)drift.push({table,differences:comparison.differences});
  }
  return {ready:!missing.length&&!drift.length&&markers.some(m=>m.migration_key===MIGRATION_KEY),missing,drift,backfill:[]};
}
async function applyV7Mappings(db){
  const [[lock]]=await db.execute("SELECT GET_LOCK('mdm_v7_mapping_migration_v1',10) acquired");
  if(Number(lock.acquired)!==1)throw failure('DEFINITION_V7_MIGRATION_BUSY',409);
  try{
    const before=await inspectV7Mappings(db);if(before.drift.length)throw failure('DEFINITION_V7_SCHEMA_DRIFT',409);
    for(const sql of statements())if(before.missing.includes(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1]))await db.execute(sql);
    const after=await inspectV7Mappings(db);if(after.missing.length||after.drift.length)throw Object.assign(failure('DEFINITION_V7_SCHEMA_DRIFT',409),{inspection:after});
    await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)',[MIGRATION_KEY]);
    return inspectV7Mappings(db);
  }finally{await db.execute("SELECT RELEASE_LOCK('mdm_v7_mapping_migration_v1')");}
}
module.exports={inspectV7Mappings,applyV7Mappings,MIGRATION_KEY,tables};
