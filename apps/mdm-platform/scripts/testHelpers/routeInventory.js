// Inspect actual formal Express registrations without listening or opening a DB.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const appRoot=path.resolve(__dirname,'../..');
const routesDir=path.join(appRoot,'server/routes');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function source(file) {return fs.readFileSync(path.join(appRoot,file),'utf8');}
function reference(file,needle) {
  const content=source(file);const offset=content.indexOf(needle);
  if(offset<0)throw Error(`Missing security evidence: ${file} ${needle}`);
  return {file,line:content.slice(0,offset).split('\n').length,anchor:needle};
}
function staticRoutes() {
  const result=[];
  for(const file of fs.readdirSync(routesDir).filter(f=>f.endsWith('.js')).sort()) {
    const content=source('server/routes/'+file);
    for(const m of content.matchAll(/router\.(post|put|patch|delete|all)\(\s*(['"`])([^'"`]+)\2\s*,/g)) {
      result.push({file,line:content.slice(0,m.index).split('\n').length,method:m[1].toUpperCase(),path:m[3]});
    }
  }
  return result;
}
function formalRoutes() {
  const {isolatedEnvironment}=require('./isolatedProcess');
  process.env=isolatedEnvironment({NODE_ENV:'production',MDM_IDENTITY_READ_MODEL:'mysql',PROCESS_GOVERNANCE_READ_MODEL:'mysql',
    MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'1',MYSQL_USER:'synthetic',MYSQL_PASSWORD:'synthetic',MYSQL_DATABASE:'unreachable',
    SESSION_SECRET:'synthetic-inventory-secret-no-listener',MDM_ACCESS_MODE:'https-proxy',MDM_PUBLIC_ORIGIN:'https://synthetic.invalid',MDM_TRUST_PROXY:'127.0.0.1/32'});
  require('./blockRealMysql');
  const Module=require('node:module');const load=Module._load;
  Module._load=function(name,...args) {if(name==='better-sqlite3'||/^(\.\.?\/)+db$/.test(name))throw Error('INVENTORY_SQLITE_FORBIDDEN');return load.call(this,name,...args);};
  const express=require('express');const originalRouter=express.Router;
  const registrations=[];const mounts=[];
  express.Router=function(...args) {
    const router=originalRouter(...args);router.auditRows=[];const middleware=[];
    for(const method of ['get','head','post','put','patch','delete','all','use']) {
      const original=router[method];
      router[method]=function(...values) {
        const stack=new Error().stack;
        const location=stack.match(/[\\/]server[\\/]routes[\\/]([^:\n]+):(\d+):/);
        if(location) {
          const handlers=values.flat(Infinity).filter(v=>typeof v==='function').map(fn=>({name:fn.name,body:String(fn)}));
          if(method==='use') middleware.push({line:Number(location[2]),path:typeof values[0]==='string'?values[0]:null,handlers});
          else {
            const row={file:location[1],line:Number(location[2]),method:method.toUpperCase(),path:values[0],handlers,middleware:[...middleware]};
            registrations.push(row);router.auditRows.push(row);
          }
        }
        return original.apply(this,values);
      };
    }
    return router;
  };
  const originalUse=express.application.use;
  express.application.use=function(...args) {
    if(typeof args[0]==='string')for(const fn of args.slice(1).flat(Infinity))if(fn&&fn.auditRows)mounts.push({base:args[0],rows:fn.auditRows,router:fn});
    return originalUse.apply(this,args);
  };
  require(path.join(appRoot,'server/index'));
  // Fail closed if a chained route, nested router or future registration syntax escapes capture.
  for(const mount of mounts) {
    const observed=mount.router.stack.filter(layer=>layer.route).map(layer=>layer.route);
    if(mount.router.stack.some(layer=>!layer.route&&layer.handle&&layer.handle.stack))throw Error('Untraced nested router: '+mount.base);
    for(const route of observed) {
      const methods=route.methods._all?['ALL']:Object.keys(route.methods).filter(key=>route.methods[key]).map(key=>key.toUpperCase());
      for(const method of methods)if(!mount.rows.some(row=>row.path===route.path&&row.method===method))throw Error(`Untraced Express route: ${mount.base} ${method} ${route.path}`);
    }
    if(observed.length!==mount.rows.length)throw Error('Registration occurrence mismatch: '+mount.base);
  }
  const rows=mounts.flatMap(m=>m.rows.filter(r=>['POST','PUT','PATCH','DELETE','ALL'].includes(r.method)).map(r=>({...r,base:m.base})));
  return {rows,mounts:mounts.map(m=>({base:m.base,files:[...new Set(m.rows.map(r=>r.file))]}))};
}

// Expand the route's direct local helper calls for inspectable, line-bound evidence.
// This is a static trace, not a claim that every branch executes or a vulnerability verdict.
function localEvidence(row) {
  const file='server/routes/'+row.file,content=source(file);
  const parts=[...row.handlers,...row.middleware.flatMap(m=>m.handlers)].map(h=>h.body);
  const from=content.split(/\r?\n/).slice(row.line-1).join('\n');
  const next=from.slice(1).search(/\nrouter\./);
  parts.push(next<0?from:from.slice(0,next+1));
  for(const spread of parts.join('\n').matchAll(/\.\.\.(\w+)/g)) {
    const declaration=new RegExp('const\\s+'+spread[1]+'\\s*=\\s*\\[[\\s\\S]*?\\];').exec(content);
    if(declaration)parts.push(declaration[0]);
  }
  const found=new Map();
  for(let depth=0;depth<4;depth++) {
    const names=[...new Set(parts.join('\n').match(/\b(?:assert|can|has|require|current|authorized|processGovernancePreview|importStructuredOutput|requestHas|expected|formalV7|v7Formal|issuePoolActor|conflictActor)\w*(?=\s*\()/g)||[])];
    let grew=false;
    for(const name of names) {
      if(found.has(name))continue;
      const pattern=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(');
      const m=pattern.exec(content);
      if(!m)continue;
      const start=m.index; const next=content.slice(start+m[0].length).search(/\n(?:async )?function |\nrouter\./);
      const end=next<0?content.length:start+m[0].length+next;
      const body=content.slice(start,end);
      found.set(name,{file,line:content.slice(0,start).split('\n').length,anchor:name});parts.push(body);grew=true;
    }
    if(!grew)break;
  }
  if (row.file === 'offices.js') {
    const repositoryFile='server/officeRepository.js';
    parts.push(source(repositoryFile));
    for(const name of ['currentActor','transaction','requireActiveOffice','member']) found.set('office:'+name,reference(repositoryFile,'async function '+name));
  }
  const text=parts.join('\n');
  const guards=[...new Set(text.match(/\b(?:assert|can|has|require|authorized|requestHas)\w*(?=\s*\()/g)||[])].filter(n=>!['require','requireAuth'].includes(n));
  const permissions=[...new Set([...text.matchAll(/['"]((?:governance|identity|guidance):[a-z_-]+)['"]/g)].map(m=>m[1]))];
  const calls=[...new Set([...text.matchAll(/\b(?:repo|officeRepository)(?:\(\))?\.(\w+)\(/g)].map(m=>m[1]))];
  return {guards,permissions,helpers:[...found.values()],repositoryCalls:calls,source:text};
}
module.exports={appRoot,source,reference,staticRoutes,formalRoutes,localEvidence,sha};
