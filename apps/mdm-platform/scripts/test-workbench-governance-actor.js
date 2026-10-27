// Synthetic authenticated HTTP only. Checks the aggregate projection preserves
// exact session identity needed by assigned-package authorization; no real MySQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.PROCESS_DATA_GOVERNANCE_ENABLED = '1';
process.env.PROCESS_V7_PREVIEW_ENABLED = '0';
const auth = require('../server/auth');
const workbench = require('../server/routes/roleWorkbench');
const offices = require('../server/routes/offices');

test('assigned governance workbench receives exact person, account, auth version and permissions from current session', async () => {
  const session = { personId: '9007199254741001', accountId: '9007199254741003', authVersion: '9007199254741005', departmentId: 91 };
  const permissions = ['governance:read-assigned-context','governance:handle-assigned-work'];
  let received;
  auth.setIdentityRepositoryFactory(() => ({ async validateSession() { return {valid:true,user:{...session,must_change_password:false}}; } }));
  workbench.setIdentityRepositoryFactory(() => ({ async getCurrentUserPayload() { return {id:session.personId,personId:session.personId,
    departmentId:91,departmentName:'Synthetic',roleCodes:['mdm_steward'],permissions}; } }));
  offices.setRepositoryFactory(() => ({ async personalWorkItems() { return []; } }));
  workbench.setProcessDataGovernanceRepositoryFactory(() => ({ async listWorkbenchItems(actor) {
    received=actor;
    assert.equal(actor.personId,session.personId); assert.equal(actor.accountId,session.accountId); assert.equal(actor.authVersion,session.authVersion);
    return [{id:'process-data-package:7',type:'process_data_governance_package',title:'Synthetic assigned package',canAct:true,
      target:'#/processGovernance?workspace=dataGovernance&package=7',actionLabel:'Continue',sourceRoles:['mdm_steward']}];
  } }));
  const app=express(); app.use((req,_res,next)=>{req.session={...session};next();}); app.use('/api/role-workbench',workbench);
  const server=await new Promise(resolve=>{const started=app.listen(0,'127.0.0.1',()=>resolve(started));});
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/role-workbench`), payload=await response.json();
    assert.equal(response.status,200,JSON.stringify(payload));
    assert.equal(received.identityKind,'person'); assert.equal(received.departmentId,91);
    assert.deepEqual([...received.permissions],permissions); assert.deepEqual([...received.roleCodes],['mdm_steward']);
    assert.equal(received.canReadGlobal,false); assert.equal(received.canReviewDepartment,false);
    assert.equal(payload.workItems.some(item=>item.id==='process-data-package:7'),true);
  } finally {
    await new Promise(resolve=>server.close(resolve)); workbench.resetIdentityRepositoryFactory(); workbench.resetProcessDataGovernanceRepositoryFactory();
    workbench.clearWorkbenchCaches(); auth.resetIdentityRepositoryFactory(); offices.setRepositoryFactory(null);
  }
});
