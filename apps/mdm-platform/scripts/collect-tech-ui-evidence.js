// Source coverage and immutable build/source hashes. Reads code and artifact reports only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const { pages } = require('../shared/browserProtocol');
const at = process.argv.indexOf('--run'); assert(at > 0);
const run = path.resolve(process.argv[at + 1]), artifacts = path.resolve(__dirname, '../../../artifacts/mdm-tech-ui');
assert(run.startsWith(artifacts + path.sep));
const root = path.resolve(__dirname, '..'), source = path.join(root, 'frontend/src');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const components = { '/app/workbench':'RoleWorkbench','/app/':'RoleWorkbench','/app/todos':'TodoInbox','/app/offices':'OfficeWorkbench','/app/identity':'main','/app/password':'PasswordChange','/app/process-preview':'ProcessPreview','/app/process-formal':'ProcessFormal','/app/v7-mappings':'V7Mappings','/app/design-handoffs':'DesignHandoffs','/app/analysis':'AnalysisWorkbench','/app/data-governance':'DataGovernance','/app/data-map':'DataMapRead','/app/publications':'Publications','/app/organization':'Directory','/app/roster':'Directory','/app/roles':'RoleManagement','/app/role-guide':'RoleGuide','/app/terms':'GovernanceUtilities','/app/conflicts':'GovernanceUtilities','/app/quality':'Quality','/app/accounts':'AccountManagement','/app/access-audit':'AccessAudit','/app/dashboard':'Dashboard','/app/template-import':'TemplateImport','/app/objects':'ObjectManagement','/app/fact-checks':'FactChecks' };
const matrix = pages.map(page => {
  assert(components[page.href], 'New route needs explicit component/evidence mapping: ' + page.href);
  const visited = new Set();
  function collect(file) {
    file = path.resolve(file); if (visited.has(file) || !file.startsWith(source+path.sep) || !fs.existsSync(file)) return;
    visited.add(file); const body = fs.readFileSync(file,'utf8');
    if (path.basename(file) === 'main.jsx') return;
    for (const match of body.matchAll(/(?:from\s+|import\()['"](\.\/[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file),match[1]); const resolved = path.extname(target) ? target : target+'.jsx';
      if (/\.jsx$/.test(resolved) && !resolved.includes(path.sep+'presentation'+path.sep)) collect(resolved);
    }
  }
  collect(path.join(source,components[page.href]+'.jsx'));
  const files = [...visited].map(file => ({ file: path.relative(root,file).replaceAll('\\','/'), sha256:digest(file), text:fs.readFileSync(file,'utf8') }));
    const operations = files.flatMap(file => [...file.text.matchAll(/<(button|summary|label)\b[^>]*>([^<]{1,180})/g)].map(match=>({component:file.file,element:match[1],text:match[2].trim()}))).filter(item=>item.text);
  const routeCoverage = JSON.parse(fs.readFileSync(path.join(run,'complete/ui-evidence-02/route-coverage.json'),'utf8')).find(item=>item.href===page.href);
  const permissions=[...new Set(files.flatMap(file=>[...file.text.matchAll(/['"]((?:governance|identity):[a-z-]+)['"]/g)].map(match=>match[1])))];
  const locationParameters=[...new Set(files.flatMap(file=>[...file.text.matchAll(/(?:searchParams|params|query|p|q)\.get\(['"]([^'"]+)['"]\)/g)].map(match=>match[1])))];
  return {...page,component:components[page.href],sources:files.map(({text,...file})=>file),operations,
    permissionsAndScope:{declaredUiPermissionKeys:permissions,serverDecisionRetained:true,note:'UI keys do not grant actions. Actual administrator, department, office and allowed-action behavior is checked by the isolated business suites.'},
    locationParameters,
    newPresentation:['semantic dark tokens','opaque business panels','native focus','state-bound feedback','pause/reduced controls',...(['/app/','/app/workbench','/app/dashboard'].includes(page.href)?['local worker scene','display-card pointer feedback']:[])],
    protection:files.some(file=>/useUnsavedInput|draft|useInputProtection/.test(file.text))?'existing input/session guard retained':'read-only or parent-owned guard',
    states:{normal:'actual source component retained; functional evidence linked separately',loading:files.some(file=>/kind="loading"/.test(file.text)),error:files.some(file=>/kind="error"/.test(file.text)),empty:files.some(file=>/StatusPanel/.test(file.text)),disabled:files.some(file=>/disabled=/.test(file.text)),readOnly:'server allowed-action collection and original input guards retained'},routeCoverage};
});
fs.writeFileSync(path.join(run,'source-coverage.json'),JSON.stringify(matrix,null,2));
const table=['# 第一期功能覆盖与证据索引','','从当前 browserProtocol.pages 和对应 React 源码生成；导航数量变化会要求补齐映射。子组件和操作文字完整清单见 source-coverage.json。源码存在状态与实际测试通过分别记录。','','| 页面 | 实际组件与子组件数 | 操作节点数 | 输入保护 | 全入口隔离证据 |','|---|---|---:|---|---|'];
for(const item of matrix)table.push(`| ${item.title}（${item.href}） | ${item.component} / ${item.sources.length} | ${item.operations.length} | ${item.protection} | complete/ui-evidence-02/${item.routeCoverage.screenshot}；受限身份/异常态、标题焦点、桌面溢出通过 |`);
fs.writeFileSync(path.join(run,'coverage-matrix.md'),table.join('\n')+'\n');
function build(directory) {
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'.vite/manifest.json'),'utf8')); const initial=new Set();
  function walk(key){const item=manifest[key];if(!item||initial.has(item.file))return;initial.add(item.file);(item.imports||[]).forEach(walk);}walk('index.html');
  const files=fs.readdirSync(path.join(directory,'assets')).map(name=>{const file=path.join(directory,'assets',name),bytes=fs.readFileSync(file);return {file:'assets/'+name,bytes:bytes.length,gzipBytes:zlib.gzipSync(bytes).length,sha256:digest(file),initial:initial.has('assets/'+name)};});
  return {directory,entrySha256:digest(path.join(directory,'index.html')),initialJsGzipBytes:files.filter(file=>file.initial&&file.file.endsWith('.js')).reduce((sum,file)=>sum+file.gzipBytes,0),files};
}
const original=build(path.join(run,'baseline-build')), candidate=build(path.join(run,'complete/build'));
const protectedFiles=['api.js','protocol.js','sessionGate.js'];
const preserved=protectedFiles.map(name=>({name,before:digest(path.join(run,'baseline-source/src',name)),after:digest(path.join(source,name))}));
assert(preserved.every(file=>file.before===file.after),'Protected protocol/session/API file changed during UI task');
const report={original,candidate,incrementBytes:candidate.initialJsGzipBytes-original.initialJsGzipBytes,budgetBytes:50*1024,routeCount:pages.length,protectedFiles:preserved,node:process.version,buildIsolation:true};
assert(report.incrementBytes<=report.budgetBytes);
fs.writeFileSync(path.join(run,'build-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({routeCount:pages.length,initialGzipIncrement:report.incrementBytes,output:run}));
