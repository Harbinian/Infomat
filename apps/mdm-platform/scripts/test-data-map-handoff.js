// Local priority regression runner. Pure mode blocks real MySQL; --mysql creates
// only fresh owner-labelled tmpfs fixtures. No env files, formal target or service.
// HTTP coverage is a separate opt-in command because it needs fixture dependencies.
const {spawnSync}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const mysql=process.argv.includes('--mysql');
const args=process.argv.slice(2);let requestedOutput;
for(let i=0;i<args.length;i++){if(args[i]==='--mysql')continue;if(args[i]==='--output'&&args[i+1]){requestedOutput=args[++i];continue;}throw Error('Supported arguments: --mysql --output <new artifacts directory>');}
const artifacts=path.resolve(__dirname,'../../../artifacts');
const target=path.resolve(requestedOutput||path.join(artifacts,'mdm-data-map-handoff-suite-'+require('node:crypto').randomUUID()));
if(!target.startsWith(artifacts+path.sep)||fs.existsSync(target))throw Error('Use a new directory inside artifacts');fs.mkdirSync(target,{recursive:true});
const scripts=[
 ['test-data-map-handoff-authority.js'],['test-data-map-handoff-boundaries.js'],
 ['test-data-map-handoff-impact.js'],['test-data-map-handoff-legacy.js'],
 ['test-data-map-mysql-repository.js'],['test-data-map-contexts-api.js']
];
if(mysql)scripts.push(
 ['test-data-map-handoff-schema-mysql.js'],['test-data-map-handoff-authority-mysql.js'],
 ['test-data-map-handoff-legacy.js','--mysql'],['test-data-map-handoff-requests-mysql.js'],
 ['test-data-map-handoff-reader-mysql.js'],['test-data-map-handoff-impact-mysql.js'],
 ['test-data-map-handoff-publisher-mysql.js'],['test-data-map-handoff-repository-mysql.js'],
 ['test-data-map-handoff-native-review-mysql.js'],['test-data-map-handoff-migration-mysql.js'],
 ['test-data-map-handoff-generator-mysql.js'],['test-data-map-native-history-mysql.js'],
 ['test-data-map-publication-withdrawal-mysql.js'],['test-data-map-withdrawn-reference-mysql.js'],
 ['test-data-map-restoration-mysql.js'],['test-data-map-publication-faults-mysql.js'],
 ['test-data-map-conflict-mysql.js'],['test-data-map-conflict-faults-mysql.js'],
 ['test-data-map-legacy-consumers-mysql.js'],['test-data-map-source-upgrade-mysql.js']
);
const results=[];
for(const [file,...originalArgs] of scripts){
 const pure=!mysql||(!file.endsWith('-mysql.js')&&!originalArgs.includes('--mysql'));
 const evidence=path.join(target,file.replace(/\.js$/,'')+(pure?'-pure':'-mysql'));
 const namedOutput=['test-data-map-handoff-legacy.js','test-data-map-handoff-reader-mysql.js','test-data-map-withdrawn-reference-mysql.js'].includes(file);
 const args=[...originalArgs,...(namedOutput?['--output',evidence]:!pure?[evidence]:[])];
 const argv=[...(pure?['-r',path.join(__dirname,'testHelpers/blockRealMysql.js')]:[]),path.join(__dirname,file),...args];
 const run=spawnSync(process.execPath,argv,{env:isolatedEnvironment(),encoding:'utf8',windowsHide:true,timeout:900000,maxBuffer:8*1024*1024});
 process.stdout.write(run.stdout||'');process.stderr.write(run.stderr||'');
 results.push({file,args,result:run.status===0?'passed':'failed',exit_code:run.status,error:run.error?.code||null});
 if(run.status!==0)break;
}
const passed=results.length===scripts.length&&results.every(x=>x.result==='passed');
fs.writeFileSync(path.join(target,mysql?'priority-suite-mysql.json':'priority-suite-pure.json'),JSON.stringify({mode:mysql?'isolated_mysql':'pure',status:passed?'passed':'failed',results,formal_database_connected:false,formal_migration:false,deployed:false,feature_enabled:false},null,2)+'\n');
if(!passed)process.exitCode=1;
