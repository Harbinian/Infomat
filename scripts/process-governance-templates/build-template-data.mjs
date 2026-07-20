/**
 * Build the normalized data package used by the department process-governance
 * workbooks and the common Word guide.
 *
 * Inputs (read-only):
 *   - docs/company-sankey-data.json
 *   - docs/norms/{department}部门-能力-流程-系统映射关系.md
 *
 * Output:
 *   - one JSON file under the caller-provided working/output directory
 *
 * This script never writes docs/norms, the Sankey snapshot, PMO assets, or a
 * database. It preserves source wording and marks unresolved evidence instead
 * of inventing a regulation title.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'docs', 'company-sankey-data.json');

const DEPARTMENTS = [
  { name: '财务部', code: 'FIN' },
  { name: '复材车间', code: 'CMP' },
  { name: '工程技术部', code: 'ENG' },
  { name: '经营发展部', code: 'BDV' },
  { name: '物资保障部', code: 'MAT' },
  { name: '项目管理部', code: 'PMO' },
  { name: '行政人事部', code: 'AHR' },
  { name: '运维安环部', code: 'EHS' },
  { name: '质量管理部', code: 'QMS' },
];

const PLACEHOLDER_RE = /^(?:[-—–/]+|无|暂无|待补|待确认|未明确|未提供|不适用|旧模板未采集，待补)$/i;
const INFERENCE_RE = /(上下文推断|分析拆分|同上|继承所属流程)/;

function parseArgs(argv) {
  const args = { out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') args.out = resolve(argv[index + 1] || '');
  }
  if (!args.out) throw new Error('Usage: node build-template-data.mjs --out <template-data.json>');
  return args;
}

function cleanCell(value) {
  return String(value ?? '')
    .replace(/\*\*/g, '')
    .replace(/<br\s*\/?\s*>/gi, '；')
    .replace(/[🔴🟡🟢⚠✓△]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function useful(value) {
  const text = cleanCell(value);
  return Boolean(text && !PLACEHOLDER_RE.test(text));
}

function unique(values) {
  return [...new Set(values.map(cleanCell).filter(Boolean))];
}

function uniqueTitles(values) {
  const byNormalizedTitle = new Map();
  for (const value of values) {
    const title = cleanCell(value);
    const key = normalizeTitle(title);
    if (key && !byNormalizedTitle.has(key)) byNormalizedTitle.set(key, title);
  }
  return [...byNormalizedTitle.values()];
}

function splitMarkdownRow(line) {
  const cells = String(line || '').trim().split('|');
  if (cells[0]?.trim() === '') cells.shift();
  if (cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map(cleanCell);
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function looksLikeA1Header(cells) {
  const joined = cells.join('|');
  return (joined.includes('业务行为（A1）编号') || joined.includes('A1编号'))
    && (joined.includes('业务行为（A1）') || joined.includes('行为名称'))
    && (joined.includes('应用系统') || joined.includes('S1'));
}

function extractL3FromHeading(line) {
  const trimmed = String(line || '').trim();
  if (!/^#{3,6}\s+/.test(trimmed)) return '';
  let title = trimmed.replace(/^#+\s*/, '').trim();
  if (!/(业务流程（L3）|L3-|^[A-Z]{1,6}-\d{2}-\d{2}|^\d{4}\s)/.test(title)) return '';
  title = title
    .replace(/^业务流程（L3）[-—\s]*/, '')
    .replace(/^[A-Z]{1,6}-L3-\d+\s+/, '')
    .replace(/^[A-Z]{1,6}-\d{2}-\d{2}\s+/, '')
    .replace(/^L3-\d+\s+/, '')
    .replace(/^\d{4}\s+/, '')
    .trim();
  return title;
}

function extractL2FromHeading(line) {
  const trimmed = String(line || '').trim();
  if (!/^#{3,6}\s+L2-\d+\s+/.test(trimmed)) return '';
  return trimmed.replace(/^#+\s*/, '').replace(/^L2-\d+\s+/, '').trim();
}

function normalizeProcessName(value) {
  return String(value || '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/[【】\[\]《》"“”'‘’`*]/g, '')
    .replace(/[：:，,、；;\s]/g, '')
    .replace(/管理$/g, '')
    .trim();
}

function processNameScore(leftValue, rightValue) {
  const left = normalizeProcessName(leftValue);
  const right = normalizeProcessName(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1000;
  if (right.startsWith(left) || left.startsWith(right)) return 900 + Math.min(left.length, right.length);
  if (right.includes(left) || left.includes(right)) return 800 + Math.min(left.length, right.length);
  const chars = new Set([...left]);
  let common = 0;
  for (const char of chars) if (right.includes(char)) common += 1;
  return common / Math.max(left.length, right.length);
}

function resolveA1Process(a1, processes) {
  const candidates = processes.filter(item => item.dept === a1.dept);
  const exact = candidates.find(item => item.l3 === a1.l3Heading);
  if (exact) return exact;
  const byL2Heading = candidates.filter(item => normalizeProcessName(item.l2) === normalizeProcessName(a1.l3Heading));
  if (byL2Heading.length === 1) return byL2Heading[0];
  const scored = candidates
    .map(process => ({ process, score: processNameScore(a1.l3Heading, process.l3) }))
    .sort((a, b) => b.score - a.score);
  if (scored[0]?.score >= 800 || (scored[0]?.score >= 0.55 && scored[0].score > (scored[1]?.score ?? 0) + 0.08)) {
    return scored[0].process;
  }
  if (a1.l2Heading) {
    const byL2 = candidates.filter(item => normalizeProcessName(item.l2) === normalizeProcessName(a1.l2Heading));
    if (byL2.length === 1) return byL2[0];
  }
  return null;
}

function parseA1Rows(text, dept) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex(line => line.trim().startsWith('## 业务行为（A1）'));
  if (start < 0) return [];

  const results = [];
  let currentL3 = '';
  let currentL2 = '';
  let headers = [];
  let inTable = false;

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (index > start && line.startsWith('## ') && !line.includes('业务行为') && !line.startsWith('###')) break;
    const l3 = extractL3FromHeading(line);
    if (l3) {
      currentL3 = l3;
      headers = [];
      inTable = false;
      continue;
    }
    const l2 = extractL2FromHeading(line);
    if (l2) currentL2 = l2;

    if (currentL3 && line.startsWith('|')) {
      const cells = splitMarkdownRow(line);
      if (looksLikeA1Header(cells)) {
        headers = cells;
        inTable = true;
        continue;
      }
      if (inTable && isSeparator(cells)) continue;
      if (inTable && headers.length > 0) {
        if (cells[0] === '合计' || cells[0] === '统计' || cells.join('|') === headers.join('|')) continue;
        const raw = {};
        headers.forEach((header, column) => { raw[header] = cells[column] || ''; });
        const code = valueByAliases(raw, ['业务行为（A1）编号', 'A1编号']);
        const name = valueByAliases(raw, ['业务行为（A1）', '行为名称']);
        if (name && name.length > 1) results.push({ dept, l3Heading: currentL3, l2Heading: currentL2, code, name, raw });
      }
    }
    if (inTable && line && !line.startsWith('|')) inTable = false;
  }
  return results;
}

function valueByAliases(raw, aliases) {
  for (const alias of aliases) {
    if (Object.hasOwn(raw, alias)) return cleanCell(raw[alias]);
  }
  for (const [header, value] of Object.entries(raw)) {
    if (aliases.some(alias => header.includes(alias))) return cleanCell(value);
  }
  return '';
}

function normalizeDocCode(value) {
  const cleaned = cleanCell(value).toUpperCase();
  if (!cleaned || cleaned === '待分配编号') return '';
  return cleaned.replace(/[^A-Z0-9]/g, '');
}

function normalizeTitle(value) {
  return cleanCell(value)
    .replace(/[《》]/g, '')
    .replace(/\.(?:DOCX?|PDF|XLSX?|MD)$/i, '')
    .replace(/["“”'‘’]/g, '')
    .replace(/[\s_\-—–·（）()【】\[\]，,、；;：:]/g, '')
    .toLowerCase();
}

function extractCode(value) {
  const text = cleanCell(value);
  const known = text.match(/(?:GLTX-[A-Z]{1,5}-\d{2}(?:-[A-Z0-9]+)?|GL[BCG]\d{4,}|SYCX(?:QMS)?-[A-Z0-9/-]+|FM[-_ ]?[A-Z0-9.-]+|待分配编号)/i);
  if (known) return cleanCell(known[0]).replace(/[_ ]/g, '-');
  const generic = text.match(/\b[A-Z]{2,}[A-Z0-9./-]*\d[A-Z0-9./-]*\b/i);
  return generic ? cleanCell(generic[0]) : '';
}

function extractLocator(value) {
  const text = cleanCell(value);
  const match = text.match(/(§[^；;《》]*|第\s*[一二三四五六七八九十百\d.~-]+\s*条[^；;《》]*|第?\s*\d+\s*页[^；;《》]*|表\s*\d+[^；;《》]*|附件\s*\d+[^；;《》]*)/i);
  return match ? cleanCell(match[1]) : '';
}

function parseCitationPieces(value) {
  const raw = cleanCell(value);
  if (!useful(raw) || INFERENCE_RE.test(raw)) return [];
  const pieces = [];
  const segments = raw.split(/[；;]+/).map(cleanCell).filter(Boolean);

  for (const segment of segments) {
    const titleMatches = [...segment.matchAll(/《([^》]+)》/g)];
    if (titleMatches.length > 0) {
      titleMatches.forEach((match, index) => {
        const previousEnd = index === 0 ? 0 : titleMatches[index - 1].index + titleMatches[index - 1][0].length;
        const nextStart = index + 1 < titleMatches.length ? titleMatches[index + 1].index : segment.length;
        const prefix = cleanCell(segment.slice(previousEnd, match.index)).replace(/^[、，,和及与]+/, '');
        const suffix = cleanCell(segment.slice(match.index + match[0].length, nextStart));
        pieces.push({
          raw: segment,
          code: extractCode(prefix),
          title: cleanCell(match[1]),
          locator: extractLocator(suffix) || extractLocator(segment),
        });
      });
      continue;
    }

    const locator = extractLocator(segment);
    const code = extractCode(segment);
    let titleCandidate = locator ? cleanCell(segment.slice(0, segment.indexOf(locator))) : segment;
    if (code) titleCandidate = cleanCell(titleCandidate.replace(code, ''));
    titleCandidate = titleCandidate.replace(/^[、，,：:\-—–\s]+|[、，,：:\-—–\s]+$/g, '');
    const hasChineseTitle = /[\u4e00-\u9fff]{2,}/.test(titleCandidate) && !PLACEHOLDER_RE.test(titleCandidate);
    pieces.push({ raw: segment, code, title: hasChineseTitle ? titleCandidate : '', locator });
  }
  return pieces;
}

function titleFromFileName(pathValue, fileNo = '') {
  let name = basename(pathValue, extname(pathValue));
  name = name.replace(/^~\$/, '').replace(/^附件\s*\d+\s*[:：._\-—–]*/i, '');
  if (fileNo && fileNo !== '待分配编号') name = cleanCell(name.replace(new RegExp(escapeRegExp(fileNo), 'ig'), ''));
  const codeFromName = extractCode(name);
  if (codeFromName) name = cleanCell(name.replace(new RegExp(escapeRegExp(codeFromName), 'ig'), ''));
  name = name
    .replace(/^[\s_\-—–:：]+/, '')
    .replace(/^[A-Z](?=[\u4e00-\u9fff])/i, '')
    .replace(/[（(]?\d+(?:\.\d+)*[）)]?$/, '')
    .trim();
  return name;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDocumentCatalog(snapshot, rawA1Rows) {
  const byCode = new Map();
  const sourceFiles = (snapshot.sourceManifest?.files || []).filter(file => file.status === '纳入');

  function add(code, title, origin) {
    const key = normalizeDocCode(code);
    if (!key || !useful(title)) return;
    if (!byCode.has(key)) byCode.set(key, []);
    const existing = byCode.get(key);
    if (!existing.some(item => normalizeTitle(item.title) === normalizeTitle(title))) existing.push({ code, title: cleanCell(title), origin });
  }

  for (const process of snapshot.processMappings || []) {
    for (const piece of parseCitationPieces(process.evidenceCitation)) add(piece.code, piece.title, 'L3映射');
  }
  for (const row of rawA1Rows) {
    const citation = valueByAliases(row.raw, ['制度依据']);
    for (const piece of parseCitationPieces(citation)) add(piece.code, piece.title, 'A1映射');
  }
  for (const file of sourceFiles) {
    const title = titleFromFileName(file.path, file.fileNo);
    const fileNameCode = extractCode(basename(file.path));
    if (file.fileNo && file.fileNo !== '待分配编号') add(file.fileNo, title, '源文件清单');
    if (fileNameCode) add(fileNameCode, title, '源文件清单');
  }
  return { byCode, sourceFiles };
}

function selectCatalogTitle(code, parentRefs, catalog) {
  const key = normalizeDocCode(code);
  if (!key) return { title: '', status: 'missing' };
  const parentMatches = parentRefs.filter(ref => normalizeDocCode(ref.code) === key && useful(ref.title));
  const parentTitles = uniqueTitles(parentMatches.map(ref => ref.title));
  if (parentTitles.length === 1) return { title: parentTitles[0], status: 'parent_unique' };
  const sourceCandidates = catalog.sourceFiles
    .map(file => {
      const fileName = basename(file.path);
      const fileCodes = unique([file.fileNo, extractCode(fileName)]).map(normalizeDocCode).filter(Boolean);
      if (!fileCodes.includes(key)) return null;
      const title = titleFromFileName(file.path, file.fileNo);
      let score = 0;
      if (/\.(?:docx?|pdf)$/i.test(file.path)) score += 30;
      if (/程序|规程|办法|规定|制度|规则/.test(title)) score += 35;
      if (/附件|FM\d|评审表|记录表|申请单|清单|台账/i.test(fileName)) score -= 35;
      return { title, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'));
  if (sourceCandidates[0] && (!sourceCandidates[1] || sourceCandidates[0].score > sourceCandidates[1].score)) {
    return { title: sourceCandidates[0].title, status: 'source_file_unique' };
  }
  const candidates = catalog.byCode.get(key) || [];
  const titles = uniqueTitles(candidates.map(item => item.title));
  if (titles.length === 1) return { title: titles[0], status: 'catalog_unique' };
  return { title: '', status: titles.length > 1 ? 'ambiguous' : 'missing' };
}

function matchSourceFile(ref, dept, sourceFiles) {
  const codeKey = normalizeDocCode(ref.code);
  const titleKey = normalizeTitle(ref.title);
  const candidates = sourceFiles
    .filter(file => file.dept === dept)
    .map(file => {
      const fileName = basename(file.path);
      const fileCodes = unique([file.fileNo, extractCode(fileName)]).map(normalizeDocCode).filter(Boolean);
      const fileTitle = normalizeTitle(titleFromFileName(file.path, file.fileNo));
      let score = 0;
      if (codeKey && fileCodes.includes(codeKey)) score += 80;
      if (titleKey && fileTitle === titleKey) score += 120;
      else if (titleKey && (fileTitle.includes(titleKey) || titleKey.includes(fileTitle))) score += 70;
      if (/\.(?:docx?|pdf)$/i.test(file.path)) score += 12;
      if (/附件|FM\d|记录表|申请单|清单/i.test(fileName)) score -= 25;
      return { file, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path, 'zh-CN'));

  if (candidates.length === 0) return { fileName: '', sourcePath: '', matchStatus: '未匹配源文件' };
  const top = candidates[0];
  const ambiguous = candidates[1] && candidates[1].score === top.score
    && basename(candidates[1].file.path) !== basename(top.file.path);
  if (ambiguous) return { fileName: '', sourcePath: '', matchStatus: '源文件匹配不唯一' };
  return { fileName: basename(top.file.path), sourcePath: top.file.path, matchStatus: '唯一匹配' };
}

function resolveCitationRefs(rawCitation, parentRefs, dept, catalog) {
  const parsed = parseCitationPieces(rawCitation);
  return parsed.map(piece => {
    const selected = piece.title ? { title: piece.title, status: 'citation_title' } : selectCatalogTitle(piece.code, parentRefs, catalog);
    const resolved = { ...piece, title: selected.title, resolutionStatus: selected.status };
    const source = matchSourceFile(resolved, dept, catalog.sourceFiles);
    const codeKey = normalizeDocCode(resolved.code);
    const catalogTitles = unique((catalog.byCode.get(codeKey) || []).map(item => normalizeTitle(item.title))).filter(Boolean);
    let titleMatchStatus = '编号-名称唯一匹配';
    if (!useful(resolved.title)) titleMatchStatus = '缺原文制度名称';
    else if (!codeKey) titleMatchStatus = '制度编号待补';
    else if (catalogTitles.length !== 1) titleMatchStatus = catalogTitles.length > 1 ? '编号-名称不唯一' : '编号-名称待核验';
    return { ...resolved, ...source, titleMatchStatus };
  });
}

function displayRefs(refs) {
  const valid = refs.filter(ref => useful(ref.title));
  const titleMatchStatuses = unique(refs.map(ref => ref.titleMatchStatus || '缺原文制度名称'));
  return {
    docNos: unique(valid.map(ref => ref.code || '待分配编号')).join('；') || '待补制度编号',
    titles: unique(valid.map(ref => ref.title)).join('；') || '未提供制度原文（待部门补证）',
    locators: unique(valid.map(ref => ref.locator)).join('；') || '待补原文位置',
    sourceFiles: unique(valid.map(ref => ref.fileName)).join('；') || '未匹配到制度源文件',
    citationDisplay: valid.map(ref => {
      const code = ref.code || '待分配编号';
      const locator = ref.locator ? ` ${ref.locator}` : '';
      return `${code}《${ref.title}》${locator}`;
    }).join('；') || '未提供制度原文（待部门补证）',
    titleMatchStatus: titleMatchStatuses.join('；') || '缺原文制度名称',
  };
}

function sourceType(ref) {
  const text = `${ref.title} ${ref.fileName}`;
  if (/流程图/i.test(text)) return '流程图';
  if (/台账/i.test(text)) return '台账';
  if (/表|单|清单|记录/i.test(text) && /\.(?:xlsx?|docx?)$/i.test(ref.fileName)) return '表单';
  if (/办法/.test(text)) return '办法';
  if (/规程|程序/.test(text)) return '规程';
  if (/规则/.test(text)) return '规则';
  if (/制度/.test(text)) return '制度';
  return ref.title ? '制度或规程' : '现场资料';
}

function initialStatus(display) {
  return display.titles.startsWith('未提供')
    || display.locators.startsWith('待补')
    || display.titleMatchStatus !== '编号-名称唯一匹配'
    ? '缺原文证据'
    : '待部门确认';
}

function buildEvidenceRows({ objectType, objectId, objectName, refs, citationMode, rawCitation, dept }) {
  if (refs.length === 0) {
    return [{
      dept,
      objectType,
      objectId,
      objectName,
      sourceType: '现场资料',
      docNo: '待补制度编号',
      docTitle: '未提供制度原文（待部门补证）',
      sourceFileName: '未匹配到制度源文件',
      sourcePath: '',
      locator: '待补原文位置',
      rawCitation: rawCitation || '',
      citationMode: '缺原文证据',
      evidenceStatus: '缺原文证据',
      sourceVerification: '未核验',
      matchStatus: '未匹配源文件',
      titleMatchStatus: '缺原文制度名称',
    }];
  }
  return refs.map(ref => ({
    dept,
    objectType,
    objectId,
    objectName,
    sourceType: sourceType(ref),
    docNo: ref.code || '待分配编号',
    docTitle: ref.title || '未提供制度原文（待部门补证）',
    sourceFileName: ref.fileName || '未匹配到制度源文件',
    sourcePath: ref.sourcePath || '',
    locator: ref.locator || '待补原文位置',
    rawCitation: rawCitation || ref.raw || '',
    citationMode,
    evidenceStatus: ref.title && ref.locator && ref.titleMatchStatus === '编号-名称唯一匹配' ? '待部门确认' : '缺原文证据',
    sourceVerification: '未逐条核验（来自当前流程映射基线）',
    matchStatus: ref.matchStatus || '未匹配源文件',
    titleMatchStatus: ref.titleMatchStatus || '缺原文制度名称',
  }));
}

function determineCitationMode(rawCitation, directRefs, inheritedRefs) {
  const raw = cleanCell(rawCitation);
  if (/上下文推断/.test(raw)) return '上下文推断（继承所属流程制度，非本行为直接证据）';
  if (/分析拆分/.test(raw)) return '分析拆分（继承所属流程制度，非本行为直接证据）';
  if (directRefs.some(ref => useful(ref.title))) return '本行为直接引用';
  if (inheritedRefs.length > 0) return '继承所属流程制度，非本行为直接证据';
  return '缺原文证据';
}

function isMeaningfulField(value) {
  const text = cleanCell(value);
  return useful(text) && !/^旧模板未采集/.test(text);
}

function buildPackage(snapshot) {
  const rawA1Rows = [];
  for (const department of DEPARTMENTS) {
    const sourcePath = resolve(REPO_ROOT, 'docs', 'norms', `${department.name}部门-能力-流程-系统映射关系.md`);
    const text = readFileSync(sourcePath, 'utf8');
    rawA1Rows.push(...parseA1Rows(text, department.name));
  }

  const catalog = buildDocumentCatalog(snapshot, rawA1Rows);
  const processIndex = new Map();
  const departments = [];
  const allEvidence = [];
  const unmatchedA1 = [];

  for (const department of DEPARTMENTS) {
    const sourceProcesses = (snapshot.processMappings || []).filter(item => item.dept === department.name);
    const processes = sourceProcesses.map((process, index) => {
      const processId = `${department.code}-L3-${String(index + 1).padStart(3, '0')}`;
      const refs = resolveCitationRefs(process.evidenceCitation, [], department.name, catalog);
      const display = displayRefs(refs);
      const result = {
        processId,
        processCodeNote: '模板内部关联号，非正式流程编码',
        dept: department.name,
        l1: process.l1,
        l2: process.l2,
        l3: process.l3,
        originalDocNos: display.docNos,
        originalDocTitles: display.titles,
        originalLocators: display.locators,
        otherDocTitles: '',
        sourceFileNames: display.sourceFiles,
        citationDisplay: display.citationDisplay,
        titleMatchStatus: display.titleMatchStatus,
        rawCitation: cleanCell(process.evidenceCitation),
        systems: process.systems || [],
        systemDisplay: (process.systems || []).join('、'),
        systemMappingStatus: (process.systems || []).length > 0 ? '已有承接方向' : '系统承接待确认',
        purposeAndBoundary: process.l3,
        overallOwner: '',
        overallTrigger: '',
        startConditionsAndInputs: '',
        finalDeliverableAndCompletion: '',
        itTakeoverExpectation: '待确认',
        takeoverScope: '',
        adjustmentNeeded: '待确认',
        adjustmentNote: '',
        weeklyDictionaryScope: '否',
        departmentConfirmation: '',
        evidenceStatus: initialStatus(display),
        refs,
        sourceFile: process.sourceFile,
      };
      processIndex.set(`${department.name}\n${process.l3}`, result);
      allEvidence.push(...buildEvidenceRows({
        objectType: 'L3流程', objectId: processId, objectName: process.l3, refs,
        citationMode: '流程映射直接引用', rawCitation: process.evidenceCitation, dept: department.name,
      }));
      return result;
    });

    const deptRawA1 = rawA1Rows.filter(item => item.dept === department.name);
    const behaviors = [];
    for (let index = 0; index < deptRawA1.length; index += 1) {
      const row = deptRawA1[index];
      const processMapping = resolveA1Process(row, sourceProcesses);
      if (!processMapping) {
        unmatchedA1.push({ dept: department.name, a1Code: row.code, a1Name: row.name, l3Heading: row.l3Heading });
        continue;
      }
      const parent = processIndex.get(`${department.name}\n${processMapping.l3}`);
      const rawCitation = valueByAliases(row.raw, ['制度依据']);
      const directRefs = resolveCitationRefs(rawCitation, parent.refs, department.name, catalog);
      const citationMode = determineCitationMode(rawCitation, directRefs, parent.refs);
      const refs = directRefs.some(ref => useful(ref.title)) ? directRefs : parent.refs;
      const display = displayRefs(refs);
      const evidenceType = valueByAliases(row.raw, ['证据类型']);
      const behavior = {
        behaviorRowId: `${department.code}-A1-${String(index + 1).padStart(4, '0')}`,
        dept: department.name,
        processId: parent.processId,
        l1: parent.l1,
        l2: parent.l2,
        l3: parent.l3,
        a1Code: row.code || `${department.code}-A1-${String(index + 1).padStart(4, '0')}`,
        a1Name: row.name,
        originalDocNos: display.docNos,
        originalDocTitles: display.titles,
        originalLocators: display.locators,
        sourceFileNames: display.sourceFiles,
        citationDisplay: display.citationDisplay,
        titleMatchStatus: display.titleMatchStatus,
        rawCitation,
        citationMode,
        evidenceType,
        actor: valueByAliases(row.raw, ['执行角色']),
        actorBasis: valueByAliases(row.raw, ['执行角色依据']),
        triggerScene: valueByAliases(row.raw, ['触发情景']),
        triggerBasis: valueByAliases(row.raw, ['触发情景依据']),
        precondition: valueByAliases(row.raw, ['前置条件']),
        preconditionBasis: valueByAliases(row.raw, ['前置条件依据']),
        inputMaterials: valueByAliases(row.raw, ['数据输入', '输入材料']),
        outputResult: valueByAliases(row.raw, ['数据输出', '输出结果']),
        inputSourceDept: valueByAliases(row.raw, ['输入来源部门']),
        outputTargetDept: valueByAliases(row.raw, ['输出目标部门']),
        approvalType: valueByAliases(row.raw, ['审批类型']),
        currentSystems: valueByAliases(row.raw, ['应用系统（S1）', '应用系统', 'S1']),
        currentModule: valueByAliases(row.raw, ['应用模块（S2）', '应用模块', 'S2']),
        concreteAction: row.name,
        nodeType: '',
        decisionCondition: '',
        nextStep: '',
        returnStep: '',
        timeLimit: '',
        executionStandard: valueByAliases(row.raw, ['验收标准']),
        acceptanceCondition: valueByAliases(row.raw, ['验收标准']),
        acceptanceBasis: valueByAliases(row.raw, ['验收标准依据']),
        completionMarker: valueByAliases(row.raw, ['验收标准']),
        verificationNote: valueByAliases(row.raw, ['核验提醒']),
        departmentOpinion: valueByAliases(row.raw, ['部门确认意见']),
        adjustmentNeeded: valueByAliases(row.raw, ['是否调整']) || '待确认',
        adjustmentSuggestion: valueByAliases(row.raw, ['调整建议']),
        remarks: valueByAliases(row.raw, ['备注']),
        evidenceStatus: initialStatus(display),
        raw: row.raw,
      };
      behaviors.push(behavior);
      allEvidence.push(...buildEvidenceRows({
        objectType: 'A1行为', objectId: behavior.a1Code, objectName: behavior.a1Name, refs,
        citationMode, rawCitation, dept: department.name,
      }));
    }

    // Fill safe flow-level clues only from explicit first/last A1 values.
    for (const process of processes) {
      const processBehaviors = behaviors.filter(item => item.processId === process.processId);
      const first = processBehaviors[0];
      const last = processBehaviors[processBehaviors.length - 1];
      if (first) {
        process.overallTrigger = isMeaningfulField(first.triggerScene) ? first.triggerScene : '';
        process.startConditionsAndInputs = unique([
          isMeaningfulField(first.precondition) ? first.precondition : '',
          isMeaningfulField(first.inputMaterials) ? first.inputMaterials : '',
        ]).join('；');
      }
      if (last) {
        process.finalDeliverableAndCompletion = unique([
          isMeaningfulField(last.outputResult) ? last.outputResult : '',
          isMeaningfulField(last.completionMarker) ? last.completionMarker : '',
        ]).join('；');
      }
    }

    const dictionaryStarters = behaviors.map((behavior, index) => ({
      dictionaryRowId: `${department.code}-FD-${String(index + 1).padStart(4, '0')}`,
      dept: department.name,
      processId: behavior.processId,
      l3: behavior.l3,
      a1Code: behavior.a1Code,
      a1Name: behavior.a1Name,
      inputOutputClue: unique([behavior.inputMaterials, behavior.outputResult].filter(isMeaningfulField)).join('；'),
      formNo: '',
      formName: '',
      tableKind: '',
      tableName: '',
      fieldSequence: '',
      fieldChineseName: '',
      candidateEnglishName: '',
      businessDefinition: '',
      dataObject: '',
      dataType: '',
      length: '',
      precision: '',
      required: '待确认',
      primaryKey: '待确认',
      queryCondition: '待确认',
      visible: '待确认',
      editable: '待确认',
      hidden: '待确认',
      autoGenerated: '待确认',
      approvalTrace: '待确认',
      enumItems: '',
      numberingRule: '',
      defaultValue: '',
      conditionalFill: '',
      calculationFormula: '',
      sourceDocNo: behavior.originalDocNos,
      sourceDocTitle: behavior.originalDocTitles,
      sourceLocator: behavior.originalLocators,
      sourceTitleMatchStatus: behavior.titleMatchStatus,
      fieldConclusion: '待确认',
      noFieldReason: '',
      confirmationStatus: behavior.evidenceStatus,
      openQuestion: '',
    }));

    departments.push({
      name: department.name,
      code: department.code,
      sourceFile: `docs/norms/${department.name}部门-能力-流程-系统映射关系.md`,
      processes,
      behaviors,
      dictionaryStarters,
      evidence: allEvidence.filter(item => item.dept === department.name),
      counts: {
        processes: processes.length,
        behaviors: behaviors.length,
        mappedProcesses: processes.filter(item => item.systems.length > 0).length,
        unmappedProcesses: processes.filter(item => item.systems.length === 0).length,
        missingProcessTitles: processes.filter(item => item.originalDocTitles.startsWith('未提供')).length,
        missingBehaviorTitles: behaviors.filter(item => item.originalDocTitles.startsWith('未提供')).length,
        ambiguousProcessTitles: processes.filter(item => item.titleMatchStatus.includes('不唯一')).length,
        ambiguousBehaviorTitles: behaviors.filter(item => item.titleMatchStatus.includes('不唯一')).length,
        blockingProcessEvidence: processes.filter(item => item.evidenceStatus === '缺原文证据').length,
        blockingBehaviorEvidence: behaviors.filter(item => item.evidenceStatus === '缺原文证据').length,
      },
    });
  }

  const totals = departments.reduce((acc, dept) => {
    for (const key of Object.keys(acc)) acc[key] += dept.counts[key] || 0;
    return acc;
  }, {
    processes: 0,
    behaviors: 0,
    mappedProcesses: 0,
    unmappedProcesses: 0,
    missingProcessTitles: 0,
    missingBehaviorTitles: 0,
    ambiguousProcessTitles: 0,
    ambiguousBehaviorTitles: 0,
    blockingProcessEvidence: 0,
    blockingBehaviorEvidence: 0,
  });

  if (totals.processes !== 273) throw new Error(`L3 count mismatch: expected 273, received ${totals.processes}`);
  if (totals.behaviors !== 1415) {
    throw new Error(`A1 count mismatch: expected 1415, received ${totals.behaviors}; by department ${JSON.stringify(departments.map(item => [item.name, item.counts.behaviors]))}`);
  }
  if (totals.unmappedProcesses !== 7) throw new Error(`Unmapped process count mismatch: expected 7, received ${totals.unmappedProcesses}`);
  if (unmatchedA1.length > 0) throw new Error(`Unmatched A1 rows: ${JSON.stringify(unmatchedA1.slice(0, 10), null, 2)}`);

  return {
    schemaVersion: 'department-process-template-data-v1',
    generatedAt: new Date().toISOString(),
    snapshotDate: snapshot.snapshotDate,
    sourceSnapshot: 'docs/company-sankey-data.json',
    rules: {
      workflowQuestions: [
        '解决什么事：流程目的和结束边界',
        '谁负总责：整条流程的责任角色',
        '何时触发：业务场景或触发事件',
        '开始前有什么：前置条件和输入材料',
        '每一步谁来做：保留制度原文角色称谓',
        '具体做什么：动作、判断和退回路径',
        '按什么标准：时限、规则和验收条件',
        '最终交付什么：输出结果和完成标志',
      ],
      statuses: ['已完成', '待部门确认', '缺原文证据'],
      evidenceRule: '原文制度名称必须直接显示；继承所属流程制度不得冒充A1直接证据。',
    },
    totals,
    departments,
  };
}

const args = parseArgs(process.argv.slice(2));
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
const packageData = buildPackage(snapshot);
writeFileSync(args.out, `${JSON.stringify(packageData, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ out: args.out, snapshotDate: packageData.snapshotDate, totals: packageData.totals })}\n`);
