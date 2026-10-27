// Worker failure, rendering fallback and local 30s estimates. No database or business writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), express = require('express');
const { frontendRouter, publicEntryRouter } = require('../server/frontend');
const { securityHeaders } = require('../server/security');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(arg('--output') || ''), dist = path.resolve(arg('--dist') || ''), baseline = path.resolve(arg('--baseline') || '');
const artifacts = path.resolve(__dirname, '../../../artifacts');
assert(process.argv.includes('--output') && process.argv.includes('--dist') && process.argv.includes('--baseline'));
assert([output, dist, baseline].every(value => value.startsWith(artifacts + path.sep)) && !fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const percentile = values => values.length ? [...values].sort((a,b) => a-b)[Math.ceil(values.length * .95)-1] : null;
async function main() {
  const app = express(); app.use(securityHeaders); app.use('/baseline/app', frontendRouter(baseline)); app.use('/app', frontendRouter(dist)); app.use(publicEntryRouter());
  const server = await new Promise(resolve => { const handle = app.listen(0, '127.0.0.1', () => resolve(handle)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
  const checks = [], samples = [];
  const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
  async function makePage(extra) {
    const context = await browser.newContext({ viewport: {width:1699,height:828}, deviceScaleFactor:1 }); const page = await context.newPage();
    if (extra) await extra(page);
    await page.route('**/api/**', route => {
      const endpoint = new URL(route.request().url()).pathname;
      return route.fulfill({ status: endpoint === '/api/org/login' ? 401 : 200, json: endpoint === '/api/org/session' ? { authenticated:false } : endpoint === '/api/csrf-token' ? { csrfToken:'synthetic-token' } : { error:'synthetic denied' } });
    });
    return { context, page };
  }
  try {
    for (const scenario of ['worker-unavailable', 'wasm-unavailable', 'offscreen-unavailable']) {
      const {context,page} = await makePage(async page => {
        if (scenario === 'worker-unavailable') await page.route('**/app/assets/*worker*.js', route => route.fulfill({status:503,body:'synthetic unavailable'}));
        if (scenario === 'wasm-unavailable') await page.route('**/*.wasm', route => route.fulfill({status:503,body:'synthetic unavailable'}));
        if (scenario === 'offscreen-unavailable') await page.addInitScript(() => { HTMLCanvasElement.prototype.transferControlToOffscreen = undefined; });
      });
      await page.goto(base + '/app/'); await page.locator('#login-name').fill('SYNTHETIC_FALLBACK'); await page.locator('#login-password').fill('synthetic-password'); await page.getByRole('button',{name:'登录',exact:true}).click();
      await page.getByRole('alert').waitFor(); await page.waitForTimeout(6600);
      assert.equal(await page.locator('#login-password').inputValue(),'synthetic-password'); assert.equal(await page.getByRole('button',{name:'登录',exact:true}).isEnabled(),true);
      assert((await page.getByRole('alert').textContent()).includes('工号或密码不正确'));
      await page.getByText('显示诊断',{exact:true}).click(); await page.getByRole('button',{name:'更新诊断'}).click();
      const diagnostic = JSON.parse(await page.locator('.presentation-diagnostics pre').textContent()); assert(diagnostic.events.some(event => event.type === 'fallback'));
      save(scenario + '.json', diagnostic); await page.screenshot({path:path.join(output,scenario+'.png'),mask:[page.locator('input[type=password]')]});
      await context.close(); checks.push(scenario + ': static decoration and original login error/input remain usable');
    }
    // Baseline asset routing is replaced only inside this synthetic browser context.
    for (const variant of ['baseline', 'candidate']) {
      const {context,page} = await makePage();
      if (variant === 'baseline') await page.route('**/app/assets/**', async route => { const asset=path.basename(new URL(route.request().url()).pathname); const file=path.join(baseline,'assets',asset); await route.fulfill({status:200,body:fs.readFileSync(file),contentType:asset.endsWith('.css')?'text/css':'application/javascript'}); });
      if (variant === 'baseline') await page.route('**/app/', route => route.fulfill({status:200,body:fs.readFileSync(path.join(baseline,'index.html')),contentType:'text/html'}));
      const cdp = await context.newCDPSession(page), trace=[]; cdp.on('Tracing.dataCollected', data=>trace.push(...data.value));
      await page.goto(base + '/app/'); await page.locator('#login-name').waitFor(); await page.waitForTimeout(5000);
      await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',options:'record-as-much-as-possible'});
      await page.evaluate(() => { window.uiFrameSample={intervals:[],previous:null,visible:!document.hidden}; function tick(now){const data=window.uiFrameSample;if(data.previous!==null)data.intervals.push(now-data.previous);data.previous=now;data.frame=requestAnimationFrame(tick);} window.uiFrameSample.frame=requestAnimationFrame(tick); });
      await page.waitForTimeout(30000);
      const frame = await page.evaluate(()=>{cancelAnimationFrame(window.uiFrameSample.frame); return {intervals:window.uiFrameSample.intervals,visible:window.uiFrameSample.visible};});
      const traceEnded = new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve)); await cdp.send('Tracing.end'); await traceEnded;
      const durations=frame.intervals; const sample={variant,visible:frame.visible,samples:durations.length,estimatedFps:1000/(durations.reduce((a,b)=>a+b,0)/durations.length),intervalP95:percentile(durations),gpuPresentationVerified:false,inp:null};
      if (variant==='candidate') { await page.getByText('显示诊断',{exact:true}).click(); await page.getByRole('button',{name:'更新诊断'}).click(); sample.diagnostics=JSON.parse(await page.locator('.presentation-diagnostics pre').textContent()); }
      samples.push(sample); save(variant+'-trace.json',{traceEvents:trace}); await page.screenshot({path:path.join(output,variant+'-performance.png')}); await context.close();
    }
    checks.push('same login scenario: original and candidate optimized builds, 5s warmup plus 30s foreground scheduling samples and browser timelines');
    save('results.json',{passed:true,checks,samples,dist,baseline,browser:browser.version(),headless:true,cpu:os.cpus()[0].model,memoryBytes:os.totalmem(),specifiedOfficeHardwareVerified:false,manualImeVerified:false,businessAccepted:false,inp:null,inpReason:'no reliable page-wide aggregation; raw Event Timing is diagnostic only'});
    console.log(JSON.stringify({passed:true,checks:checks.length,output}));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,stack:error.stack},null,2));console.error(error.message);process.exitCode=1;});
