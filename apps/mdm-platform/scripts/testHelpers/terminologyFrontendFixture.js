// Candidate frontend fixture: real terminology/identity/reference repositories
// against the caller-owned freshMysql pool. Shell login and outer process-page
// reads are synthetic and are explicitly listed in the evidence.
const express=require('express');
const {randomUUID}=require('node:crypto');
const {seed}=require('./dataMapHandoffFixture');
const {digest,json}=require('../../server/dataMapHandoffPolicy');
async function fixture(target,{jointHandoff=false,runtimePoolFactory=null}={}){
  let {pool}=target;const base=await seed(target),auth=require('../../server/auth');
  const connection=await pool.getConnection();try{await require('../../server/departmentAccountabilityMigration').applyDepartmentAccountabilityPolicy(connection);}finally{connection.release();}
  for(const [person,account,department,role]of [['21','121','91','department_mdm_reviewer'],['22','122','92',null],['23','123','92','department_mdm_reviewer']]){
    await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,?)',[person,'FRONTEND_SYN_'+person,'前端合成人员'+person,department]);
    await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES(?,?,?,'synthetic-unusable','active',0)",[account,person,'FRONTEND_SYN_'+person]);
    if(role)await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,'department',?,'owned frontend fixture',CURRENT_DATE FROM roles WHERE role_code=?",[person,department,role]);
  }
  await pool.execute('UPDATE departments SET final_responsible_person_id=21 WHERE id=91');await pool.execute('UPDATE departments SET final_responsible_person_id=23 WHERE id=92');
  for(const sql of [...require('../../server/terminologyGovernanceSchema').statements(),...require('../../server/terminologyUsageSchema').statements()])await pool.execute(sql);
  await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES(?)',[require('../../server/terminologyGovernanceSchema').MIGRATION_KEY]);
  const {source}=await base.packageSeed(701,{status:'mdm_governing'});source.process.process_name='前端合成设备';source.process.purpose='验证原文与固定术语引用';
  await pool.execute('UPDATE process_design_drafts SET schema_version=?,process_content_json=?,content_hash=? WHERE id=701',[source.schema_version,json(source),digest(source)]);
  if(runtimePoolFactory)pool=await runtimePoolFactory(target);
  const identity=require('../../server/identityMysqlRepository').makeIdentityMysqlRepository(pool);
  const core=require('../../server/terminologyGovernanceRepository'),repo=core.makeTerminologyGovernanceRepository(pool),usage=require('../../server/terminologyUsages'),refs=usage.makeTerminologyUsages(pool);
  const sessions={contact:{...base.session('14'),departmentId:'91'},lead:{...base.session('11'),departmentId:'91'},steward:{...base.session('12'),departmentId:'91'},admin:{...base.session('13'),departmentId:'91'},head:{personId:'21',accountId:'121',authVersion:'1',departmentId:'91'},employee:{personId:'22',accountId:'122',authVersion:'1',departmentId:'92'},otherHead:{personId:'23',accountId:'123',authVersion:'1',departmentId:'92'}};
  for(const s of Object.values(sessions)){s.userId=s.personId;s.identityKind='person';}
  auth.setIdentityRepositoryFactory(async()=>identity);core.setTerminologyGovernanceRepositoryFactory(async()=>repo);
  const usageRouter=require('../../server/routes/terminologyUsages');usageRouter.setRepositoryFactory(async()=>refs);
  const dataMap=require('../../server/dataMapMysqlRepository');dataMap.setDataMapRepositoryFactory(async()=>dataMap.makeDataMapMysqlRepository(pool));
  const app=express(),csrf=randomUUID(),requests=[],scaffolds=new Set();app.use(express.json({limit:'1mb'}));
  app.use((req,res,next)=>{const who=req.get('x-synthetic-role'),s=sessions[who];if(s)req.session={...s,destroy:cb=>cb()};res.on('finish',()=>requests.push({method:req.method,path:req.originalUrl.split('?')[0],url:req.originalUrl,status:res.statusCode,role:who,body:req.method==='GET'?undefined:req.body}));next();});
  app.get('/api/org/session',(req,res)=>res.json({authenticated:Boolean(req.session)}));
  app.get('/api/org/me',auth.requireAuth,async(req,res)=>{const user=await identity.getUserById(req.session.personId),permissions=await identity.getUserEffectivePermissions(req.session.personId),roles=await identity.getUserRoleCodes(req.session.personId);res.json({...user,personId:String(user.personId),departmentId:String(user.current_department_id||''),personName:user.personName||'合成测试人员',departmentName:'前端合成部门',permissions:[...permissions.permSet],roleCodes:roles.map(r=>r.role_code||r)});});
  app.get('/api/org/me/password-status',auth.requireAuth,(req,res)=>res.json({is_default_password:false}));
  app.get('/api/csrf-token',auth.requireAuth,(req,res)=>res.json({csrfToken:csrf}));
  app.use('/api',(req,res,next)=>!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('x-csrf-token')!==csrf?res.status(403).json({code:'CSRF_TOKEN_INVALID',error:'合成CSRF校验失败'}):next());
  app.use('/api/terminology-governance',usageRouter);app.use('/api/terminology-governance',require('../../server/routes/terminologyGovernance'));
  app.use('/api/data-map-definitions',require('../../server/routes/dataMapDefinitions'));
  if(jointHandoff){
    app.use('/api/data-map-handoffs',require('../../server/routes/dataMapHandoffs').createRouter({pool}));
    const terms=require('../../server/terminologyMysqlRepository');terms.setTerminologyRepositoryFactory(async()=>terms.makeTerminologyMysqlRepository(pool));
    app.use('/api/terminology',require('../../server/routes/terminology'));
    app.use('/api/field-entries',require('../../server/routes/fieldEntries'));
    app.use('/api/field-identities',require('../../server/routes/fieldIdentities'));
    app.use('/api/data-map',require('../../server/routes/dataMap'));
  }
  // Only reads needed to mount the existing outer pages are simulated. The
  // terminology requests from those mounted panels still use actual routes.
  app.use('/api',(req,res,next)=>{
    if(req.method!=='GET')return next();const p=req.path;let value;
    if(p==='/process-v7-preview/cases')value={items:[{id:'701',process_name:'前端合成流程',current_revision_no:1}]};
    if(p==='/process-v7-preview/cases/701')value={case:{id:'701',process_name:'前端合成流程',owning_department_name:'合成甲部',current_revision_no:1,current_content_hash:digest(source)},revision:{document:source},formal_promotion:{document:{id:'701'},draft:{id:'701',revision_no:1,content_hash:digest(source),status:'draft',schema_version:source.schema_version}},allowed_actions:[],formal_allowed_actions:[],formal_allowed_decisions:[],events:[]};
    if(p==='/process-data-governance/status')value={enabled:true,read_only:false};
    if(p==='/process-data-governance/workbench')value={items:[],work_packages:[],allowed_actions:[]};
    if(p==='/process-data-governance/work-packages/701')value={package:{id:'701',process_name:'前端合成工作包',process_version_id:'701',source_content_hash:digest(source),revision_no:1,status:'mdm_governing'},source_version:{schema_version:source.schema_version,document_no:'SYNTHETIC',document_title:'前端合成流程'},details:[],fact_requests:[],reviews:[],events:[],allowed_actions:[]};
    if(p==='/governance-responsibilities/work-packages/701')value={target_id:'701',target_type:'work_package',assignments:{},allowed_actions:[]};
    if(value!==undefined){scaffolds.add(p);return res.json(value);}return next();
  });
  app.use('/api',(req,res)=>res.status(404).json({code:'SYNTHETIC_ROUTE_NOT_PROVIDED',error:'夹具未提供该读取'}));
  const front=require('../../server/frontend');app.use(front.publicEntryRouter());app.use('/app',front.frontendRouter());
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const url='http://127.0.0.1:'+server.address().port;
  return {url,pool,repo,refs,source,sessions,requests,scaffolds,base,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));auth.resetIdentityRepositoryFactory();core.resetTerminologyGovernanceRepositoryFactory();usageRouter.setRepositoryFactory(null);dataMap.resetDataMapRepositoryFactory();if(jointHandoff)require('../../server/terminologyMysqlRepository').resetTerminologyRepositoryFactory();}};
}
module.exports={fixture};
