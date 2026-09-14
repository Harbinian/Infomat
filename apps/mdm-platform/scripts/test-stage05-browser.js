// Repeatable Edge validation on the owned stage05 fixture. Requires installed
// Playwright (local or the existing Playwright CLI runtime) and Microsoft Edge.
// CLI modal interception cannot run the whole reload/close matrix atomically;
// use its installed Playwright library for this explicit browser regression test.
const fs=require('node:fs');
const path=require('node:path');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const scenario=require('./stage05-browser-scenario');
function playwrightRuntime() {
  try { return require('playwright'); }
  catch { return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright')); }
}
async function main() {
  await withStage05Fixture(async ({fixture,expect,pool})=>{
    const companion=await expect('contact','/api/process-v7-preview/cases','POST',{document:fixture.document,source_file_name:'synthetic-closed-case.json'},201);
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
    } catch(error) {
      if(!page.isClosed())await page.screenshot({path:path.join(fixture.evidenceDir,'browser-failure.png'),fullPage:false}).catch(()=>{});
      fs.writeFileSync(path.join(fixture.evidenceDir,'browser-failure.json'),JSON.stringify({message:error.message,responses},null,2));
      throw error;
    } finally {await browser.close();}
  });
}
main().catch(error=>{console.error(error);process.exitCode=1;});
