const fields=new Set(['created_at','updated_at','completed_at','due_at','answered_at','closed_at','next_retry_at','published_at']);
function column(alias,field){
  if(!fields.has(field)||alias&&!/^[a-z][a-z0-9_]*$/i.test(alias))throw new TypeError('Explicit governance time column required');
  return (alias?alias+'.':'')+field;
}
// TIMESTAMP stores an instant. Epoch reads bypass mysql2's host-timezone
// interpretation without changing the database session or any stored value.
function timestampColumns(alias,names){return names.map(field=>'UNIX_TIMESTAMP('+column(alias,field)+') AS __instant_'+field).join(',');}
// Only callers whose DATETIME write contract is explicitly UTC may use this.
function utcDateTimeColumns(alias,names){return names.map(field=>"CONCAT(LEFT(DATE_FORMAT("+column(alias,field)+",'%Y-%m-%dT%H:%i:%s.%f'),23),'Z') AS "+field).join(',');}
function timeRow(row){
  if(!row||typeof row!=='object')return row;
  const value={...row};
  for(const field of fields){const key='__instant_'+field;if(!Object.hasOwn(value,key))continue;
    value[field]=value[key]==null?null:new Date(Math.round(Number(value[key])*1000)).toISOString();delete value[key];
  }
  return value;
}
module.exports={timestampColumns,utcDateTimeColumns,timeRow};
