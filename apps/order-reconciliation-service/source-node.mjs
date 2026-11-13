import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ALL_DATASETS as DATASETS} from './datasets.mjs';

const app = fileURLToPath(new URL('.',import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = name => `[${name.replaceAll(']',']]')}]`;
const denied = /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|EXEC|EXECUTE|OPENROWSET|OPENQUERY|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC)\b|\bINTO\s/i;
const fail = code => { throw new Error(code); };

// Only top-level ordering is removed. Quoted identifiers, string literals,
// comments and window/CTE parentheses cannot be mistaken for the final ORDER BY.
function tokens(text) {
  const result=[]; let depth=0;
  for(let i=0;i<text.length;) {
    const character=text[i];
    if(character==="'" || character==='"' || character==='[') {
      const end=character==='['?']':character; i++; let closed=false;
      while(i<text.length) {if(text[i]===end){if(text[i+1]===end){i+=2;continue;}i++;closed=true;break;}i++;}
      if(!closed)fail('SOURCE_QUERY_UNSUPPORTED');
    } else if(text.slice(i,i+2)==='--') {i=text.indexOf('\n',i+2);if(i<0)break;}
    else if(text.slice(i,i+2)==='/*') {
      let nested=1;i+=2;
      while(i<text.length&&nested){if(text.slice(i,i+2)==='/*'){nested++;i+=2;}else if(text.slice(i,i+2)==='*/'){nested--;i+=2;}else i++;}
      if(nested)fail('SOURCE_QUERY_UNSUPPORTED');
    } else if(character==='(') {depth++;i++;}
    else if(character===')') {if(--depth<0)fail('SOURCE_QUERY_UNSUPPORTED');i++;}
    else if(character===';') {fail('SOURCE_QUERY_UNSUPPORTED');}
    else if(/[A-Za-z_]/.test(character)) {const start=i++;while(i<text.length&&/[A-Za-z0-9_]/.test(text[i]))i++;result.push({word:text.slice(start,i).toUpperCase(),start,end:i,depth});}
    else i++;
  }
  if(depth!==0)fail('SOURCE_QUERY_UNSUPPORTED');
  return result;
}

function reviewQuery(query) {
  const text=query.replace(/^\uFEFF/,'').trim().replace(/;\s*$/,'');
  if(!/^\s*(SELECT|WITH)\b/i.test(text)||denied.test(text))fail('SOURCE_QUERY_NOT_READONLY');
  const top=tokens(text).filter(token=>token.depth===0);
  if(top.some(token=>['TOP','OFFSET','FETCH','OPTION','FOR'].includes(token.word)))fail('SOURCE_QUERY_UNSUPPORTED');
  const main=top.find(token=>token.word==='SELECT');if(!main)fail('SOURCE_QUERY_UNSUPPORTED');
  let end=text.length;
  for(let i=0;i<top.length-1;i++)if(top[i].word==='ORDER'&&top[i+1].word==='BY'&&top[i].start>main.start)end=top[i].start;
  return {prefix:text.slice(0,main.start).trimEnd(),body:text.slice(main.start,end).trimEnd()};
}

function columnProjection(column) {
  if(!column.name||typeof column.name!=='string'||!column.system_type_name||column.error_number)fail('SOURCE_METADATA_UNSUPPORTED');
  const type=column.system_type_name.toLowerCase().split(/[ (]/,1)[0];
  const reference=`[__snapshot].${quote(column.name)}`;
  let expression;
  if(['nvarchar','varchar','nchar','char','ntext','text','xml','tinyint','smallint','int','bigint','decimal','numeric'].includes(type))expression=`CONVERT(nvarchar(max),${reference})`;
  else if(type==='uniqueidentifier')expression=`LOWER(CONVERT(nvarchar(36),${reference}))`;
  else if(type==='bit')expression=`CASE WHEN ${reference} IS NULL THEN NULL WHEN ${reference}=1 THEN N'True' ELSE N'False' END`;
  else if(type==='datetime'||type==='smalldatetime')expression=`REPLACE(CONVERT(nvarchar(23),${reference},121),N' ',N'T')+N'0000'`;
  else if(type==='date')expression=`CONVERT(nvarchar(10),${reference},23)+N'T00:00:00.0000000'`;
  else if(type==='datetime2')expression=`CONVERT(nvarchar(19),${reference},126)+N'.'+RIGHT(N'0000000'+CONVERT(nvarchar(7),DATEPART(NANOSECOND,${reference})/100),7)`;
  else if(type==='money'||type==='smallmoney')expression=`CONVERT(nvarchar(max),CONVERT(decimal(19,4),${reference}))`;
  else if(type==='float'||type==='real')expression=`CONVERT(nvarchar(max),${reference},3)`;
  else if(['binary','varbinary','image','timestamp','rowversion'].includes(type))expression=`CONVERT(nvarchar(max),${reference},2)`;
  else fail('SOURCE_METADATA_UNSUPPORTED');
  return {name:column.name,type,expression:`CASE WHEN ${reference} IS NULL THEN NULL ELSE ${expression} END AS ${quote(column.name)}`};
}

function buildStringQuery(query,metadata) {
  const reviewed=reviewQuery(query);
  if(!Array.isArray(metadata)||!metadata.length||metadata.some(column=>column.is_hidden||column.error_number))fail('SOURCE_METADATA_UNSUPPORTED');
  const columns=metadata.map(columnProjection);
  if(new Set(columns.map(column=>column.name)).size!==columns.length||!columns.some(column=>column.name==='_expectedCount'))fail('SOURCE_METADATA_UNSUPPORTED');
  const projection=columns.map(column=>column.expression).join(',\n ');
  const statement=reviewed.prefix
    ? `${reviewed.prefix},\n[__order_snapshot_9998_source] AS (\n${reviewed.body}\n)\nSELECT ${projection}\nFROM [__order_snapshot_9998_source] AS [__snapshot]`
    : `SELECT ${projection}\nFROM (\n${reviewed.body}\n) AS [__snapshot]`;
  return {statement,columns};
}

function normalizeRow(raw,columns) {
  const row=Object.create(null);
  for(const column of columns) {
    const value=raw[column.name];
    // All values cross TDS as strings. Numeric JavaScript values are refused,
    // because a post-decode String(value) cannot recover a rounded decimal.
    if(value!==null&&typeof value!=='string')fail('SOURCE_VALUE_CONTRACT_MISMATCH');
    if(value!==null&&['binary','varbinary','image','timestamp','rowversion'].includes(column.type)) {
      if(!/^(?:[0-9a-f]{2})*$/i.test(value))fail('SOURCE_VALUE_CONTRACT_MISMATCH');
      row[column.name]=Buffer.from(value,'hex').toString('base64');
    } else row[column.name]=value;
  }
  if(typeof row._expectedCount!=='string'||!/^\d+$/.test(row._expectedCount))fail('SOURCE_COMPLETENESS_MISMATCH');
  return row;
}

async function consume(request,statement,writer,columns,retainRows=true) {
  const rows=[]; const checksum=createHash('sha256'); let expected=null,sets=0,countRead=0;
  await new Promise((resolvePromise,rejectPromise)=>{
    let finished=false;
    const reject=error=>{if(finished)return;finished=true;try{request.cancel();}catch{}writer.destroy();rejectPromise(error);};
    writer.on('error',()=>reject(new Error('SOURCE_OUTPUT_FAILED')));
    request.on('recordset',()=>{sets++;if(sets!==1)reject(new Error('MULTIPLE_RESULT_SETS_NOT_ALLOWED'));});
    request.on('row',raw=>{
      if(finished)return;
      try{
        const row=normalizeRow(raw,columns),count=BigInt(row._expectedCount);
        if(expected!==null&&expected!==count)fail('SOURCE_COMPLETENESS_MISMATCH');expected=count;
        countRead++;if(retainRows)rows.push(row);const line=JSON.stringify(row)+'\n';checksum.update(line,'utf8');
        if(!writer.write(line,'utf8')){request.pause();writer.once('drain',()=>{if(!finished)request.resume();});}
      }catch(error){reject(error);}
    });
    request.on('error',()=>reject(new Error('SOURCE_QUERY_FAILED')));
    request.on('done',()=>{
      if(finished)return;
      if(sets!==1||(expected!==null&&expected!==BigInt(countRead))){reject(new Error('SOURCE_COMPLETENESS_MISMATCH'));return;}
      writer.end(()=>{if(finished)return;finished=true;resolvePromise();});
    });
    request.stream=true;
    try{Promise.resolve(request.query(statement)).catch(()=>reject(new Error('SOURCE_QUERY_FAILED')));}catch{reject(new Error('SOURCE_QUERY_FAILED'));}
  });
  return {rows,count:countRead,sha256:checksum.digest('hex')};
}

function transportOptions(source){return {encrypt:true,trustServerCertificate:true,readOnlyIntent:true,useUTC:true,appName:'Infomat-Order-Reconciliation-9998-SELECT',...(source==='mes'&&process.env.MES_LEGACY_TLS==='1'?{cryptoCredentialsDetails:{minVersion:'TLSv1',ciphers:'DEFAULT:@SECLEVEL=0'}}:{})};}
async function configuration(source) {
  const readSecret=async(name,fallback)=>{const value=await readFile(process.env[name]||fallback,'utf8');if(!value)fail('SOURCE_CONFIGURATION_UNAVAILABLE');return value;};
  const mes=source==='mes';
  const user=mes?await readSecret('MES_SQL_USERNAME_FILE','/run/secrets/mes_username'):'va2';
  const password=await readSecret(mes?'MES_SQL_PASSWORD_FILE':'U8_SQL_PASSWORD_FILE',mes?'/run/secrets/mes_password':'/run/secrets/u8_password');
  return {
    server:mes?'192.168.19.220':'192.168.19.222',port:1433,
    database:mes?'CXSYSYS':source==='kfu'?'KFU8QZ':'UFDATA_333_2025',user,password,
    connectionTimeout:8000,requestTimeout:90000,
    pool:{max:1,min:0,idleTimeoutMillis:1000},
    options:transportOptions(source)
  };
}

async function writeAudit(handle,audit) {
  const buffer=Buffer.from(JSON.stringify(audit,null,2),'utf8');let offset=0;
  while(offset<buffer.length){const result=await handle.write(buffer,offset,buffer.length-offset,offset);if(!result.bytesWritten)fail('SOURCE_OUTPUT_FAILED');offset+=result.bytesWritten;}
  await handle.truncate(buffer.length);await handle.sync();
}

// The metadata function compiles the reviewed SELECT without executing it.
// Exact numerics are converted inside SQL Server before Tedious can round them:
// https://learn.microsoft.com/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-describe-first-result-set-transact-sql
// Streaming/pause semantics: https://github.com/tediousjs/node-mssql#streaming
export async function readNodeDataset({key,source,queryFile,outputFile,expectedHash,retainRows=true}) {
  if(!DATASETS[key]||DATASETS[key].source!==source||!['u8','kfu','mes'].includes(source))fail('SOURCE_TARGET_MISMATCH');
  if(relative(join(app,'sql'),resolve(queryFile))!==`${key}.sql`)fail('SOURCE_QUERY_SCOPE_MISMATCH');
  const original=await readFile(queryFile,'utf8'),querySha256=hash(original);
  if(!/^[a-f0-9]{64}$/.test(expectedHash||'')||querySha256!==expectedHash)fail('RULE_VERSION_CHANGED');
  reviewQuery(original);
  const audit={dataset:key,source,startedAt:new Date().toISOString(),finishedAt:null,querySha256,queryFile:`${key}.sql`,status:'running',count:0,transportPolicy:source==='mes'&&process.env.MES_LEGACY_TLS==='1'?'mes-only-legacy-tls':'default-tls'};
  let output,auditFile,pool,writer;let ownsOutput=false;
  try{
    await mkdir(dirname(outputFile),{recursive:true});
    output=await open(outputFile,'wx',0o600);ownsOutput=true;
    auditFile=await open(outputFile+'.audit.json','wx',0o600);
    audit.phase='configuration';
    const sql=(await import('mssql')).default;
    pool=new sql.ConnectionPool(await configuration(source));pool.on('error',()=>{});
    audit.phase='connect';
    await pool.connect();
    await pool.request().query('SET LOCK_TIMEOUT 5000');
    audit.phase='metadata';
    const described=await pool.request().input('reviewedQuery',sql.NVarChar(sql.MAX),original).query('SELECT column_ordinal,name,system_type_name,is_hidden,error_number FROM sys.dm_exec_describe_first_result_set(@reviewedQuery,NULL,0) ORDER BY column_ordinal');
    const projection=buildStringQuery(original,described.recordset);
    audit.executedQuerySha256=hash(projection.statement);
    audit.valueEncoding='server-nvarchar-lossless-numeric';
    writer=createWriteStream(outputFile,{fd:output.fd,autoClose:false,encoding:'utf8',highWaterMark:65536});
    audit.phase='read';
    const result=await consume(pool.request(),projection.statement,writer,projection.columns,retainRows);
    await output.sync();
    audit.count=result.count;audit.sha256=result.sha256;audit.status='succeeded';audit.finishedAt=new Date().toISOString();
    await writeAudit(auditFile,audit);
    return {rows:result.rows,audit};
  }catch(error){
    if(writer&&!writer.destroyed)writer.destroy();
    if(output){await output.close().catch(()=>{});output=null;}
    if(ownsOutput)await unlink(outputFile).catch(()=>{});
    audit.status='failed';audit.finishedAt=new Date().toISOString();audit.errorCode=error.code==='EEXIST'?'SOURCE_OUTPUT_EXISTS':/^[A-Z_]+$/.test(error.message||'')?error.message:'SOURCE_READ_FAILED';
    audit.driverCode=/^[A-Z_]+$/.test(error.code||'')?error.code:null;
    audit.sqlErrorNumber=Number.isSafeInteger(error.number)?error.number:null;
    audit.causeCode=typeof error.originalError?.code==='string'?error.originalError.code:null;
    if(auditFile)await writeAudit(auditFile,audit).catch(()=>{});
    throw new Error(`${audit.errorCode}:${key}`);
  }finally{
    if(pool)await pool.close().catch(()=>{});
    if(output)await output.close().catch(()=>{});
    if(auditFile)await auditFile.close().catch(()=>{});
  }
}

export const __test={reviewQuery,buildStringQuery,normalizeRow,consume,transportOptions};
