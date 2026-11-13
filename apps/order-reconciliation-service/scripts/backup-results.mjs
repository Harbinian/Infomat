// Local consistent backup only. No source database connection or source writes.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,access,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
const source=resolve(process.argv[2]),target=resolve(process.argv[3]);
if(source===target)throw new Error('BACKUP_SOURCE_EQUALS_TARGET');
try{await access(target);throw new Error('BACKUP_TARGET_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(dirname(target),{recursive:true});
const db=new DatabaseSync(source,{readOnly:true,timeout:5000});
await backup(db,target);db.close();
const restored=new DatabaseSync(target,{readOnly:true});
const result={source,target,quickCheck:restored.prepare('PRAGMA quick_check').get().quick_check,batches:restored.prepare('SELECT id,status FROM batches ORDER BY started_at').all(),snapshots:restored.prepare('SELECT COUNT(*) n FROM snapshots').get().n,ledger:restored.prepare('SELECT COUNT(*) n FROM ledger').get().n};restored.close();
if(result.quickCheck!=='ok')throw new Error('BACKUP_INTEGRITY_FAILED');
await writeFile(target+'.backup.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
