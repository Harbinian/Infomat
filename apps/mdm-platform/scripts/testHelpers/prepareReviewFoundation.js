// Explicit preparation for a caller-owned synthetic DB; never runtime/startup DDL.
const assert=require('node:assert/strict');
module.exports=async function(pool){
 const [[target]]=await pool.execute('SELECT DATABASE() AS name');assert.match(target.name,/^stage\d{2}_isolated(?:_[a-f0-9]{32})?$/);
 for(const name of ['processCaseGovernanceSchema','governanceResponsibilitiesMigration']){const schema=require('../../server/'+name);for(const sql of require('../../server/mysqlSchema').splitSqlStatements(schema.SCHEMA_SQL))await pool.execute(sql);await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[schema.MIGRATION_KEY]);}
 await require('../../server/processFormalControlMigration').applyMigration(pool,{authorized:true});
 await require('../../server/todoTermSourceMigration').manageTodoTermSource(pool,'apply');
};
