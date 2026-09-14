// Stage05 required regression suites in sanitized children. MySQL is blocked in
// all simulated checks; real MySQL/Edge steps create only owned tmpfs fixtures.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const appRoot=path.resolve(__dirname,'..'),root=path.resolve(appRoot,'../..');
const pkg=require('../package.json');
function expand(name) {
  return pkg.scripts[name].split(' && ').flatMap(part=>{
    if(part.startsWith('npm run test:'))return expand(part.slice(8));
    if(/^node scripts\/test-[\w-]+\.js$/.test(part))return [part.slice(5)];
    throw Error('Unreviewed test command: '+part);
  });
}
const suites=['test:frontend','test:project-roles','test:process-governance','test:mainline','test:role-workbench','test:stage03-runtime','test:mysql-runtime-boundary'];
let scripts=[...new Set(suites.flatMap(expand))];
const retryIndex=process.argv.indexOf('--failed-from');
if(retryIndex>=0) {
  const previous=JSON.parse(fs.readFileSync(path.resolve(process.argv[retryIndex+1]),'utf8'));
  const failed=new Set(previous.results.filter(r=>r.status!==0).map(r=>r.script));
  scripts=scripts.filter(file=>failed.has(file));
  if(!scripts.length)throw Error('No failed scripts from the reviewed stage05 suite');
}
const dir=path.join(root,'artifacts/mdm-3000-launch','stage05-'+new Date().toISOString().replace(/[-:.TZ]/g,''));fs.mkdirSync(dir,{recursive:true});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report={stage:'05',startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,suites,retryOf:retryIndex>=0?path.resolve(process.argv[retryIndex+1]):null,results:[]};
function run(file,real=false) {
  const blocker=path.join(__dirname,'testHelpers/blockRealMysql.js');
  const env=isolatedEnvironment({npm_execpath:path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),...(!real?{NODE_OPTIONS:`--require="${blocker.replace(/\\/g,'/')}"`}:{})});
  const start=Date.now();
  const result=spawnSync(process.execPath,real?[file]:['--require',blocker,file],{cwd:appRoot,env,encoding:'utf8',windowsHide:true,timeout:real?300000:180000,maxBuffer:20*1024*1024});
  const log=path.join(dir,path.basename(file,'.js')+'.log');fs.writeFileSync(log,(result.stdout||'')+(result.stderr||'')+'\nexit='+result.status+'\n');
  report.results.push({script:file,sha256:sha(path.join(appRoot,file)),status:result.status,durationMs:Date.now()-start,dependency:real?'owned real MySQL / HTTP / Edge if browser test':'static / synthetic repositories / owned temporary legacy SQLite; real MySQL blocked',log:path.relative(root,log).replace(/\\/g,'/'),logSha256:sha(log)});
  console.log((result.status===0?'PASS ':'FAIL ')+file);
  if(result.status!==0){process.exitCode=1;console.error(((result.stdout||'')+(result.stderr||'')).slice(-1500));}
  fs.writeFileSync(path.join(dir,'test-results.json'),JSON.stringify(report,null,2)+'\n');
}
for(const file of scripts)run(file);
if(!process.argv.includes('--simulated-only')) {
  run('scripts/test-stage05-mysql-isolated.js',true);
  run('scripts/test-stage05-browser.js',true);
}
report.finishedAt=new Date().toISOString();report.passed=report.results.every(r=>r.status===0);
fs.writeFileSync(path.join(dir,'test-results.json'),JSON.stringify(report,null,2)+'\n');
console.log('STAGE05_EVIDENCE='+dir);
