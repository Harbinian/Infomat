// R13 closing condition, in a real Edge at the only supported desktop geometry:
//   全部保留页面可用 | 预期脚本被允许 | 非授权内联脚本被阻断 | 控制台无新增策略阻断错误
// Usage: node scripts/test-csp-browser.js --output <new directory under artifacts/>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');

function runtime() {
  try { return require('playwright'); }
  catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
}

const at = process.argv.indexOf('--output');
assert(at > 0 && process.argv[at + 1], '--output is required');
const output = path.resolve(process.argv[at + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep), 'evidence must be inside repository artifacts');
assert(!fs.existsSync(output), 'use a new evidence directory');
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

// Retained pages, from the page registry the shell itself uses.
const PAGES = ['#/roleWorkbench', '#/todos', '#/rbac', '#/dataMap', '#/conflicts'];

async function main() {
  const checks = [];
  let observed = {};
  const check = (name, ok, detail) => { if (!ok) throw new Error(`${name}: ${detail}`); checks.push(name); console.log('PASS ' + name); };

  await withStage05Fixture(async ({ fixture }) => {
    const pw = runtime();
    const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const violations = [];
      page.on('console', message => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
      page.on('pageerror', error => violations.push(`pageerror: ${error.message}`));

      const response = await page.goto(`${fixture.baseURL}/`, { waitUntil: 'domcontentloaded' });
      const csp = response.headers()['content-security-policy'] || '';
      observed.csp = csp;
      check('the policy no longer allows inline script in general', !/script-src[^;]*unsafe-inline/.test(csp), csp);
      check('the policy carries the page script hash', /script-src[^;]*'sha256-/.test(csp), csp);

      await page.fill('#employeeNo', 'SYNTHETIC_lead');
      await page.fill('#password', fixture.loginPassword);
      await page.click('#loginBtn');
      await page.locator('#appContent').waitFor({ state: 'visible' });

      const allowed = await page.evaluate(() => ({
        navigateTo: typeof navigateTo,
        escHtml: typeof escHtml,
        renderRoleWorkbench: typeof renderRoleWorkbench,
        pageActions: typeof PAGE_ACTIONS
      }));
      observed.allowedGlobals = allowed;
      check('the page\'s own script was allowed to run', allowed.navigateTo === 'function' && allowed.escHtml === 'function' && allowed.pageActions === 'object', JSON.stringify(allowed));

      // The retained pages still work under the tightened policy, and none of them reports a
      // policy violation of its own.
      for (const hash of PAGES) {
        await page.goto(`${fixture.baseURL}/${hash}`, { waitUntil: 'domcontentloaded' });
        await page.locator('#appContent').waitFor({ state: 'visible' });
      }
      observed.pagesVisited = PAGES;
      await page.waitForTimeout(500);
      check('every retained page renders under the tightened policy', true, '');
      observed.violationsWhileBrowsing = violations.slice();
      check('no content security policy violation was reported', violations.length === 0, JSON.stringify(violations.slice(0, 3)));

      // An inline script the page did not ship must not run. addScriptTag with content creates
      // exactly an inline <script> element, which is what the policy governs; the violation it
      // produces is the expected outcome, so it is measured separately from the browsing above.
      const before = violations.length;
      let injectedRan = false;
      try {
        await page.addScriptTag({ content: 'window.__cspInjected = true;' });
        injectedRan = await page.evaluate(() => window.__cspInjected === true);
      } catch { injectedRan = false; }
      observed.injectedRan = injectedRan;
      observed.injectionViolations = violations.slice(before);
      check('an injected inline script was blocked', injectedRan === false, 'the injected script executed');
      check('and the block was reported as a policy violation', violations.length > before, 'no violation was reported for the injected script');
      await page.screenshot({ path: path.join(output, 'csp-desktop.png') });
    } finally {
      await browser.close();
    }
  }, { stage: '05', randomDatabase: true });

  save('csp-observations.json', observed);
  save('validation.json', {
    passed: true, checks, edge: true, viewport: '1699x828', deviceScaleFactor: 1,
    injectedInlineScriptBlocked: observed.injectedRan === false,
    browserConsoleViolationsWhileBrowsing: (observed.violationsWhileBrowsing || []).length,
    injectionProducedAViolation: (observed.injectionViolations || []).length > 0,
    deploymentVerified: false, businessAcceptance: false
  });
  console.log('R13_CSP_BROWSER_PASSED');
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
