/** Read an explicitly selected source folder; write only the requested inventory, never a database or source file. */
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const option=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1]};
const source=option('--source'),output=option('--output'),label=option('--label');
if(!source||!output||!label)throw new Error('Required: --source <directory> --output <inventory.json> --label <round label>');
const sourceRoot=path.resolve(source),target=path.resolve(output);
if(target===sourceRoot||target.startsWith(sourceRoot+path.sep))throw new Error('Inventory output must be outside the source directory');
const files=[],supportingFiles=[];
async function visit(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const filename=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw new Error(`Source link needs explicit review: ${filename}`);
    if(entry.isDirectory())await visit(filename);
    else if(entry.isFile()&&/\.json$/i.test(entry.name)){
      const bytes=await readFile(filename),document=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replace(/^\uFEFF/,''));
      const relativePath=path.relative(sourceRoot,filename).replaceAll('\\','/');
      const record={sourcePath:filename,relativePath,department:relativePath.split('/')[0],sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
      if(typeof document.schema_version==='string'&&document.schema_version.startsWith('process-governance-')){
        if(!['process-governance-v8','process-governance-v9'].includes(document.schema_version)||!document.process.process_name||!Array.isArray(document.behaviors)||!Array.isArray(document.flow_relations))throw new Error(`Unsupported or incomplete process: ${relativePath}`);
        files.push({...record,name:document.process.process_name,schemaVersion:document.schema_version});
      }else{
        if(document.behaviors||document.flow_relations)throw new Error(`Process graph without a supported schema: ${relativePath}`);
        supportingFiles.push({...record,name:entry.name});
      }
    }
  }
}
await visit(sourceRoot);
files.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
supportingFiles.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
await mkdir(path.dirname(target),{recursive:true});
await writeFile(target,JSON.stringify({format:'review-material-round-v1',label,sourceRoot,capturedAt:new Date().toISOString(),files,supportingFiles},null,2),'utf8');
console.log(JSON.stringify({output:target,processes:files.length,supporting:supportingFiles.length,departments:[...new Set(files.map(item=>item.department))]}));
