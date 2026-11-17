/** Read a complete SQLite backup; create a separate filtered operational database. Never edit the source database. */
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {Store} from '../store.mjs';
import {loadReviewRound} from '../review-round.mjs';
import {retainRoundRecords} from '../scope-retention.mjs';
const option=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1]};
const source=option('--source'),roundFile=option('--round'),output=option('--output-dir');
if(!source||!roundFile||!output)throw new Error('Required: --source <backup.sqlite> --round <inventory.json> --output-dir <new directory>');
const sourcePath=path.resolve(source),outputDir=path.resolve(output),target=path.join(outputDir,'review.sqlite');
if(sourcePath===target||existsSync(target))throw new Error('Refusing to overwrite an existing database');
const sourceDb=new DatabaseSync(sourcePath,{readOnly:true});
const state=JSON.parse(sourceDb.prepare('SELECT value FROM state WHERE id=1').get().value),audit=sourceDb.prepare('SELECT * FROM audit ORDER BY sequence').all();
const round=loadReviewRound(roundFile);
if(!round.retainOnly)throw new Error('An explicit retainOnly inventory is required');
const selection=retainRoundRecords(state,audit.map(row=>({...row,detail:JSON.parse(row.detail)})),round);
mkdirSync(outputDir,{recursive:true});
const targetStore=new Store({dataDir:outputDir});
try{
  targetStore.db.exec('BEGIN IMMEDIATE');
  targetStore.db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(selection.state));
  const putMaterial=targetStore.db.prepare('INSERT INTO materials(id,source_path,sha256,raw_text) VALUES(?,?,?,?)');
  for(const item of selection.state.materials){const row=sourceDb.prepare('SELECT * FROM materials WHERE id=?').get(item.id);putMaterial.run(row.id,row.source_path,row.sha256,row.raw_text);}
  const putAudit=targetStore.db.prepare('INSERT INTO audit(sequence,id,actor_id,time,operation,detail) VALUES(?,?,?,?,?,?)');
  const keepSequences=new Set(selection.audit.map(row=>row.sequence));
  for(const row of audit.filter(row=>keepSequences.has(row.sequence)))putAudit.run(row.sequence,row.id,row.actor_id,row.time,row.operation,row.detail);
  const backupDigest=createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
  putAudit.run(Math.max(0,...audit.map(row=>row.sequence))+1,randomUUID(),'local-pmo',new Date().toISOString(),'review.scope_retain_only',JSON.stringify({reason:'用户明确仅保留各部门第19周主动提交、等待联合评审的对象',inventoryDigest:round.digest,backupDigest,counts:selection.summary}));
  targetStore.db.exec('COMMIT');
  const result=targetStore.read();
  if(result.materials.length!==round.files.length)throw new Error('Retained database count mismatch');
  targetStore.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const report={source:sourcePath,target,sourceRevision:state.revision,targetRevision:result.revision,backupDigest,summary:selection.summary,activeAuditRows:result.audit.length,sourceUntouched:true};
  writeFileSync(path.join(outputDir,'retention-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{sourceDb.close();targetStore.close();}
