// Verify an explicitly selected department-role image with a fresh labelled
// tmpfs MySQL and synthetic identity. No formal container, DB, env file or data.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
assert(args.includes('--image')&&args.includes('--output'));
const image=value('--image'),output=path.resolve(value('--output'));
assert.match(image,/^infomat-mdm:department-roles-\d{8}-[a-f0-9]{8}$/);
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const docker=args=>cp.execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
let browserCloseTimedOut=false;
async function closeBrowser(browser){
  let timer;
  const closed=await Promise.race([browser.close().then(()=>true).catch(()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);
  clearTimeout(timer);browserCloseTimedOut=!closed;
}
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
async function main(){await withFreshMysql(async({pool,password,database,owner,containerId})=>{
  await require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool).initSchema();
  await require('../server/sessionMigration').manageSessionSchema(pool,'apply');
  await pool.execute("INSERT INTO departments(id,code,name) VALUES(91,'SYNTHETIC_DEPARTMENT','合成部门')");
  await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(81,'SYNTHETIC_ROLES','合成角色查看人员',91)");
  const loginPassword=crypto.randomBytes(24).toString('hex')+'!Aa1';
  await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES(181,81,'SYNTHETIC_ROLES',?,'active',0)",[require('bcryptjs').hashSync(loginPassword,10)]);
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 81,role_id,'global','Synthetic explicit administrator',CURRENT_DATE FROM roles WHERE role_code='admin'");
  const [beforeRoles]=await pool.query('SELECT * FROM person_roles ORDER BY person_role_id');
  assert.equal(docker(['inspect',containerId,'--format','{{index .Config.Labels "infomat.stage04"}}']),owner);
  const mysqlHost=docker(['inspect',containerId,'--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}']);assert.match(mysqlHost,/^172\.\d+\.\d+\.\d+$/);
  const name='mdm-department-roles-ui-'+owner,secret=crypto.randomBytes(48).toString('hex');let appId,browser;
  const bootstrap="const net=require('net'),os=require('os');const app=require('./server/index');app.listen(3000,'127.0.0.1');const address=Object.values(os.networkInterfaces()).flat().find(a=>a&&!a.internal&&a.family==='IPv4').address;net.createServer(client=>{const target=net.connect(3000,'127.0.0.1');client.on('error',()=>target.destroy());target.on('error',()=>client.destroy());client.pipe(target);target.pipe(client);}).listen(3000,address);";
  const checks=[],pageErrors=[],writeRequests=[];
  try{
    const env=isolatedEnvironment({MYSQL_HOST:mysqlHost,MYSQL_PORT:'3306',MYSQL_USER:'root',MYSQL_PASSWORD:password,MYSQL_DATABASE:database,MYSQL_CONNECTION_LIMIT:'4',SESSION_SECRET:secret});
    const envArgs=Object.keys(env).filter(key=>key.startsWith('MYSQL_')||key==='SESSION_SECRET').flatMap(key=>['--env',key]);
    appId=cp.execFileSync('docker',['run','--detach','--pull','never','--name',name,'--label','infomat.department-roles.test='+owner,'--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--publish','127.0.0.1::3000',...envArgs,'--env','HOST=127.0.0.1','--env','PORT=3000','--env','NODE_ENV=development','--env','MDM_SESSION_STORE=mysql','--env','MDM_ACCESS_MODE=http-local','--env','MDM_IDENTITY_READ_MODEL=mysql','--env','PROCESS_GOVERNANCE_READ_MODEL=mysql','--env','MDM_SYSTEM_ADMIN_ENABLED=0','--env','PROCESS_V7_PREVIEW_ENABLED=0','--env','PROCESS_V7_FORMAL_ENABLED=0','--env','PROCESS_V7_AUTHORING_ENABLED=0','--env','PROCESS_DATA_GOVERNANCE_ENABLED=0','--entrypoint','node',image,'-e',bootstrap],{env,encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']}).trim();assert.match(appId,/^[a-f0-9]{64}$/);
    const binding=JSON.parse(docker(['inspect',appId,'--format','{{json .NetworkSettings.Ports}}']))['3000/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');assert(![3000,3001,3306,3307,5173].includes(Number(binding.HostPort)));
    const baseURL='http://127.0.0.1:'+binding.HostPort;let healthy=false;
    for(let i=0;i<100;i++){try{if((await fetch(baseURL+'/api/health')).ok){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(healthy,'owned image HTTP ready');
    assert.equal((await fetch(baseURL+'/api/rbac/department-role-requirements')).status,401);
    browser=await runtime().chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});const page=await context.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',error=>pageErrors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/rbac/')&&request.method()!=='GET')writeRequests.push(request.method());});
    await page.goto(baseURL+'/app/roles');await page.locator('#login-name').fill('SYNTHETIC_ROLES');await page.locator('#login-password').fill(loginPassword);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
    const expected=require('../config/department-role-requirements.json');
    const configured=page.locator('[data-department-role-requirements]');await configured.getByText('本配置不绑定人员',{exact:true}).first().waitFor();assert.equal(await configured.getByRole('row').count(),expected.departments.length+1);assert.equal(await configured.getByText('已设置',{exact:true}).count(),expected.departments.reduce((count,d)=>count+d.role_codes.length,0));assert.equal(await configured.locator('input,select').count(),0);
    for(const department of expected.departments)assert.equal(await configured.getByRole('cell',{name:department.name,exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);await page.screenshot({path:path.join(output,'department-role-requirements-desktop.png')});
    await page.locator('[data-role-ready]').waitFor();assert.equal(await page.getByLabel('选择角色').locator('option').count(),7);
    checks.push(`real selected image, Edge 100% 1699x828: all ${expected.departments.length} exact source departments, ${expected.departments.reduce((count,d)=>count+d.role_codes.length,0)} existing role references, no people binding or grant controls, no page overflow, original 7 roles retained`);
    const [afterRoles]=await pool.query('SELECT * FROM person_roles ORDER BY person_role_id');assert.deepEqual(afterRoles,beforeRoles);assert.equal((await pool.query('SELECT COUNT(*) AS total FROM departments'))[0][0].total,1);assert.deepEqual(pageErrors,[]);assert.deepEqual(writeRequests,[]);
    checks.push('anonymous endpoint denied; view creates no departments or role assignments, no permission write requests, no page errors');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({image,checks,pageErrors,writeRequests,passed:true},null,2));
    await closeBrowser(browser);browser=null;
  }catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,checks,pageErrors},null,2));if(appId)fs.writeFileSync(path.join(output,'owned-app.log'),docker(['logs',appId]));throw error;}
  finally{if(browser)await closeBrowser(browser);if(appId){assert.equal(docker(['inspect',appId,'--format','{{index .Config.Labels "infomat.department-roles.test"}}']),owner);docker(['rm','--force',appId]);console.log('OWNED_ROLE_IMAGE_REMOVED');}}
},{randomDatabase:true});}
main().then(()=>{if(browserCloseTimedOut){fs.writeFileSync(path.join(output,'browser-close-note.json'),JSON.stringify({scenarioChecksPassed:true,browserCloseTimedOut:true,ownedApplicationAndMysqlRemoved:true},null,2));process.exit(0);}}).catch(error=>{console.error(error.message);process.exitCode=1;});
