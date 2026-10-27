// Synthetic credentials and repository doubles only. Random loopback HTTP;
// no private configuration, database connection or external system calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const {configuredClients,authenticateDirectoryClient} = require('../server/directoryIntegrationAuth');
const route = require('../server/routes/directoryIntegration');
const credential = crypto.randomBytes(32).toString('base64url');
const client = {client_id:'synthetic_consumer',token_sha256:crypto.createHash('sha256').update(credential).digest('hex'),enabled:true,expires_at:'2099-01-01T00:00:00Z'};

test('directory machine credentials require explicit enablement, valid unique configuration and unexpired credentials',()=>{
  assert.equal(configuredClients({}),null);
  assert.throws(()=>configuredClients({DIRECTORY_INTEGRATION_ENABLED:'1'}),{code:'DIRECTORY_CLIENT_CONFIG_INVALID'});
  assert.throws(()=>configuredClients({DIRECTORY_INTEGRATION_ENABLED:'1',DIRECTORY_API_CLIENTS_JSON:JSON.stringify([client,client])}),{code:'DIRECTORY_CLIENT_CONFIG_INVALID'});
  const clients=configuredClients({DIRECTORY_INTEGRATION_ENABLED:'1',DIRECTORY_API_CLIENTS_JSON:JSON.stringify([client])});
  assert.equal(authenticateDirectoryClient('Bearer '+credential,clients),client.client_id);
  assert.equal(authenticateDirectoryClient('Bearer '+credential,[{...client,enabled:false}]),null);
  assert.equal(authenticateDirectoryClient('Bearer '+credential,[{...client,expires_at:'2020-01-01T00:00:00Z'}]),null);
  assert.equal(authenticateDirectoryClient('Bearer '+crypto.randomBytes(32).toString('base64url'),clients),null);
  assert.equal(authenticateDirectoryClient('Basic '+credential,clients),null);
});

test('machine API is read-only, excludes private fields and does not accept person sessions',async()=>{
  const before={enabled:process.env.DIRECTORY_INTEGRATION_ENABLED,clients:process.env.DIRECTORY_API_CLIENTS_JSON};
  delete process.env.DIRECTORY_INTEGRATION_ENABLED;
  const reads=[];
  route.setRepositoryFactory(()=>({snapshot:async options=>{reads.push(options);return {schema_version:'organization-person-directory-v1',source:'3000',snapshot_hash:'a'.repeat(64),departments:[{id:'9007199254740993',code:'SYN',name:'合成部门',private_note:'not public'}],persons:[{person_id:'9007199254740995',employee_no:'SYN001',person_name:'合成人员',office_ids:[],mobile:'PRIVATE',email:'PRIVATE',password_hash:'PRIVATE',roles:['admin']}],offices:[],canMaintain:true};}}));
  const app=express();app.use('/api/integration/v1',route);
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const url=`http://127.0.0.1:${server.address().port}/api/integration/v1/directory`;
  try {
    assert.equal((await fetch(url)).status,503);
    process.env.DIRECTORY_INTEGRATION_ENABLED='1';process.env.DIRECTORY_API_CLIENTS_JSON=JSON.stringify([client]);
    assert.equal((await fetch(url,{headers:{cookie:'synthetic_session=yes'}})).status,401);
    assert.equal(reads.length,0);
    const response=await fetch(url+'?include_contacts=true',{headers:{Authorization:'Bearer '+credential}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const body=await response.json();assert.equal(body.persons[0].person_id,'9007199254740995');
    assert.equal(JSON.stringify(body).includes('PRIVATE'),false);
    assert.equal(body.canMaintain,undefined);assert.equal(body.departments[0].private_note,undefined);
    assert.deepEqual(reads,[{includeContacts:false}]);
    assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+credential}})).status,405);
    assert.equal(reads.length,1);
  } finally {
    route.setRepositoryFactory(null);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    if(before.enabled===undefined)delete process.env.DIRECTORY_INTEGRATION_ENABLED;else process.env.DIRECTORY_INTEGRATION_ENABLED=before.enabled;
    if(before.clients===undefined)delete process.env.DIRECTORY_API_CLIENTS_JSON;else process.env.DIRECTORY_API_CLIENTS_JSON=before.clients;
  }
});
