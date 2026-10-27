// Historical filename retained for callers. This is an HTTP adapter/permission
// test with injected session and repository doubles, not a MySQL persistence test.
const {syntheticSession,validateSyntheticSession}=require('./testHelpers/syntheticSession');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),express=require('express');
process.env.MDM_DB_QUIET='1';
const previousIdentityReadModel=process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL='mysql';
const auth=require('../server/auth');
const {setDataMapRepositoryFactory,resetDataMapRepositoryFactory}=require('../server/dataMapMysqlRepository');
const {failure,clientUpgrade}=require('../server/dataMapHandoffControl');
const fieldEntriesRouter=require('../server/routes/fieldEntries');
const contextVersion='f8784870-4f68-48de-aaf7-32998cf285a5';
const publicationId='d9b24416-b751-46f9-8199-74e02b5ac744';
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
const close=server=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections?.();});

function makeControlledRepositoryDouble(){
  const state={
    contexts:[{id:'10',dept_id:'9',title:'合成客户字段上下文'},{id:'11',dept_id:'10',title:'合成其他部门上下文'}],
    fields:[{id:'20',context_id:'10',field_name_cn:'合成客户名称',version_id:'9007199254741001',publication_id:publicationId},{id:'21',context_id:'11',field_name_cn:'合成其他部门字段',version_id:'9007199254741002',publication_id:publicationId}],
    calls:[]
  };
  const blocked=(name,args)=>{state.calls.push({method:name,args:structuredClone(args)});throw failure('HANDOFF_REQUIRED',409);};
  return {
    state,
    async getContextScope(value){const id=String(value);state.calls.push({method:'getContextScope',id});const row=state.contexts.find(item=>item.id===id);return row?{id:row.id,dept_id:row.dept_id}:null;},
    async getFieldScope(value){const id=String(value);state.calls.push({method:'getFieldScope',id});const row=state.fields.find(item=>item.id===id);return row?{id:row.id,context_id:row.context_id}:null;},
    async getFieldsByContext(value,query={}){
      const id=String(value);state.calls.push({method:'getFieldsByContext',id,query:{...query}});
      if(!['current','history'].includes(query.view)||query.view==='history'&&!query.version)clientUpgrade();
      if(query.view==='history'&&query.version!==contextVersion)throw failure('HANDOFF_VERSION_NOT_FOUND',404);
      return state.fields.filter(row=>row.context_id===id).map(row=>({...row,mapping_id:row.context_id,view:query.view,
        field_name_cn:query.view==='history'?'合成客户名称固定历史':row.field_name_cn,
        version_id:query.view==='history'?'9007199254741000':row.version_id,
        governance_status:query.view==='history'?'governed_history':'governed',referenceable:query.view==='current',new_reference_allowed:query.view==='current'}));
    },
    async createField(payload,actorId){return blocked('createField',[payload,actorId]);},
    async updateField(fieldId,payload,actorId){return blocked('updateField',[String(fieldId),payload,actorId]);},
    async deleteField(fieldId,actorId){return blocked('deleteField',[String(fieldId),actorId]);}
  };
}

async function main(){
  const routeSource=fs.readFileSync(path.join(__dirname,'../server/routes/fieldEntries.js'),'utf8');
  assert(!routeSource.includes("require('../db')"),'route must not import SQLite');
  assert(!routeSource.includes('field_entries'),'route must not query the SQLite field_entries table');
  assert(!routeSource.includes('terms'),'route must not query SQLite terms');
  const repo=makeControlledRepositoryDouble(),original=structuredClone(repo.state.fields),checks=[],exchanges=[];
  setDataMapRepositoryFactory(async()=>repo);
  auth.setIdentityRepositoryFactory(async()=>({validateSession:validateSyntheticSession,async getUserEffectivePermissions(personId){assert.equal(personId,42);return {permSet:new Set(['governance:read-department','governance:draft-department']),fieldConstraints:{}};}}));
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.session=syntheticSession({personId:42,userId:42,userName:'合成部门主对接人',departmentId:9});next();});app.use('/api/field-entries',fieldEntriesRouter);
  const server=await listen(app),baseURL=`http://127.0.0.1:${server.address().port}`;
  async function call(url,{method='GET',body,status=200,code}={}){const response=await fetch(baseURL+'/api/field-entries'+url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),value=await response.json();assert.equal(response.status,status,JSON.stringify({method,url,status:response.status,value}));if(code)assert.equal(value.code,code);exchanges.push({method,url,status:response.status,code:value.code||null});return value;}
  async function check(name,work){await work();assert.deepEqual(repo.state.fields,original,'HTTP adapter tests must not mutate preserved fields');checks.push(name);console.log('PASS '+name);}
  const readCalls=()=>repo.state.calls.filter(item=>item.method==='getFieldsByContext');
  const writeCalls=()=>repo.state.calls.filter(item=>['createField','updateField','deleteField'].includes(item.method));
  try{
    await check('explicit current view passes unchanged through the real route after scope authorization',async()=>{
      const value=await call('/mapping/10?view=current');assert.equal(value.length,1);assert.equal(value[0].context_id,'10');assert.equal(value[0].mapping_id,'10');assert.equal(value[0].version_id,'9007199254741001');assert.equal(value[0].view,'current');assert.equal(value[0].new_reference_allowed,true);assert.deepEqual(readCalls().at(-1),{method:'getFieldsByContext',id:'10',query:{view:'current'}});
    });
    await check('exact history context version passes unchanged and returns fixed readonly field versions',async()=>{
      const value=await call('/mapping/10?view=history&version='+contextVersion);assert.equal(value[0].field_name_cn,'合成客户名称固定历史');assert.equal(value[0].version_id,'9007199254741000');assert.equal(value[0].view,'history');assert.equal(value[0].referenceable,false);assert.equal(value[0].new_reference_allowed,false);assert.deepEqual(readCalls().at(-1),{method:'getFieldsByContext',id:'10',query:{view:'history',version:contextVersion}});
    });
    await check('missing explicit view, incomplete history and unsupported legacy collection require a client upgrade',async()=>{
      for(const url of ['/mapping/10','/mapping/10?view=history','/mapping/10?view=legacy_in_use&version=capture:synthetic'])await call(url,{status:409,code:'HANDOFF_CLIENT_UPGRADE_REQUIRED'});
      await call('/mapping/10?view=history&version=00000000-0000-4000-8000-000000000000',{status:404,code:'HANDOFF_VERSION_NOT_FOUND'});
    });
    await check('foreign department reads stop at scope metadata with 403 and do not read field bodies',async()=>{
      const count=readCalls().length;await call('/mapping/11?view=current',{status:403});await call('/mapping/11?view=history&version='+contextVersion,{status:403});assert.equal(readCalls().length,count);
    });
    await check('missing contexts return 404 without reading field content',async()=>{
      const count=readCalls().length;await call('/mapping/999?view=current',{status:404});assert.equal(readCalls().length,count);
    });
    await check('own department old POST PUT DELETE all reach the closed repository and return HANDOFF_REQUIRED',async()=>{
      const payload={context_id:10,data_object:'合成客户',field_name_cn:'合成客户简称',field_type:'文本'};
      await call('',{method:'POST',body:payload,status:409,code:'HANDOFF_REQUIRED'});
      await call('',{method:'POST',body:{mapping_id:10,field_name_cn:'合成旧别名入口'},status:409,code:'HANDOFF_REQUIRED'});
      await call('/20',{method:'PUT',body:{field_name_cn:'合成试图直接修改'},status:409,code:'HANDOFF_REQUIRED'});
      await call('/20',{method:'DELETE',status:409,code:'HANDOFF_REQUIRED'});
      assert.deepEqual(writeCalls().map(item=>item.method),['createField','createField','updateField','deleteField']);assert(writeCalls().every(item=>item.args.at(-1)===42));assert.equal(writeCalls()[0].args[0].context_id,10);
    });
    await check('foreign department old writes remain 403 before the closed mutation methods',async()=>{
      const count=writeCalls().length;await call('',{method:'POST',body:{context_id:11,field_name_cn:'合成跨部门新增'},status:403});await call('/21',{method:'PUT',body:{field_name_cn:'合成跨部门修改'},status:403});await call('/21',{method:'DELETE',status:403});assert.equal(writeCalls().length,count);
    });
    await check('missing context or field writes return 404 without mutation and missing context input remains 400',async()=>{
      const count=writeCalls().length;await call('',{method:'POST',body:{context_id:999,field_name_cn:'合成不存在上下文'},status:404});await call('/999',{method:'PUT',body:{field_name_cn:'合成不存在字段'},status:404});await call('/999',{method:'DELETE',status:404});await call('',{method:'POST',body:{field_name_cn:'合成缺上下文'},status:400});assert.equal(writeCalls().length,count);
    });
    console.log(JSON.stringify({passed:true,check_count:checks.length,http_exchanges:exchanges.length,checks,exchanges,verification_scope:'real ephemeral HTTP router; injected synthetic session/permission/repository doubles only',real_mysql:false,persistence_verified:false,preserved_original_fields:true,formal_database_connected:false}));
  }finally{await close(server);resetDataMapRepositoryFactory();auth.resetIdentityRepositoryFactory();}
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(previousIdentityReadModel===undefined)delete process.env.MDM_IDENTITY_READ_MODEL;else process.env.MDM_IDENTITY_READ_MODEL=previousIdentityReadModel;});
