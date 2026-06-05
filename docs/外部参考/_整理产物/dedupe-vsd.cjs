// 多版本 VSD 去重：按 (业务域, 流程编号) 分组，保留最新日期的版本，其余删除
// 用法:
//   node dedupe-vsd.cjs --dry-run   只列出，不删除
//   node dedupe-vsd.cjs             执行删除

const fs = require('fs');
const path = require('path');

const ROOT = 'E:/CA001/Infomat/docs/外部参考';
const DRY_RUN = process.argv.includes('--dry-run');

// 复用 INDEX 生成器的解析器
function parseVsd(relPath) {
  const fileName = path.basename(relPath);
  const parts = relPath.split(/[\\/]/);
  const folder = parts[parts.length - 2] || '';

  let procNo = '', procName = '', owner = '', date = '';

  const fno = folder.match(/^(\d+\.\d+(?:\.\d+){0,2})/);
  if (fno) {
    procNo = fno[1];
    let nameInFolder = folder.replace(/^\d+\.\d+(?:\.\d+){0,2}/, '').trim();
    nameInFolder = nameInFolder.replace(
      /^(流程梳理|信息流图|集成研发业务域L3流程|集成研发业务域L3层流程梳理|集成研发业务域信息流图)[-－\s]+/,
      ''
    );
    const m = nameInFolder.match(/^(.+?)[-－]([^-\－]+?)(\d{2,4})?$/);
    if (m) {
      procName = m[1].trim();
      owner = m[2].trim();
      date = m[3] || '';
    } else if (nameInFolder) {
      procName = nameInFolder;
    }
  } else {
    const stripped = fileName.replace(/\.vsd$/i, '').replace(/^信息流图[-－]+/, '');
    const m2 = stripped.match(/(\d+\.\d+(?:\.\d+){0,2})\s*(.+)$/);
    if (m2) {
      procNo = m2[1];
      procName = m2[2].trim().replace(/\s*\d{8}\s*$/, '').trim();
    }
  }

  // 文件名 8 位日期优先
  const dm8 = fileName.match(/(\d{8})/);
  if (dm8) date = dm8[1];
  // 退化到 4 位 MMDD（视作 2025 年）
  if (!date) {
    const dm4 = fileName.match(/[-_](\d{4})\.vsd$/i);
    if (dm4) date = '2025' + dm4[1];
  }

  return { procNo, procName, owner, date, fileName };
}

// 日期标准化为可比较的整数（YYYYMMDD）
function normDate(d) {
  if (!d) return 0;
  if (d.length === 8) return parseInt(d, 10);
  if (d.length === 4) return 20250000 + parseInt(d, 10);
  return 0;
}

function scanDir(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_整理产物') continue;
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      out.push(...scanDir(full, rel));
    } else if (entry.name.toLowerCase().endsWith('.vsd')) {
      out.push(rel);
    }
  }
  return out;
}

const allVsd = scanDir(ROOT);

// 从文件名推断"类型"（信息流图/流程图/其他）
function detectType(fileName) {
  if (/信息流图/.test(fileName)) return '信息流图';
  if (/流程图/.test(fileName)) return '流程图';
  return '其他';
}

// 分组：(业务域, 流程编号, 类型)
const groups = {};
for (const f of allVsd) {
  const meta = parseVsd(f);
  const type = detectType(meta.fileName);
  if (!meta.procNo) {
    if (!groups.__no_no__) groups.__no_no__ = [];
    groups.__no_no__.push({ f, ...meta, type });
    continue;
  }
  const domain = f.split(/[\\/]/)[0];
  const key = `${domain}/${meta.procNo}/${type}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push({ f, ...meta, type, normDate: normDate(meta.date) });
}

// 排序各组 + 标记保留/删除
let keepCount = 0, delCount = 0;
const plan = [];
for (const [key, items] of Object.entries(groups)) {
  if (key === '__no_no__') continue;
  if (items.length < 2) { keepCount += items.length; continue; }
  // 按日期降序
  items.sort((a, b) => b.normDate - a.normDate);
  // 主版 = 第一个；其余都标记为删除，但如果日期相同则保留
  const main = items[0];
  const dups = items.slice(1).filter(x => x.normDate < main.normDate);
  const sameDate = items.slice(1).filter(x => x.normDate === main.normDate);
  keepCount += 1 + sameDate.length;
  delCount += dups.length;
  plan.push({ key, main, dups, sameDate });
}

console.log(`\n=== 多版本 VSD 去重计划 (${DRY_RUN ? 'DRY-RUN' : '实际执行'}) ===\n`);
console.log(`统计：${allVsd.length} 个 VSD，共 ${Object.keys(groups).filter(k=>k!=='__no_no__').length} 个唯一流程编号`);
console.log(`将保留：${keepCount}，将删除：${delCount}\n`);

if (plan.length === 0) {
  console.log('没有多版本 VSD，无需处理。');
} else {
  for (const { key, main, dups, sameDate } of plan) {
    console.log(`\n## ${key}`);
    console.log(`  保留: ${main.f}  (${main.date || '无日期'})`);
    for (const s of sameDate) {
      console.log(`  保留(同日): ${s.f}  (${s.date || '无日期'})`);
    }
    for (const d of dups) {
      console.log(`  删除: ${d.f}  (${d.date || '无日期'})`);
    }
  }
}

if (groups.__no_no__ && groups.__no_no__.length) {
  console.log(`\n未解析出流程编号的 VSD（${groups.__no_no__.length} 个，保留）：`);
  for (const x of groups.__no_no__) console.log(`  - ${x.f}`);
}

if (DRY_RUN) {
  console.log('\n【DRY-RUN 模式，未删除任何文件】');
  process.exit(0);
}

// 实际删除
console.log('\n--- 开始删除 ---');
let actualDel = 0;
for (const { dups } of plan) {
  for (const d of dups) {
    const full = path.join(ROOT, d.f);
    try {
      fs.unlinkSync(full);
      console.log(`  已删: ${d.f}`);
      actualDel++;
    } catch (e) {
      console.error(`  失败: ${d.f} - ${e.message}`);
    }
  }
}
console.log(`\n实际删除：${actualDel} 个文件`);
