// Route parameter contract only; full query/projection equivalence uses owned MySQL.
const assert = require('node:assert/strict');
require('./testHelpers/blockRealMysql');
const express = require('express');
const auth = require('../server/auth');
const roles = require('../server/routes/roles');
const previous = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
const received = [];
auth.setIdentityRepositoryFactory(() => ({
  async validateSession(session) { return {valid:true,user:{...session,must_change_password:false}}; },
  async getUserEffectivePermissions() { return {permSet:new Set(['identity:read']),fieldConstraints:{}}; }
}));
roles.setIdentityRepositoryFactory(() => ({
  async getRoleDetail(id) { received.push(id); return {role_id:id}; },
  async getRolePermissionMatrix(id) { received.push(id); return {role:{role_id:id},matrix:[]}; }
}));
async function main() {
  const app = express();
  app.use((req,res,next) => {req.session={personId:42,accountId:142,authVersion:7,destroy:done=>done()};next();});
  app.use('/api/roles',roles);
  const server = await new Promise(resolve => {const owned=app.listen(0,'127.0.0.1',()=>resolve(owned));});
  try {
    const base = 'http://127.0.0.1:'+server.address().port+'/api/roles/';
    for (const suffix of ['', '/permissions']) {
      for (const [input,expected] of [['1',1],['00042',42],['9007199254740991',Number.MAX_SAFE_INTEGER],['9007199254740992','9007199254740992'],['9007199254740993','9007199254740993'],['9223372036854775807','9223372036854775807']]) {
        const response=await fetch(base+input+suffix);assert.equal(response.status,200);
        assert.equal(received.at(-1),expected);assert.equal(typeof received.at(-1),typeof expected);
      }
      for (const input of ['0','-1','1.0','1e0','0x1','1x','NaN','Infinity','%20','9223372036854775808']) {
        const count=received.length,response=await fetch(base+input+suffix);
        assert.equal(response.status,404);assert.equal((await response.json()).code,'ROLE_NOT_FOUND');assert.equal(received.length,count);
      }
    }
    console.log('B02_ROLE_ROUTE_EXACT_PARAMETER_CONTRACT_PASSED');
  } finally {
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    roles.resetIdentityRepositoryFactory();auth.resetIdentityRepositoryFactory();
    if(previous===undefined)delete process.env.MDM_IDENTITY_READ_MODEL;else process.env.MDM_IDENTITY_READ_MODEL=previous;
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
