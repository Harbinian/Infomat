// Optional interactive fixture: owned temporary MySQL and synthetic records only.
const path=require('node:path');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
async function main(){
  await withStage05Fixture(async({fixture,expect})=>{
    fixture.document.data_objects=[{data_ref:'data_synthetic',data_name:'合成核对记录',description:'仅用于图形与导入的隔离功能测试',information_type:'business_conclusion',fields:[{field_ref:'field_result',field_name:'核对结果',field_type:'文本',definition:'合成结果'}],behavior_links:[{link_ref:'link_create',behavior_ref:'behavior_prepare',operation:'create'},{link_ref:'link_update',behavior_ref:'behavior_check',operation:'update',updated_field_refs:['field_result']},{link_ref:'link_use',behavior_ref:'behavior_receive',operation:'use'}],source_relations:[],lifecycle:{applicability:'pending_confirmation',entry_state:{business_validity:'pending_confirmation',custody:'pending_confirmation',identifiability_applicability:'pending_confirmation',identifiability:'pending_confirmation'},routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'',decision_notes:''}}];
    await require('./stage05-workbench-scenario')({fixture,expect});
    console.log(JSON.stringify({baseURL:fixture.baseURL,caseId:1,loginName:'SYNTHETIC_lead',fixture:'owned synthetic data with formal V7 version; press Enter to stop'}));
    process.stdin.resume();await new Promise(resolve=>{process.stdin.once('data',resolve);process.once('SIGINT',resolve);});process.stdin.pause();
  },{evidenceDir:path.resolve(__dirname,'../../../artifacts/mdm-3000-rebuild-tests/browser'),processDataGovernanceVersionId:1});
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
