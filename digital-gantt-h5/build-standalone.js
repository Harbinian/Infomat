// 用法: node build-standalone.js
// 读取 tasks.json，生成内嵌数据的 index-standalone.html（可直接双击打开）

const fs = require('fs');
const path = require('path');

const tasks = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'tasks.json'), 'utf-8'));
const html = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');

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

let result = html.replace(oldLoadData, newLoadData);
result = result.replace(scriptOpen, embeddedData);

fs.writeFileSync(path.resolve(__dirname, 'index-standalone.html'), result, 'utf-8');
console.log(`Generated index-standalone.html (${(result.length / 1024).toFixed(0)} KB, ${tasks.length} tasks embedded)`);
