// Sequential owned MySQL/Edge regressions on an explicit artifact build; no default build.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const arg = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index+1] : null; };
const dist = path.resolve(arg('--dist') || ''), output = path.resolve(arg('--output') || ''), modules = path.resolve(arg('--test-node-path') || '');
const artifacts = path.resolve(__dirname,'../../../artifacts');
assert(['--dist','--output','--test-node-path'].every(name => process.argv.includes(name)));
assert([dist,output,modules].every(value => value.startsWith(artifacts + path.sep)) && !fs.existsSync(output)); fs.mkdirSync(output,{recursive:true});
const tests = (arg('--tests') || 'test-role-workbench-browser.js,test-dashboard-browser.js,test-identity-directory-browser.js,test-role-management-browser.js,test-role-guide-browser.js,test-office-workbench-browser.js,test-data-governance-browser.js,test-process-formal-browser.js,test-data-map-read-browser.js,test-data-map-create-browser.js,test-field-import-browser.js,test-field-identity-browser.js,test-field-export-browser.js,test-quality-browser.js,test-publications-browser.js,test-terms-conflicts-browser.js,test-todo-inbox-browser.js').split(',');
assert(tests.every(name => /^test-[a-z0-9-]+\.js$/.test(name) && fs.existsSync(path.join(__dirname,name))));
const results = [];
(async () => {
  for (const name of tests) {
    const target = path.join(output,name.replace('.js',''));
    const file = fs.openSync(path.join(output,name+'.log'),'wx');
    const started = Date.now();
    const child = spawn(process.execPath,['--require',path.join(__dirname,'testHelpers/ownedBrowserRuntime.js'),path.join(__dirname,name),...(process.argv.includes('--native-v8')&&name==='test-p25-candidate-integration.js'?['--native-v8']:[]),'--frontend-dist',dist,'--test-node-path',modules,'--complete-source','--output',target],{cwd:path.resolve(__dirname,'../../..'),windowsHide:true,env:{...process.env,NODE_PATH:[path.resolve(__dirname,'../node_modules'),modules].join(path.delimiter)},stdio:['ignore',file,file]});
    const code = await new Promise((resolve,reject)=>{ child.once('error',reject); child.once('exit',resolve); }); fs.closeSync(file);
    let report=null; if(fs.existsSync(path.join(target,'results.json'))) report=JSON.parse(fs.readFileSync(path.join(target,'results.json'),'utf8'));
    results.push({name,code,seconds:(Date.now()-started)/1000,passed:code===0 && Boolean(report) && report.passed!==false,checks:report?.checks||[],evidence:target});
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({completed:results.length,total:tests.length,results},null,2));
    console.log(JSON.stringify({name,code,passed:results.at(-1).passed,completed:results.length,total:tests.length}));
  }
  process.exitCode = results.every(result=>result.passed) ? 0 : 1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
