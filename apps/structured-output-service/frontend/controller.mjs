import { clone, catalog, resolve, fields, readPath, writePath, normalizeKind, tableForTarget, gridTarget, newEntity, pendingLifecycle, createAddition, deletionPlan, KIND_LABELS } from './model.mjs';

const frozen = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(frozen);return Object.freeze(value);
};
const pointerValue = (document, path) => String(path || '').split('/').slice(1).reduce((value,key) => value?.[key.replace(/~1/g,'/').replace(/~0/g,'~')],document);
function issueKey(document, issue) {
  const path=issue.path || issue.instancePath || issue.focusPath || '';
  const owner=catalog(document).filter(item=>path===item.path || path.startsWith(`${item.path}/`)).sort((a,b)=>b.path.length-a.path.length)[0];
  const valuePath=issue.params?.missingProperty?`${path}/${issue.params.missingProperty}`:issue.params?.additionalProperty?`${path}/${issue.params.additionalProperty}`:path;
  return JSON.stringify([issue.rule_code || issue.code || issue.keyword,owner ? [owner.kind,owner.ref,owner.parentRef,path.slice(owner.path.length)] : path,issue.params || {},pointerValue(document,valuePath)]);
}
function introducedErrors(beforeDocument,beforeErrors,afterDocument,afterErrors) {
  const counts=new Map();beforeErrors.forEach(issue=>{const key=issueKey(beforeDocument,issue);counts.set(key,(counts.get(key)||0)+1);});
  return afterErrors.filter(issue=>{const key=issueKey(afterDocument,issue),count=counts.get(key)||0;if(count){counts.set(key,count-1);return false;}return true;});
}
function issueTarget(document,issue) {
  return issue.target || catalog(document).filter(item=>(issue.path || issue.instancePath || issue.focusPath || '')===item.path || (issue.path || issue.instancePath || issue.focusPath || '').startsWith(`${item.path}/`)).sort((a,b)=>b.path.length-a.path.length)[0];
}
function decorateIssue(document,issue,severity) {
  const owner=issueTarget(document,issue);
  return {...issue,severity,...(owner?{target:{kind:owner.kind,ref:owner.ref,parentRef:owner.parentRef,formRef:owner.formRef,areaRef:owner.areaRef,dataRef:owner.dataRef,routeRef:owner.routeRef},focusField:issue.column || issue.params?.missingProperty || String(issue.path || issue.instancePath || issue.focusPath || '').slice(owner.path?.length || 0).replace(/^\//,'').replaceAll('/','.')}: {})};
}
export function createWorkbenchController(options = {}) {
  const modules = options.modules;
  if (!modules?.GraphEditorState || !modules?.EditSessionManager || !modules?.WebGridCore) throw new Error('工作台领域桥尚未初始化');
  const fetcher=options.fetch || globalThis.fetch?.bind(globalThis), history=modules.GraphEditorState.createManager({limit:50}), edits=modules.EditSessionManager.createManager();
  const listeners=new Set(), timeoutMs=options.timeoutMs ?? 12000;
  let destroyed=false, version=0, request=null, grid=null, generation=0, candidateSeq=0, sessionRevision=0, refSeq=0, returnFlow=null;
  const fingerprint=modules.GraphEditorState.fingerprint;
  let state={document:null,candidateKey:'',revision:0,selection:null,view:'flow',detailOpen:false,detailExpanded:false,editing:false,session:null,reusePicker:null,pending:false,dirty:false,checks:{issues:[],stale:true,valid:null},download:null,guard:null,busy:false,error:null,enums:{},schema:null,history:{canUndo:false,canRedo:false},viewport:{flow:null,relations:null},relationTarget:null,reducedMotion:Boolean(options.reducedMotion),appliedTarget:null,appliedRevision:null,importInfo:null,importCandidates:null,gridDraftDocument:null};
  let cachedDocument=null,cachedDocumentSource=null,cachedGrid=null,cachedGridRevision=-1,cachedGridSource=null;
  let snapshot=frozen(clone(state));
  const sourceKey=()=>`${state.candidateKey}:${state.revision}`;
  const refFactory=prefix=>`${prefix.replace(/[^A-Za-z0-9_]/g,'_')}_${Date.now().toString(36)}_${++refSeq}`;
  const pickerPending=()=>Boolean(state.reusePicker?.fieldRefs.length);
  function emit() {
    if(destroyed)return;
    state.pending=pickerPending() || (grid ? grid.isDirty() : edits.isDirty());
    state.dirty=Boolean(state.document && history.isDirty(state.candidateKey,state.document));
    state.history=state.document ? history.snapshot(state.candidateKey,state.document) : {canUndo:false,canRedo:false};
    if(grid) {
      state.session={kind:'grid',tables:grid.allRows(),definitions:grid.definitions(),tableId:state.session?.tableId || 'data_objects',parentRef:state.session?.parentRef || '',rowId:state.session?.rowId || '',revision:grid.revision()};
      if(cachedGrid!==grid || cachedGridRevision!==grid.revision() || cachedGridSource!==state.document) {
        cachedGrid=grid;cachedGridRevision=grid.revision();cachedGridSource=state.document;state.gridDraftDocument=frozen(projectGridDocument());
      }
    }
    if(cachedDocumentSource!==state.document) {cachedDocumentSource=state.document;cachedDocument=frozen(clone(state.document));}
    const {document:ignoredDocument,gridDraftDocument:ignoredDraft,...ui}=state;
    snapshot=frozen({...clone(ui),document:cachedDocument,gridDraftDocument:state.gridDraftDocument,version:++version});listeners.forEach(listener=>listener());
  }
  function fail(error) { state.error=error?.message || String(error);emit();return {ok:false,error:state.error}; }
  function abort() { generation+=1;request?.abort();request=null;state.busy=false; }
  async function jsonRequest(url,init={},signal) {
    const response=await fetcher(url,{...init,signal,cache:'no-store'});
    const result=await response.json();if(!response.ok)throw new Error(result.error || `本地服务请求失败 (${response.status})`);return result;
  }
  const validate=(document,signal,profile='')=> options.validate ? options.validate(clone(document),{signal,profile}) : jsonRequest('/api/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:document,...(profile ? {validation_profile:profile} : {})})},signal);
  function token() { return {generation,candidateKey:state.candidateKey,revision:state.revision,sessionRevision,gridRevision:grid?.revision(),fingerprint:state.document ? fingerprint(state.document) : ''}; }
  function current(mark,includeSession=true) { return !destroyed && !mark.canceled && mark.generation===generation && mark.candidateKey===state.candidateKey && mark.revision===state.revision && mark.fingerprint===(state.document?fingerprint(state.document):'') && (!includeSession || mark.sessionRevision===sessionRevision && mark.gridRevision===grid?.revision()); }
  async function operation(work,{session=true}={}) {
    abort();const mark=token(),controller=new AbortController();request=controller;state.busy=true;state.error=null;emit();
    let timeout;
    try {
      const result=await Promise.race([work(controller.signal,mark),new Promise((_,reject)=>{timeout=setTimeout(()=>{mark.canceled=true;controller.abort();reject(new Error('校验超时，当前内容和可见输入均保留，请重试'));},timeoutMs);})]);
      return result;
    } catch(error) {
      if(!current({...mark,canceled:false},session))return {ok:false,stale:true};
      return fail(error);
    } finally {clearTimeout(timeout);if(request===controller){request=null;state.busy=false;emit();}}
  }
  function discardSession() { edits.reset();grid=null;state.session=null;state.gridDraftDocument=null;sessionRevision+=1; }
  function objectSession(target=state.selection,entityOverride=null,added=null) {
    const selected=resolve(state.document,target), entity=entityOverride || selected.entity;
    if(!entity)throw new Error('对象不存在、技术标识歧义或父级归属不符，无法进入编辑');
    const specs=fields(added?.document || state.document,target,state.enums,modules),allowed=[...new Set(specs.map(item=>item.key.split('.')[0]))];
    edits.reset();edits.open({candidateKey:state.candidateKey,editorKind:normalizeKind(target.kind),entityRef:target,allowedFields:allowed,baselineFields:entity,patch:entity,started:Boolean(added)});
    state.session={kind:'object',target:clone(target),values:clone(entity),fields:specs,added:added ? {kind:added.kind,parentRef:added.parentRef,entity:clone(entity)} : null};sessionRevision+=1;
  }
  function commit(document,details={}) {
    const result=history.execute(state.candidateKey,state.document,()=>({ok:true,document:clone(document),details}));
    if(!result.ok)throw new Error(result.message || '未能应用修改');
    const appliedTarget=clone(details.target || state.selection);
    if(appliedTarget)delete appliedTarget.locateSequence;
    state.document=result.document;state.revision+=1;state.checks={...state.checks,stale:true};state.appliedTarget=appliedTarget;state.appliedRevision=state.revision;state.error=null;
  }
  function replaceDocument(document,{dirty=false,importInfo=null}={}) {
    abort();history.clear();discardSession();state.document=clone(document);state.candidateKey=`candidate_${++candidateSeq}`;state.revision=0;history.register(state.candidateKey,state.document);
    if(dirty)history.markBaseline(state.candidateKey,{});
    state.selection=null;state.view='flow';state.detailOpen=false;state.editing=false;state.guard=null;state.reusePicker=null;state.download=null;state.importInfo=importInfo;state.importCandidates=null;state.appliedTarget=null;state.appliedRevision=null;state.viewport={flow:null,relations:null};state.relationTarget=null;returnFlow=null;state.checks={issues:[],stale:true,valid:null};
  }
  function guard(action,reason='pending',message='可见输入尚未应用，请先处理修改。') { state.guard={action:clone(action),reason,message};emit();return {ok:false,guard:true}; }
  function guarded(action) {
    const pending=pickerPending() || (grid ? grid.isDirty() : edits.isDirty());
    if(pending && !action.discardPending)return guard(action);
    if(['new','import','choose-import'].includes(action.type) && state.dirty && !action.confirmedDiscard)return guard(action,'dirty','当前 JSON 的修改尚未下载，请先决定是否保留文件。');
    return null;
  }
  function gridOptions() {
    return {refFactory,pendingLifecycle,allowedFieldTypes:state.enums.fieldType || state.enums.field_types || state.enums.fieldTypes || ['文本','长文本','数字','日期','日期时间','金额','枚举','布尔','部门','人员','文件编号','签名','图片','附件','二维码'],technicalIntegrity:modules.GraphEditCommands.technicalIntegrity,dataObjectFactory:ref=>newEntity('data',ref,modules)};
  }
  function startGrid() {
    if(grid)return;
    const nextGrid=modules.WebGridCore.createSession({adapter:modules.ProcessV7GridAdapter,documentValue:state.document,sourceKey:sourceKey(),adapterOptions:gridOptions()});
    if(state.selection && resolve(state.document,state.selection).status!=='valid'){state.selection=null;state.detailOpen=false;}
    edits.reset();grid=nextGrid;
    const tableId=tableForTarget(state.selection)||'data_objects',rowId=tableForTarget(state.selection)?state.selection.ref:'',definition=grid.definition(tableId),row=grid.rows(tableId).find(item=>item._row_id===rowId);
    state.session={kind:'grid',tableId,parentRef:definition.parentKey?row?.[definition.parentKey] || '':'',rowId};sessionRevision+=1;
  }
  function projectGridDocument() {
    if(!grid)return null;
    const draft=clone(state.document),tables=grid.allRows(),active=id=>(tables[id]||[]).filter(row=>!row._deleted),entries=catalog(draft);
    const rowEntity=(id,row)=>{
      const target=gridTarget(draft,id,row),found=entries.find(item=>item.kind===target.kind && item.ref===target.ref && (!target.parentRef||item.parentRef===target.parentRef));
      const entity=clone(found?.entity || newEntity(target.kind,target.ref,modules));
      grid.definition(id).columns.forEach(column=>{if(!['data_ref','form_ref','area_ref','item_ref'].includes(column.key) || column.key===grid.definition(id).refField)entity[column.key]=clone(row[column.key]);});return entity;
    };
    draft.data_objects=active('data_objects').map(row=>{
      const data=rowEntity('data_objects',row);data.fields=active('data_fields').filter(child=>child.data_ref===row.data_ref).map(child=>rowEntity('data_fields',child));data.behavior_links=active('data_behavior_links').filter(child=>child.data_ref===row.data_ref).map(child=>rowEntity('data_behavior_links',child));data.source_relations=active('data_source_relations').filter(child=>child.data_ref===row.data_ref).map(child=>rowEntity('data_source_relations',child));return data;
    });
    draft.forms=active('forms').map(row=>{
      const form=rowEntity('forms',row);form.behavior_links=active('form_behavior_links').filter(child=>child.form_ref===row.form_ref).map(child=>rowEntity('form_behavior_links',child));form.areas=active('form_areas').filter(child=>child.form_ref===row.form_ref).map(child=>{
        const area=rowEntity('form_areas',child);area.items=active('form_items').filter(item=>item.form_ref===row.form_ref&&item.area_ref===child.area_ref).map(item=>{
          const entity=rowEntity('form_items',item);entity.source_links=active('field_source_links').filter(source=>source.item_ref===item.item_ref).map(source=>rowEntity('field_source_links',source));return entity;
        });return area;
      });return form;
    });return draft;
  }
  function gridCell(tableId,rowId,column,value,{emitNow=true}={}) {
    const row=grid.rows(tableId).find(item=>item._row_id===rowId&&!item._deleted);if(!row)throw new Error('表格行已不存在');
    const patch={[column]:clone(value)};
    if(tableId==='form_items' && column==='item_type' && row.data_field_ref)throw new Error('引用对象字段后，字段类型由对象定义维护，请在对象字段中修改');
    if(tableId==='form_items' && column==='data_field_ref' && value) {
      const result=modules.FormFieldReuse.buildReferencePatch(row,value,modules.FormFieldReuse.indexDataFields(projectGridDocument()));
      if(!result.ok)throw new Error(result.errors.map(error=>error.message).join('；'));
      Object.assign(patch,result.patch);
    }
    Object.entries(patch).forEach(([key,item])=>grid.updateCell(tableId,rowId,key,item));sessionRevision+=1;
    if(emitNow)emit();
  }
  async function applySession() {
    if(!state.session)return {ok:true};
    let planned,target=state.selection;
    if(grid) {
      const result=grid.prepare(state.document,sourceKey());
      if(!result.ok) {
        const baseline=modules.WebGridCore.createSession({adapter:modules.ProcessV7GridAdapter,documentValue:state.document,sourceKey:sourceKey(),adapterOptions:gridOptions()});
        const oldResult=baseline.prepare(state.document,sourceKey()),oldRows=baseline.allRows(),newRows=grid.allRows(),oldCounts=new Map();
        const localKey=(issue,tables)=>JSON.stringify([issue.tableId,issue.rowId,issue.column,issue.code,issue.message,(tables[issue.tableId]||[]).find(row=>row._row_id===issue.rowId)?.[issue.column]]);
        (oldResult.errors||[]).forEach(issue=>{const key=localKey(issue,oldRows);oldCounts.set(key,(oldCounts.get(key)||0)+1);});
        const introduced=(result.errors||[]).filter(issue=>{const key=localKey(issue,newRows),count=oldCounts.get(key)||0;if(count){oldCounts.set(key,count-1);return false;}return true;});
        if(introduced.length)return fail(new Error(introduced.map(error=>error.message).join('；')));
        planned=projectGridDocument();
      } else planned=result.document;
    } else {
      const session=state.session;target=session.target;
      if(session.added) {
        const addition=createAddition(state.document,session.added.kind,session.added.parentRef,session.target.ref,modules);
        const entity=resolve(addition.document,target);Object.assign(entity.entity,clone(session.values));planned=addition.document;
      } else {
        const document=clone(state.document),entity=resolve(document,target);
        if(entity.status!=='valid')return fail(new Error('对象身份或父级已变化，未应用输入保留'));
        const merged=edits.mergeCurrentEntity(entity.entity);if(!merged.ok)return fail(new Error('来源字段已经变化，未应用输入保留，请重新核对'));
        Object.assign(entity.entity,merged.mergedEntity);planned=document;
        if(normalizeKind(target.kind)==='data-field')catalog(planned).filter(item=>item.kind==='form-item'&&item.entity.data_field_ref===target.ref&&item.entity.business_data_ref===target.parentRef).forEach(item=>{item.entity.item_type=entity.entity.field_type;});
      }
    }
    if(fingerprint(planned)===fingerprint(state.document))return {ok:true};
    return operation(async(signal,mark)=>{
      const baseline=await validate(state.document,signal),validation=await validate(planned,signal);
      const newErrors=introducedErrors(state.document,baseline.errors||[],planned,validation.errors||[]);
      if(newErrors.length)throw new Error(`修改未应用：${newErrors.map(issue=>issue.message).slice(0,6).join('；')}。输入已保留，可先下载原稿。`);
      if(!current(mark))return {ok:false,stale:true};
      commit(planned,{target});
      if(grid)grid.accept(state.document,sourceKey());else objectSession(target);
      // Transaction validation protects a commit. It never masquerades as the user's explicit whole-document check.
      state.checks={...state.checks,stale:true};
      emit();return {ok:true};
    });
  }
  async function transaction(planned,details={}) {
    return operation(async(signal,mark)=>{
      const before=await validate(state.document,signal),after=await validate(planned,signal);
      const introduced=introducedErrors(state.document,before.errors||[],planned,after.errors||[]);
      if(introduced.length)throw new Error(introduced.map(issue=>issue.message).slice(0,6).join('；'));
      if(!current(mark))return {ok:false,stale:true};commit(planned,details);emit();return {ok:true};
    });
  }
  async function download() {
    const exported=clone(state.document);exported.export_meta={...exported.export_meta,exported_at:new Date().toISOString()};
    const bytes=new TextEncoder().encode(`${JSON.stringify(exported,null,2)}\n`),fileName=`${(exported.process?.process_name||'未命名流程').replace(/[\\/:*?"<>|]/g,'_')}.json`;
    const key=state.candidateKey,revision=state.revision;
    let digest='';
    try { const hashed=await (options.digest ? options.digest(bytes) : globalThis.crypto.subtle.digest('SHA-256',bytes));digest=typeof hashed==='string'?hashed:Array.from(new Uint8Array(hashed)).map(value=>value.toString(16).padStart(2,'0')).join(''); } catch { /* Byte count and frozen exported document remain accurate if platform crypto is unavailable. */ }
    if(destroyed || key!==state.candidateKey || revision!==state.revision)return {ok:false,stale:true};
    if(options.downloadFile) await options.downloadFile({bytes,fileName,document:clone(exported),digest});
    else {
      const blob=new Blob([bytes],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    if(!destroyed && key===state.candidateKey) {
      history.markBaseline(key,exported);state.download={digest,byteLength:bytes.byteLength,fileName,exportedAt:exported.export_meta.exported_at,revision,document:exported};emit();
    }
    return {ok:true,download:state.download};
  }
  async function importText(action) {
    let parsed;try { parsed=JSON.parse(action.text); } catch { return fail(new Error('文件不是有效 JSON，当前内容和输入均保留')); }
    return operation(async(signal,mark)=>{
      let source=await validate(parsed,signal);
      if(!source.valid && parsed.schema_version==='process-governance-v7' && modules.ProcessGovernanceMigration.needsDataFieldUpgrade(parsed))source=await validate(parsed,signal,'early-v7-data-fields');
      if(!source.valid && !modules.ImportCompatibility.classifyPostMigrationValidation(source).allowed)throw new Error(`源文件检查失败：${(source.errors||[]).slice(0,4).map(item=>item.message).join('；')}`);
      const documents=modules.ProcessGovernanceMigration.migrateDocument(source.data || parsed,{fileName:action.fileName});
      const validations=[];for(const document of documents)validations.push(await validate(document,signal));
      const classification=modules.ImportCompatibility.classifyPostMigrationBatch(validations);
      if(!classification.allowed)throw new Error('迁移后的文件存在无法安全保留的结构问题，当前工作内容保持不变');
      const info={fileName:action.fileName || '',sourceVersion:parsed.schema_version,targetVersion:documents[0]?.schema_version,count:documents.length,normalization:modules.ImportCompatibility.summarizeNormalization?.(parsed,documents[0]),repairableErrorCount:classification.repairableErrorCount};
      if(!current(mark))return {ok:false,stale:true};
      if(documents.length>1) {state.importCandidates=documents.map((document,index)=>({index,label:document.process?.process_name || `流程 ${index+1}`,document,info}));emit();return {ok:true,choose:true};}
      replaceDocument(documents[0],{dirty:parsed.schema_version!==documents[0].schema_version||fingerprint(parsed)!==fingerprint(documents[0]),importInfo:info});emit();return {ok:true};
    });
  }
  function select(target) {
    const document=grid ? projectGridDocument() : state.document, selected=resolve(document,target);
    if(selected.status!=='valid')throw new Error(`对象${selected.status==='ambiguous'?'标识存在歧义':selected.status==='wrong-parent'?'父级归属不符':'不存在'}，原值保留`);
    state.selection={kind:selected.kind,ref:selected.ref,parentRef:selected.parentRef,formRef:selected.formRef,areaRef:selected.areaRef,locateSequence:version+1,...(target.locateReason?{locateReason:target.locateReason}:{})};state.detailOpen=true;
    if(grid) {
      const tableId=tableForTarget(state.selection);
      if(tableId)state.session={...state.session,tableId,rowId:selected.ref,parentRef:grid.definition(tableId).parentKey ? grid.rows(tableId).find(row=>row._row_id===selected.ref)?.[grid.definition(tableId).parentKey] || '' : ''};
      else state.session={...state.session,rowId:''};
    } else if(state.editing)objectSession(state.selection);else {edits.reset();state.session=null;}
  }
  function gridParentValid(tableId,parentRef) {
    const definition=grid.definition(tableId);if(!definition?.parentTableId)return true;
    const parents=grid.rows(definition.parentTableId).filter(row=>row._row_id===parentRef&&!row._deleted);
    if(parents.length!==1)throw new Error(`请先明确选择唯一的${grid.definition(definition.parentTableId)?.label}，再新增${definition.label}`);
    return true;
  }
  async function reuseFields(action) {
    const draft=grid?projectGridDocument():state.document,area=resolve(draft,{kind:'form-area',ref:action.areaRef || state.selection?.ref,parentRef:action.formRef || state.selection?.parentRef});
    if(area.status!=='valid')throw new Error('请先选择有效的表单区域');
    const result=modules.FormFieldReuse.planBatchReference(draft,{candidateKey:state.candidateKey,documentFingerprint:fingerprint(draft),formRef:area.formRef,areaRef:area.ref,fieldRefs:action.fieldRefs,requiredByFieldRef:action.requiredByFieldRef || {}},refFactory);
    if(!result.ok)throw new Error(result.errors.map(item=>item.message).join('；'));
    if(grid) {
      const nextRows=modules.ProcessV7GridAdapter.read(result.document),currentRows=grid.allRows();
      for(const id of ['form_items','field_source_links']) {
        const existing=new Set(currentRows[id].map(row=>row._row_id));
        const added=nextRows[id].filter(row=>!existing.has(row._row_id)).map(row=>({...row,_existing:false}));
        if(added.length)grid.replaceRows(id,[...currentRows[id],...added]);
      }
      sessionRevision+=1;emit();return {ok:true};
    }
    return transaction(result.document,{target:state.selection});
  }
  async function applyReusePicker() {
    const picker=state.reusePicker;if(!picker)return {ok:true};
    const result=await reuseFields({fieldRefs:picker.fieldRefs,requiredByFieldRef:picker.requiredByFieldRef,formRef:picker.target.parentRef,areaRef:picker.target.ref});
    if(result.ok && state.reusePicker===picker){state.reusePicker=null;sessionRevision+=1;emit();}
    return result;
  }
  async function applyVisibleInputs() {
    if(pickerPending()){const result=await applyReusePicker();if(!result.ok)return result;}
    return applySession();
  }
  function gridPaste(action) {
    const definition=grid.definition(action.tableId),rows=grid.rows(action.tableId).filter(row=>!row._deleted && (!definition.parentKey || row[definition.parentKey]===state.session.parentRef));
    const rowIndex=rows.findIndex(row=>row._row_id===action.rowId),columnIndex=definition.columns.findIndex(column=>column.key===action.column);
    if(rowIndex<0 || columnIndex<0)throw new Error('粘贴起点已经变化');
    const matrix=action.matrix || modules.NativeWebGrid.parseClipboardGrid(action.text || '');
    if(rowIndex+matrix.length>rows.length)throw new Error('粘贴区域超过现有行，请先在当前父级下新增所需行');
    const optionResolver=column=>{
      if(column.values?.length)return column.values;
      if(!column.lookup)return [];
      const kind={data_objects:'data',data_fields:'data-field',forms:'form',form_areas:'form-area',form_items:'form-item',behaviors:'behavior',dataBehaviors:'behavior'}[column.lookup];
      return catalog(projectGridDocument()).filter(item=>item.kind===kind&&!item.ambiguous).map(item=>({value:item.ref,label:item.label}));
    };
    const plan=modules.NativeWebGrid.planPaste({matrix,columns:definition.columns,startColumn:columnIndex,optionResolver});
    if(plan.errors?.length)throw new Error(plan.errors.map(error=>`${error.fieldLabel || '粘贴'}：${error.message}`).join('；'));
    const before=grid.allRows();
    try {plan.values.forEach((values,i)=>values.forEach((value,j)=>gridCell(action.tableId,rows[rowIndex+i]._row_id,definition.columns[columnIndex+j].key,value,{emitNow:false})));}
    catch(error) {Object.entries(before).forEach(([id,table])=>grid.replaceRows(id,table));throw error;}
    emit();return {ok:true};
  }
  async function executeAction(action) {
    if(destroyed)return {ok:false,destroyed:true};
    try {
      if(typeof action==='string')action={type:action};
      // Camera and resize feedback must not erase a failure before the user can read it.
      if(action.type!=='viewport')state.error=null;
      const protectedActions=['new','import','choose-import','select','select-reference','view','close-detail','exit-edit','add','delete','undo','redo','download','relations','return-flow','focus-issue','reuse-fields','reuse-picker-open'];
      const preserveGrid=grid && ['select','select-reference','close-detail','expand-detail','grid-table','grid-select','reuse-fields','reuse-picker-open'].includes(action.type);
      const pickerNavigation=pickerPending() && ['grid-table','grid-select','grid-start','grid-add','grid-delete','grid-cancel','cancel','edit'].includes(action.type);
      if((protectedActions.includes(action.type) && (!preserveGrid || pickerPending()) || pickerNavigation) && !action.guardResolved) {const blocked=guarded(action);if(blocked)return blocked;}
      switch(action.type) {
        case 'init':
          if(state.document)return {ok:true};
          return operation(async(signal,mark)=>{
            const [template,enums,schema]=await Promise.all([options.template?Promise.resolve({data:options.template}):jsonRequest('/api/template',{},signal),options.enums?Promise.resolve(options.enums):jsonRequest('/api/enums',{},signal),options.schema?Promise.resolve(options.schema):jsonRequest('/api/schema',{},signal)]);
            if(!current(mark))return {ok:false,stale:true};state.enums=enums;state.schema=schema;replaceDocument(template.data,{dirty:options.initialDirty!==false});emit();return {ok:true};
          });
        case 'new': {
          if(options.template){replaceDocument(options.template,{dirty:true});emit();return {ok:true};}
          return operation(async(signal,mark)=>{const template=await jsonRequest('/api/template',{},signal);if(!current(mark))return {ok:false,stale:true};replaceDocument(template.data,{dirty:true});emit();return {ok:true};});
        }
        case 'import':return await importText(action);
        case 'choose-import': {
          const candidate=state.importCandidates?.[action.index];if(!candidate)throw new Error('请选择文件内的一条流程');
          replaceDocument(candidate.document,{dirty:true,importInfo:candidate.info});emit();return {ok:true};
        }
        case 'cancel-import':state.importCandidates=null;emit();break;
        case 'select':select(action.target);emit();break;
        case 'select-reference': {
          const expected=action.reference;
          if(!expected?.path || !expected?.ref)throw new Error('引用来源信息缺失，原位置保持不变，请重新打开引用明细');
          const projection=modules.ElementReferences.buildCatalog(state.document),matches=projection.references.filter(item=>item.path===expected.path&&item.id===expected.id),live=matches.length===1?matches[0]:null;
          const targetKey=modules.ElementReferences.targetKey;
          const equalTarget=(left,right)=>targetKey(left)===targetKey(right);
          if(!live || live.ref!==expected.ref || live.status!=='valid' || live.status!==expected.status || !equalTarget(live.sourceTarget,expected.sourceTarget) || !equalTarget(live.target,expected.target) || !equalTarget(live.elementTarget,expected.elementTarget))throw new Error('该引用的来源、原值或归属已经变化，原位置保持不变，请重新查看关系');
          const destination=action.direction==='incoming'?live.sourceTarget:live.elementTarget || live.target;
          if(!destination || action.target && !equalTarget(destination,action.target))throw new Error('引用目标已经变化，未执行旧目标导航，请重新查看关系');
          select(destination);emit();break;
        }
        case 'view':
          if(!['flow','list','grid','relations'].includes(action.view))throw new Error('未知视图');
          if(action.view==='grid')startGrid();else if(grid){
            const valid=!state.selection || resolve(state.document,state.selection).status==='valid';
            discardSession();if(!valid){state.selection=null;state.detailOpen=false;}else if(state.editing&&state.selection)objectSession();
          }
          state.view=action.view;emit();break;
        case 'relations':
          if(!returnFlow)returnFlow={selection:clone(state.selection),view:state.view,viewport:clone(state.viewport),editing:state.editing};
          state.relationTarget=clone(action.target || state.selection);state.view='relations';emit();break;
        case 'return-flow': {
          const restore=returnFlow;
          const target=restore?.selection && resolve(grid?projectGridDocument():state.document,restore.selection).status==='valid'?restore.selection:null;
          if(restore){state.selection=target;state.view=restore.view;state.viewport=restore.viewport;state.editing=restore.editing;returnFlow=null;if(!target)state.detailOpen=false;}
          else state.view='flow';state.relationTarget=null;
          if(!grid){edits.reset();state.session=null;if(state.editing&&state.selection)objectSession();}emit();break;
        }
        case 'close-detail':state.detailOpen=false;emit();break;
        case 'expand-detail':state.detailExpanded=action.value ?? !state.detailExpanded;emit();break;
        case 'edit':
          if(grid){state.editing=true;emit();break;}
          state.editing=true;objectSession();emit();break;
        case 'exit-edit':discardSession();state.editing=false;emit();break;
        case 'update': {
          abort();
          if(grid) {
            const tableId=tableForTarget(state.selection),rowId=state.selection?.ref;
            if(!tableId)throw new Error('该关联详情超出批量表格映射，当前会话只能查看');
            gridCell(tableId,rowId,action.field,action.value);break;
          }
          if(state.session?.kind!=='object')throw new Error('请先进入对象编辑');
          const field=state.session.fields.find(item=>item.key===action.field);if(!field || field.readOnly)throw new Error('该字段不属于当前编辑面板');
          const values=clone(state.session.values);writePath(values,action.field,field.nullable&&action.value===''?null:action.value);
          if(normalizeKind(state.session.target.kind)==='form-item' && action.field==='data_field_ref' && action.value) {
            const result=modules.FormFieldReuse.buildReferencePatch(values,action.value,modules.FormFieldReuse.indexDataFields(state.document));
            if(!result.ok)throw new Error(result.errors.map(error=>error.message).join('；'));Object.assign(values,result.patch);
          }
          const projection=clone(state.document);
          if(!state.session.added)Object.assign(resolve(projection,state.session.target).entity,clone(values));
          else {const addition=createAddition(projection,state.session.added.kind,state.session.added.parentRef,state.session.target.ref,modules);Object.assign(resolve(addition.document,state.session.target).entity,clone(values));projection.behaviors=addition.document.behaviors;projection.data_objects=addition.document.data_objects;projection.forms=addition.document.forms;projection.terms=addition.document.terms;projection.flow_relations=addition.document.flow_relations;}
          state.session={...state.session,values,fields:fields(projection,state.session.target,state.enums,modules)};
          edits.updatePatch({[action.field.split('.')[0]]:values[action.field.split('.')[0]],...(action.field==='data_field_ref'?{business_data_ref:values.business_data_ref,item_type:values.item_type,item_name:values.item_name}:{})});sessionRevision+=1;emit();break;
        }
        case 'apply':case 'grid-apply':return applySession();
        case 'cancel':
          abort();if(state.session?.added){discardSession();state.selection=null;state.detailOpen=false;}
          else {discardSession();if(state.editing&&state.selection)objectSession();}emit();break;
        case 'grid-start': {
          if(!grid && edits.isDirty() && !action.discardPending)return guard(action);startGrid();state.view='grid';emit();break;
        }
        case 'grid-table':
          startGrid();if(!grid.definition(action.tableId))throw new Error('未知表格');state.session={...state.session,tableId:action.tableId,parentRef:action.parentRef || '',rowId:''};emit();break;
        case 'grid-select': {
          const row=grid?.rows(action.tableId).find(item=>item._row_id===action.rowId&&!item._deleted);if(!row)throw new Error('表格记录已不存在');
          select(gridTarget(projectGridDocument(),action.tableId,row));emit();break;
        }
        case 'grid-update':abort();if(!grid)throw new Error('未进入表格工作副本');gridCell(action.tableId,action.rowId,action.column,action.value);break;
        case 'grid-add': {
          abort();startGrid();const id=action.tableId || state.session.tableId,parent=action.parentRef ?? state.session.parentRef;gridParentValid(id,parent);
          const area=id==='form_items'?grid.rows('form_areas').find(row=>row._row_id===parent):null,row=grid.addRow(id,{parentRef:parent,formRef:area?.form_ref || action.formRef});state.session={...state.session,tableId:id,parentRef:parent,rowId:row._row_id};state.selection=gridTarget(projectGridDocument(),id,row);state.detailOpen=true;sessionRevision+=1;
          const definition=grid.definition(id);state.focus={target:clone(state.selection),tableId:id,rowId:row._row_id,field:definition.columns.find(column=>!column.readOnly&&column.key!==definition.parentKey&&column.key!=='form_ref')?.key || '',sequence:version+1};emit();return {ok:true,rowId:row._row_id};
        }
        case 'grid-delete': {
          if(!grid)throw new Error('未进入表格工作副本');const row=grid.rows(action.tableId).find(item=>item._row_id===action.rowId),target=gridTarget(projectGridDocument(),action.tableId,row),plan=deletionPlan(projectGridDocument(),target,modules);
          if(!plan.ok)throw new Error(`${plan.message}：${plan.impacts.map(item=>item.label).join('、')}`);
          if(!action.confirmed)return guard({...action,confirmed:true},'delete',plan.message);
          abort();grid.setDeleted(action.tableId,action.rowId,true);sessionRevision+=1;if(state.selection?.ref===action.rowId){state.selection=null;state.detailOpen=false;}emit();break;
        }
        case 'grid-paste':abort();if(!grid)throw new Error('未进入表格工作副本');return gridPaste(action);
        case 'grid-cancel':abort();discardSession();startGrid();emit();break;
        case 'add': {
          const kind=normalizeKind(action.kind),ref=refFactory(kind),addition=createAddition(state.document,kind,action.parentRef,ref,modules);
          discardSession();state.editing=true;state.selection=addition.target;state.detailOpen=true;objectSession(addition.target,resolve(addition.document,addition.target).entity,{...addition,kind,parentRef:action.parentRef});emit();break;
        }
        case 'delete': {
          const target=action.target || state.selection,plan=deletionPlan(state.document,target,modules);
          if(!plan.ok)throw new Error(`${plan.message}：${plan.impacts.map(item=>item.label).join('、')}`);
          if(!action.confirmed)return guard({...action,target,confirmed:true},'delete',plan.message);
          const result=await transaction(plan.document,{deletedRef:target.ref});if(result.ok){discardSession();state.selection=null;state.detailOpen=false;emit();}return result;
        }
        case 'reuse-fields':return await reuseFields(action);
        case 'reuse-picker-open': {
          const target=action.target || state.selection,area=resolve(grid?projectGridDocument():state.document,target);
          if(area.status!=='valid'||area.kind!=='form-area')throw new Error('请先选择有效且归属明确的表单区域');
          abort();
          if(action.discardPending&&!grid){const added=state.session?.added;discardSession();if(added){state.selection=null;state.detailOpen=false;}else if(state.editing&&state.selection)objectSession();}
          state.reusePicker={target:{kind:'form-area',ref:area.ref,parentRef:area.formRef},fieldRefs:[],requiredByFieldRef:{}};sessionRevision+=1;emit();break;
        }
        case 'reuse-picker-update': {
          if(!state.reusePicker)throw new Error('引用对象字段选择器尚未打开');
          abort();state.reusePicker={...state.reusePicker,...(Object.hasOwn(action,'fieldRefs')?{fieldRefs:clone(action.fieldRefs || [])}:{}),...(Object.hasOwn(action,'requiredByFieldRef')?{requiredByFieldRef:clone(action.requiredByFieldRef || {})}:{})};sessionRevision+=1;emit();break;
        }
        case 'reuse-picker-cancel':abort();state.reusePicker=null;sessionRevision+=1;emit();break;
        case 'reuse-picker-apply':return await applyReusePicker();
        case 'undo':case 'redo': {
          abort();const result=history[action.type](state.candidateKey,state.document);if(!result.ok)throw new Error(result.message);
          state.document=result.document;state.revision+=1;state.appliedTarget=null;state.appliedRevision=null;state.checks.stale=true;discardSession();if(state.selection&&resolve(state.document,state.selection).status!=='valid'){state.selection=null;state.detailOpen=false;}else if(state.editing&&state.selection)objectSession();emit();break;
        }
        case 'check':
          return operation(async(signal,mark)=>{const validation=await validate(state.document,signal);if(!current(mark))return {ok:false,stale:true};state.checks={issues:[...(validation.errors||[]).map(item=>decorateIssue(state.document,item,'error')),...(validation.warnings||[]).map(item=>decorateIssue(state.document,item,'warning'))],stale:false,valid:validation.valid,revision:state.revision};emit();return {ok:true};},{session:false});
        case 'focus-issue': {
          const issue=action.issue,target=issueTarget(state.document,issue),resolved=resolve(state.document,target);
          if(resolved.status!=='valid')throw new Error('该问题的对象已经变化或没有可定位对象，原位置保持不变，请重新检查');
          const relative=issue.focusField || issue.column || issue.params?.missingProperty || String(issue.path || issue.instancePath || issue.focusPath || '').slice(resolved.path.length).replace(/^\//,'').replaceAll('/','.');
          const definitions=fields(state.document,target,state.enums,modules),editable=definitions.filter(field=>!field.readOnly),field=editable.find(field=>relative===field.key||relative.startsWith(`${field.key}.`))?.key || '';
          const tableId=tableForTarget(target),mapped=tableId&&modules.ProcessV7GridAdapter.definitions(state.document,gridOptions()).find(item=>item.id===tableId)?.columns.some(column=>column.key===relative&&!column.readOnly);
          if((issue.tableId || grid) && mapped) {if(!grid)startGrid();select({...target,locateReason:'issue'});state.view='grid';}
          else {if(grid)discardSession();state.editing=true;select({...target,locateReason:'issue'});state.view='flow';}
          state.focus={target:clone(state.selection),field:state.view==='grid'?relative:field,tableId:state.view==='grid'?tableId:'',rowId:issue.rowId || target.ref,sequence:version+1};emit();break;
        }
        case 'download':return await download();
        case 'resolve-guard': {
          const pending=state.guard;if(!pending)return {ok:true};
          if(action.choice==='continue'){state.guard=null;emit();return {ok:true,canceled:true};}
          if(pending.reason==='pending') {
            if(action.choice==='apply'){const applied=await applyVisibleInputs();if(!applied.ok)return applied;}
            else if(action.choice==='discard'){abort();pending.action.discardPending=true;}
            else throw new Error('未知修改处理方式');
          } else if(pending.reason==='dirty' && action.choice==='apply'){
            const beforeInputs=sessionRevision,result=await download();if(!result.ok)return result;
            if(beforeInputs!==sessionRevision){state.guard={action:clone({...pending.action,discardPending:false}),reason:'pending',message:'下载过程中有新输入，请先处理这些修改，目标操作尚未执行。'};emit();return {ok:false,guard:true};}
          }
          else if(pending.reason==='delete' && action.choice!=='discard' && action.choice!=='apply')throw new Error('请确认删除或继续编辑');
          state.guard=null;emit();return await dispatch({...pending.action,...(pending.reason==='dirty'?{confirmedDiscard:true}:{}),...(pending.reason==='delete'?{confirmed:true}:{}),guardResolved:pending.reason==='delete'});
        }
        case 'viewport':state.viewport={...state.viewport,[action.view || state.view]:clone(action.viewport)};emit();break;
        case 'reduced-motion':state.reducedMotion=Boolean(action.value);emit();break;
        case 'cancel-async':abort();emit();break;
        case 'clear-error':state.error=null;emit();break;
        default:throw new Error(`工作台不支持操作：${action.type}`);
      }
      return {ok:true};
    } catch(error) {return fail(error);}
  }
  async function dispatch(action) {
    const inputsBefore=sessionRevision,pickerBefore=state.reusePicker,result=await executeAction(action);
    // A discard decision is committed together with the requested action, after all fallible work.
    // New input during download supersedes that decision and remains visible and unapplied.
    if(action?.discardPending && result?.ok && !state.guard) {
      const clearPicker=pickerBefore && state.reusePicker===pickerBefore,clearSession=inputsBefore===sessionRevision&&state.session;
      if(clearPicker)state.reusePicker=null;
      if(clearSession) {
        const added=state.session.added;discardSession();
        if(added){state.selection=null;state.detailOpen=false;}
        else if(state.editing && state.selection && resolve(state.document,state.selection).status==='valid')objectSession();
      } else if(clearPicker)sessionRevision+=1;
      if(clearPicker || clearSession)emit();
    }
    return result;
  }
  return Object.freeze({getSnapshot:()=>snapshot,subscribe:listener=>{if(destroyed)return()=>{};listeners.add(listener);return()=>listeners.delete(listener);},dispatch,destroy:()=>{if(destroyed)return;abort();destroyed=true;listeners.clear();state.reusePicker=null;discardSession();history.clear();snapshot=frozen({...snapshot,reusePicker:null,session:null,pending:false,destroyed:true});}});
}
