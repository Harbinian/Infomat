const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const permissions = {hr:['identity:read','directory:read','directory:maintain'],reader:['identity:read'],lead:['governance:publish'],admin:['identity:read','directory:maintain'],system_admin:['identity:read']};
function route(name) {
  const filename=path.resolve(__dirname,'../server/routes/'+name+'.js'),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  const originalRequire=loaded.require.bind(loaded);
  loaded.require=specifier=>specifier==='../auth'?{
    requireAuth(req,res,next){const principal=req.headers['x-synthetic-principal'];if(!principal)return res.status(401).json({error:'login required'});req.session={personId:principal,...(principal==='system_admin'?{identityKind:'system_admin'}:{})};next();},
    requirePermission(code){return (req,res,next)=>(permissions[req.session.personId]||[]).includes(code)?next():res.status(403).json({error:'denied'});},
    requireAnyPermission(...codes){return (req,res,next)=>codes.some(code=>(permissions[req.session.personId]||[]).includes(code))?next():res.status(403).json({error:'denied'});},
    async getUserEffectivePermissionsAsync(principal){return {permSet:new Set(permissions[principal]||[])};},
    async getUserRoleCodesAsync(principal){return principal==='admin'?[{code:'admin'}]:[];}
  }:originalRequire(specifier);
  loaded._compile(fs.readFileSync(filename,'utf8'),filename);return loaded.exports;
}
async function serve(app,action) {
  const server=await new Promise(resolve=>{const started=app.listen(0,'127.0.0.1',()=>resolve(started));});
  try {await action('http://127.0.0.1:'+server.address().port);} finally {await new Promise(resolve=>server.close(resolve));}
}
test('directory HTTP contract limits contact projection and maintenance to HR permission',async()=>{
  const router=route('directory'),reads=[],writes=[];
  router.setRepositoryFactory(()=>({snapshot:async options=>{reads.push(options);return {schema_version:'organization-person-directory-v1',persons:[{person_id:'9007199254741001',...(options.includeContacts?{mobile:'synthetic-contact'}:{})}]};},preview:async body=>{writes.push(body);return {request_hash:'synthetic'};},save:async()=>({idempotent:false})}));
  const app=express();app.use(express.json());app.use('/api/directory',router);
  await serve(app,async base=>{
    const request=(url,principal='reader',options={})=>fetch(base+url,{...options,headers:{'x-synthetic-principal':principal,...options.headers}});
    assert.equal((await fetch(base+'/api/directory/v1')).status,401);
    const basic=await (await request('/api/directory/v1')).json();assert.equal(basic.canMaintain,false);assert.equal('mobile' in basic.persons[0],false);
    assert.equal((await request('/api/directory/v1?include_contacts=true')).status,403);
    const full=await (await request('/api/directory/v1?include_contacts=true','hr')).json();assert.equal(full.canMaintain,true);assert.equal(full.persons[0].mobile,'synthetic-contact');
    assert.equal((await request('/api/directory/v1?include_contacts=true','admin')).status,403);
    assert.equal((await request('/api/directory/preview','reader',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await request('/api/directory/preview','hr',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"entity":"person"}'})).status,200);
    assert.equal(writes.length,1);assert.deepEqual(reads,[{includeContacts:false},{includeContacts:true}]);
  });
});

test('legacy roster preserves basic identity and limits contacts to effective HR maintenance',async()=>{
  const previousModel=process.env.MDM_IDENTITY_READ_MODEL;
  process.env.MDM_IDENTITY_READ_MODEL='mysql';
  const router=route('org');
  const rows=[{person_id:'9007199254741001',employee_no:'SYNTHETIC-1',person_name:'合成员工',mobile:'synthetic-contact',email:'synthetic@example.invalid'}];
  router.setIdentityRepositoryFactory(()=>({
    getUserEffectivePermissions:async principal=>({permSet:new Set(permissions[principal]||[])}),
    getUserRoleCodes:async principal=>principal==='admin'?[{code:'admin'}]:[{code:'hr_directory_manager'}],
    listRoster:async()=>rows
  }));
  const app=express();app.use('/api/org',router);
  try {
    await serve(app,async base=>{
      assert.equal((await fetch(base+'/api/org/roster')).status,401);
      assert.equal((await fetch(base+'/api/org/roster',{headers:{'x-synthetic-principal':'lead'}})).status,403);
      for(const principal of ['reader','admin','system_admin','hr']) {
        const response=await fetch(base+'/api/org/roster',{headers:{'x-synthetic-principal':principal}});
        assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
        const body=await response.json();assert.equal(body.rows[0].person_id,rows[0].person_id);
        assert.equal('mobile' in body.rows[0],principal==='hr');assert.equal('email' in body.rows[0],principal==='hr');
      }
      assert.equal(rows[0].mobile,'synthetic-contact');
    });
  } finally {
    router.resetIdentityRepositoryFactory();
    if(previousModel===undefined)delete process.env.MDM_IDENTITY_READ_MODEL;else process.env.MDM_IDENTITY_READ_MODEL=previousModel;
  }
});
test('publication capabilities and spreadsheet preparation are isolated by selected kind',async()=>{
  const router=route('publications');
  router.setActorFactory(req=>({canRead:true,canPrepare:true,canPublish:true,canMaintainDirectory:req.session.personId==='hr',canPrepareMasterData:req.session.personId==='lead',canPublishMasterData:req.session.personId==='lead'}));
  router.setRepositoryFactory(()=>({status:async()=>({ready:true})}));
  const app=express();app.use('/api/publications',router);
  await serve(app,async base=>{
    for(const [principal,kind,allowed] of [['hr','roster',true],['hr','master_data',false],['lead','organization',false],['lead','master_data',true]]) {
      const headers={'x-synthetic-principal':principal};
      const status=await (await fetch(base+'/api/publications/status?kind='+kind,{headers})).json();assert.equal(status.canPublish,allowed);assert.equal(status.canPrepare,allowed);
      const form=new FormData();form.set('kind',kind);form.set('file',new Blob(['编码,名称\nK1,合成记录'],{type:'text/csv'}),'synthetic.csv');
      assert.equal((await fetch(base+'/api/publications/parse',{method:'POST',headers,body:form})).status,allowed?200:403);
    }
  });
});
test('directory full history and every download format require directory maintenance',async()=>{
  const router=route('publications');
  router.setActorFactory(req=>({canRead:true,canMaintainDirectory:req.session.personId==='hr'}));
  router.setRepositoryFactory(()=>({get:async value=>({id:value,kind:value==='3'?'master_data':value==='2'?'organization':'roster',title:'合成历史',version_no:1,content:{headers:['人员信息'],rows:[['合成受限信息']]},audit:{reason:'合成依据',before:{mobile:'合成电话'}}})}));
  const app=express();app.use('/api/publications',router);
  await serve(app,async base=>{
    for(const principal of ['reader','lead','admin']) for(const recordId of ['1','2']) for(const suffix of ['', '/download?format=json','/download']) {
      const response=await fetch(base+'/api/publications/'+recordId+suffix,{headers:{'x-synthetic-principal':principal}});
      assert.equal(response.status,403);const body=await response.json();assert.equal(body.code,'DIRECTORY_HISTORY_ACCESS_DENIED');assert.equal('content' in body,false);assert.equal('audit' in body,false);
    }
    for(const recordId of ['1','2','3']) for(const suffix of ['', '/download?format=json','/download']) {
      const response=await fetch(base+'/api/publications/'+recordId+suffix,{headers:{'x-synthetic-principal':'hr'}});assert.equal(response.status,200);await response.arrayBuffer();
    }
    assert.equal((await fetch(base+'/api/publications/3',{headers:{'x-synthetic-principal':'reader'}})).status,200);
  });
});
