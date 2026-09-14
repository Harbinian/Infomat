// Repeatable Edge validation on the owned stage05 fixture. Requires installed
// Playwright (local or the existing Playwright CLI runtime) and Microsoft Edge.
// CLI modal interception cannot run the whole reload/close matrix atomically;
// use its installed Playwright library for this explicit browser regression test.
// --keep-open leaves the synthetic review page available until Enter, SIGINT or
// browser closure; the owned application/database are then cleaned up as usual.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const scenario=require('./stage05-browser-scenario');
const evidenceDir=path.resolve(__dirname,'../../../artifacts/mdm-3000-functional',`browser-${Date.now()}`);
function playwrightRuntime() {
  try { return require('playwright'); }
  catch { return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright')); }
}
async function main() {
  await withStage05Fixture(async ({fixture,expect,pool})=>{
    const companion=await expect('contact','/api/process-v7-preview/cases','POST',{document:fixture.document,source_file_name:'synthetic-closed-case.json'},201);
    const binding={expected_revision_no:companion.case.current_revision_no,expected_content_hash:companion.case.current_content_hash};
    const itemId=companion.items[0].id;
    for(const who of ['reviewA','reviewB'])await expect(who,`/api/process-v7-preview/items/${itemId}/decision`,'POST',{...binding,decision:'confirmed',basis:'合成时间沿用验证'},200);
    const original=await expect('contact',`/api/process-v7-preview/cases/${companion.case.id}`,'GET');
    const originalItem=original.items.find(item=>item.id===itemId);
    for(const field of ['origin_decided_at','counterparty_decided_at'])assert.ok(Math.abs(Date.now()-Date.parse(originalItem[field]))<60000);
    const metadataRevision=structuredClone(fixture.document);
    metadataRevision.export_meta.package_ref='package_stage05_timestamp_carry';
    await expect('contact',`/api/process-v7-preview/cases/${companion.case.id}/revisions`,'POST',{...binding,document:metadataRevision,source_file_name:'synthetic-metadata-revision.json'},201);
    const revised=await expect('contact',`/api/process-v7-preview/cases/${companion.case.id}`,'GET');
    const carried=revised.items.find(item=>item.stable_item_key===originalItem.stable_item_key);
    assert.equal(carried.carry_state,'carried_forward');
    for(const field of ['origin_decided_at','counterparty_decided_at'])assert.equal(carried[field],originalItem[field]);
    const [recordedTimes]=await pool.execute('SELECT id, UNIX_TIMESTAMP(origin_decided_at) AS origin_epoch, UNIX_TIMESTAMP(counterparty_decided_at) AS counterparty_epoch FROM process_v7_preview_review_items WHERE id IN (?,?) ORDER BY id',[itemId,carried.id]);
    assert.equal(recordedTimes[0].origin_epoch,recordedTimes[1].origin_epoch);
    assert.equal(recordedTimes[0].counterparty_epoch,recordedTimes[1].counterparty_epoch);
    const connection=await pool.getConnection();
    try {
      const repository=require('../server/processV7PreviewReviewRepository').makeProcessV7PreviewReviewRepository(connection);
      for(const zone of ['+08:00','-05:00']){
        await connection.execute('SET time_zone=?',[zone]);
        assert.equal((await repository.getCase(companion.case.id)).created_at,original.case.created_at);
      }
    }finally{await connection.execute("SET time_zone='+00:00'");connection.release();}
    fs.writeFileSync(path.join(evidenceDir,'review-time-results.json'),JSON.stringify({passed:true,originalItemId:itemId,carriedItemId:carried.id,recordedTimes,sessionTimeZones:['+08:00','-05:00']},null,2));
    // A fully formed synthetic historical case for real case-list navigation.
    // Direct fixture setup changes only this owned temporary database.
    await pool.execute("UPDATE process_v7_preview_cases SET status='closed' WHERE id=?",[companion.case.id]);
    fixture.companionCaseId=companion.case.id;
    fixture.documentFile=path.join(fixture.evidenceDir,'browser-document.json');
    fs.writeFileSync(fixture.documentFile,JSON.stringify(fixture.document,null,2));
    const noCross=JSON.parse(JSON.stringify(fixture.document));
    noCross.behaviors.forEach(item=>{item.current_actor_role='合成甲部经办人';});
    fixture.noCrossFile=path.join(fixture.evidenceDir,'browser-no-cross.json');
    fs.writeFileSync(fixture.noCrossFile,JSON.stringify(noCross,null,2));
    const duringUpload=JSON.parse(JSON.stringify(noCross));
    duringUpload.behaviors[0].completion_standard='合成修订4：准备记录已核对。';
    fixture.duringUploadFile=path.join(fixture.evidenceDir,'browser-during-upload.json');
    fs.writeFileSync(fixture.duringUploadFile,JSON.stringify(duringUpload,null,2));
    const browser=await playwrightRuntime().chromium.launch({channel:'msedge',headless:false});
    const context=await browser.newContext({viewport:{width:1699,height:828}});
    const page=await context.newPage();
    const responses=[];
    page.on('response',r=>{if(r.status()>=400)responses.push({status:r.status(),path:new URL(r.url()).pathname});});
    try {
      const result=await scenario(page,fixture);
      fs.writeFileSync(path.join(fixture.evidenceDir,'browser-results.json'),JSON.stringify({at:new Date().toISOString(),...result,responses,dependency:'real Microsoft Edge / HTTP / owned MySQL; synthetic identities and data; explicitly injected UI failures'},null,2));
      console.log('STAGE05_EDGE_PASS '+result.checks.length);
      if(process.argv.includes('--keep-open')) {
        await page.locator('#logoutBtn').click();
        await page.locator('#employeeNo').fill('SYNTHETIC_lead');
        await page.locator('#password').fill(fixture.loginPassword);
        await page.getByRole('button',{name:'登录',exact:true}).click();
        await page.locator('#appContent').waitFor({state:'visible'});
        const url=fixture.baseURL+'/#/processGovernance?workspace=v7Preview&v7Case='+result.caseId;
        await page.goto(url);
        await page.locator('#pgDownloadV7ProcedureBtn').scrollIntoViewIfNeeded();
        fs.writeFileSync(path.join(evidenceDir,'review-ready.json'),JSON.stringify({url,caseId:result.caseId,syntheticDataOnly:true,sourceFile:fixture.documentFile},null,2));
        console.log('FUNCTIONAL_REVIEW_READY '+url);
        console.log('FUNCTIONAL_REVIEW_EVIDENCE '+evidenceDir);
        await new Promise(resolve=>{
          process.stdin.resume();process.stdin.once('data',resolve);
          process.once('SIGINT',resolve);browser.once('disconnected',resolve);
        });
        process.stdin.pause();
      }
    } catch(error) {
      if(!page.isClosed())await page.screenshot({path:path.join(fixture.evidenceDir,'browser-failure.png'),fullPage:false}).catch(()=>{});
      fs.writeFileSync(path.join(fixture.evidenceDir,'browser-failure.json'),JSON.stringify({message:error.message,responses},null,2));
      throw error;
    } finally {await browser.close();}
  }, {evidenceDir});
  console.log('FUNCTIONAL_BROWSER_EVIDENCE '+evidenceDir);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
