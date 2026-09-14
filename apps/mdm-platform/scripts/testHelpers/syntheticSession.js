// Explicit session/identity test double for route-only suites. This does not test
// login, persistent storage, account revocation or real authorization (separate suites do).
const identities=new Map();
function syntheticSession(input) {
  const personId=Number(input.personId||input.userId);
  if(!Number.isSafeInteger(personId)||personId<1)throw Error('Synthetic person required');
  const session={...input,personId,accountId:100000+personId,authVersion:1,destroy(callback){callback();}};
  identities.set(session.accountId,{personId,accountId:session.accountId,authVersion:1,personName:input.userName||'合成测试人员',current_department_id:input.departmentId||null,must_change_password:false});
  return session;
}
async function validateSyntheticSession(session) {
  const user=identities.get(session.accountId);
  return {valid:!!user&&user.personId===session.personId&&user.authVersion===session.authVersion,user};
}
module.exports={syntheticSession,validateSyntheticSession};
