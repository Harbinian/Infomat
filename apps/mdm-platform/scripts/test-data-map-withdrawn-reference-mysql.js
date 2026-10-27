// TD-09 fixed-reference reads on an owned, loopback-only tmpfs MySQL target.
// These are synthetic publications, never a formal migration or activation.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed,draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {newId,json,digest,snapshot,parse}=require('../server/dataMapHandoffPolicy');
const {lockGraph}=require('../server/dataMapHandoffControl');
const {handoffActor}=require('../server/dataMapHandoffAuthority');
const publisher=require('../server/dataMapHandoffPublisher'),reader=require('../server/dataMapEffectiveReader');
const outputArg=process.argv.indexOf('--output');
const output=path.resolve(outputArg<0?path.join(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-03/withdrawn-reference-'+newId()):process.argv[outputArg+1]);
const checks=[];let targetRecord;
const check=async(name,action)=>{await action();checks.push({name,passed:true});console.log('PASS '+name);};
async function main(){
  await withFreshMysql(async target=>{
    const {pool,owner,database,containerId}=target;targetRecord={owner,database,containerId,storage:'tmpfs',host:'127.0.0.1'};
    const {session,packageSeed}=await seed(target),lead=session(11);
    async function tx(action,commit=true){const db=await pool.getConnection();try{await db.beginTransaction();const control=await lockGraph(db),value=await action(db,control);if(commit)await db.commit();else await db.rollback();return value;}catch(error){await db.rollback();throw error;}finally{db.release();}}
    async function publish(number,input=draftBody()){
      const pkg=await packageSeed(number),body=snapshot(input),draft={handoff_id:newId(),package_id:String(number)},revision={revision_id:newId(),binding_id:newId()},approval={approval_id:newId()};
      return tx(async(db,control)=>{
        const actor=await handoffActor(db,lead,'publish',{packageId:String(number)});
        await db.execute("INSERT INTO data_map_handoff_drafts(handoff_id,package_id,current_revision,state,active_slot,created_by,created_actor_json,created_at) VALUES(?,?,1,'approved',1,11,?,UTC_TIMESTAMP(3))",[draft.handoff_id,String(number),json(actor.qualificationSnapshot)]);
        await db.execute('INSERT INTO data_map_handoff_revisions(revision_id,handoff_id,revision_no,scope_mode,binding_id,snapshot_json,content_digest,dependency_manifest_json,impact_manifest_json,created_by,created_actor_json,created_at) VALUES(?,?,1,?,?,?,?,?,?,11,?,UTC_TIMESTAMP(3))',[revision.revision_id,draft.handoff_id,body.scope_mode,revision.binding_id,json(body),digest(body),json({}),json([]),json(actor.qualificationSnapshot)]);
        await db.execute("INSERT INTO data_map_handoff_approvals(approval_id,action,revision_id,binding_digest,decision,basis,actor_json,request_id,created_at) VALUES(?,'publish',?,?,'approved','synthetic read fixture',?,?,UTC_TIMESTAMP(3))",[approval.approval_id,revision.revision_id,'0'.repeat(64),json(actor.qualificationSnapshot),newId()]);
        // The fixture deliberately targets the publisher and reader. Approval
        // and lifecycle policy are exercised by their separate repository suites.
        const evaluation={body,pkg:{id:String(number)},source:{id:String(number),content_hash:pkg.hash},review:{detail_versions:[{detail_ref:'object:source_1',detail_version_id:newId()}]},report:{dependency_manifest:{},impact_manifest:[]}};
        return publisher.publish(db,{draft,revision,approval,evaluation,actor,control,requestId:newId()});
      });
    }
    const item=(pub,ref)=>pub.items.find(i=>i.item_ref===ref);
    function successor(pub,{reuse=false}={}){
      const body=draftBody();
      for(const row of body.items){
        const prior=item(pub,row.item_ref);row.definition=structuredClone(prior.payload.definition);
        if(row.target_kind==='object')for(const group of row.definition.unique_identifiers){group.field_item_refs=group.field_version_ids.map(v=>pub.items.find(i=>i.target_version_ref===v).item_ref);delete group.field_version_ids;}
        if(['object','field','data_element'].includes(row.target_kind)){
          row.operation=reuse?'reuse':'modify';row.target_id=prior.target_id;
          if(reuse){row.target_version_ref=prior.target_version_ref;row.definition=structuredClone(prior.payload.definition);}
          else row.base_version_ref=prior.target_version_ref;
        }else row.target_id=prior.target_id;
      }
      return body;
    }
    async function withdraw(db,pub,{clearHeads=true}={}){
      const [[event]]=await db.execute('SELECT COALESCE(MAX(event_no),0)+1 n FROM data_map_publication_events WHERE publication_id=?',[pub.publication_id]);
      await db.execute("INSERT INTO data_map_publication_events(publication_id,event_no,event_type,payload_json,request_id,created_at) VALUES(?,?,'withdrawn',?,?,UTC_TIMESTAMP(3))",[pub.publication_id,event.n,json({reason:'synthetic actual withdrawal event'}),newId()]);
      if(clearHeads)for(const row of pub.items.filter(i=>i.produces_version))await db.execute("UPDATE data_map_effective_heads SET availability='withdrawn',effective_version_ref=NULL,publication_id=NULL,head_revision=head_revision+1 WHERE subject_kind=? AND subject_id=? AND effective_version_ref=? AND publication_id=?",[row.target_kind,row.target_id,row.target_version_ref,pub.publication_id]);
    }
    async function changeItem(db,pub,ref,mutate){
      const [[record]]=await db.execute('SELECT manifest_json FROM data_map_publications WHERE publication_id=?',[pub.publication_id]);
      const manifest=parse(record.manifest_json),row=manifest.items.find(i=>i.item_ref===ref);mutate(row);
      await db.execute('UPDATE data_map_publications SET manifest_json=?,manifest_digest=? WHERE publication_id=?',[json(manifest),digest(manifest),pub.publication_id]);
      await db.execute('UPDATE data_map_publication_items SET payload_json=? WHERE publication_id=? AND item_ref=?',[json(row.payload),pub.publication_id,ref]);
      const [[event]]=await db.execute('SELECT payload_json FROM data_map_publication_events WHERE publication_id=? AND event_no=1',[pub.publication_id]);
      const payload=parse(event.payload_json);payload.manifest_digest=digest(manifest);
      await db.execute('UPDATE data_map_publication_events SET payload_json=? WHERE publication_id=? AND event_no=1',[json(payload),pub.publication_id]);
      return row;
    }
    let original,reused,independent,dependent;
    await check('original complete fixed graph handles parent/identifier/context cycles with exact BIGINT versions',async()=>{
      original=await publish(7601);const object=item(original,'object');assert(BigInt(object.target_version_ref)>9007199254740991n);
      for(const row of original.items){const status=await reader.referenceStatus(pool,{subjectKind:row.target_kind,subjectId:row.target_id,versionRef:row.target_version_ref});assert.equal(status.referenceable,true,json(status));assert.deepEqual(status.reference_issues,[]);}
      assert.equal(await reader.isVersionReferenceable(pool,object.target_version_ref),true);
    });
    await check('absent null and empty identifiers remain supported no-dependency declarations without adding a business gate',async()=>{
      for(const [index,value]of [undefined,null,[]].entries()){
        const body=draftBody();if(value===undefined)delete body.items[0].definition.unique_identifiers;else body.items[0].definition.unique_identifiers=value;
        const publication=await publish(7610+index,body),object=item(publication,'object');
        const current=await reader.readDefinition(pool,{entityType:'object',entityId:object.target_id,view:'current'});assert.equal(current.referenceable,true,json(current.reference_issues));assert.equal(current.requires_attention,false);
        const history=await reader.readDefinition(pool,{entityType:'object',entityId:object.target_id,view:'history',versionId:object.target_version_ref});assert.deepEqual(history.definition,object.payload.definition);assert.equal(history.new_reference_allowed,true);
      }
    });
    await check('an actually malformed identifier declaration fails closed while its fixed body remains readable',async()=>{
      for(const value of [{kind:'single'},'unknown-identifier-structure',[{kind:'single',field_version_ids:[]}]])await tx(async db=>{
        const changed=await changeItem(db,original,'object',row=>{row.payload.definition.unique_identifiers=value;});
        await db.execute('UPDATE data_map_definition_versions SET definition_json=?,content_digest=? WHERE version_id=?',[json(changed.payload.definition),digest(changed.payload.definition),changed.target_version_ref]);
        const history=await reader.readDefinition(db,{entityType:'object',entityId:changed.target_id,view:'history',versionId:changed.target_version_ref});assert.deepEqual(history.definition,changed.payload.definition);assert.equal(history.new_reference_allowed,false);assert(history.reference_issues.some(i=>i.code==='HANDOFF_DEPENDENCY_STRUCTURE_UNSUPPORTED'));
      },false);
    });
    await check('withdrawing a reuse unit preserves the independent producing publication and definitions',async()=>{
      reused=await publish(7602,successor(original,{reuse:true}));
      await tx(async db=>{
        await withdraw(db,reused);const object=item(original,'object');
        assert.equal((await reader.assertReferenceable(db,{entityType:'object',entityId:object.target_id,versionId:object.target_version_ref})).publication_id,original.publication_id);
        const context=item(reused,'context');assert.equal((await reader.readSubject(db,{subjectKind:'context',subjectId:context.target_id,view:'current'})).current,null);
        const old=await reader.readSubject(db,{subjectKind:'context',subjectId:context.target_id,view:'history',versionRef:context.target_version_ref});assert.deepEqual(old.payload,context.payload);assert.equal(old.new_reference_allowed,false);
      },false);
    });
    await check('withdrawing the producer blocks every reused version and retains fixed history without washing eligibility',async()=>{
      await tx(async db=>{
        await withdraw(db,original);const object=item(original,'object'),context=item(reused,'context');
        await assert.rejects(()=>reader.assertReferenceable(db,{entityType:'object',entityId:object.target_id,versionId:object.target_version_ref}),{code:'HANDOFF_REFERENCE_UNAVAILABLE'});
        const history=await reader.readDefinition(db,{entityType:'object',entityId:object.target_id,view:'history',versionId:object.target_version_ref});assert.deepEqual(history.definition,object.payload.definition);assert.equal(history.producer_status,'withdrawn');assert.equal(history.new_reference_allowed,false);
        const current=await reader.readSubject(db,{subjectKind:'context',subjectId:context.target_id,view:'current'});assert.deepEqual(current.payload,context.payload);assert.equal(current.availability,'requires_attention');assert.equal(current.requires_attention,true);assert.equal(current.new_reference_allowed,false);
        const fields=await reader.contextFields(db,{contextId:context.target_id,view:'current'});assert.equal(fields.items.length,2);assert(fields.items.every(f=>!f.new_reference_allowed&&f.requires_attention));
        const rule=item(reused,'rule');assert.equal((await reader.readSubject(db,{subjectKind:'rule',subjectId:rule.target_id,view:'history',versionRef:rule.target_version_ref})).requires_attention,true);
      },false);
    });
    await check('later heads with fully adopted independent content survive withdrawal of ancestry',async()=>{
      independent=await publish(7603,successor(original));
      await tx(async db=>{
        await withdraw(db,original);const object=item(independent,'object');
        const current=await reader.readDefinition(db,{entityType:'object',entityId:object.target_id,view:'current'});assert.equal(current.version_id,object.target_version_ref);assert.equal(current.publication_id,independent.publication_id);assert.equal(current.referenceable,true,json(current.reference_issues));
        assert.equal(current.supersedes_version_id,item(original,'object').target_version_ref);
        const context=item(independent,'context');assert.equal((await reader.readSubject(db,{subjectKind:'context',subjectId:context.target_id,view:'current'})).referenceable,true);
      },false);
    });
    await check('later produced field/context using an old element is displayed but requires attention after its producer is withdrawn',async()=>{
      const body=successor(independent);for(const row of body.items.filter(i=>i.target_kind==='data_element')){const prior=item(original,row.item_ref);row.operation='reuse';row.target_version_ref=prior.target_version_ref;row.target_id=prior.target_id;row.definition=prior.payload.definition;delete row.base_version_ref;}
      dependent=await publish(7604,body);
      await tx(async db=>{
        await withdraw(db,original);const field=item(dependent,'field_a');
        const current=await reader.readDefinition(db,{entityType:'field',entityId:field.target_id,view:'current'});assert.equal(current.version_id,field.target_version_ref);assert.deepEqual(current.definition,field.payload.definition);assert.equal(current.availability,'requires_attention');assert.equal(current.new_reference_allowed,false);assert(current.reference_issues.some(i=>i.subject_kind==='data_element'&&i.code==='HANDOFF_PUBLICATION_WITHDRAWN'));
        await assert.rejects(()=>reader.isVersionReferenceable(db,field.target_version_ref),{code:'HANDOFF_REFERENCE_UNAVAILABLE'});
        const context=item(dependent,'context'),history=await reader.readSubject(db,{subjectKind:'context',subjectId:context.target_id,view:'history',versionRef:context.target_version_ref});assert.deepEqual(history.payload,context.payload);assert.equal(history.requires_attention,true);
      },false);
    });
    await check('a stale active head naming a withdrawn producer returns unavailable rather than falling back',async()=>{
      await tx(async db=>{
        await withdraw(db,original,{clearHeads:false});const object=item(original,'object');
        await db.execute("UPDATE data_map_effective_heads SET effective_version_ref=?,publication_id=?,availability='active' WHERE subject_kind='object' AND subject_id=?",[object.target_version_ref,original.publication_id,object.target_id]);
        const current=await reader.readDefinition(db,{entityType:'object',entityId:object.target_id,view:'current'});assert.equal(current.current,null);assert.equal(current.availability,'withdrawn');assert.equal(current.referenceable,false);
      },false);
    });
    await check('missing governed head never falls back to retained physical or legacy heads',async()=>{
      await tx(async db=>{const object=item(independent,'object');await db.execute("DELETE FROM data_map_effective_heads WHERE subject_kind='object' AND subject_id=?",[object.target_id]);assert.equal((await reader.readDefinition(db,{entityType:'object',entityId:object.target_id,view:'current'})).current,null);assert.equal((await reader.readDefinition(db,{entityType:'object',entityId:'301',view:'current'})).current,null);},false);
    });
    await check('an independent produced field and rule retain their old context dependency instead of rebinding to the latest context',async()=>{
      await tx(async db=>{
        const oldContext=item(original,'context');
        await changeItem(db,dependent,'field_a',row=>{row.payload.context_version_ref=oldContext.target_version_ref;});
        await db.execute('UPDATE data_map_field_element_bindings SET context_version_ref=? WHERE field_version_id=?',[oldContext.target_version_ref,item(dependent,'field_a').target_version_ref]);
        await changeItem(db,dependent,'rule',row=>{row.payload.context_version_ref=oldContext.target_version_ref;});
        await withdraw(db,original);
        const field=item(dependent,'field_a'),fixed=await reader.readDefinition(db,{entityType:'field',entityId:field.target_id,view:'current'});assert.equal(fixed.version_id,field.target_version_ref);assert.equal(fixed.requires_attention,true);assert(fixed.reference_issues.some(i=>i.subject_kind==='context'&&i.version_ref===oldContext.target_version_ref&&i.code==='HANDOFF_PUBLICATION_WITHDRAWN'));
        const rule=item(dependent,'rule'),current=await reader.readSubject(db,{subjectKind:'rule',subjectId:rule.target_id,view:'current'});assert.equal(current.version_ref,rule.target_version_ref);assert.equal(current.payload.context_version_ref,oldContext.target_version_ref);assert.equal(current.new_reference_allowed,false);
      },false);
    });
    await check('a missing dependency producer preserves root history and returns explicit unavailability without inventing eligibility',async()=>{
      await tx(async db=>{
        const elementId=newId(),versionId=newId(),definition={name:'Synthetic orphan',business_meaning:'Actual orphan fixed row, deliberately no producer claim'};
        await db.execute('INSERT INTO data_map_data_elements(element_id,created_at) VALUES(?,UTC_TIMESTAMP(3))',[elementId]);
        await db.execute('INSERT INTO data_map_data_element_versions(element_version_id,element_id,definition_json,content_digest,publication_id,created_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3))',[versionId,elementId,json(definition),digest(definition),original.publication_id]);
        await changeItem(db,independent,'field_a',row=>{row.payload.data_element_version_ref=versionId;});
        await db.execute('UPDATE data_map_field_element_bindings SET element_version_id=? WHERE field_version_id=?',[versionId,item(independent,'field_a').target_version_ref]);
        const field=item(independent,'field_a'),history=await reader.readDefinition(db,{entityType:'field',entityId:field.target_id,view:'history',versionId:field.target_version_ref});assert.deepEqual(history.definition,field.payload.definition);assert.equal(history.new_reference_allowed,false);assert(history.reference_issues.some(i=>i.version_ref===versionId&&i.code==='HANDOFF_PRODUCER_UNAVAILABLE'));
        await assert.rejects(()=>reader.isVersionReferenceable(db,field.target_version_ref),{code:'HANDOFF_REFERENCE_UNAVAILABLE'});
      },false);
    });
    await check('reuse payload cannot claim changed content even after its manifest digest is recomputed',async()=>{
      await tx(async db=>{
        await changeItem(db,reused,'field_a',row=>{row.payload.definition.name='Forged reuse body';});
        const context=item(reused,'context');await assert.rejects(()=>reader.readSubject(db,{subjectKind:'context',subjectId:context.target_id,view:'history',versionRef:context.target_version_ref}),{code:'HANDOFF_PUBLICATION_INTEGRITY_CONFLICT'});
      },false);
    });
    await check('immutable definition and publication hash corruption fail closed',async()=>{
      await tx(async db=>{const object=item(independent,'object');await db.execute("UPDATE data_map_definition_versions SET content_digest=? WHERE version_id=?",['f'.repeat(64),object.target_version_ref]);await assert.rejects(()=>reader.isVersionReferenceable(db,object.target_version_ref),{code:'HANDOFF_VERSION_INTEGRITY_CONFLICT'});},false);
      await tx(async db=>{await db.execute('UPDATE data_map_publications SET manifest_digest=? WHERE publication_id=?',['f'.repeat(64),original.publication_id]);const object=item(original,'object');await assert.rejects(()=>reader.isVersionReferenceable(db,object.target_version_ref),{code:'HANDOFF_PUBLICATION_INTEGRITY_CONFLICT'});},false);
    });
    await check('malformed fixed manifest or payload is an explicit integrity conflict rather than an accidental parser failure',async()=>{
      await tx(async db=>{await db.execute('UPDATE data_map_publications SET manifest_json=?,manifest_digest=? WHERE publication_id=?',[json(null),digest(null),original.publication_id]);const object=item(original,'object');await assert.rejects(()=>reader.isVersionReferenceable(db,object.target_version_ref),{code:'HANDOFF_PUBLICATION_INTEGRITY_CONFLICT'});},false);
      await tx(async db=>{await changeItem(db,independent,'rule',row=>{row.payload=[];});const rule=item(independent,'rule');await assert.rejects(()=>reader.readSubject(db,{subjectKind:'rule',subjectId:rule.target_id,view:'history',versionRef:rule.target_version_ref}),{code:'HANDOFF_PUBLICATION_INTEGRITY_CONFLICT'});},false);
    });
    await check('missing gapped mismatched and restarted publication event chains never grant new reference eligibility',async()=>{
      const object=item(original,'object'),reject=db=>assert.rejects(()=>reader.isVersionReferenceable(db,object.target_version_ref),{code:'HANDOFF_PUBLICATION_INTEGRITY_CONFLICT'});
      await tx(async db=>{await db.execute('DELETE FROM data_map_publication_events WHERE publication_id=?',[original.publication_id]);await reject(db);},false);
      await tx(async db=>{await db.execute('UPDATE data_map_publication_events SET event_no=2 WHERE publication_id=? AND event_no=1',[original.publication_id]);await reject(db);},false);
      for(const field of ['manifest_digest','scope_mode','actor','request_id'])await tx(async db=>{
        const [[event]]=await db.execute('SELECT payload_json FROM data_map_publication_events WHERE publication_id=? AND event_no=1',[original.publication_id]),payload=parse(event.payload_json);
        if(field==='request_id')await db.execute('UPDATE data_map_publication_events SET request_id=? WHERE publication_id=? AND event_no=1',[newId(),original.publication_id]);
        else{payload[field]=field==='actor'?{person_id:'forged'}:field==='scope_mode'?'historical':'f'.repeat(64);await db.execute('UPDATE data_map_publication_events SET payload_json=? WHERE publication_id=? AND event_no=1',[json(payload),original.publication_id]);}
        await reject(db);
      },false);
      await tx(async db=>{
        const [[event]]=await db.execute('SELECT payload_json FROM data_map_publication_events WHERE publication_id=? AND event_no=1',[original.publication_id]);await withdraw(db,original,{clearHeads:false});
        await db.execute("INSERT INTO data_map_publication_events(publication_id,event_no,event_type,payload_json,request_id,created_at) VALUES(?,3,'published',?,?,UTC_TIMESTAMP(3))",[original.publication_id,event.payload_json,newId()]);await reject(db);
      },false);
    });
    await check('duplicate producing claims are rejected instead of selecting one active producer',async()=>{
      await tx(async db=>{
        const row=item(original,'object');await db.execute("INSERT INTO data_map_publication_items(publication_id,item_ref,target_kind,target_id,target_version_ref,operation,produces_version,payload_json,source_detail_versions_json) VALUES(?,'forged_producer','object',?,?,'modify',1,?,?)",[reused.publication_id,row.target_id,row.target_version_ref,json(row.payload),json(row.source_detail_versions)]);
        await assert.rejects(()=>reader.isVersionReferenceable(db,row.target_version_ref),{code:'HANDOFF_PUBLICATION_PRODUCER_AMBIGUOUS'});
      },false);
    });
    await check('an unknown fixed dependency structure retains readable history and denies new references',async()=>{
      await tx(async db=>{
        const changed=await changeItem(db,independent,'element_a',row=>{row.payload.definition.unrecognised_version_ref='missing-future-version';});
        await db.execute('UPDATE data_map_data_element_versions SET definition_json=?,content_digest=? WHERE element_version_id=?',[json(changed.payload.definition),digest(changed.payload.definition),changed.target_version_ref]);
        const object=item(independent,'object'),history=await reader.readDefinition(db,{entityType:'object',entityId:object.target_id,view:'history',versionId:object.target_version_ref});assert.deepEqual(history.definition,object.payload.definition);assert.equal(history.referenceable,false);assert(history.reference_issues.some(i=>i.code==='HANDOFF_DEPENDENCY_STRUCTURE_UNSUPPORTED'));
        await assert.rejects(()=>reader.isVersionReferenceable(db,object.target_version_ref),{code:'HANDOFF_REFERENCE_UNAVAILABLE'});
      },false);
    });
    await check('a missing control marker blocks new references while independently verified fixed definition history remains readable',async()=>{
      await tx(async db=>{
        const object=item(independent,'object');await db.execute('DELETE FROM data_map_governance_control');
        await assert.rejects(()=>reader.readDefinition(db,{entityType:'object',entityId:object.target_id,view:'current'}),{code:'HANDOFF_CONTROL_UNAVAILABLE'});
        await assert.rejects(()=>reader.isVersionReferenceable(db,object.target_version_ref),{code:'HANDOFF_CONTROL_UNAVAILABLE'});
        await assert.rejects(()=>reader.referenceStatus(db,{subjectKind:'object',subjectId:object.target_id,versionRef:object.target_version_ref}),{code:'HANDOFF_CONTROL_UNAVAILABLE'});
        const history=await reader.readDefinition(db,{entityType:'object',entityId:object.target_id,view:'history',versionId:object.target_version_ref});assert.deepEqual(history.definition,object.payload.definition);assert.equal(history.new_reference_allowed,false);
      },false);
    });
    await check('new references reread after withdrawal under the caller control lock rather than trusting a previous result',async()=>{
      const object=item(independent,'object');await tx(db=>reader.assertReferenceable(db,{entityType:'object',entityId:object.target_id,versionId:object.target_version_ref}),false);
      await tx(db=>withdraw(db,independent));
      await tx(async db=>{await assert.rejects(()=>reader.assertReferenceable(db,{entityType:'object',entityId:object.target_id,versionId:object.target_version_ref}),{code:'HANDOFF_REFERENCE_UNAVAILABLE'});const history=await reader.readDefinition(db,{entityType:'object',entityId:object.target_id,view:'history',versionId:object.target_version_ref});assert.deepEqual(history.definition,object.payload.definition);},false);
    });
  },{stage:'76',randomDatabase:true});
}
main().then(()=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:'passed',checks,target:targetRecord,owned_container_removed:true,formal_database_connected:false,business_accepted:false},null,2)+'\n');console.log('WITHDRAWN_REFERENCE_MYSQL_PASS '+checks.length);}).catch(error=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({status:'failed',checks,target:targetRecord,code:error.code,message:error.message,stack:error.stack},null,2)+'\n');console.error(error);process.exitCode=1;});
