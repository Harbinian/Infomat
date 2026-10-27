// Opt-in preloader for owned governance tests. Resolve application modules from
// one explicit artifacts candidate, retaining local test-only dependencies.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),artifacts=path.resolve(root,'../../artifacts')+path.sep;
const selected=process.env.MDM_TEST_CANDIDATE_ROOT;
assert(selected,'MDM_TEST_CANDIDATE_ROOT is required');const candidate=path.resolve(selected);assert(candidate.startsWith(artifacts));
const testScript=path.resolve(process.argv[1]);assert(testScript.startsWith(path.join(root,'scripts')+path.sep));
const argument=process.argv.indexOf('--output'),output=path.resolve(argument<0?process.argv[2]:process.argv[argument+1]);assert(output.startsWith(artifacts));
const resolve=Module._resolveFilename;
process.env.NODE_PATH=[path.join(root,'node_modules'),process.env.NODE_PATH||''].filter(Boolean).join(path.delimiter);Module._initPaths();
Module._resolveFilename=function(request,parent,...rest){
 const resolved=resolve.call(this,request,parent,...rest);
 if(typeof resolved==='string'&&['server','shared'].some(folder=>resolved.startsWith(path.join(root,folder)+path.sep))){
  const target=path.join(candidate,path.relative(root,resolved));assert(fs.existsSync(target),'candidate module missing: '+path.relative(root,resolved));return target;
 }return resolved;
};
process.on('exit',code=>{
 if(!fs.existsSync(output))return;
 const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const sources=Object.values(require.cache).filter(module=>module.filename&&['server','shared'].some(folder=>module.filename.startsWith(path.join(candidate,folder)+path.sep)))
  .map(module=>({path:path.relative(candidate,module.filename).replaceAll('\\','/'),sha256:hash(fs.readFileSync(module.filename))})).sort((a,b)=>a.path.localeCompare(b.path));
 const destination=path.join(output,'candidate-runtime-sources.json');assert(!fs.existsSync(destination));
 fs.writeFileSync(destination,JSON.stringify({candidate_root:candidate,test_script:path.relative(root,testScript).replaceAll('\\','/'),test_script_sha256:hash(fs.readFileSync(testScript)),exit_code:code,runtime_source_files:sources,runtime_manifest_sha256:hash(JSON.stringify(sources))},null,2)+'\n');
});
