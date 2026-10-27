// Explicit test preload only: the application entry and shutdown remain unchanged.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
// Worker threads inherit Node preload arguments. Never load Express or patch the
// candidate router in a bounded parser/analysis worker.
if (require('node:worker_threads').isMainThread) {
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.MYSQL_HOST, '127.0.0.1');
assert.match(process.env.MYSQL_DATABASE || '', /^stage\d{2}_isolated(?:_[a-f0-9]{32})?$/);
const dist = path.resolve(process.env.MDM_TEST_FRONTEND_DIST || '');
assert(dist.startsWith(path.resolve(__dirname, '../../../../artifacts') + path.sep));
assert(fs.statSync(path.join(dist, 'index.html')).isFile());
if (process.env.MDM_TEST_NODE_PATH) {
  const modules = path.resolve(process.env.MDM_TEST_NODE_PATH);
  assert(modules.startsWith(path.resolve(__dirname, '../../../../artifacts') + path.sep));
  assert(fs.statSync(modules).isDirectory());
  process.env.NODE_PATH = [modules,process.env.NODE_PATH||''].filter(Boolean).join(path.delimiter);
  require('node:module').Module._initPaths();
}
const candidateRoot=process.env.MDM_TEST_CANDIDATE_ROOT&&path.resolve(process.env.MDM_TEST_CANDIDATE_ROOT);
if(candidateRoot)assert(candidateRoot.startsWith(path.resolve(__dirname,'../../../../artifacts')+path.sep));
const frontend = candidateRoot?require(path.join(candidateRoot,'server/frontend')):require('../../server/frontend');
const original = frontend.frontendRouter;
frontend.frontendRouter = () => original(dist);
if(candidateRoot&&process.env.MDM_TEST_CANDIDATE_TRACE_FILE){
 const trace=path.resolve(process.env.MDM_TEST_CANDIDATE_TRACE_FILE);assert(trace.startsWith(path.resolve(__dirname,'../../../../artifacts')+path.sep));
 process.on('exit',code=>{const crypto=require('node:crypto'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  const sources=Object.values(require.cache).filter(module=>module.filename&&['server','shared'].some(folder=>module.filename.startsWith(path.join(candidateRoot,folder)+path.sep)))
   .map(module=>({path:path.relative(candidateRoot,module.filename).replaceAll('\\','/'),sha256:sha(fs.readFileSync(module.filename))})).sort((a,b)=>a.path.localeCompare(b.path));
  assert(!fs.existsSync(trace));fs.writeFileSync(trace,JSON.stringify({candidate_root:candidateRoot,exit_code:code,runtime_source_files:sources,runtime_manifest_sha256:sha(JSON.stringify(sources))},null,2)+'\n');
 });
}
}else{
 // Bounded parser workers deliberately receive env:{} and inherit this test
 // preloader. Candidate source folders omit installed packages; provide only
 // the existing test dependency location, without loading Express or secrets.
 process.env.NODE_PATH=path.resolve(__dirname,'../../node_modules');
 require('node:module').Module._initPaths();
}
