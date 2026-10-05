// Historical standalone exporter. The former pmo/index.html was retired.
// Usage: node pmo/build-standalone.js --input <HTML> --tasks <JSON> --out <HTML>

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--input', '--tasks', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) {
    throw new Error('Specify --input <historical HTML> --tasks <JSON> --out <HTML>; no default input or output is retained.');
  }
  options[args[i]] = path.resolve(args[i + 1]);
}
if (!options['--input'] || !options['--tasks'] || !options['--out']) {
  throw new Error('The default standalone template was retired. Specify --input <historical HTML> --tasks <JSON> --out <HTML>.');
}
function sameFile(left, right) {
  if (left.toLowerCase() === right.toLowerCase()) return true;
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  const a = fs.statSync(left), b = fs.statSync(right);
  return fs.realpathSync(left).toLowerCase() === fs.realpathSync(right).toLowerCase() || (a.dev === b.dev && a.ino === b.ino);
}
if ([options['--input'], options['--tasks']].some(input => sameFile(input, options['--out']))) {
  throw new Error('Output must not replace either input.');
}
const tasks = JSON.parse(fs.readFileSync(options['--tasks'], 'utf-8'));
if (!Array.isArray(tasks)) throw new Error('Task input must be a JSON array.');
const html = fs.readFileSync(options['--input'], 'utf-8');

// 替换 loadData: fetch → 内嵌数据
const oldLoadData = /async function loadData\(\) \{[\s\S]*?^}/m;
const newLoadData = `async function loadData() {
  allTasks = EMBEDDED_TASKS;
  treeData = buildTaskTree(allTasks);
  filteredTasks = [...allTasks];
  document.getElementById('loading').style.display = 'none';
  return true;
}`;

// 在 <script> 开头插入内嵌数据
const scriptOpen = '<script>';
const embeddedData = `<script>\nconst EMBEDDED_TASKS = ${JSON.stringify(tasks)};\n`;

if ((html.match(new RegExp(oldLoadData.source, 'gm')) || []).length !== 1 || !html.includes(scriptOpen)) {
  throw new Error('Historical HTML must contain exactly one supported loadData function and an inline script; output was not written.');
}

let result = html.replace(oldLoadData, newLoadData);
result = result.replace(scriptOpen, embeddedData);

fs.mkdirSync(path.dirname(options['--out']), { recursive: true });
fs.writeFileSync(options['--out'], result, 'utf-8');
console.log(`Generated ${options['--out']} (${(result.length / 1024).toFixed(0)} KB, ${tasks.length} tasks embedded)`);
