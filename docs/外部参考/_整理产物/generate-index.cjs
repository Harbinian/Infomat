// 扫描 VSD/XLSX/PPTX 全量文件，生成 INDEX.md 索引
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/CA001/Infomat/docs/外部参考';
const OUT = path.join(ROOT, '_整理产物/INDEX.md');

// 从流程清单.json 加载 流程名→编号 反查表
const flowLookup = (() => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, '_整理产物/流程清单.json'), 'utf8'));
    const m = {};
    for (const r of data) {
      if (r['流程编号'] && r['流程名称']) {
        m[r['流程名称'].trim()] = r['流程编号'].trim();
        // 也存 流程名（去尾）变体
        const short = r['流程名称'].replace(/管理$|策划$|编制$|执行$|维护$|检查$|控制$|验证$|改进$/, '').trim();
        if (short && !m[short]) m[short] = r['流程编号'].trim();
      }
    }
    return m;
  } catch (e) { return {}; }
})();

// 解析 VSD 文件名/路径，提取元信息
function parseVsd(relPath) {
  const fileName = path.basename(relPath);
  const parts = relPath.split(/[\\/]/);
  const folder = parts[parts.length - 2] || '';

  let procNo = '', procName = '', owner = '', date = '';

  // 集成研发风格：文件夹名 "12.1.1 产品设计策划-耿璐璐1021" 或 "12.1.5概念定义阶段设计-王健1009"
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
    // 集成制造/市场营销风格：文件名 "信息流图--集成制造业务域-14.7.1工装工具策划.vsd" 或
    //                    "信息流图-项目管理业务域-市场推广与开发-11.1.1 市场推广与开发策划.vsd"
    // 流程编号与流程名都从文件名提取
    const stripped = fileName.replace(/\.vsd$/i, '').replace(/^信息流图[-－]+/, '');
    const m2 = stripped.match(/(\d+\.\d+(?:\.\d+){0,2})\s*(.+)$/);
    if (m2) {
      procNo = m2[1];
      // 去掉尾部的 8 位日期和首尾空白
      procName = m2[2].trim().replace(/\s*\d{8}\s*$/, '').trim();
    } else {
      // 文件名只有流程名没有编号，从 XLSX 数据反查
      procName = stripped.replace(/^集成制造业务域[-－]|^项目管理业务域[-－]|^信息流图[-－]/, '').trim();
      // 去掉"信息流图"前后缀
      procName = procName.replace(/^(市场推广与开发|仓储物流管理|生产计划管理|生产资源保障|制造工艺策划|制造工艺设计|制造质量管理|制造工艺验证与改进|工装工具管理)[-－]?/, '').trim();
      // 反查编号
      if (flowLookup[procName]) procNo = flowLookup[procName];
      // 子串匹配
      if (!procNo) {
        for (const k of Object.keys(flowLookup)) {
          if (k.includes(procName) || procName.includes(k)) {
            procNo = flowLookup[k]; break;
          }
        }
      }
    }
  }

  // 日期补救
  if (!date) {
    const dm = fileName.match(/(\d{8})/);
    if (dm) date = dm[1];
  }

  return { procNo, procName, owner, date, fileName };
}

function scanDir(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_整理产物') continue;
      out.push(...scanDir(full, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

const allFiles = scanDir(ROOT);
const byExt = {};
for (const f of allFiles) {
  const ext = path.extname(f).toLowerCase() || '(无后缀)';
  byExt[ext] = (byExt[ext] || 0) + 1;
}

const vsdFiles = allFiles.filter(f => f.toLowerCase().endsWith('.vsd'));
const xlsxFiles = allFiles.filter(f => f.toLowerCase().endsWith('.xlsx'));
const pptxFiles = allFiles.filter(f => f.toLowerCase().endsWith('.pptx'));

// 业务域分组
function groupByDomain(files) {
  const g = { '集成研发': [], '集成制造': [], '市场营销': [], '培训材料(根目录)': [] };
  for (const f of files) {
    if (f.startsWith('集成研发' + path.sep) || f.startsWith('集成研发/')) g['集成研发'].push(f);
    else if (f.startsWith('集成制造' + path.sep) || f.startsWith('集成制造/')) g['集成制造'].push(f);
    else if (f.startsWith('市场营销' + path.sep) || f.startsWith('市场营销/')) g['市场营销'].push(f);
    else g['培训材料(根目录)'].push(f);
  }
  return g;
}

const vsdByDomain = groupByDomain(vsdFiles);
const xlsxByDomain = groupByDomain(xlsxFiles);

const lines = [];
lines.push('# 外部参考文档索引');
lines.push('');
lines.push(`> 整理日期：2026-06-03  `);
lines.push(`> 根目录：\`docs/外部参考/\`  `);
lines.push(`> 整理产物：\`_整理产物/\`  `);
lines.push(`> 流程抽取数据源：8 个 XLSX 一图三表汇总清单（合并后 1159 行 / 98 个唯一流程）`);
lines.push('');

// 0. 概览
lines.push('## 0. 概览');
lines.push('');
lines.push('| 指标 | 数值 |');
lines.push('|------|------|');
lines.push(`| 文件总数 | ${allFiles.length} |`);
lines.push(`| VSD（Visio 流程图） | ${vsdFiles.length} |`);
lines.push(`| XLSX（一图三表汇总清单） | ${xlsxFiles.length} |`);
lines.push(`| PPTX（培训材料） | ${pptxFiles.length} |`);
lines.push('');
lines.push('### 按业务域分布');
lines.push('');
lines.push('| 业务域 | VSD | XLSX |');
lines.push('|--------|-----|------|');
lines.push(`| 集成研发 | ${vsdByDomain['集成研发'].length} | ${xlsxByDomain['集成研发'].length} |`);
lines.push(`| 集成制造 | ${vsdByDomain['集成制造'].length} | ${xlsxByDomain['集成制造'].length} |`);
lines.push(`| 市场营销 | ${vsdByDomain['市场营销'].length} | ${xlsxByDomain['市场营销'].length} |`);
lines.push(`| 培训材料(根目录) | 0 | 0 |`);
lines.push('');
lines.push('### 抽取数据（来自 XLSX）');
lines.push('');
lines.push('| 指标 | 数值 |');
lines.push('|------|------|');
lines.push('| 数据行数（合并 8 个 XLSX 后） | 1159 |');
lines.push('| 唯一流程数 | 98 |');
lines.push('| 已核查（"OK"）行数 | 724 |');
lines.push('| 待核查（核查结果为空）行数 | 433 |');
lines.push('| 待定（"新程序，表单号未定"） | 2 |');
lines.push('');
lines.push('涉及系统：OA、ERP、用友 U8、CPM、CAPP、MES、PDM、PLM、QMS、WMS、KB、纸质、线下 等');
lines.push('');
lines.push('---');
lines.push('');

// 1. 培训材料（已归位，从 docs/training/ 扫描）
lines.push('## 1. 培训材料（已归位到 docs/training/）');
lines.push('');
lines.push('| 文件名 | 大小 |');
lines.push('|--------|------|');
const trainingDir = path.join(ROOT, '../training');
if (fs.existsSync(trainingDir)) {
  for (const f of fs.readdirSync(trainingDir).filter(n => n.toLowerCase().endsWith('.pptx'))) {
    const stat = fs.statSync(path.join(trainingDir, f));
    lines.push(`| [${f}](../../training/${f}) | ${fmtSize(stat.size)} |`);
  }
}
lines.push('');
lines.push('> 2026-06-03 转移：3 个 PPTX 从 `docs/外部参考/` 根目录移到 `docs/training/`。');
lines.push('');
lines.push('---');
lines.push('');

// 2-4. 业务域
function renderVsdSection(domain, files) {
  if (files.length === 0) return;
  lines.push(`## ${domain}（${files.length} 个 VSD）`);
  lines.push('');

  // 解析
  const parsed = files.map(f => ({ rel: f, ...parseVsd(f) }));

  // 按"部门"分组（集成研发/市场营销没有子部门，集成制造有 5 个）
  const sub = {};
  for (const p of parsed) {
    let k = '';
    if (domain === '集成制造') {
      // 路径第二层是部门：集成制造/<部门>/...
      const parts = p.rel.split(/[\\/]/);
      k = parts[1] || '(根目录)';
    } else {
      k = '(本业务域)';
    }
    (sub[k] = sub[k] || []).push(p);
  }

  for (const [subName, items] of Object.entries(sub)) {
    if (subName !== '(本业务域)') {
      lines.push(`### ${subName}（${items.length} 个 VSD）`);
    } else {
      lines.push(`### 信息流图（${items.length} 个 VSD）`);
    }
    lines.push('');
    lines.push('| 流程编号 | 流程名（路径推断） | 责任人 | 日期 | 文件 |');
    lines.push('|----------|--------------------|--------|------|------|');
    // 按 procNo 排序
    items.sort((a, b) => (a.procNo || 'zzz').localeCompare(b.procNo || 'zzz', 'zh', { numeric: true }));
    for (const p of items) {
      const fpath = '../' + p.rel.replace(/\\/g, '/');
      lines.push(`| ${p.procNo || '?'} | ${p.procName || '?'} | ${p.owner || '?'} | ${p.date || '?'} | [${p.fileName}](${fpath}) |`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
}

renderVsdSection('集成研发', vsdByDomain['集成研发']);
renderVsdSection('集成制造', vsdByDomain['集成制造']);
renderVsdSection('市场营销', vsdByDomain['市场营销']);

// 5. 一图三表汇总清单
lines.push('## XLSX 一图三表汇总清单');
lines.push('');
lines.push('| 业务域 | 文件 | 行数 |');
lines.push('|--------|------|------|');
const rowCounts = {
  '集成研发/一图三表汇总清单 - 集成研发业务域20251030.xlsx': 344,
  '集成制造/集成制造业务域一图三表汇总清单0929.xlsx': 419,
  '集成制造/科技创新部一图三表汇总及信息流图/一图三表汇总清单-科技创新部20250930.xlsx': 211,
  '集成制造/数字工程部一图三表汇总及信息流图/一图三表数字工程部汇总清单0929.xlsx': 37,
  '集成制造/项目管理部一图三表汇总及信息流图/一图三表项目管理部汇总清单0929.xlsx': 27,
  '集成制造/质量安全部一图三表汇总及信息流图/一图三表质量安全部汇总清单.xlsx': 50,
  '集成制造/生产运营部一图三表汇总及信息流图/一图三表生产运营部汇总清单0929.xlsx': 62,
  '市场营销/一图三表汇总清单市场营销业务域20251031.xlsx': 9,
};
for (const [f, c] of Object.entries(rowCounts)) {
  lines.push(`| ${f.split('/')[0]} | [${f}](../${f}) | ${c} |`);
}
lines.push('');
lines.push('合计：1159 行（去重后 98 个唯一流程）');
lines.push('');
lines.push('---');
lines.push('');

// 6. 整理产物
lines.push('## 整理产物');
lines.push('');
lines.push('| 文件 | 用途 |');
lines.push('|------|------|');
lines.push('| [流程清单.csv](流程清单.csv) | 8 个 XLSX 合并后的"一图三表"数据，统一 29 列 schema |');
lines.push('| [流程清单.json](流程清单.json) | 同上的 JSON 格式 |');
lines.push('| [extract-xlsx.cjs](extract-xlsx.cjs) | 抽取脚本（依赖 `apps/mdm-platform/node_modules/exceljs`） |');
lines.push('| [INDEX.md](INDEX.md) | 本文件 |');
lines.push('');
lines.push('### 流程清单字段说明');
lines.push('');
lines.push('| 列 | 含义 |');
lines.push('|----|------|');
lines.push('| 业务域编号 / 业务域 | 集成研发（12）、集成制造（14）、市场营销（11） |');
lines.push('| 流程组编号 / 流程组名称 | 14.1 生产计划管理 / 14.5 制造工艺设计管理 等 |');
lines.push('| 流程编号 / 流程名称 | L3 流程，例 14.5.9 制造物料清单（MBOM）编制 |');
lines.push('| 子流程编号 / 子流程名称 | 集成制造特有，可空 |');
lines.push('| 信息流图名称 | 对应 VSD 文件名 |');
lines.push('| 业务表名称 | 流程的输出表 |');
lines.push('| 是否输出业务项 | 是 / 否 |');
lines.push('| 线上线下输出物名称 | 实际落地形式（末级菜单/表单名） |');
lines.push('| 对比业务表名称 | 与"业务表名称"对比，标记一致/不一致 |');
lines.push('| SAP模块代码 / SAP口令代码 | 集成制造特有 |');
lines.push('| 目前表号 / 新表号 | 表单编号（FM1201-02 等） |');
lines.push('| 权威数据源系统1/2 | 数据最全的源系统 |');
lines.push('| 是否已挂附件 | 上报形式 |');
lines.push('| 系统名称 | CPM / OA / ERP / CAPP 等 |');
lines.push('| 操作 | U（更新）/ C（创建）/ R（其他） |');
lines.push('| 数据分布表编号 / 名称 | 数据分布表中的引用 |');
lines.push('| 表责任部门 | 此表单的责任部门（注意：部分行填了表号而非部门） |');
lines.push('| 问题或建议 / 核查结果 | 来自原 XLSX |');
lines.push('| 来源文件 / 来源部门 | 8 个 XLSX 的原始路径/部门（整理产物附加） |');
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log('已生成：', OUT);
console.log(`VSD=${vsdFiles.length}, XLSX=${xlsxFiles.length}, PPTX=${pptxFiles.length}, 总=${allFiles.length}`);
