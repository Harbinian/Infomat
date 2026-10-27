// TECH-02 partial-DDL recovery in a fresh labelled tmpfs MySQL. Additive only;
// original legacy rows are compared before/after. No formal target or env file.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed}=require('./testHelpers/dataMapHandoffFixture');
const {digest}=require('../server/dataMapHandoffPolicy');
const output=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/schema');
if(process.argv[2]){assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output),'preserve previous evidence');}
const checks=[];let targetRecord;
async function check(name,work){await work();checks.push({name,passed:true});console.log('PASS '+name);}
async function main(){await withFreshMysql(async target=>{
  const {pool,owner,database,containerId}=target;targetRecord={owner,database,containerId};await seed(target,{handoff:false});
  const schema=require('../server/dataMapHandoffSchema');
  async function oldDigest(){const [rows]=await pool.execute('SELECT CAST(version_id AS CHAR) version_id,definition_json,base_snapshot_json,content_digest,base_digest,source_kind FROM data_map_definition_versions ORDER BY version_id');return digest(rows);}
  const before=await oldDigest();
  await pool.execute('ALTER TABLE data_map_definition_versions AUTO_INCREMENT=9007199254745000');
  await check('DDL interruption leaves explicit matching/missing structure without a migration marker',async()=>{
    const probe=new Proxy(pool,{get(t,k){if(k==='execute')return async(sql,args)=>{if(sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_handoff_revisions'))throw Object.assign(Error('Synthetic DDL interruption'),{code:'SYNTHETIC_DDL_INTERRUPTION'});return t.execute(sql,args);};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
    await assert.rejects(()=>schema.applyHandoffSchema(probe,{owner,database}),{code:'SYNTHETIC_DDL_INTERRUPTION'});
    const partial=await schema.inspectHandoffSchema(pool);assert.equal(partial.ready,false);assert(partial.tables.some(x=>x.status==='matching'));assert(partial.tables.some(x=>x.status==='missing'));assert(!partial.tables.some(x=>x.status==='drifted'));
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM schema_migrations WHERE migration_key=?',[schema.MIGRATION_KEY]))[0][0].n,0);assert.equal(await oldDigest(),before);
  });
  await check('explicit resume from a fresh module finishes DDL and chooses the actual AUTO_INCREMENT upper bound',async()=>{
    delete require.cache[require.resolve('../server/dataMapHandoffSchema')];const resumed=require('../server/dataMapHandoffSchema');assert.equal((await resumed.applyHandoffSchema(pool,{owner,database})).ready,true);
    assert.equal((await pool.execute('SELECT CAST(next_definition_version_id AS CHAR) n,cutover_state FROM data_map_governance_control'))[0][0].n,'9007199254745000');assert.equal(await oldDigest(),before);
    const prior=(await pool.execute('SELECT * FROM data_map_governance_control'))[0];await resumed.applyHandoffSchema(pool,{owner,database});assert.deepEqual((await pool.execute('SELECT * FROM data_map_governance_control'))[0],prior);
  });
  await check('disabled actual CHECK is schema drift and is never silently repaired',async()=>{
    const [rows]=await pool.execute("SELECT CONSTRAINT_NAME name FROM information_schema.table_constraints WHERE table_schema=DATABASE() AND table_name='data_map_governance_control' AND constraint_type='CHECK' ORDER BY constraint_name");const name=rows[0].name;assert.match(name,/^\w+$/);
    await pool.execute('ALTER TABLE data_map_governance_control ALTER CHECK `'+name+'` NOT ENFORCED');assert.equal((await schema.inspectHandoffSchema(pool)).ready,false);
    await assert.rejects(()=>schema.applyHandoffSchema(pool,{owner,database}),{code:'HANDOFF_SCHEMA_DRIFT'});
    await pool.execute('ALTER TABLE data_map_governance_control ALTER CHECK `'+name+'` ENFORCED');assert.equal((await schema.inspectHandoffSchema(pool)).ready,true);assert.equal(await oldDigest(),before);
  });
},{stage:'65',randomDatabase:true});fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:'passed',checks,target:targetRecord,owned_container_removed:true,formal_database_connected:false},null,2)+'\n');}
main().catch(e=>{console.error(e.code,e.message);process.exitCode=1;});
