// Opt-in adapter for discovery endpoints only. The caller's existing
// transaction supplies one MVCC snapshot; mutation paths use the raw connection.
function selectSnapshot(db){
  return Object.freeze({
    async execute(sql,params=[]){
      if(typeof sql!=='string'||!/^\s*SELECT\b/i.test(sql))throw new TypeError('Handoff discovery accepts SELECT only');
      const statement=sql.trim().replace(/;\s*$/,'').replace(/\s+FOR\s+(?:UPDATE|SHARE)(?:\s+(?:NOWAIT|SKIP\s+LOCKED))?\s*$/i,'');
      if(/;|\/\*|--|\bINTO\b|\b(?:GET_LOCK|RELEASE_LOCK|SLEEP|BENCHMARK)\s*\(|\bFOR\s+(?:UPDATE|SHARE)\b/i.test(statement))throw new TypeError('Unsupported handoff discovery SELECT');
      return db.execute(statement,params);
    }
  });
}
async function readDiscoverySnapshot(pool,action){
  return require('./dataMapHandoffControl').readSnapshot(pool,db=>action(selectSnapshot(db)));
}
module.exports={selectSnapshot,readDiscoverySnapshot};
