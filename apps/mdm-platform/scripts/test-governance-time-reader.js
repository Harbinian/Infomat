// Read-only child for cross-Node-timezone checks. Owned target credentials arrive
// on stdin only and are never persisted or printed.
const fs=require('node:fs'),mysql=require('mysql2/promise');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {makeProcessDataGovernanceRepository}=require('../server/processDataGovernanceRepository');
async function main(){const target=JSON.parse(fs.readFileSync(0,'utf8')),pool=mysql.createPool({host:'127.0.0.1',port:target.port,user:'root',password:target.password,database:target.database,connectionLimit:2});
  try{
    const repo=createDataMapHandoffRepository(pool,{env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}}),native=makeProcessDataGovernanceRepository(pool);
    const trace=await repo.tracePackage('701',target.lead),detail=await native.getWorkPackageDetail('703'),publication=await repo.getPublication(target.publicationId,target.lead);
    const [[raw]]=await pool.execute('SELECT created_at,UNIX_TIMESTAMP(created_at) epoch FROM process_data_governance_reviews WHERE work_package_id=703 ORDER BY id DESC LIMIT 1');
    const [[utc]]=await pool.execute("SELECT CONCAT(LEFT(DATE_FORMAT(published_at,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z') expected FROM data_map_publications WHERE publication_id=?",[target.publicationId]);
    const result={nativeReview:detail.reviews[0].created_at,nativeEvent:detail.events.find(row=>row.event_type==='mdm_workgroup_review_approved').created_at,
      bindings:trace.bindings.map(row=>row.created_at),drafts:trace.drafts.map(row=>row.created_at),revisions:trace.revisions.map(row=>row.created_at),approvals:trace.approvals.map(row=>row.created_at),
      handoffEvents:trace.events.map(row=>row.created_at),published:trace.publications.map(row=>row.published_at),publicationEvents:publication.events.map(row=>row.created_at)};
    console.log(JSON.stringify({nodeTimeZone:process.env.TZ,rawDriverReview:raw.created_at.toISOString(),expectedNativeReview:new Date(Number(raw.epoch)*1000).toISOString(),expectedPublication:utc.expected,result}));
  }finally{await pool.end();}
}
main().catch(()=>{console.error('Cross-timezone read failed; credential-bearing diagnostics suppressed.');process.exitCode=1;});
