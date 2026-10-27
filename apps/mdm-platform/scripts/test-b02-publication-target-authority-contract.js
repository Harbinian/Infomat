// Pure target-qualification contract. Run with blockRealMysql and the reviewed
// dispatch guard. Explicit query doubles only; no config, socket or process IO.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {directoryPlan}=require('../server/publicationRepository');
const {normalizePublication,suggestedMapping}=require('../server/publicationSpreadsheet');
const {sessionSubject,identityInteger,sameIdentityInteger}=require('../server/sessionSubject');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const D='9007199254740992',P='9007199254741000',N='9007199254741001';
const doc=()=>{const headers=['工号','姓名','部门编码','在职状态'];return normalizePublication({kind:'roster',title:'synthetic',sourceFileName:'synthetic.csv',headers,rows:[['P','changed','D','leave']],mapping:suggestedMapping('roster',headers)});};
function fixture({adminCurrent=true,adminSnapshot=false}={}) {
  const departments=[{id:Number(D),code:'D',name:'D',parent_id:null,department_type:null,status:'active',exact_id:D,exact_parent_id:null}];
  const persons=[{person_id:Number(P),employee_no:'P',person_name:'original',current_department_id:Number(D),employment_status:'active',status:'active',mobile:null,email:null,exact_person_id:P,exact_current_department_id:D}];
  const calls=[];
  return {calls,async query(sql){calls.push(sql);
    if(sql.includes('FROM departments'))return [departments];
    if(sql.includes('FROM person ORDER'))return [persons];
    if(sql.includes('FROM org_unit')||sql.includes('FROM office_membership')||sql.includes('FROM mdm_todo_office_assignments'))return [[]];
    if(sql.includes('FROM user_accounts'))return [[]];
    if(sql.includes('FROM person_roles WHERE'))return [[]];
    if(sql.includes('SELECT DISTINCT pr.person_id'))return [( /FOR (SHARE|UPDATE)$/.test(sql)?adminCurrent:adminSnapshot)?[{person_id:Number(P),exact_person_id:P}]:[]];
    throw Error('unreviewed query '+sql);
  }};
}
const checks=[];async function check(name,action){await action();checks.push(name);console.log('PASS '+name);}
async function main(){
  await check('original exact IDs, null person and typed system administrator representation',async()=>{
    assert.equal(identityInteger(P),P);assert.equal(identityInteger(N),N);assert(!sameIdentityInteger(P,N));assert.equal(identityInteger(7),7);assert.equal(identityInteger(Number(N)),null);
    assert.deepEqual(sessionSubject({identityKind:'system_admin',accountId:N,personId:P,authVersion:D}),{kind:'system_admin',principal:'system-admin:'+N,personId:null,accountId:N,authVersion:D});
  });
  await check('preview retains original unlocked admin read and legacy hash projection',async()=>{
    const db=fixture(),result=await directoryPlan(db,doc());assert.equal(result.errors.length,0);
    assert(db.calls.every(s=>!/FOR (UPDATE|SHARE)$/.test(s)));assert(!JSON.stringify(result).includes('exact_'));
    assert.equal(result.baseHash,hash({departments:[{id:Number(D),code:'D',name:'D',parent_id:null,department_type:null,status:'active'}],persons:[{person_id:Number(P),employee_no:'P',person_name:'original',current_department_id:Number(D),employment_status:'active',status:'active',mobile:null,email:null}],accounts:[],assignments:[],admins:[],offices:{offices:[],memberships:[],pending:[]}}));
  });
  await check('locked plan reads current target admin qualification after original earlier reads',async()=>{
    const db=fixture(),result=await directoryPlan(db,doc(),true);
    assert.equal(result.errors.length,1);assert.match(result.errors[0].message,/请先调整管理员身份/);
    assert(/FOR (UPDATE|SHARE)$/.test(db.calls.at(-1)));assert.equal(result.changes[0].existing.person_id,P);
    for(const sql of db.calls.slice(0,-1))assert(sql.endsWith(' FOR UPDATE'),'keep original target lock order');
  });
  await check('removed admin is not retained from an earlier snapshot in locked plan',async()=>{
    const db=fixture({adminCurrent:false,adminSnapshot:true}),result=await directoryPlan(db,doc(),true);assert.equal(result.errors.length,0);
  });
  await check('adjacent BIGINT admin does not attach to another physical person',async()=>{
    const db=fixture(),original=db.query;db.query=async sql=>sql.includes('SELECT DISTINCT pr.person_id')?[[{person_id:Number(N),exact_person_id:N}]]:original.call(db,sql);
    assert.equal((await directoryPlan(db,doc(),true)).errors.length,0);
  });
  await check('current admin unchanged roster row keeps original legitimate no-op',async()=>{
    const db=fixture(),unchanged=doc();unchanged.records[0].person_name='original';unchanged.records[0].employment_status='active';const result=await directoryPlan(db,unchanged,true);assert.equal(result.errors.length,0);assert.equal(result.changes[0].same,true);
  });
  await check('current admin name correction preserves administrator qualification',async()=>{
    const db=fixture(),correction=doc();correction.records[0].employment_status='active';const result=await directoryPlan(db,correction,true);assert.equal(result.errors.length,0);assert.equal(result.changes[0].same,false);
  });
  console.log('B02_PUBLICATION_TARGET_CONTRACT_PASSED '+checks.length);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
