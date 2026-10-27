const { syntheticSession, validateSyntheticSession } = require('./testHelpers/syntheticSession');
const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const { setDataMapRepositoryFactory, resetDataMapRepositoryFactory } = require('../server/dataMapMysqlRepository');
const dataMapRouter = require('../server/routes/dataMap');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function makeFakeDataMapRepository() {
  const state = {
    contexts: [{
      id: 10,
      context_id: 10,
      mapping_id: 10,
      context_key: 'ctx-customer',
      context_type: 'process',
      title: '客户字段上下文',
      dept_id: 9,
      dept_name: '经营发展部',
      owner_user_id: 42,
      status: 'active',
      created_by: 42
    }, {
      id: 11,
      context_id: 11,
      mapping_id: 11,
      context_key: 'ctx-other',
      context_type: 'process',
      title: '其他部门字段上下文',
      dept_id: 10,
      dept_name: '工程技术部',
      owner_user_id: 77,
      status: 'active',
      created_by: 77
    }],
    calls: []
  };

  return {
    state,
    async listContexts(query={}) {
      if(query.view!=='current')throw Object.assign(Error('HANDOFF_CLIENT_UPGRADE_REQUIRED'),{code:'HANDOFF_CLIENT_UPGRADE_REQUIRED',statusCode:409});
      state.calls.push(['listContexts']);
      return state.contexts;
    },
    async getContextScope(id) {return state.contexts.find(x=>String(x.id)===String(id))||null;},
    async getContext(id,query={}) {
      if(query.view!=='current')throw Object.assign(Error('HANDOFF_CLIENT_UPGRADE_REQUIRED'),{code:'HANDOFF_CLIENT_UPGRADE_REQUIRED',statusCode:409});
      state.calls.push(['getContext', Number(id)]);
      return state.contexts.find(context => context.id === Number(id)) || null;
    },
    async createContext(){state.calls.push(['createContext']);throw Object.assign(Error('HANDOFF_REQUIRED'),{code:'HANDOFF_REQUIRED',statusCode:409});},
    async updateContext(){state.calls.push(['updateContext']);throw Object.assign(Error('HANDOFF_REQUIRED'),{code:'HANDOFF_REQUIRED',statusCode:409});}
  };
}

async function main() {
  const repo = makeFakeDataMapRepository();
  setDataMapRepositoryFactory(async () => repo);
  let currentPersonId = 42;
  auth.setIdentityRepositoryFactory(async () => ({
    validateSession: validateSyntheticSession,
    async getUserEffectivePermissions(personId) {
      if (personId === 42) {
        return {
          permSet: new Set([
            'identity:read',
            'identity:manage-account',
            'identity:assign-role',
            'identity:read-audit',
            'governance:read-global'
          ]),
          fieldConstraints: {}
        };
      }
      if (personId === 43) {
        return {
          permSet: new Set([
            'governance:read-department',
            'governance:draft-department'
          ]),
          fieldConstraints: {}
        };
      }
      throw new Error(`unexpected person id ${personId}`);
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = syntheticSession({
      personId: currentPersonId,
      userId: currentPersonId,
      userName: currentPersonId === 42 ? '数据地图管理员' : '部门主对接人',
      departmentId: 9
    });
    next();
  });
  app.use('/api/data-map', dataMapRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const original=JSON.stringify(repo.state.contexts);
    const request=async(path,method='GET',body)=>{const res=await fetch(baseUrl+'/api/data-map'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()};};
    assert.strictEqual((await request('/contexts')).status,409);
    const global=await request('/contexts?view=current');assert.strictEqual(global.status,200);assert.strictEqual(global.body.length,2);
    assert.strictEqual((await request('/contexts','POST',{title:'unapproved',dept_id:9})).status,403);
    currentPersonId=43;
    const own=await request('/contexts?view=current');assert.strictEqual(own.status,200);assert.deepStrictEqual(own.body.map(x=>x.id),[10]);
    assert.strictEqual((await request('/contexts/10?view=current')).status,200);
    assert.strictEqual((await request('/contexts/11?view=current')).status,403);
    assert.strictEqual((await request('/contexts','POST',{title:'unapproved',dept_id:9})).status,409);
    assert.strictEqual((await request('/contexts/10','PUT',{title:'unapproved'})).status,409);
    assert.strictEqual((await request('/contexts','POST',{title:'cross',dept_id:10})).status,403);
    assert.strictEqual(JSON.stringify(repo.state.contexts),original);
    console.log('Data Map contexts API current-view and sealed-write scope test passed');
  } finally {
    await closeServer(server);
    resetDataMapRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
});
