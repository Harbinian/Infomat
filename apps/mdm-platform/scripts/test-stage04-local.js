// Repeatable local launch checks. All simulation children have a sanitized environment
// and a mandatory MySQL connection blocker. The optional/full MySQL step creates ONLY
// its own labelled disposable container. Does not run setup/init/start scripts or read env files.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const appRoot=path.resolve(__dirname,'..');
const root=path.resolve(appRoot,'../..');
const pkg=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json')));
const security=['test-user-password-scripts.js','test-password-audit.js','test-route-write-audit.js','test-security-routes.js'];
function expand(name) {
  if(name==='test:security')return security.map(file=>path.join('scripts',file));
  const command=pkg.scripts[name];if(!command)throw Error('Unknown test: '+name);
  return command.split(' && ').flatMap(part=>{
    if(part.startsWith('npm run test:'))return expand(part.slice(8));
    if(/^node scripts\/test-[\w-]+\.js$/.test(part))return [part.slice(5)];
    throw Error('Unreviewed test command: '+part);
  });
}
const securityOnly=process.argv.includes('--security');
const suites=securityOnly?['test:security']:[
  'test:security','test:project-roles','test:rbac-raci-v2','test:identity-mysql',
  'test:process-governance','test:conflicts-mysql','test:conflicts-mysql-identity',
  'test:mappings-mysql-identity','test:field-entries-mysql-identity','test:field-identities-mysql-identity',
  'test:process-data-governance','test:mysql-runtime-boundary'
];
const scripts=[...new Set(suites.flatMap(expand))];
const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'');
const evidenceDir=path.join(root,'artifacts/mdm-3000-launch',`stage04-${stamp}`);
fs.mkdirSync(evidenceDir,{recursive:true});
const results=[];
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report={stage:'04',startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,suites,results};
function run(file,realMysql=false) {
  const args=realMysql?[file]:['--require',path.join(__dirname,'testHelpers/blockRealMysql.js'),file];
  const start=Date.now();
  const env=isolatedEnvironment(realMysql?{}:{NODE_OPTIONS:`--require="${path.join(__dirname,'testHelpers/blockRealMysql.js').replace(/\\/g,'/')}"`});
  const result=spawnSync(process.execPath,args,{cwd:appRoot,env,encoding:'utf8',windowsHide:true,timeout:realMysql?180000:120000,maxBuffer:20*1024*1024});
  const log=path.join(evidenceDir,path.basename(file,'.js')+'.log');
  fs.writeFileSync(log,(result.stdout||'')+(result.stderr||'')+`\nexit=${result.status}\n`);
  const record={script:file,sha256:sha(path.join(appRoot,file)),status:result.status,durationMs:Date.now()-start,dependency:realMysql?'fresh isolated mysql:8.4 and real app HTTP/session':'static / injected repositories / owned temporary legacy SQLite, real MySQL blocked',log:path.relative(root,log).replace(/\\/g,'/'),logSha256:sha(log)};
  results.push(record);
  console.log(`${result.status===0?'PASS':'FAIL'} ${file}`);
  if(result.status!==0) {console.error(((result.stdout||'')+(result.stderr||'')).slice(-2200));process.exitCode=1;}
  fs.writeFileSync(path.join(evidenceDir,'test-results.json'),JSON.stringify(report,null,2)+'\n');
}
for(const file of scripts)run(file);
if(!securityOnly&&!process.argv.includes('--simulated-only'))run('scripts/test-stage04-mysql-isolated.js',true);
report.finishedAt=new Date().toISOString();
report.passed=results.every(r=>r.status===0);
fs.writeFileSync(path.join(evidenceDir,'test-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`STAGE04_EVIDENCE=${evidenceDir}`);
