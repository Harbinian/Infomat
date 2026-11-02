// Read-only source inspection. Produces a reviewable per-table plan; never
// connects to MySQL, executes GRANT or assigns a person's application role.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const acorn=require('acorn');
const dataTerminologyModules=Object.freeze([
  'terminologyGovernanceRepository.js','terminologyUsages.js',
  'processDataGovernanceRepository.js','dataMapNativeHistory.js',
  'dataMapHandoffRepository.js','dataMapHandoffRequests.js','dataMapHandoffBindings.js',
  'dataMapHandoffLegacy.js','dataMapHandoffGenerator.js','dataMapHandoffPublisher.js',
  'dataMapHandoffCompatibility.js','dataMapHandoffConflict.js','dataMapPublicationLifecycle.js',
  'dataMapRestoration.js','dataMapSourceUpgrade.js'
]);
const processModules=Object.freeze(['processCaseGovernance.js','processCaseDisputes.js','processFormalControls.js',
  'processDepartmentDecisions.js','processDisputeMaterials.js','processPreviewReviewRepository.js','processV7Authoring.js','processDesignMysqlRepository.js']);
const modules=Object.freeze([...dataTerminologyModules,...processModules]);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function plan(root=path.resolve(__dirname,'..'),{includeProcessGovernance=true,authoringEnabled=false}={}){
  const sources=[],writes=new Map(),unresolved=[];
  for(const file of includeProcessGovernance?modules:dataTerminologyModules){
    const location=path.join(root,'server',file),bytes=fs.readFileSync(location),source=bytes.toString('utf8');
    sources.push({path:'server/'+file,sha256:sha(bytes)});
    const tree=acorn.parse(source,{ecmaVersion:'latest',sourceType:'script',locations:true});
    function sql(value,line,dynamic=false){
      const match=value.match(/^\s*(INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM)\s+`?([A-Za-z_][A-Za-z0-9_]*)/i);
      if(!match){if(dynamic&&/^\s*(INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM)\s+\$\{/i.test(value))unresolved.push({file:'server/'+file,line,reason:'dynamic_table_identifier'});return;}
      const table=match[2],privilege=/^INSERT/i.test(match[1])?'INSERT':/^DELETE/i.test(match[1])?'DELETE':'UPDATE';
      if(!writes.has(table))writes.set(table,new Map());
      const record=(permission)=>{
        if(!writes.get(table).has(permission))writes.get(table).set(permission,[]);
        writes.get(table).get(permission).push({path:'server/'+file,line});
      };
      record(privilege);
      if(privilege==='INSERT'&&/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(value))record('UPDATE');
    }
    function visit(node,ancestors=[]){
      if(!node||typeof node!=='object')return;
      // This source retains explicit historical schema initialization helpers.
      // Only the runtime store factory is a formal business write entry point.
      const runtime=!(file==='processV7Authoring.js'&&!authoringEnabled)&&(file!=='processDesignMysqlRepository.js'||ancestors.some(parent=>parent.type==='FunctionDeclaration'&&parent.id?.name==='makeProcessDesignMysqlStore'));
      if(runtime&&node.type==='Literal'&&typeof node.value==='string')sql(node.value,node.loc.start.line);
      if(runtime&&node.type==='TemplateLiteral')sql(node.quasis.map((quasi,index)=>quasi.value.cooked+(index<node.expressions.length?' ${DYNAMIC_EXPRESSION} ':'')).join(''),node.loc.start.line,true);
      for(const [key,value]of Object.entries(node)){if(['loc','start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(child=>visit(child,[...ancestors,node]));else if(value&&typeof value==='object')visit(value,[...ancestors,node]);}
    }
    visit(tree);
  }
  const tables=[...writes].sort(([a],[b])=>a.localeCompare(b)).map(([table,permissions])=>({table,privileges:[...permissions.keys()].sort(),evidence:[...permissions].flatMap(([permission,locations])=>locations.map(location=>({...location,privilege:permission})))}));
  const control=tables.find(table=>table.table==='data_map_governance_control');
  if(control)control.privilege_columns={UPDATE:['graph_revision','next_definition_version_id']};
  if(tables.some(table=>table.privileges.includes('DELETE'))||unresolved.length)throw Object.assign(Error('Runtime write plan requires explicit review'),{code:'GOVERNANCE_GRANT_PLAN_UNRESOLVED',tables,unresolved});
  if(tables.some(table=>['person','user_accounts','person_roles','roles','permissions','role_permissions','data_map_definition_heads','schema_migrations','governance_cutover_events'].includes(table.table)))throw Error('GOVERNANCE_GRANT_PLAN_SCOPE_EXPANDED');
  return {schema_version:'governance-runtime-write-plan-v1',source_root:root,source_manifest_sha256:sha(JSON.stringify(sources)),sources,
    preparation_period:{new_write_privileges:[],condition:'all newly introduced business write entrypoints remain fenced; deployment uses a separately authorized maintenance connection'},
    enabled_period:{existing_read_scope:'SELECT on the explicitly authorized database',tables,required_table_privileges:tables.reduce((count,table)=>count+table.privileges.length,0)},
    locking_read_prerequisites:[
      {table:'user_accounts',privilege:'UPDATE',columns:['account_id'],reason:'FOR UPDATE account identity anchor; no identity DML in this feature',evidence:['server/dataMapHandoffAuthority.js','server/dataMapDefinitionRepository.js']},
      {table:'person',privilege:'UPDATE',columns:['person_id'],reason:'FOR UPDATE person identity anchor; no personnel edit authority granted',evidence:['server/dataMapHandoffAuthority.js','server/dataMapDefinitionRepository.js']},
      {table:'process_governance_responsibilities',privilege:'UPDATE',columns:['id'],reason:'FOR UPDATE exact mutable work-package assignment; assignment maintenance reviewed separately',evidence:['server/dataMapHandoffAuthority.js']}
    ],
    select_only_lock_sources:['person_roles','roles','permissions','role_permissions','process_design_versions','process_data_governance_reviews'],
    existing_projection_tables:['data_map_objects','data_map_contexts','data_map_fields','data_map_definition_versions'],
    immutable_sidecar_tables:includeProcessGovernance?['process_case_submissions','process_case_change_confirmations','process_case_requests']:[],
    feature_conditions:{PROCESS_V7_AUTHORING_ENABLED:authoringEnabled?'1':'0'},
    disabled_branch_writes:authoringEnabled?[]:[{module:'server/processV7Authoring.js',tables:['process_v7_authoring','process_v7_authoring_records'],reason:'initialize/record mutations require authoring.enabled(); current feature stays disabled. Existing privileges are retained without adding INSERT/UPDATE.'}],
    excluded_maintenance_sources:['processDesignMysqlRepository.js schema initialization helpers outside makeProcessDesignMysqlStore','governanceControlledCutover.js maintenance-only control and audit writes'],
    baseline_diff_instruction:'Compare each table/column privilege with the actual runtime grants; keep existing scopes and grant only missing INSERT/UPDATE items after review. Identity/personnel role assignments are not changed by this plan.',
    excluded_privileges:['DELETE','CREATE','ALTER','DROP','GRANT OPTION'],personnel_roles_changed:false,grants_executed:false,
    scope:includeProcessGovernance?'terminology/data handoff plus process-case/formal sidecars and their existing preview/formal runtime writes':'terminology governance, native data work packages and controlled data-map handoff'};
}
function grantDiff(result,baseline,{knownTables=[]}={}){
  const {digest}=require('../server/dataMapDefinitionValues'),target=baseline.target;
  if(!baseline.passed||!baseline.read_only||!/^\w+$/.test(target?.database||'')||!/^'[A-Za-z0-9_.-]+'@'[A-Za-z0-9_.:%-]+'$/.test(target?.principal||'')||!/^[0-9a-f-]{36}$/.test(target?.serverUuid||''))throw Error('GOVERNANCE_GRANT_BASELINE_INVALID');
  const lines=baseline.grants.map(row=>typeof row==='string'?row:String(Object.values(row)[0]));
  const available=[];
  for(const line of lines){
    const match=line.match(/^GRANT (.+) ON (\*|`[^`]+`)\.(\*|`[^`]+`) TO `([^`]+)`@`([^`]+)`(?: WITH GRANT OPTION)?$/);
    if(!match)throw Error('GOVERNANCE_GRANT_BASELINE_UNSUPPORTED');
    if("'"+match[4]+"'@'"+match[5]+"'"!==target.principal)throw Error('GOVERNANCE_GRANT_BASELINE_PRINCIPAL_MISMATCH');
    const scope={database:match[2].replaceAll('`',''),table:match[3].replaceAll('`','')};
    const privileges=[];let start=0,depth=0;for(let n=0;n<match[1].length;n++){if(match[1][n]==='(')depth++;else if(match[1][n]===')')depth--;else if(match[1][n]===','&&!depth){privileges.push(match[1].slice(start,n).trim());start=n+1;}}privileges.push(match[1].slice(start).trim());
    for(const permission of privileges){const parsed=permission.match(/^([A-Z ]+?)(?:\s+\(([^)]+)\))?$/);if(!parsed)throw Error('GOVERNANCE_GRANT_BASELINE_UNSUPPORTED');
      available.push({...scope,privilege:parsed[1],columns:parsed[2]?parsed[2].split(',').map(column=>column.trim().replaceAll('`','')):null});}
  }
  const required=result.enabled_period.tables.flatMap(table=>table.privileges.map(privilege=>({table:table.table,privilege,columns:table.privilege_columns?.[privilege]||null})))
    .concat(result.locking_read_prerequisites.map(({table,privilege,columns})=>({table,privilege,columns})));
  const satisfied=[],additional=[];
  for(const item of required){const matching=available.filter(grant=>(grant.database==='*'||grant.database===target.database)&&(grant.table==='*'||grant.table===item.table)&&[item.privilege,'ALL PRIVILEGES'].includes(grant.privilege));
    if(matching.some(grant=>!grant.columns)){satisfied.push(item);continue;}
    const columns=new Set(matching.flatMap(grant=>grant.columns||[]));
    if(!item.columns&&columns.size)throw Object.assign(Error('GOVERNANCE_GRANT_COLUMN_SCOPE_REVIEW_REQUIRED'),{table:item.table,privilege:item.privilege,existing_columns:[...columns]});
    const missing=item.columns?item.columns.filter(column=>!columns.has(column)):null;if(missing&&!missing.length){satisfied.push(item);continue;}
    additional.push({...item,columns:missing,known_in_original_target:knownTables.includes(item.table),must_verify_actual_table_and_columns_after_preparation:true});
  }
  const quotedPrincipal=target.principal.replace(/^'([^']+)'@'([^']+)'$/,'`$1`@`$2`');
  for(const item of additional)if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.table)||!['INSERT','UPDATE'].includes(item.privilege)||(item.columns||[]).some(column=>!/^\w+$/.test(column)))throw Error('GOVERNANCE_GRANT_DIFF_OUT_OF_SCOPE');
  return {...result,baseline_diff:{target,baseline_captured_at:baseline.at,baseline_grants_sha256:digest(lines.slice().sort()),existing_required_privileges:satisfied,
    additional,sql_candidates:additional.map(item=>'GRANT '+item.privilege+(item.columns?' ('+item.columns.map(column=>'`'+column+'`').join(',')+')':'')+' ON `'+target.database+'`.`'+item.table+'` TO '+quotedPrincipal+';'),
    existing_privileges_preserved:true,existing_column_scopes_widened:false,grants_executed:false,requires_runtime_source_closure_and_grant_recheck:true}};
}
if(require.main===module){
  const at=process.argv.indexOf('--root'),root=at<0?path.resolve(__dirname,'..'):path.resolve(process.argv[at+1]);
  const outputAt=process.argv.indexOf('--output');let result=plan(root,{authoringEnabled:process.argv.includes('--authoring-enabled')});
  const baselineAt=process.argv.indexOf('--grant-baseline'),inventoryAt=process.argv.indexOf('--target-inventory');
  if(baselineAt>=0){const file=path.resolve(process.argv[baselineAt+1]);result=grantDiff(result,JSON.parse(fs.readFileSync(file,'utf8')),{knownTables:inventoryAt>=0?Object.keys(JSON.parse(fs.readFileSync(path.resolve(process.argv[inventoryAt+1]),'utf8'))):[]});result.baseline_diff.baseline_file_sha256=sha(fs.readFileSync(file));}
  if(outputAt<0)console.log(JSON.stringify(result,null,2));
  else{const output=path.resolve(process.argv[outputAt+1]),artifacts=path.resolve(__dirname,'../../../artifacts')+path.sep;if(!output.startsWith(artifacts)||fs.existsSync(output))throw Error('GOVERNANCE_GRANT_PLAN_OUTPUT_INVALID');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log('GOVERNANCE_RUNTIME_GRANT_PLAN '+output);}
}
module.exports={modules,dataTerminologyModules,processModules,plan,grantDiff};
