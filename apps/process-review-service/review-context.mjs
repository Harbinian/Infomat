import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Load a read-only evidence input; material identity remains the exact source digest. */
export function loadReviewContext(file) {
  if (!file) return null;
  const bytes=readFileSync(file),catalog=JSON.parse(bytes.toString('utf8'));
  if(catalog.format!=='review-evidence-context-v1'||!Array.isArray(catalog.processes)||!catalog.summary||
    catalog.processes.some(p=>!/^[a-f0-9]{64}$/.test(p.sha256)||!Array.isArray(p.topics)))throw new Error('Invalid review context');
  const digest=createHash('sha256').update(bytes).digest('hex');
  const bySha=new Map(catalog.processes.map(p=>[p.sha256,p]));
  const supporting=new Map((catalog.supportingMaterials||[]).map(p=>{
    if(createHash('sha256').update(p.rawText,'utf8').digest('hex')!==p.sha256)throw new Error('Supporting source digest mismatch');
    return [p.sha256,p];
  }));
  const summary={digest,revision:catalog.revision,...catalog.summary,notes:catalog.notes,warnings:catalog.warnings,
    supportingMaterials:[...supporting.values()].map(({rawText,...p})=>p),
    processes:catalog.processes.map(p=>({sha256:p.sha256,processName:p.processName,sourceFile:p.sourceFile,scope:p.scope,
      department:p.department,objects:p.topics.length,offlineMatches:p.offlineMatches.length,
      fieldMappings:p.fieldMappings.length,derivedTemplates:p.derivedTemplates.length,physicalColumns:p.physicalColumns.length}))};
  return {catalog,digest,bySha,supporting,summary};
}
