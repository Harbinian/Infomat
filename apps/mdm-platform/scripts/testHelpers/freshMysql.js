// Creates a new labelled tmpfs container only. No env file, default DB or existing volume.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const mysql = require('mysql2/promise');
const { isolatedEnvironment } = require('./isolatedProcess');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withFreshMysql(action, { stage = '04' } = {}) {
  assert.match(stage, /^\d{2}$/);
  const database = `stage${stage}_isolated`;
  const owner = crypto.randomUUID();
  const password = crypto.randomBytes(24).toString('hex');
  const env = isolatedEnvironment({ MYSQL_ROOT_PASSWORD: password });
  const docker = args => execFileSync('docker', args, {env, encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
  let id, pool;
  try {
    id = docker(['run','--detach','--pull','never','--name',`mdm-stage${stage}-${owner}`,'--label',`infomat.stage${stage}=${owner}`,
      '--tmpfs','/var/lib/mysql:rw,size=1073741824','--publish','127.0.0.1::3306','--env','MYSQL_ROOT_PASSWORD','mysql:8.4']);
    assert.match(id,/^[a-f0-9]{64}$/);
    const inspected=JSON.parse(docker(['inspect',id]))[0];
    assert.equal(inspected.Config.Labels[`infomat.stage${stage}`],owner);
    assert.equal(inspected.Mounts.filter(m=>['bind','volume'].includes(m.Type)).length,0);
    assert.equal(inspected.HostConfig.Tmpfs['/var/lib/mysql'],'rw,size=1073741824');
    const binding=inspected.NetworkSettings.Ports['3306/tcp'][0];
    assert.equal(binding.HostIp,'127.0.0.1');
    const port=Number(binding.HostPort); assert.ok(![3000,3001,3306,3307,5173].includes(port));
    pool=mysql.createPool({host:'127.0.0.1',port,user:'root',password,connectionLimit:4,connectTimeout:1000});
    let ready=false;
    for(let i=0;i<180;i++) {try {await pool.execute('SELECT 1');ready=true;break;}catch{await sleep(500);}}
    assert.ok(ready,'fresh MySQL container ready');
    await pool.execute(`CREATE DATABASE ${database}`);
    await pool.end();
    pool=mysql.createPool({host:'127.0.0.1',port,user:'root',password,database,connectionLimit:4});
    const transfer = (command, input) => {
      assert.equal(JSON.parse(docker(['inspect',id]))[0].Config.Labels[`infomat.stage${stage}`],owner);
      return execFileSync('docker', ['exec','-i','-e','MYSQL_PWD',id,...command], {
        env: {...env, MYSQL_PWD:password}, input, windowsHide:true, timeout:60000,
        maxBuffer:64*1024*1024, stdio:['pipe','pipe','pipe']
      });
    };
    return await action({pool,port,password,owner,database,containerId:id,
      backup:()=>transfer(['mysqldump','-uroot','--single-transaction','--routines','--triggers','--events','--hex-blob','--set-gtid-purged=OFF','--no-tablespaces',database]),
      restore:dump=>transfer(['mysql','-uroot',database],dump)});
  } finally {
    if(pool) await pool.end().catch(()=>{});
    if(id) {
      assert.match(id,/^[a-f0-9]{64}$/);
      assert.equal(JSON.parse(docker(['inspect',id]))[0].Config.Labels[`infomat.stage${stage}`],owner,'refuse cleanup without ownership');
      docker(['rm','--force',id]);
      console.log(`STAGE${stage}_OWNED_MYSQL_REMOVED`);
    }
  }
}
module.exports={withFreshMysql};
