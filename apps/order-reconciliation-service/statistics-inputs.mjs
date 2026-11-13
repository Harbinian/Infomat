// Separate process bounds the lifetime of large ledger/source arrays. It exits
// before Python analysis starts; publication later revalidates the saved files.
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {join} from 'node:path';
import {DATASETS,reconcile} from './reconcile.mjs';
import {ALL_DATASETS} from './datasets.mjs';
import {fileURLToPath} from 'node:url';
const stage=process.argv[2],context=JSON.parse(await readFile(join(stage,'quantity-inputs.json'),'utf8'));
const data={},reads=[];
for(const key of Object.keys(DATASETS)){
 const audit=JSON.parse((await readFile(join(stage,key+'.ndjson.audit.json'),'utf8')).replace(/^\uFEFF/,'')),digest=createHash('sha256');
 for await(const chunk of createReadStream(join(stage,key+'.ndjson')))digest.update(chunk);
 if(audit.status!=='succeeded'||audit.sha256!==digest.digest('hex')||audit.querySha256!==context.queryHashes[key])throw new Error('STATISTICS_INPUT_MISMATCH');
 const rows=[];for await(const line of createInterface({input:createReadStream(join(stage,key+'.ndjson')),crlfDelay:Infinity}))if(line){const row=JSON.parse(line);if(String(audit.count)!==row._expectedCount)throw new Error('STATISTICS_INPUT_MISMATCH');rows.push(row);}
 if(rows.length!==audit.count)throw new Error('STATISTICS_INPUT_MISMATCH');data[key]=rows;reads.push({...audit,dataset:key});
}
const result=reconcile(data,reads),digest=createHash('sha256'),stream=createWriteStream(join(stage,'statistics-ledger.ndjson'),{flags:'wx'}),done=once(stream,'finish');
for(const row of result.rows){const {evidence,...small}=row,line=JSON.stringify(small)+'\n';digest.update(line);if(!stream.write(line))await once(stream,'drain');}
stream.end();await done;
const policy=JSON.parse(await readFile(new URL('./risk-policy.json',import.meta.url),'utf8'));
await writeFile(join(stage,'unified-inputs.json'),JSON.stringify({batchId:context.batchId,queryHashes:context.queryHashes,sources:ALL_DATASETS,policy,sourceDispositions:result.sourceDispositions,ledger:{sha256:digest.digest('hex'),rows:result.rows.length}}),{flag:'wx'});
