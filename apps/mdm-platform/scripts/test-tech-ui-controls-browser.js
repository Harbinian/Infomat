const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),express=require('express');
const {frontendRouter,publicEntryRouter}=require('../server/frontend'); const {securityHeaders}=require('../server/security');
const arg=name=>process.argv[process.argv.indexOf(name)+1]; const output=path.resolve(arg('--output')||''),dist=path.resolve(arg('--dist')||'');
const artifacts=path.resolve(__dirname,'../../../artifacts');assert(process.argv.includes('--output')&&process.argv.includes('--dist')&&[output,dist].every(v=>v.startsWith(artifacts+path.sep))&&!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
async function main(){
 const app=express();app.use(securityHeaders);app.use('/app',frontendRouter(dist));app.use(publicEntryRouter());
 const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});const base='http://127.0.0.1:'+server.address().port;
 const browser=await runtime().chromium.launch({channel:'msedge',headless:true});const checks=[];
 try{
  for(const scenario of ['context-loss','automatic-downgrade']){
   const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1}),page=await context.newPage(); let sceneWorker,patch;
   page.on('worker',worker=>{if(/scene\.worker-/.test(worker.url()))sceneWorker=worker;});
   if(scenario==='context-loss'){
    const cdp=await context.newCDPSession(page);
    cdp.on('Target.attachedToTarget',async target=>{
     const expression="const originalContext=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(type,...args){const context=originalContext.call(this,type,...args);if(String(type).includes('webgl'))self.__techTestContext=context;return context;};";
     await cdp.send('Target.sendMessageToTarget',{sessionId:target.sessionId,message:JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression}})});
     await cdp.send('Target.sendMessageToTarget',{sessionId:target.sessionId,message:JSON.stringify({id:2,method:'Runtime.runIfWaitingForDebugger',params:{}})});
    });
    await cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:false,filter:[{type:'worker',exclude:false}]});
   }
   if(scenario==='automatic-downgrade')await page.addInitScript(()=>{const nativeRequest=requestAnimationFrame.bind(window),nativeCancel=cancelAnimationFrame.bind(window),pending=new Map();window.requestAnimationFrame=callback=>{const id=nativeRequest(()=>{const timer=setTimeout(()=>{pending.delete(id);callback(performance.now());},24);pending.set(id,timer);});return id;};window.cancelAnimationFrame=id=>{nativeCancel(id);clearTimeout(pending.get(id));pending.delete(id);};});
   await page.route('**/api/**',route=>route.fulfill({status:200,json:{authenticated:false}}));await page.goto(base+'/app/');await page.locator('#login-name').fill('SYNTHETIC_CONTROLS');
   await page.locator('[data-scene-host][data-ready=true]').waitFor();
   if(scenario==='context-loss'){
    await patch;const lost=await sceneWorker.evaluate(()=>{const extension=self.__techTestContext?.getExtension('WEBGL_lose_context');if(!extension)return false;extension.loseContext();return true;});assert(lost,'actual WebGL loss extension must be available and captured');
    await page.waitForFunction(()=>!document.querySelector('[data-scene-host]'));checks.push('actual Worker WebGL context loss disposes scene and keeps static fallback/input');
   }else{
    await page.getByRole('combobox',{name:'显示效果'}).selectOption('enhanced');
    await page.waitForFunction(()=>document.documentElement.dataset.presentation==='basic',null,{timeout:20000});
    assert.equal(await page.locator('[data-scene-host]').count(),0);checks.push('delayed-rAF simulation: two visible slow windows lower enhanced to standard and then basic; no auto promotion');
   }
   assert.equal(await page.locator('#login-name').inputValue(),'SYNTHETIC_CONTROLS');await page.getByText('显示诊断',{exact:true}).click();await page.getByRole('button',{name:'更新诊断'}).click();const diagnostic=JSON.parse(await page.locator('.presentation-diagnostics pre').textContent());
   if(scenario==='context-loss')assert(diagnostic.events.some(event=>event.reason==='webgl-context-lost'));
   else assert(diagnostic.events.filter(event=>event.type==='downgrade').length>=2);
   fs.writeFileSync(path.join(output,scenario+'.json'),JSON.stringify(diagnostic,null,2));await page.screenshot({path:path.join(output,scenario+'.png')});await context.close();
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,viewport:{width:1699,height:828},browser:browser.version(),downgradeLoadSimulated:true,specifiedOfficeHardwareVerified:false},null,2));console.log(JSON.stringify({passed:true,output}));
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,stack:error.stack},null,2));console.error(error.message);process.exitCode=1;});
