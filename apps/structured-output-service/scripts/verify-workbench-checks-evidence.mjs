// Reads the source and actual browser downloads, compares all business fields, writes local byte evidence only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
if(!process.argv[2]||!process.argv[3])throw new Error('Explicit source and evidence directory required');
const root=path.resolve(process.argv[3]),source=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,`${name}.json`),'utf8'));
const project=doc=>{const copy=structuredClone(doc);delete copy.export_meta.exported_at;return copy;};
assert.deepEqual(project(read('baseline')),project(source));
const expected=project(source);expected.flow_relations[1].condition='到货类型为A';expected.behaviors[0].behavior_description='核对到货清单，登记核对结果。';expected.export_meta.compiler='测试编制人';
assert.deepEqual(project(read('edited')),expected);assert.deepEqual(project(read('technical-error')),expected);
const files=['baseline','edited','technical-error'].map(name=>{const bytes=fs.readFileSync(path.join(root,`${name}.json`));return{name,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
fs.writeFileSync(path.join(root,'byte-verification.json'),JSON.stringify({passed:true,files,changes:['one branch condition','one action description','compiler metadata'],sourceBusinessContentPreserved:true},null,2)+'\n');
console.log('Actual browser downloads verified: original, three explicit edits, and download with simulated technical error.');
