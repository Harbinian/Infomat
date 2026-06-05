// 抽取 8 个 XLSX 的"一图三表"内容为统一 CSV/JSON
// 用法: node extract-xlsx.cjs
const path = require('path');
const fs = require('fs');
const ExcelJS = require('E:/CA001/Infomat/apps/mdm-platform/node_modules/exceljs');

const ROOT = 'E:/CA001/Infomat/docs/外部参考';
const OUT_DIR = path.join(ROOT, '_整理产物');
fs.mkdirSync(OUT_DIR, { recursive: true });

const XLSX_FILES = [
  { path: '集成研发/一图三表汇总清单 - 集成研发业务域20251030.xlsx', format: 'A', domain: '集成研发', dept: null },
  { path: '集成制造/集成制造业务域一图三表汇总清单0929.xlsx', format: 'B', domain: '集成制造', dept: null },
  { path: '集成制造/科技创新部一图三表汇总及信息流图/一图三表汇总清单-科技创新部20250930.xlsx', format: 'B', domain: '集成制造', dept: '科技创新部' },
  { path: '集成制造/数字工程部一图三表汇总及信息流图/一图三表数字工程部汇总清单0929.xlsx', format: 'B', domain: '集成制造', dept: '数字工程部' },
  { path: '集成制造/项目管理部一图三表汇总及信息流图/一图三表项目管理部汇总清单0929.xlsx', format: 'B', domain: '集成制造', dept: '项目管理部' },
  { path: '集成制造/质量安全部一图三表汇总及信息流图/一图三表质量安全部汇总清单.xlsx', format: 'B', domain: '集成制造', dept: '质量安全部' },
  { path: '集成制造/生产运营部一图三表汇总及信息流图/一图三表生产运营部汇总清单0929.xlsx', format: 'B', domain: '集成制造', dept: '生产运营部' },
  { path: '市场营销/一图三表汇总清单市场营销业务域20251031.xlsx', format: 'A', domain: '市场营销', dept: null },
];

const COLS = [
  '业务域编号','业务域','流程组编号','流程组名称','流程编号','流程名称',
  '子流程编号','子流程名称','信息流图名称','业务表名称',
  '是否输出业务项','线上线下输出物名称','对比业务表名称',
  'SAP模块代码','SAP口令代码','目前表号','新表号',
  '权威数据源系统1','权威数据源系统2','是否已挂附件',
  '系统名称','操作','数据分布表编号','数据分布表名称',
  '表责任部门','问题或建议','核查结果','来源文件','来源部门'
];

function getCellVal(cell) {
  if (cell == null) return '';
  let v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text) return v.text;
    if (v.formula) return v.result != null ? String(v.result) : '';
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v).trim();
}

async function extractOne(file, fmt, domain, dept) {
  const fp = path.join(ROOT, file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const sh = wb.worksheets[0];
  const dataStartRow = 6;
  const rows = [];
  for (let r = dataStartRow; r <= sh.rowCount; r++) {
    const row = sh.getRow(r);
    if (row.hasValues === false) continue;
    const cells = [];
    for (let c = 1; c <= 30; c++) cells.push(getCellVal(row.getCell(c)));
    if (cells.every(c => !c)) continue;
    rows.push(cells);
  }
  return rows.map(cells => {
    let rec;
    if (fmt === 'A') {
      rec = new Array(30).fill('');
      rec[0] = '';
      rec[1] = cells[0] || domain;
      rec[2] = '';
      rec[3] = '';
      rec[4] = cells[1];
      rec[5] = cells[2];
      rec[6] = '';
      rec[7] = '';
      rec[8] = cells[3];
      rec[9] = cells[4];
      rec[10] = cells[5];
      rec[11] = cells[6];
      rec[12] = (cells[6] && cells[4] && cells[6] === cells[4]) ? '一致' : (cells[6] && cells[4] ? '不一致' : '');
      rec[13] = '';
      rec[14] = '';
      rec[15] = cells[7];
      rec[16] = cells[8];
      rec[17] = cells[9];
      rec[18] = '';
      rec[19] = '';
      rec[20] = cells[10];
      rec[21] = cells[11];
      rec[22] = cells[12];
      rec[23] = cells[13];
      rec[24] = cells[14];
      rec[25] = '';
      rec[26] = '';
    } else {
      // B 格式列重排：cells[8],cells[9] 是重复的 流程编号/名称，需跳过
      rec = new Array(30).fill('');
      rec[0]  = cells[0];  // 业务域编号
      rec[1]  = cells[1];  // 业务域
      rec[2]  = cells[2];  // 流程组编号
      rec[3]  = cells[3];  // 流程组名称
      rec[4]  = cells[4];  // 流程编号（顶层）
      rec[5]  = cells[5];  // 流程名称（顶层）
      rec[6]  = cells[6];  // 子流程编号
      rec[7]  = cells[7];  // 子流程名称
      rec[8]  = cells[10]; // 信息流图名称
      rec[9]  = cells[11]; // 业务表名称
      rec[10] = cells[12]; // 是否输出业务项
      rec[11] = cells[13]; // 线上线下输出物名称
      rec[12] = cells[14]; // 对比
      rec[13] = cells[15]; // SAP模块代码
      rec[14] = cells[16]; // SAP口令代码
      rec[15] = cells[17]; // 目前表号
      rec[16] = cells[18]; // 新表号
      rec[17] = cells[19]; // 权威数据源系统1
      rec[18] = cells[20]; // 权威数据源系统2
      rec[19] = cells[21]; // 是否已挂附件
      rec[20] = cells[22]; // 系统名称
      rec[21] = cells[23]; // 操作
      rec[22] = cells[24]; // 数据分布表编号
      rec[23] = cells[25]; // 数据分布表名称
      rec[24] = cells[26]; // 表责任部门
      rec[25] = cells[27]; // 问题或建议
      rec[26] = cells[28]; // 核查结果
    }
    rec[27] = file;
    rec[28] = dept || '';
    return rec;
  });
}

function csvEscape(s) {
  if (s == null) return '';
  s = String(s);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  const all = [];
  for (const f of XLSX_FILES) {
    const rows = await extractOne(f.path, f.format, f.domain, f.dept);
    console.log(`  ${f.path}: ${rows.length} 行`);
    all.push(...rows);
  }
  console.log(`合计: ${all.length} 行`);

  const csvHeader = COLS.join(',');
  const csvBody = all.map(r => r.map(csvEscape).join(',')).join('\n');
  const csv = '﻿' + csvHeader + '\n' + csvBody;
  fs.writeFileSync(path.join(OUT_DIR, '流程清单.csv'), csv, 'utf8');

  const jsonData = all.map(r => {
    const o = {};
    COLS.forEach((c, i) => o[c] = r[i]);
    return o;
  });
  fs.writeFileSync(path.join(OUT_DIR, '流程清单.json'), JSON.stringify(jsonData, null, 2), 'utf8');

  const byDomain = {};
  for (const r of all) {
    const d = r[1] || '(空)';
    byDomain[d] = (byDomain[d] || 0) + 1;
  }
  console.log('按业务域:');
  for (const [k, v] of Object.entries(byDomain)) console.log(`  ${k}: ${v}`);

  const byGroup = {};
  for (const r of all) {
    const g = r[3] || '(未分组)';
    byGroup[g] = (byGroup[g] || 0) + 1;
  }
  console.log('按流程组:');
  for (const [k, v] of Object.entries(byGroup).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);

  const procSet = new Set();
  for (const r of all) {
    if (r[4]) procSet.add(`${r[1]}/${r[4]}`);
  }
  console.log(`唯一流程数: ${procSet.size}`);

  const byDept = {};
  for (const r of all) {
    const d = r[24] || '(空)';
    byDept[d] = (byDept[d] || 0) + 1;
  }
  console.log('按责任部门:');
  for (const [k, v] of Object.entries(byDept).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);

  const bySys = {};
  for (const r of all) {
    const s = r[20] || '(空)';
    bySys[s] = (bySys[s] || 0) + 1;
  }
  console.log('按系统:');
  for (const [k, v] of Object.entries(bySys).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);

  const checkStats = {};
  for (const r of all) {
    const s = r[26] || '(空)';
    checkStats[s] = (checkStats[s] || 0) + 1;
  }
  console.log('核查结果统计:');
  for (const [k, v] of Object.entries(checkStats).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);
}

main().catch(e => { console.error(e); process.exit(1); });
