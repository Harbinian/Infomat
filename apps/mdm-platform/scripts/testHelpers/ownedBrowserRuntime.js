// Optional test preload. Only browsers created by this runner receive bounded shutdown.
const fs = require('node:fs');
const path = require('node:path');
let runtime;
try { runtime = require('playwright'); } catch { runtime = require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
const launchServer = runtime.chromium.launchServer.bind(runtime.chromium);
let index = 0;
runtime.chromium.launch = async options => {
  const server = await launchServer(options);
  const browser = await runtime.chromium.connect(server.wsEndpoint());
  const at = process.argv.indexOf('--output');
  if (at > 0) {
    const output = path.resolve(process.argv[at + 1]);
    if (output.startsWith(path.resolve(__dirname, '../../../../artifacts') + path.sep)) {
      fs.writeFileSync(path.join(output, `browser-owner-${++index}.json`), JSON.stringify({ runnerPid: process.pid, browserPid: server.process().pid, owned: true }));
    }
  }
  const close = browser.close.bind(browser);
  browser.close = async () => {
    let timer;
    try { await Promise.race([close(), new Promise(resolve => { timer = setTimeout(resolve, 8000); })]); }
    finally { clearTimeout(timer); await server.kill().catch(() => {}); }
  };
  return browser;
};
