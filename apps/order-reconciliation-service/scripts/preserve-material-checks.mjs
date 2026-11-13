// Append a verified local supplement to a successful batch. No source connection.
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Store} from '../store.mjs';
import {readMaterialChecks} from '../material-checks.mjs';
const [root,folder]=process.argv.slice(2);if(!root||!folder)throw new Error('DATA_ROOT_AND_PACKAGE_REQUIRED');
const data=await readMaterialChecks(folder),attachments=data.report.provenance.attachments;
if(data.report.provenance.kind!=='preserved_review'||!Array.isArray(attachments)||!attachments.length)throw new Error('PRESERVED_EVIDENCE_REQUIRED');
for(const a of attachments){
 const path=resolve(folder,a.file),rel=relative(resolve(folder),path);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('INVALID_ATTACHMENT');
 const hash=createHash('sha256');for await(const b of createReadStream(path))hash.update(b);if(hash.digest('hex')!==a.sha256)throw new Error('PRESERVED_EVIDENCE_MISMATCH');
}
const store=new Store(join(root,'results.sqlite'));
try{store.material.preserve(data);console.log(JSON.stringify({reviewId:data.report.reviewId,summary:data.report.summary,status:'appended',originalBatchUnchanged:true}));}finally{store.close();}
