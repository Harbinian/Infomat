const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const mappingEvidenceCache = new Map();
const sourceDocumentParagraphCache = new Map();

const QUEUE_DEFINITIONS = [
  ['waiting_my_action', '需要我确认'],
  ['waiting_department_review', '需要我审核'],
  ['pending_collaboration', '需要我协同'],
  ['waiting_others', '等待别人'],
  ['waiting_mdm_decision', '待最终裁决'],
  ['completed', '已完成']
];

const POINT_OPTIONS = {
  owner_role: ['已有具体岗位', '只能确认到部门', '制度或表单原文没写清', '这条核验项不适用'],
  completion_standard: ['已有完成标准', '制度或表单原文缺少完成标准', '该行为不需要完成标准', '制度或表单原文没写清'],
  controlled_transfer: ['有受控传递证据', '没有受控传递证据', '需要对方部门确认', '不涉及跨部门传递'],
  cross_department: ['本部门可以确认', '需要对方部门确认', '需要工作室协调', '提交 MDM 工作组裁决'],
  process_structure: ['当前流程结构合理', '流程结构需调整', '需要补 L1/L2 口径', '提交 MDM 工作组裁决'],
  system_landing: ['当前应用落位合理', '应用落位需调整', '暂不落位系统', '需要信息化工作组判断'],
  data_object: ['数据对象已明确', '字段口径需补充', '黄金源需确认', '提交 MDM 工作组裁决'],
  evidence_gap: ['证据链充分', '当前问题卡缺少来源证据', '证据与原文对不上', '制度或表单原文没写清'],
  terminology: ['采用推荐术语', '保留原表达并说明原因', '需要多部门统一', '提交 MDM 工作组裁决']
};

const MISSING_ORIGINAL_EVIDENCE_TEXT = '缺少制度或表单原文摘录，本问题不能确认。';
const CONTROLLED_BUSINESS_ACTIONS = ['修改制度或表单源文件后重新导入', '说明这条核验项不是问题'];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function positiveInteger(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function sourceLayer(sourceFile) {
  const text = String(sourceFile || '');
  if (/总则|规章/.test(text)) return 'rule';
  if (/表单|台账|模板/.test(text)) return 'form';
  if (/标准|作业/.test(text)) return 'standard';
  if (!text) return 'unknown';
  return 'procedure';
}

function fileNameFromSource(sourceFile) {
  return String(sourceFile || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '';
}

function parseSourceDocuments(rawValue) {
  return String(rawValue || '')
    .split(';;')
    .map(piece => {
      const [fileNo, filePath] = String(piece || '').split('||');
      return {
        file_no: inferDocumentSourceFileNo(fileNo, filePath),
        file_path: cleanText(filePath),
        document_name: fileNameFromSource(filePath)
      };
    })
    .filter(item => item.file_path || item.file_no || item.document_name);
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function inferSourceFileNo(...values) {
  const text = values.map(cleanText).filter(Boolean).join(' ').replace(/\\/g, '/').toUpperCase();
  const match = text.match(/\b([A-Z]{2,8}(?:[-_][A-Z0-9]{1,12}){1,5}|[A-Z]{2,8}\d{2,12})\b/);
  return match ? match[1].replace(/_/g, '-') : '';
}

function inferSourceFileNos(value) {
  const text = cleanText(value).replace(/\\/g, '/').toUpperCase();
  return [...text.matchAll(/\b([A-Z]{2,8}(?:[-_][A-Z0-9]{1,12}){1,5}|[A-Z]{2,8}\d{2,12})\b/g)]
    .map(match => match[1].replace(/_/g, '-'));
}

function moreSpecificSourceFileNo(values) {
  return inferSourceFileNos(values)
    .sort((left, right) => {
      const partDiff = right.split('-').length - left.split('-').length;
      if (partDiff) return partDiff;
      return right.length - left.length;
    })[0] || '';
}

function inferDocumentSourceFileNo(fileNo, filePath) {
  const declaredNo = inferSourceFileNo(fileNo);
  const pathNo = moreSpecificSourceFileNo(filePath);
  if (pathNo && declaredNo && pathNo.startsWith(`${declaredNo}-`)) return pathNo;
  return pathNo || declaredNo;
}

function normalizeSourceFileNo(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[\\/_]+/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function hasOnlyRevisionSuffix(base, expanded) {
  if (!base || !expanded.startsWith(`${base}-`)) return false;
  const suffix = expanded.slice(base.length + 1).split('-').filter(Boolean);
  return suffix.length === 1 && /^[A-Z]$/.test(suffix[0]);
}

function sourceFileNoMatches(expected, actual) {
  const left = normalizeSourceFileNo(expected);
  const right = normalizeSourceFileNo(actual);
  if (!left || !right) return false;
  return left === right || hasOnlyRevisionSuffix(left, right) || hasOnlyRevisionSuffix(right, left);
}

function expectedSourceFileNoForRow(row = {}) {
  return cleanText(row.mapping_source_file_no)
    || inferSourceFileNo(
      row.evidence_source_anchor,
      row.evidence_source_label,
      row.evidence_source_file,
      row.evidence_document_name
    );
}

function readableList(values, emptyText) {
  const uniqueValues = uniqueNonEmpty(values);
  if (!uniqueValues.length) return emptyText;
  if (uniqueValues.length <= 4) return uniqueValues.join('；');
  return `${uniqueValues.slice(0, 4).join('；')}；另有${uniqueValues.length - 4}个来源文件`;
}

function sourcePositionTextFromAnchor(sourceAnchor, sourceLabel) {
  const text = cleanText(`${sourceAnchor || ''} ${sourceLabel || ''}`);
  if (!text) return '';
  const parts = [];
  const clause = text.match(/§\s*([0-9]+(?:\.[0-9]+)*)/)?.[1] || text.match(/第\s*([0-9]+(?:\.[0-9]+)*)\s*条/)?.[1];
  if (clause) parts.push(`第${clause}条`);
  const page = text.match(/\bpage\s*=?\s*(\d+)\b/i)?.[1] || text.match(/第?(\d+)页/)?.[1];
  if (page) parts.push(`第${page}页`);
  const paragraph = text.match(/第?\s*(\d+)\s*段/)?.[1] || text.match(/\bP(\d+)\b/i)?.[1];
  if (paragraph) parts.push(`第${paragraph}段附近`);
  const table = text.match(/(?:表格?|table)\s*([A-Za-z0-9._-]+)/i)?.[1] || text.match(/\b(T\d+)\b/i)?.[1];
  if (table) parts.push(/^T\d+$/i.test(table) ? table.replace(/^T/i, '表') : `表${table}`);
  return uniqueNonEmpty(parts).join('；');
}

function extractClauseNumber(sourceAnchor, sourceLabel) {
  const text = cleanText(`${sourceAnchor || ''} ${sourceLabel || ''}`);
  return text.match(/§\s*([0-9]+(?:\.[0-9]+)*)/)?.[1] || text.match(/第\s*([0-9]+(?:\.[0-9]+)*)\s*条/)?.[1] || '';
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeForEvidenceMatch(value) {
  return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readZipEntry(buffer, entryName) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return null;
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < entryCount && offset < buffer.length; index += 1) {
    if (buffer.readUInt32LE(offset) !== centralSignature) return null;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === entryName) {
      if (buffer.readUInt32LE(localHeaderOffset) !== localSignature) return null;
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
      if (compressionMethod === 0) return compressed;
      if (compressionMethod === 8) return zlib.inflateRawSync(compressed);
      return null;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function paragraphsFromDocxBuffer(buffer) {
  const documentXml = readZipEntry(buffer, 'word/document.xml');
  if (!documentXml) return [];
  return documentXml.toString('utf8')
    .split(/<\/w:p>/)
    .map(paragraphXml => [...paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map(match => decodeXmlEntities(match[1]))
      .join('')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
}

function resolveSourceDocumentPath(sourceFile) {
  const raw = String(sourceFile || '').trim();
  if (!raw || isIntermediateMappingSource(raw)) return '';
  const resolved = path.resolve(path.isAbsolute(raw) ? raw : path.join(REPO_ROOT, raw));
  const repoRoot = REPO_ROOT.toLowerCase();
  const normalized = resolved.toLowerCase();
  if (normalized !== repoRoot && !normalized.startsWith(`${repoRoot}${path.sep}`)) return '';
  return fs.existsSync(resolved) ? resolved : '';
}

function readSourceDocumentParagraphs(sourceFile) {
  const resolved = resolveSourceDocumentPath(sourceFile);
  if (!resolved) return [];
  if (sourceDocumentParagraphCache.has(resolved)) return sourceDocumentParagraphCache.get(resolved);
  let paragraphs = [];
  try {
    if (/\.docx$/i.test(resolved)) {
      paragraphs = paragraphsFromDocxBuffer(fs.readFileSync(resolved));
    } else if (/\.(txt|md)$/i.test(resolved)) {
      paragraphs = fs.readFileSync(resolved, 'utf8').split(/\r?\n/).map(cleanText).filter(Boolean);
    }
  } catch {
    paragraphs = [];
  }
  sourceDocumentParagraphCache.set(resolved, paragraphs);
  return paragraphs;
}

function sourceContainsClause(paragraphs, sourceAnchor, sourceLabel) {
  const clause = extractClauseNumber(sourceAnchor, sourceLabel);
  if (!clause) return true;
  const clausePattern = clause.split('.').map(escapeRegExp).join('[\\.．]');
  const text = paragraphs.join('\n');
  return new RegExp(`(^|[^0-9])(?:§\\s*)?${clausePattern}([^0-9]|$)|第\\s*${clausePattern}\\s*条`).test(text);
}

function closestSourcePosition(paragraphs, matchIndex) {
  let section = '';
  let subsection = '';
  for (let index = matchIndex; index >= 0; index -= 1) {
    const text = paragraphs[index];
    if (!subsection && /^（[0-9一二三四五六七八九十]+）/.test(text)) {
      subsection = text;
    }
    if (/^[0-9]+(?:[\.．][0-9]+)*(?:\s+|(?=[^\d.．]))\S+/.test(text)) {
      section = text;
      break;
    }
  }
  return subsection || section || '原文摘录附近';
}

function verifyMappingEvidenceAgainstSource(row = {}, sourceDocuments = sourceDocumentsFromRow(row)) {
  const excerpt = cleanText(row.mapping_source_excerpt);
  if (!excerpt) return { verified: false, reason: 'missing_excerpt' };
  const needle = normalizeForEvidenceMatch(excerpt);
  if (needle.length < 6) return { verified: false, reason: 'short_excerpt' };
  for (const document of sourceDocuments) {
    const paragraphs = readSourceDocumentParagraphs(document.file_path);
    if (!paragraphs.length) continue;
    const matchIndex = paragraphs.findIndex(paragraph => {
      const normalized = normalizeForEvidenceMatch(paragraph);
      return normalized.includes(needle) || (normalized.length >= 8 && needle.includes(normalized));
    });
    if (matchIndex < 0) continue;
    const anchorFound = sourceContainsClause(paragraphs, row.mapping_source_anchor, row.mapping_source_label);
    const filePath = resolveSourceDocumentPath(document.file_path) || document.file_path || '';
    return {
      verified: true,
      raw_text: paragraphs[matchIndex],
      position: closestSourcePosition(paragraphs, matchIndex),
      source_file: filePath,
      document_name: document.document_name || fileNameFromSource(document.file_path),
      source_anchor: row.mapping_source_anchor || row.mapping_source_label || '',
      anchor_found: anchorFound
    };
  }
  return { verified: false, reason: 'excerpt_not_found' };
}

function resolveMappingSourcePath(sourceFile) {
  const raw = String(sourceFile || '').trim();
  if (!raw || !/\.md$/i.test(raw)) return '';
  const resolved = path.resolve(path.isAbsolute(raw) ? raw : path.join(REPO_ROOT, raw));
  const root = `${REPO_ROOT}${path.sep}`.toLowerCase();
  const normalized = `${resolved}${path.sep}`.toLowerCase();
  return normalized.startsWith(root) || resolved.toLowerCase() === REPO_ROOT.toLowerCase() ? resolved : '';
}

function parseMarkdownTableRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map(cell => cleanText(cell));
}

function isMarkdownSeparator(cells) {
  return cells && cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(String(cell || '').trim()));
}

function valueFromMarkdownRow(row, ...names) {
  for (const name of names) {
    if (row[name]) return row[name];
  }
  const key = Object.keys(row).find(matchKey => names.some(name => matchKey.includes(name)));
  return key ? row[key] || '' : '';
}

function cleanSourceAnchor(value) {
  return cleanText(value)
    .replace(/[“"].*?[”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function quotedSourceExcerpt(...values) {
  for (const value of values) {
    const text = String(value || '');
    const match = text.match(/[“"]([^”"]+)[”"]/);
    if (match && cleanText(match[1])) return cleanText(match[1]);
  }
  return '';
}

function readMappingEvidenceByCode(sourceFile) {
  const resolved = resolveMappingSourcePath(sourceFile);
  if (!resolved || !fs.existsSync(resolved)) return new Map();
  if (mappingEvidenceCache.has(resolved)) return mappingEvidenceCache.get(resolved);

  const evidenceByCode = new Map();
  let headers = null;
  for (const line of fs.readFileSync(resolved, 'utf8').split(/\r?\n/)) {
    const cells = parseMarkdownTableRow(line);
    if (!cells || isMarkdownSeparator(cells)) continue;
    if (cells.some(cell => /A1|业务行为/.test(cell)) && cells.some(cell => /制度依据|执行角色依据/.test(cell))) {
      headers = cells;
      continue;
    }
    if (!headers || cells.length < headers.length) continue;
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
    const a1Code = valueFromMarkdownRow(row, '业务行为（A1）编号', 'A1编号');
    const behavior = valueFromMarkdownRow(row, '业务行为（A1）', '业务行为');
    if (!a1Code && !behavior) continue;

    const systemSource = valueFromMarkdownRow(row, '制度依据');
    const roleSource = valueFromMarkdownRow(row, '执行角色依据');
    const triggerSource = valueFromMarkdownRow(row, '触发情景依据');
    const conditionSource = valueFromMarkdownRow(row, '前置条件依据');
    const standardSource = valueFromMarkdownRow(row, '验收标准依据');
    const sourceAnchor = cleanSourceAnchor(systemSource || roleSource || triggerSource || conditionSource || standardSource);
    if (!sourceAnchor) continue;

    const item = {
      source_anchor: sourceAnchor,
      source_label: sourceAnchor,
      source_file_no: inferSourceFileNo(sourceAnchor),
      source_excerpt: quotedSourceExcerpt(roleSource, triggerSource, systemSource, conditionSource, standardSource)
    };
    if (a1Code) evidenceByCode.set(cleanText(a1Code), item);
    if (behavior) evidenceByCode.set(`behavior:${cleanText(behavior)}`, item);
  }
  mappingEvidenceCache.set(resolved, evidenceByCode);
  return evidenceByCode;
}

function enrichRowWithMappingEvidence(row = {}) {
  if (cleanText(row.evidence_source_anchor) || cleanText(row.evidence_raw_text)) return row;
  const evidence = readMappingEvidenceByCode(row.source_file || row.record_source_file || '')
    .get(cleanText(row.a1_code))
    || readMappingEvidenceByCode(row.source_file || row.record_source_file || '').get(`behavior:${cleanText(row.behavior || row.a1_name)}`);
  if (!evidence) return row;
  return {
    ...row,
    mapping_source_anchor: evidence.source_anchor,
    mapping_source_label: evidence.source_label,
    mapping_source_file_no: evidence.source_file_no,
    mapping_source_excerpt: evidence.source_excerpt,
    mapping_source_file: row.source_file || row.record_source_file || ''
  };
}

function sourceDocumentsFromRow(row = {}) {
  const evidenceFile = cleanText(row.evidence_source_file);
  const evidenceName = cleanText(row.evidence_document_name) || fileNameFromSource(evidenceFile);
  const evidenceAnchor = cleanText(row.evidence_source_anchor || row.evidence_source_label || row.mapping_source_anchor || row.mapping_source_label);
  const evidenceFileNo = inferSourceFileNo(evidenceAnchor, evidenceFile, evidenceName);
  const manifestDocuments = parseSourceDocuments(row.source_documents || row.sourceDocuments);
  const matchedManifestDocuments = evidenceFileNo
    ? manifestDocuments
        .filter(document => sourceFileNoMatches(evidenceFileNo, document.file_no))
        .map(document => ({
          ...document,
          file_no: evidenceFileNo,
          document_name: document.document_name || fileNameFromSource(document.file_path)
        }))
    : [];
  const evidenceDocuments = evidenceFile || evidenceName || evidenceAnchor
    ? [{
        file_no: evidenceFileNo,
        file_path: evidenceFile,
        document_name: evidenceName || '制度或表单源文件未识别'
      }]
    : [];
  const documents = matchedManifestDocuments.length
    ? matchedManifestDocuments
    : evidenceDocuments.length
    ? evidenceDocuments
    : manifestDocuments;
  const sourceFile = row.source_file || row.sourceFile || '';
  if (!evidenceDocuments.length && sourceFile && !isIntermediateMappingSource(sourceFile)) {
    documents.unshift({
      file_no: inferSourceFileNo(row.source_file_no, row.sourceFileNo, row.doc_no, row.docNo, sourceFile),
      file_path: cleanText(sourceFile),
      document_name: fileNameFromSource(sourceFile)
    });
  }
  const seen = new Set();
  return documents.filter(document => {
    const key = `${document.file_no || ''}|${document.file_path || document.document_name || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isIntermediateMappingSource(sourceFile) {
  const text = String(sourceFile || '').replace(/\\/g, '/');
  return !text || /\.md\b/i.test(text) || /\/_extracted\//i.test(text) || /process[-_]input[-_]baseline|mapping[_-]diff|company-sankey|artifacts/i.test(text);
}

function sourcePositionText(sourceFile, sourceLine) {
  const text = String(sourceFile || '');
  const paragraph = text.match(/第?\s*(\d+)\s*段/)?.[1] || text.match(/\bP(\d+)\b/i)?.[1];
  if (paragraph) return `第${paragraph}段附近`;
  const clause = text.match(/§\s*([0-9]+(?:\.[0-9]+)*)/)?.[1];
  if (clause) return `第${clause}条`;
  const page = text.match(/\bpage\s*=?\s*(\d+)\b/i)?.[1] || text.match(/第?(\d+)页/)?.[1];
  if (page) return `第${page}页`;
  const table = text.match(/\b(T\d+)\b/i)?.[1];
  if (table) return table.replace(/^T/i, '表');
  const lineAsParagraph = Number(sourceLine);
  if (Number.isFinite(lineAsParagraph) && lineAsParagraph > 0) return `第${Math.floor(lineAsParagraph)}段附近`;
  return '';
}

function businessSourceInfo(row = {}) {
  const sourceFile = row.source_file || row.sourceFile || '';
  const sourceLine = Number(row.source_line || row.sourceLine || 0);
  const sourceDocuments = sourceDocumentsFromRow(row);
  const evidencePosition = sourcePositionTextFromAnchor(row.evidence_source_anchor, row.evidence_source_label);
  const documentNo = readableList(
    sourceDocuments.map(document => document.file_no),
    '源文件编号未随输入基线入库'
  );
  const documentName = readableList(
    sourceDocuments.map(document => document.document_name || fileNameFromSource(document.file_path)),
    '制度或表单源文件未识别'
  );
  if (evidencePosition) {
    const evidenceRequired = Number(row.evidence_required || 0) === 1;
    return {
      documentNo,
      documentName,
      position: evidencePosition,
      residualIssue: evidenceRequired && !cleanText(row.evidence_raw_text || row.mapping_source_excerpt)
        ? '残留问题：已定位源文件和位置，但缺少可核对的制度或表单原文摘录。'
        : ''
    };
  }
  if (cleanText(row.mapping_source_anchor || row.mapping_source_label || row.mapping_source_excerpt)) {
    const verifiedMappingEvidence = verifyMappingEvidenceAgainstSource(row, sourceDocuments);
    if (verifiedMappingEvidence.verified) {
      return {
        documentNo,
        documentName,
        position: verifiedMappingEvidence.position,
        residualIssue: verifiedMappingEvidence.anchor_found
          ? ''
          : `残留问题：流程输入基线标注为 ${cleanText(row.mapping_source_anchor || row.mapping_source_label)}，但未在制度或表单源文件中核到对应条款；本卡按原文摘录所在段落定位。`
      };
    }
    return {
      documentNo,
      documentName,
      position: '来源依据不足：未在制度或表单源文件中核到对应段落',
      residualIssue: '残留问题：流程输入基线提供了来源线索，但尚未定位到制度或表单原文段落。'
    };
  }
  if (isIntermediateMappingSource(sourceFile)) {
    const inputBaselinePosition = sourcePositionText(sourceFile, sourceLine);
    return {
      documentNo,
      documentName,
      position: inputBaselinePosition ? `流程治理输入基线${inputBaselinePosition}` : '来源依据不足：未标注可核对段落号',
      residualIssue: sourceDocuments.length
        ? '残留问题：已给出制度或表单编号和名称，但尚未定位到该文件中的具体段落、页码或表格位置。'
        : '残留问题：本问题卡缺少制度或表单源文件编号、名称和可核对位置，需要先补充来源依据再确认。'
    };
  }
  const position = sourcePositionText(sourceFile, sourceLine);
  return {
    documentNo,
    documentName: documentName || fileNameFromSource(sourceFile) || '制度或表单源文件未识别',
    position: position || '来源依据不足：未标注可核对段落号',
    residualIssue: position ? '' : '残留问题：源文件已识别，但缺少可核对的段落号，需要先补充来源依据再确认。'
  };
}

function businessLines(parts) {
  return parts.filter(Boolean).join('\n');
}

function readableIssueText(value) {
  return String(value || '')
    .replace(/原输出目标部门/g, '输出给哪个部门')
    .replace(/输出目标部门/g, '输出给哪个部门')
    .replace(/未见受控传递证据/g, '没有看到制度或表单里写清交接依据')
    .replace(/待补/g, '需要补清')
    .replace(/\s*[；;]\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function handlingMethodLabel(value) {
  const map = {
    source_revision: '修改制度或表单源文件后重新导入',
    not_issue: '这条核验项不是问题'
  };
  return map[value] || '';
}

function handlingReasonLabel(value) {
  const map = {
    source_already_clear: '制度或表单原文已经写清楚',
    not_controlled_transfer: '这不是受控传递事项',
    not_current_department: '不属于本部门处理范围',
    no_business_impact: '不会影响这个业务行为',
    duplicate_or_covered: '已被其他问题或来源覆盖'
  };
  return map[value] || value || '';
}

function pointActionNote(options = {}) {
  const selectedOption = options.selectedOption || options.selected_option || '';
  const method = options.handlingMethod || options.handling_method || '';
  const reason = options.handlingReason || options.handling_reason || '';
  const methodLabel = handlingMethodLabel(method);
  if (methodLabel) {
    return businessLines([
      `处理方式：${methodLabel}`,
      reason ? `问题原因：${handlingReasonLabel(reason)}` : '',
      selectedOption ? `处理结论：${selectedOption}` : ''
    ]);
  }
  return options.note || null;
}

function pointActionPayload(options = {}, nextStatus) {
  return {
    selected_option: options.selectedOption || options.selected_option || null,
    handling_method: options.handlingMethod || options.handling_method || null,
    handling_reason: options.handlingReason || options.handling_reason || null,
    next_status: nextStatus
  };
}

function displayStatusForSource(row) {
  const status = String(row.todo_status || row.status || '').trim();
  if (['closed', 'accepted'].includes(status)) return 'completed';
  if (status === 'source_resolved') return 'completed';
  if (status === 'submitted') return 'waiting_department_review';
  if (row.todo_type === 'cross_dept' && row.target_dept_name && row.target_dept_name !== row.dept_name) return 'waiting_my_action';
  return 'waiting_my_action';
}

function priorityScore(row) {
  const priority = String(row.priority || '').trim();
  if (priority === 'high') return 90;
  if (priority === 'medium') return 60;
  if (priority === 'low') return 30;
  return row.todo_id ? 50 : 20;
}

function pointTypeForSource(row) {
  const todoType = String(row.todo_type || '').trim();
  const message = `${row.message || ''} ${row.suggestion || ''} ${row.verification_note || ''}`;
  if (todoType === 'cross_dept') return 'cross_department';
  if (/受控传递|跨部门|输出给哪个部门|输入来源|输出目标|交接|移交|承接|流转/.test(message)) return 'controlled_transfer';
  if (todoType === 'evidence' || /证据/.test(message)) return 'evidence_gap';
  if (todoType === 'adjustment' || /结构|L1|L2|流程/.test(message)) return 'process_structure';
  if (/系统|落位|应用/.test(message)) return 'system_landing';
  if (/字段|数据对象|主数据|黄金源/.test(message)) return 'data_object';
  if (/术语|表达|名称/.test(message)) return 'terminology';
  if (/责任|岗位|角色/.test(message)) return 'owner_role';
  return 'completion_standard';
}

function pointTitle(pointType) {
  const labels = {
    owner_role: '责任人不具体',
    completion_standard: '完成标准待确认',
    controlled_transfer: '受控传递待确认',
    cross_department: '跨部门协同确认',
    process_structure: '流程结构待裁决',
    system_landing: '系统落位待裁决',
    data_object: '数据对象或字段待裁决',
    evidence_gap: '证据链待补',
    terminology: '术语统一'
  };
  return labels[pointType] || '待确认问题';
}

function suggestedSystemsText(row = {}) {
  const systems = parseJsonArray(row.suggested_systems || row.suggestedSystems)
    .map(cleanText)
    .filter(Boolean);
  if (systems.length) return systems.join('、');
  return cleanText(row.suggested_systems || row.suggestedSystems || row.system || '');
}

function documentStructureObjectKey(row = {}) {
  return cleanText(row.a1_code) || cleanText(row.l3_key) || cleanText(row.l3_name) || cleanText(row.todo_key) || cleanText(row.mapping_key);
}

function currentStructuredValue(row = {}, pointType) {
  const targetDept = cleanText(row.target_dept_name || row.output_target_dept);
  switch (pointType) {
    case 'owner_role':
      return cleanText(row.execution_role || row.owner || row.owner_dept_name) || '待确认';
    case 'system_landing':
      return suggestedSystemsText(row) || '待确认';
    case 'cross_department':
      return targetDept || '待确认';
    case 'controlled_transfer':
      return targetDept || cleanText(row.message) || '待确认';
    case 'process_structure':
      return cleanText(row.l3_name || row.l2_name || row.l1_name) || '待确认';
    case 'data_object':
      return cleanText(row.data_object || row.message) || '待确认';
    case 'evidence_gap':
      return cleanText(row.evidence_status || row.verification_status || row.source_file || row.document_name) || '待确认';
    case 'terminology':
      return cleanText(row.term_text || row.message || row.behavior) || '待确认';
    default:
      return cleanText(row.verification_note || row.message || row.suggestion) || '待确认';
  }
}

function documentStructureSpec(row = {}, pointType, sourceExcerpt = '') {
  const a1Name = cleanText(row.behavior || row.a1_name || row.message || row.l3_name) || '这条业务行为';
  const l3Name = cleanText(row.l3_name) || '当前流程';
  const objectKey = documentStructureObjectKey(row);
  const currentValue = currentStructuredValue(row, pointType);
  const base = {
    structured_object_key: objectKey,
    current_value: currentValue,
    source_excerpt: sourceExcerpt || '',
    allowed_actions: CONTROLLED_BUSINESS_ACTIONS,
    next_step: '先看来源，再核原文；问题成立时修改制度或表单源文件后重新导入，不成立时说明原因。'
  };
  if (pointType === 'owner_role') {
    return {
      ...base,
      structured_object_type: 'A1 业务行为',
      target_block: 'a1_catalog',
      target_field: 'role',
      issue_type: '角色责任待确认',
      question_for_user: `请确认“${a1Name}”的执行角色“${currentValue}”是否足够具体，能否作为 a1_catalog.role 进入正式结构块。`
    };
  }
  if (pointType === 'completion_standard') {
    return {
      ...base,
      structured_object_type: 'A1 业务行为',
      target_block: 'a1_catalog',
      target_field: 'entry',
      issue_type: 'A1 行为待确认',
      question_for_user: `请确认“${a1Name}”的处理入口、输入输出和完成标准是否写清，能否进入正式结构块。`
    };
  }
  if (pointType === 'controlled_transfer' || pointType === 'cross_department') {
    return {
      ...base,
      structured_object_type: '跨部门承接',
      target_block: 'a1_catalog',
      target_field: 'output_result',
      issue_type: '跨部门承接待确认',
      question_for_user: `请确认“${a1Name}”是否需要跨部门承接，承接部门、交付物和承接标准是否写清。`
    };
  }
  if (pointType === 'process_structure') {
    return {
      ...base,
      structured_object_type: 'L3 流程',
      target_block: 'l3_catalog',
      target_field: 'l3_name',
      issue_type: 'L3 结构待确认',
      question_for_user: `请确认“${l3Name}”的 L1/L2/L3 归属、粒度和流程边界是否可以进入正式结构块。`
    };
  }
  if (pointType === 'system_landing') {
    const isA1 = Boolean(cleanText(row.a1_code));
    return {
      ...base,
      structured_object_type: isA1 ? 'A1 业务行为' : 'L3 流程',
      target_block: isA1 ? 'a1_catalog' : 'l3_catalog',
      target_field: 'system',
      issue_type: '系统落位待确认',
      question_for_user: `请确认“${isA1 ? a1Name : l3Name}”建议落位到“${currentValue}”是否准确；这里只确认落位关系，不评价系统重要性。`
    };
  }
  if (pointType === 'data_object') {
    return {
      ...base,
      structured_object_type: '主数据需求',
      target_block: 'mdm_requirement_catalog',
      target_field: 'object',
      issue_type: '主数据需求待确认',
      question_for_user: `请确认“${currentValue}”是否有原文或字段台账依据，能否作为待确认主数据需求继续治理。`
    };
  }
  if (pointType === 'evidence_gap') {
    return {
      ...base,
      structured_object_type: '证据',
      target_block: 'evidence_catalog',
      target_field: 'locator',
      issue_type: '来源证据不足',
      question_for_user: '请确认这条问题是否已经能回到制度、表单、台账、流程图、条款、页码或表格位置。'
    };
  }
  if (pointType === 'terminology') {
    return {
      ...base,
      structured_object_type: '术语',
      target_block: 'evidence_catalog',
      target_field: 'source_file',
      issue_type: '术语待确认',
      question_for_user: `请确认“${currentValue}”在制度中的含义、适用位置和来源依据是否写清。`
    };
  }
  return {
    ...base,
    structured_object_type: cleanText(row.a1_code) ? 'A1 业务行为' : 'L3 流程',
    target_block: cleanText(row.a1_code) ? 'a1_catalog' : 'l3_catalog',
    target_field: cleanText(row.a1_code) ? 'behavior' : 'l3_name',
    issue_type: '文档结构化字段待确认',
    question_for_user: `请确认“${a1Name}”是否可以进入正式文档结构化输出。`
  };
}

function issueKeyForSource(row) {
  if (row.todo_key) return `todo:${row.todo_key}`;
  if (row.mapping_key) return `record:${row.mapping_key}`;
  return `record-id:${row.record_id || row.id}`;
}

function pointKeyForSource(row, pointType) {
  return `${issueKeyForSource(row)}:${pointType}`;
}

function issueShape(row, batchId) {
  const deptName = row.dept_name || row.primary_dept_name || '未标注部门';
  const a1Name = row.behavior || row.a1_name || row.message || row.l3_name || '待确认业务行为';
  const a1Code = row.a1_code || '';
  const l3Name = row.l3_name || '未标注流程';
  const sourceFile = row.source_file || '';
  const targetDept = row.target_dept_name || row.output_target_dept || '';
  const sourceInfo = businessSourceInfo(row);
  const what = readableIssueText(row.message || `${a1Name}需要补充确认`);
  const why = '不确认会影响流程结构、责任边界、证据链和后续 MDM 承接。';
  return {
    issue_key: issueKeyForSource(row),
    batch_id: batchId || null,
    primary_dept_name: deptName,
    owner_dept_name: row.owner_dept_name || deptName,
    source_layer: sourceLayer(sourceFile),
    source_type: row.todo_id ? 'mapping_todo' : 'mapping_record',
    source_ref_table: row.todo_id ? 'process_mapping_todos' : 'process_mapping_records',
    source_ref_id: String(row.todo_id || row.record_id || row.id || ''),
    l1_name: row.l1_name || null,
    l2_name: row.l2_name || null,
    l3_name: l3Name,
    a1_code: a1Code,
    a1_name: a1Name,
    title: `${a1Name}待确认`,
    what_text: what,
    why_text: why,
    where_text: businessLines([
      `发现范围：${deptName}流程治理`,
      `业务流程：${l3Name}`,
      `业务行为：${a1Code ? `${a1Code} ` : ''}${a1Name}`,
      `源文件编号：${sourceInfo.documentNo}`,
      `制度或表单名称：${sourceInfo.documentName}`,
      `大概位置：${sourceInfo.position}`,
      sourceInfo.residualIssue
    ]),
    who_text: businessLines([
      `主责部门：${deptName}`,
      `协同部门：${targetDept || '暂未识别协同部门'}`,
      '审核人：部门长或授权账户',
      '裁决人：按问题类型进入信息化项目管理工作室或 MDM 工作组'
    ]),
    when_text: row.due_date ? `本轮治理，建议在 ${row.due_date} 前处理。` : '本轮流程治理中处理，按优先级排序。',
    how_text: businessLines([
      '1. 回到制度或表单源文件查看来源位置。',
      '2. 确认业务行为：看谁做、做什么、处理什么对象、产出什么结果。',
      '3. 如果这条核验项成立，完善制度或表单源文件后重新导入。',
      '4. 如果这条核验项不是问题，在本页选择问题原因提交。',
      '提示：尚未建立“确认业务行为”的标准流程，需要创建标准。'
    ]),
    how_much_text: businessLines([
      '影响范围：1 个业务行为',
      `涉及业务行为：${a1Code ? `${a1Code} ` : ''}${a1Name}`,
      targetDept ? `协同部门：${targetDept}` : '涉及对象：暂未识别涉及对象'
    ]),
    display_status: displayStatusForSource(row),
    priority_score: priorityScore(row),
    due_at: row.due_date || null
  };
}

function pointShape(row, issueId) {
  const pointType = pointTypeForSource(row);
  const sourceDocuments = sourceDocumentsFromRow(row);
  const verifiedMappingEvidence = cleanText(row.evidence_raw_text)
    ? { verified: false }
    : verifyMappingEvidenceAgainstSource(row, sourceDocuments);
  const rawText = cleanText(row.evidence_raw_text || verifiedMappingEvidence.raw_text);
  const evidenceRequired = Number(row.evidence_required || 0) === 1;
  const originalEvidence = rawText
    ? {
        can_confirm: true,
        raw_text: rawText,
        source_label: row.evidence_source_label || row.evidence_source_anchor || verifiedMappingEvidence.position || '',
        source_anchor: row.evidence_source_anchor || verifiedMappingEvidence.source_anchor || '',
        source_file: row.evidence_source_file || verifiedMappingEvidence.source_file || '',
        document_name: row.evidence_document_name || verifiedMappingEvidence.document_name || '',
        review_run_id: row.evidence_run_id || '',
        review_item_id: row.evidence_review_item_id || '',
        stable_key: row.evidence_stable_key || '',
        evidence_status: row.evidence_status || (verifiedMappingEvidence.verified ? 'source_excerpt_verified' : ''),
        verification_status: row.verification_status || (verifiedMappingEvidence.verified && !verifiedMappingEvidence.anchor_found ? 'source_verified_anchor_mismatch' : ''),
        allowed_downstream_use: row.allowed_downstream_use || (verifiedMappingEvidence.verified ? 'review_only' : '')
      }
    : {
        can_confirm: !evidenceRequired,
        raw_text: '',
        source_label: '',
        source_anchor: '',
        source_file: '',
        document_name: '',
        evidence_status: evidenceRequired ? 'missing_original_excerpt' : '',
        verification_status: evidenceRequired ? 'missing' : '',
        allowed_downstream_use: evidenceRequired ? 'blocked' : '',
        missing_reason: evidenceRequired ? MISSING_ORIGINAL_EVIDENCE_TEXT : ''
      };
  return {
    issue_id: issueId,
    point_key: pointKeyForSource(row, pointType),
    point_type: pointType,
    title: pointTitle(pointType),
    prompt_text: documentStructureSpec(row, pointType, rawText).question_for_user,
    enum_options_json: json(POINT_OPTIONS[pointType] || POINT_OPTIONS.completion_standard),
    evidence_json: json({
      source_file: row.source_file || '',
      source_file_no: readableList(
        sourceDocumentsFromRow(row).map(document => document.file_no),
        '源文件编号未随输入基线入库'
      ),
      source_document_name: readableList(
        sourceDocumentsFromRow(row).map(document => document.document_name || fileNameFromSource(document.file_path)),
        '制度或表单源文件未识别'
      ),
      l3_name: row.l3_name || '',
      a1_code: row.a1_code || '',
      source_ref_id: row.todo_id || row.record_id || row.id || null,
      document_structure: documentStructureSpec(row, pointType, rawText),
      ...originalEvidence
    }),
    requires_mdm_decision: ['process_structure', 'system_landing', 'data_object', 'terminology'].includes(pointType) ? 1 : 0,
    requires_studio_review: ['cross_department', 'system_landing'].includes(pointType) ? 1 : 0
  };
}

function eventPayload(row) {
  return {
    source_type: row.todo_id ? 'mapping_todo' : 'mapping_record',
    source_ref_id: row.todo_id || row.record_id || row.id || null
  };
}

function mapIssueRow(row) {
  return row ? { ...row } : null;
}

function mapPointRow(row) {
  return row ? {
    ...row,
    enum_options: parseJsonArray(row.enum_options_json),
    evidence: parseJsonObject(row.evidence_json, {})
  } : null;
}

function mapParticipantRow(row) {
  return row ? { ...row } : null;
}

function mapEventRow(row) {
  return row ? {
    ...row,
    actor_display_name: row.actor_user_name || row.actor_dept_name || '系统',
    payload: parseJsonObject(row.payload_json, null)
  } : null;
}

function mapTermTaskRow(row) {
  return row ? {
    ...row,
    selected_departments: parseJsonArray(row.selected_departments_json),
    decision: parseJsonObject(row.decision_json, null)
  } : null;
}

function pointActionBlockedReason(point, options = {}) {
  const action = String(options.action || 'confirm').trim();
  if (action !== 'confirm') return '';
  const evidence = parseJsonObject(point && point.evidence_json, {});
  return evidence.can_confirm === false
    ? evidence.missing_reason || MISSING_ORIGINAL_EVIDENCE_TEXT
    : '';
}

function normalizeAction(action) {
  const key = String(action || '').trim();
  const map = {
    confirm: ['business_confirmed', 'department_review', 'pending_department_review'],
    review: ['department_reviewed', 'mdm_decision', 'pending_mdm_decision'],
    collaborate: ['collaboration_answered', 'studio_review', 'pending_studio_review'],
    'studio-review': ['studio_reviewed', 'mdm_decision', 'pending_mdm_decision'],
    'mdm-decision': ['mdm_decided', 'closed', 'accepted']
  };
  return map[key] || map.confirm;
}

function sqliteRun(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

function makeSqliteProcessGovernanceIssuePoolRepository(db) {
  function issueByKey(issueKey) {
    return db.prepare('SELECT * FROM process_governance_issues WHERE issue_key=?').get(issueKey);
  }

  function addEvent(issueId, pointId, eventType, actor = {}, note = '', payload = null) {
    sqliteRun(db, `
      INSERT INTO process_governance_issue_events
        (issue_id, point_id, event_type, actor_user_id, actor_dept_name, actor_role_code, note, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      issueId,
      pointId || null,
      eventType,
      actor.actorUserId || actor.actor_user_id || null,
      actor.actorDeptName || actor.actor_dept_name || null,
      actor.actorRoleCode || actor.actor_role_code || null,
      note || null,
      payload == null ? null : json(payload)
    ]);
  }

  function upsertIssue(row, batchId) {
    const issue = issueShape(row, batchId);
    sqliteRun(db, `
      INSERT INTO process_governance_issues (
        issue_key, batch_id, primary_dept_name, owner_dept_name, source_layer, source_type,
        source_ref_table, source_ref_id, l1_name, l2_name, l3_name, a1_code, a1_name,
        title, what_text, why_text, where_text, who_text, when_text, how_text, how_much_text,
        display_status, priority_score, due_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_key) DO UPDATE SET
        batch_id=excluded.batch_id,
        primary_dept_name=excluded.primary_dept_name,
        owner_dept_name=excluded.owner_dept_name,
        source_layer=excluded.source_layer,
        source_type=excluded.source_type,
        source_ref_table=excluded.source_ref_table,
        source_ref_id=excluded.source_ref_id,
        l2_name=excluded.l2_name,
        l3_name=excluded.l3_name,
        a1_code=excluded.a1_code,
        a1_name=excluded.a1_name,
        title=excluded.title,
        what_text=excluded.what_text,
        why_text=excluded.why_text,
        where_text=excluded.where_text,
        who_text=excluded.who_text,
        when_text=excluded.when_text,
        how_text=excluded.how_text,
        how_much_text=excluded.how_much_text,
        display_status=excluded.display_status,
        priority_score=excluded.priority_score,
        due_at=excluded.due_at,
        updated_at=CURRENT_TIMESTAMP
    `, [
      issue.issue_key, issue.batch_id, issue.primary_dept_name, issue.owner_dept_name,
      issue.source_layer, issue.source_type, issue.source_ref_table, issue.source_ref_id,
      issue.l1_name, issue.l2_name, issue.l3_name, issue.a1_code, issue.a1_name,
      issue.title, issue.what_text, issue.why_text, issue.where_text, issue.who_text,
      issue.when_text, issue.how_text, issue.how_much_text, issue.display_status,
      issue.priority_score, issue.due_at
    ]);
    const saved = issueByKey(issue.issue_key);
    const created = db.prepare(`
      SELECT COUNT(*) AS count
      FROM process_governance_issue_events
      WHERE issue_id=? AND event_type='created'
    `).get(saved.issue_id);
    if (!created.count) addEvent(saved.issue_id, null, 'created', {}, '问题卡已从现有流程治理来源生成', eventPayload(row));
    return saved;
  }

  function upsertPoint(row, issueId) {
    const point = pointShape(row, issueId);
    sqliteRun(db, `
      INSERT INTO process_governance_issue_points (
        issue_id, point_key, point_type, title, prompt_text, enum_options_json,
        evidence_json, requires_mdm_decision, requires_studio_review
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(point_key) DO UPDATE SET
        issue_id=excluded.issue_id,
        point_type=excluded.point_type,
        title=excluded.title,
        prompt_text=excluded.prompt_text,
        enum_options_json=excluded.enum_options_json,
        evidence_json=excluded.evidence_json,
        requires_mdm_decision=excluded.requires_mdm_decision,
        requires_studio_review=excluded.requires_studio_review,
        updated_at=CURRENT_TIMESTAMP
    `, [
      point.issue_id, point.point_key, point.point_type, point.title, point.prompt_text,
      point.enum_options_json, point.evidence_json, point.requires_mdm_decision,
      point.requires_studio_review
    ]);
    return db.prepare('SELECT * FROM process_governance_issue_points WHERE point_key=?').get(point.point_key);
  }

  function resetParticipants(issueId) {
    sqliteRun(db, 'DELETE FROM process_governance_issue_participants WHERE issue_id=?', [issueId]);
  }

  function addParticipants(row, issueId, pointId) {
    resetParticipants(issueId);
    const deptName = row.dept_name || row.primary_dept_name || '';
    const targetDept = row.target_dept_name || row.output_target_dept || '';
    const rows = [
      ['department_drafter', deptName, 'department_contact', 1, '补充并提交部门材料'],
      ['department_reviewer', deptName, 'department_mdm_reviewer', 1, '审核并记录部门决定'],
      ['mdm_gate', null, 'mdm_lead', 0, '检查结构、证据和责任链']
    ];
    if (targetDept) {
      rows.splice(2, 0, ['related_department_reviewer', targetDept, 'department_mdm_reviewer', 1, '记录相关部门决定']);
    }
    rows.forEach(([participantType, participantDept, roleCode, canAct, actionLabel]) => {
      sqliteRun(db, `
        INSERT INTO process_governance_issue_participants
          (issue_id, point_id, participant_type, dept_name, role_code, can_view, can_act, action_label)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `, [issueId, pointId, participantType, participantDept, roleCode, canAct, actionLabel]);
    });
  }

  function listSourceRows(departmentName) {
    const params = [];
    let where = "WHERE r.record_type='a1'";
    if (departmentName) {
      where += ' AND (r.dept_name=? OR t.dept_name=? OR t.target_dept_name=?)';
      params.push(departmentName, departmentName, departmentName);
    }
    return db.prepare(`
      SELECT
        r.id AS record_id,
        r.mapping_key,
        r.dept_name,
        r.domain_name,
        r.l2_name,
        r.l3_name,
        r.a1_code,
        r.behavior,
        r.execution_role,
        r.approval_type,
        r.output_target_dept,
        r.suggested_systems,
        r.verification_note,
        r.source_file AS record_source_file,
        t.id AS todo_id,
        t.todo_key,
        t.todo_type,
        t.target_dept_name,
        COALESCE(t.source_file, r.source_file) AS source_file,
        t.source_line,
        t.message,
        t.suggestion,
        t.status AS todo_status,
        t.priority,
        t.due_date,
        COALESCE(t.latest_snapshot_id, r.latest_snapshot_id) AS source_snapshot_id,
        1 AS evidence_required,
        (
          SELECT e.raw_text
          FROM process_input_baseline_review_items i
          JOIN process_input_baseline_review_excerpts e
            ON e.run_id=i.run_id AND e.stable_key=i.stable_key
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE '%' || r.a1_code || '%'
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE '%' || r.behavior || '%'
            )
          ORDER BY i.display_order, e.display_order
          LIMIT 1
        ) AS evidence_raw_text,
        (
          SELECT e.source_label
          FROM process_input_baseline_review_items i
          JOIN process_input_baseline_review_excerpts e
            ON e.run_id=i.run_id AND e.stable_key=i.stable_key
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE '%' || r.a1_code || '%'
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE '%' || r.behavior || '%'
            )
          ORDER BY i.display_order, e.display_order
          LIMIT 1
        ) AS evidence_source_label,
        (
          SELECT i.source_anchor
          FROM process_input_baseline_review_items i
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE '%' || r.a1_code || '%'
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE '%' || r.behavior || '%'
            )
          ORDER BY i.display_order
          LIMIT 1
        ) AS evidence_source_anchor,
        (
          SELECT i.source_file
          FROM process_input_baseline_review_items i
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE '%' || r.a1_code || '%'
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE '%' || r.behavior || '%'
            )
          ORDER BY i.display_order
          LIMIT 1
        ) AS evidence_source_file,
        (
          SELECT i.document_name
          FROM process_input_baseline_review_items i
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE '%' || r.a1_code || '%'
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE '%' || r.behavior || '%'
            )
          ORDER BY i.display_order
          LIMIT 1
        ) AS evidence_document_name,
        (
          SELECT group_concat(COALESCE(sf.file_no, '') || '||' || COALESCE(sf.file_path, ''), ';;')
          FROM process_source_files sf
          WHERE sf.snapshot_id=COALESCE(t.latest_snapshot_id, r.latest_snapshot_id)
            AND COALESCE(sf.process_status, '') <> '排除'
            AND (sf.dept_name=r.dept_name OR sf.dept_name=t.dept_name OR sf.file_path=COALESCE(t.source_file, r.source_file))
        ) AS source_documents
      FROM process_mapping_records r
      LEFT JOIN process_mapping_todos t ON t.mapping_record_id=r.id
      ${where}
      ORDER BY t.id IS NULL, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.dept_name, r.l3_name, r.a1_code, r.id
      LIMIT 1000
    `).all(...params).map(enrichRowWithMappingEvidence);
  }

  return {
    async initSchema() {
      return true;
    },

    async generateIssuePool(options = {}) {
      const snapshot = db.prepare(`
        SELECT id
        FROM process_governance_snapshots
        WHERE status='active'
        ORDER BY imported_at DESC, id DESC
        LIMIT 1
      `).get();
      const batchKey = options.batchKey || `issue-pool-${Date.now()}`;
      const batchResult = sqliteRun(db, `
        INSERT INTO process_governance_issue_batches
          (batch_key, source_type, source_snapshot_id, department_name, status, generated_by, summary_json)
        VALUES (?, ?, ?, ?, 'preparing', ?, ?)
      `, [
        batchKey,
        options.sourceType || 'process_mapping',
        snapshot && snapshot.id || null,
        options.departmentName || null,
        options.generatedBy || null,
        json({})
      ]);
      const batchId = batchResult.lastInsertRowid;
      let issueCount = 0;
      let pointCount = 0;
      const rows = listSourceRows(options.departmentName || '');
      rows.forEach(sourceRow => {
        const row = { ...sourceRow, source_file: sourceRow.source_file || sourceRow.record_source_file };
        const issue = upsertIssue(row, batchId);
        const point = upsertPoint(row, issue.issue_id);
        addParticipants(row, issue.issue_id, point.point_id);
        issueCount += 1;
        pointCount += 1;
      });
      const summary = { issue_count: issueCount, point_count: pointCount };
      sqliteRun(db, `
        UPDATE process_governance_issue_batches
        SET status='ready', summary_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE batch_id=?
      `, [json(summary), batchId]);
      return { batch: mapTermTaskRow({ batch_id: batchId, batch_key: batchKey, status: 'ready' }), summary };
    },

    async listQueues({ departmentName } = {}) {
      const queues = QUEUE_DEFINITIONS.map(([key, label]) => {
        const params = [];
        let countSql = 'SELECT COUNT(DISTINCT i.issue_id) AS count FROM process_governance_issues i';
        let where = ' WHERE 1=1';
        if (key === 'pending_collaboration') {
          countSql += ' JOIN process_governance_issue_points p ON p.issue_id=i.issue_id';
          where += " AND p.point_status='pending_collaboration'";
        } else {
          where += ' AND i.display_status=?';
          params.push(key);
        }
        if (departmentName) {
          where += ' AND (i.primary_dept_name=? OR i.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i.issue_id AND pp.dept_name=?))';
          params.push(departmentName, departmentName, departmentName);
        }
        const count = db.prepare(`${countSql}${where}`).get(...params).count;
        const preview = db.prepare(`
          SELECT i.issue_id, i.title, i.a1_code, i.a1_name, i.primary_dept_name, i.priority_score
          FROM process_governance_issues i
          WHERE i.issue_id IN (
            SELECT DISTINCT i2.issue_id
            FROM process_governance_issues i2
            ${key === 'pending_collaboration' ? "JOIN process_governance_issue_points p2 ON p2.issue_id=i2.issue_id AND p2.point_status='pending_collaboration'" : ''}
            WHERE ${key === 'pending_collaboration' ? '1=1' : 'i2.display_status=?'}
            ${departmentName ? 'AND (i2.primary_dept_name=? OR i2.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i2.issue_id AND pp.dept_name=?))' : ''}
          )
          ORDER BY i.priority_score DESC, i.updated_at DESC, i.issue_id
          LIMIT 5
        `).all(...params);
        return { display_status: key, key, label, count: Number(count || 0), preview };
      });
      return { items: queues };
    },

    async listIssues({ departmentName, queue, limit, offset } = {}) {
      const params = [];
      let join = '';
      let where = 'WHERE 1=1';
      if (queue === 'pending_collaboration') {
        join = 'JOIN process_governance_issue_points p ON p.issue_id=i.issue_id';
        where += " AND p.point_status='pending_collaboration'";
      } else if (queue) {
        where += ' AND i.display_status=?';
        params.push(queue);
      }
      if (departmentName) {
        where += ' AND (i.primary_dept_name=? OR i.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i.issue_id AND pp.dept_name=?))';
        params.push(departmentName, departmentName, departmentName);
      }
      const safeLimit = positiveInteger(limit, 20, 20) || 20;
      const safeOffset = positiveInteger(offset, 0, 100000);
      const total = db.prepare(`SELECT COUNT(DISTINCT i.issue_id) AS count FROM process_governance_issues i ${join} ${where}`).get(...params).count;
      const items = db.prepare(`
        SELECT DISTINCT i.*
        FROM process_governance_issues i
        ${join}
        ${where}
        ORDER BY i.priority_score DESC, i.updated_at DESC, i.issue_id
        LIMIT ? OFFSET ?
      `).all(...params, safeLimit, safeOffset).map(mapIssueRow);
      return { items, pagination: { total: Number(total || 0), limit: safeLimit, offset: safeOffset } };
    },

    async getIssueDetail(issueId) {
      const issue = db.prepare('SELECT * FROM process_governance_issues WHERE issue_id=?').get(issueId);
      if (!issue) return { issue: null, points: [], participants: [], events: [], termTasks: [] };
      return {
        issue: mapIssueRow(issue),
        points: db.prepare('SELECT * FROM process_governance_issue_points WHERE issue_id=? ORDER BY point_id').all(issueId).map(mapPointRow),
        participants: db.prepare('SELECT * FROM process_governance_issue_participants WHERE issue_id=? ORDER BY participant_id').all(issueId).map(mapParticipantRow),
        events: db.prepare(`
          SELECT e.*, u.name AS actor_user_name
          FROM process_governance_issue_events e
          LEFT JOIN users u ON u.id=e.actor_user_id
          WHERE e.issue_id=?
          ORDER BY e.event_id
        `).all(issueId).map(mapEventRow),
        termTasks: db.prepare('SELECT * FROM process_governance_term_tasks WHERE issue_id=? ORDER BY term_task_id').all(issueId).map(mapTermTaskRow)
      };
    },

    async applyPointAction(pointId, options = {}) {
      const point = db.prepare('SELECT * FROM process_governance_issue_points WHERE point_id=?').get(pointId);
      if (!point) return null;
      const blockedReason = pointActionBlockedReason(point, options);
      if (blockedReason) {
        const detail = await this.getIssueDetail(point.issue_id);
        return {
          blocked: true,
          reason: blockedReason,
          point: detail.points.find(item => Number(item.point_id) === Number(pointId)),
          events: detail.events,
          issue: detail.issue
        };
      }
      const [eventType, nextStep, nextStatus] = normalizeAction(options.action);
      const note = pointActionNote(options);
      const payload = pointActionPayload(options, nextStatus);
      sqliteRun(db, `
        UPDATE process_governance_issue_points
        SET selected_option=?, note=?, current_step=?, point_status=?, updated_at=CURRENT_TIMESTAMP
        WHERE point_id=?
      `, [options.selectedOption || options.selected_option || null, note, nextStep, nextStatus, pointId]);
      const issueStatus = nextStatus === 'accepted'
        ? 'completed'
        : nextStatus === 'pending_mdm_decision'
          ? 'waiting_mdm_decision'
          : nextStatus === 'pending_studio_review'
            ? 'waiting_studio_review'
            : nextStatus === 'pending_department_review'
              ? 'waiting_department_review'
              : 'waiting_my_action';
      sqliteRun(db, 'UPDATE process_governance_issues SET display_status=?, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?', [issueStatus, point.issue_id]);
      addEvent(point.issue_id, pointId, eventType, options, note, payload);
      const detail = await this.getIssueDetail(point.issue_id);
      return { point: detail.points.find(item => Number(item.point_id) === Number(pointId)), events: detail.events, issue: detail.issue };
    },

    async addIssueComment(issueId, options = {}) {
      const issue = db.prepare('SELECT * FROM process_governance_issues WHERE issue_id=?').get(issueId);
      if (!issue) return null;
      addEvent(issueId, null, 'commented', options, options.note || null, null);
      return await this.getIssueDetail(issueId);
    },

    async closeIssue(issueId, options = {}) {
      const issue = db.prepare('SELECT * FROM process_governance_issues WHERE issue_id=?').get(issueId);
      if (!issue) return null;
      sqliteRun(db, "UPDATE process_governance_issues SET display_status='closed', closed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?", [issueId]);
      addEvent(issueId, null, 'closed', options, options.note || '已关闭问题卡', null);
      return await this.getIssueDetail(issueId);
    },

    async reopenIssue(issueId, options = {}) {
      const issue = db.prepare('SELECT * FROM process_governance_issues WHERE issue_id=?').get(issueId);
      if (!issue) return null;
      sqliteRun(db, "UPDATE process_governance_issues SET display_status='waiting_my_action', closed_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?", [issueId]);
      addEvent(issueId, null, 'reopened', options, options.note || '已重新打开问题卡', null);
      return await this.getIssueDetail(issueId);
    },

    async createTermTask(options = {}) {
      const selectedDepartments = asArray(options.selectedDepartments || options.selected_departments);
      const result = sqliteRun(db, `
        INSERT INTO process_governance_term_tasks
          (issue_id, point_id, term_text, context_text, selected_departments_json, status, decision_json, created_by)
        VALUES (?, ?, ?, ?, ?, 'pending_departments', ?, ?)
      `, [
        options.issueId || options.issue_id,
        options.pointId || options.point_id || null,
        options.termText || options.term_text,
        options.contextText || options.context_text || '',
        json(selectedDepartments),
        json({ answers: [] }),
        options.createdBy || options.created_by || null
      ]);
      const task = db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(result.lastInsertRowid);
      addEvent(task.issue_id, task.point_id, 'terminology_task_created', { actorUserId: options.createdBy || options.created_by || null }, `已创建术语统一待办：${task.term_text}`, {
        selected_departments: selectedDepartments
      });
      return { task: mapTermTaskRow(task) };
    },

    async answerTermTask(termTaskId, options = {}) {
      const task = db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(termTaskId);
      if (!task) return { success: false };
      const decision = parseJsonObject(task.decision_json, { answers: [] });
      const answers = asArray(decision.answers);
      answers.push({
        department_name: options.departmentName || options.department_name || '',
        answer: options.answer || '',
        note: options.note || '',
        actor_user_id: options.actorUserId || options.actor_user_id || null,
        answered_at: new Date().toISOString()
      });
      decision.answers = answers;
      sqliteRun(db, `
        UPDATE process_governance_term_tasks
        SET status='pending_mdm_decision', decision_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE term_task_id=?
      `, [json(decision), termTaskId]);
      addEvent(task.issue_id, task.point_id, 'terminology_answered', { actorUserId: options.actorUserId || options.actor_user_id || null, actorDeptName: options.departmentName || options.department_name || '' }, options.note || options.answer || '已回复术语统一待办', {
        answer: options.answer || ''
      });
      return { success: true, task: mapTermTaskRow(db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(termTaskId)) };
    },

    async decideTermTask(termTaskId, options = {}) {
      const task = db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(termTaskId);
      if (!task) return { success: false };
      const existing = parseJsonObject(task.decision_json, { answers: [] });
      const decision = {
        ...existing,
        decision: options.decision || {},
        decided_at: new Date().toISOString()
      };
      sqliteRun(db, `
        UPDATE process_governance_term_tasks
        SET status='decided', decision_json=?, decided_by=?, decided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE term_task_id=?
      `, [json(decision), options.decidedBy || options.decided_by || null, termTaskId]);
      addEvent(task.issue_id, task.point_id, 'terminology_decided', { actorUserId: options.decidedBy || options.decided_by || null, actorRoleCode: 'decision_group' }, '术语裁决结果将进入术语真源', options.decision || {});
      return {
        success: true,
        decision: options.decision || {},
        task: mapTermTaskRow(db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(termTaskId))
      };
    }
  };
}

async function mysqlQuery(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function mysqlRun(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

function makeProcessGovernanceIssuePoolRepository(pool) {
  async function addEvent(issueId, pointId, eventType, actor = {}, note = '', payload = null) {
    await mysqlRun(pool, `
      INSERT INTO process_governance_issue_events
        (issue_id, point_id, event_type, actor_user_id, actor_dept_name, actor_role_code, note, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      issueId,
      pointId || null,
      eventType,
      actor.actorUserId || actor.actor_user_id || null,
      actor.actorDeptName || actor.actor_dept_name || null,
      actor.actorRoleCode || actor.actor_role_code || null,
      note || null,
      payload == null ? null : json(payload)
    ]);
  }

  async function upsertIssue(row, batchId) {
    const issue = issueShape(row, batchId);
    await mysqlRun(pool, `
      INSERT INTO process_governance_issues (
        issue_key, batch_id, primary_dept_name, owner_dept_name, source_layer, source_type,
        source_ref_table, source_ref_id, l1_name, l2_name, l3_name, a1_code, a1_name,
        title, what_text, why_text, where_text, who_text, when_text, how_text, how_much_text,
        display_status, priority_score, due_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        batch_id=VALUES(batch_id),
        primary_dept_name=VALUES(primary_dept_name),
        owner_dept_name=VALUES(owner_dept_name),
        source_layer=VALUES(source_layer),
        source_type=VALUES(source_type),
        source_ref_table=VALUES(source_ref_table),
        source_ref_id=VALUES(source_ref_id),
        l2_name=VALUES(l2_name),
        l3_name=VALUES(l3_name),
        a1_code=VALUES(a1_code),
        a1_name=VALUES(a1_name),
        title=VALUES(title),
        what_text=VALUES(what_text),
        why_text=VALUES(why_text),
        where_text=VALUES(where_text),
        who_text=VALUES(who_text),
        when_text=VALUES(when_text),
        how_text=VALUES(how_text),
        how_much_text=VALUES(how_much_text),
        display_status=VALUES(display_status),
        priority_score=VALUES(priority_score),
        due_at=VALUES(due_at),
        updated_at=CURRENT_TIMESTAMP
    `, [
      issue.issue_key, issue.batch_id, issue.primary_dept_name, issue.owner_dept_name,
      issue.source_layer, issue.source_type, issue.source_ref_table, issue.source_ref_id,
      issue.l1_name, issue.l2_name, issue.l3_name, issue.a1_code, issue.a1_name,
      issue.title, issue.what_text, issue.why_text, issue.where_text, issue.who_text,
      issue.when_text, issue.how_text, issue.how_much_text, issue.display_status,
      issue.priority_score, issue.due_at
    ]);
    const [saved] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_key=?', [issue.issue_key]);
    const [created] = await mysqlQuery(pool, `
      SELECT COUNT(*) AS count
      FROM process_governance_issue_events
      WHERE issue_id=? AND event_type='created'
    `, [saved.issue_id]);
    if (!Number(created.count || 0)) await addEvent(saved.issue_id, null, 'created', {}, '问题卡已从现有流程治理来源生成', eventPayload(row));
    return saved;
  }

  async function upsertPoint(row, issueId) {
    const point = pointShape(row, issueId);
    await mysqlRun(pool, `
      INSERT INTO process_governance_issue_points (
        issue_id, point_key, point_type, title, prompt_text, enum_options_json,
        evidence_json, requires_mdm_decision, requires_studio_review
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        issue_id=VALUES(issue_id),
        point_type=VALUES(point_type),
        title=VALUES(title),
        prompt_text=VALUES(prompt_text),
        enum_options_json=VALUES(enum_options_json),
        evidence_json=VALUES(evidence_json),
        requires_mdm_decision=VALUES(requires_mdm_decision),
        requires_studio_review=VALUES(requires_studio_review),
        updated_at=CURRENT_TIMESTAMP
    `, [
      point.issue_id, point.point_key, point.point_type, point.title, point.prompt_text,
      point.enum_options_json, point.evidence_json, point.requires_mdm_decision,
      point.requires_studio_review
    ]);
    const [saved] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issue_points WHERE point_key=?', [point.point_key]);
    return saved;
  }

  async function addParticipants(row, issueId, pointId) {
    await mysqlRun(pool, 'DELETE FROM process_governance_issue_participants WHERE issue_id=?', [issueId]);
    const deptName = row.dept_name || row.primary_dept_name || '';
    const targetDept = row.target_dept_name || row.output_target_dept || '';
    const rows = [
      ['department_drafter', deptName, 'department_contact', 1, '补充并提交部门材料'],
      ['department_reviewer', deptName, 'department_mdm_reviewer', 1, '审核并记录部门决定'],
      ['mdm_gate', null, 'mdm_lead', 0, '检查结构、证据和责任链']
    ];
    if (targetDept) {
      rows.splice(2, 0, ['related_department_reviewer', targetDept, 'department_mdm_reviewer', 1, '记录相关部门决定']);
    }
    for (const [participantType, participantDept, roleCode, canAct, actionLabel] of rows) {
      await mysqlRun(pool, `
        INSERT INTO process_governance_issue_participants
          (issue_id, point_id, participant_type, dept_name, role_code, can_view, can_act, action_label)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `, [issueId, pointId, participantType, participantDept, roleCode, canAct, actionLabel]);
    }
  }

  async function sourceRows(departmentName) {
    const params = [];
    let where = "WHERE r.record_type='a1'";
    if (departmentName) {
      where += ' AND (r.dept_name=? OR t.dept_name=? OR t.target_dept_name=?)';
      params.push(departmentName, departmentName, departmentName);
    }
    const rows = await mysqlQuery(pool, `
      SELECT
        r.id AS record_id,
        r.mapping_key,
        r.dept_name,
        r.domain_name,
        r.l2_name,
        r.l3_name,
        r.a1_code,
        r.behavior,
        r.execution_role,
        r.approval_type,
        r.output_target_dept,
        r.suggested_systems,
        r.verification_note,
        r.source_file AS record_source_file,
        t.id AS todo_id,
        t.todo_key,
        t.todo_type,
        t.target_dept_name,
        COALESCE(t.source_file, r.source_file) AS source_file,
        t.source_line,
        t.message,
        t.suggestion,
        t.status AS todo_status,
        t.priority,
        t.due_date,
        COALESCE(t.latest_snapshot_id, r.latest_snapshot_id) AS source_snapshot_id,
        1 AS evidence_required,
        (
          SELECT e.raw_text
          FROM process_input_baseline_review_items i
          JOIN process_input_baseline_review_excerpts e
            ON e.run_id=i.run_id AND e.stable_key=i.stable_key
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE CONCAT('%', r.a1_code, '%')
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE CONCAT('%', r.behavior, '%')
            )
          ORDER BY i.display_order, e.display_order
          LIMIT 1
        ) AS evidence_raw_text,
        (
          SELECT e.source_label
          FROM process_input_baseline_review_items i
          JOIN process_input_baseline_review_excerpts e
            ON e.run_id=i.run_id AND e.stable_key=i.stable_key
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE CONCAT('%', r.a1_code, '%')
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE CONCAT('%', r.behavior, '%')
            )
          ORDER BY i.display_order, e.display_order
          LIMIT 1
        ) AS evidence_source_label,
        (
          SELECT i.source_anchor
          FROM process_input_baseline_review_items i
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE CONCAT('%', r.a1_code, '%')
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE CONCAT('%', r.behavior, '%')
            )
          ORDER BY i.display_order
          LIMIT 1
        ) AS evidence_source_anchor,
        (
          SELECT i.source_file
          FROM process_input_baseline_review_items i
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE CONCAT('%', r.a1_code, '%')
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE CONCAT('%', r.behavior, '%')
            )
          ORDER BY i.display_order
          LIMIT 1
        ) AS evidence_source_file,
        (
          SELECT i.document_name
          FROM process_input_baseline_review_items i
          WHERE i.department=r.dept_name
            AND (
              i.mapping_location LIKE CONCAT('%', r.a1_code, '%')
              OR i.content=t.message
              OR i.suggested_action=t.suggestion
              OR i.mapping_location LIKE CONCAT('%', r.behavior, '%')
            )
          ORDER BY i.display_order
          LIMIT 1
        ) AS evidence_document_name,
        (
          SELECT GROUP_CONCAT(CONCAT(COALESCE(sf.file_no, ''), '||', COALESCE(sf.file_path, '')) SEPARATOR ';;')
          FROM process_source_files sf
          WHERE sf.snapshot_id=COALESCE(t.latest_snapshot_id, r.latest_snapshot_id)
            AND COALESCE(sf.process_status, '') <> '排除'
            AND (sf.dept_name=r.dept_name OR sf.dept_name=t.dept_name OR sf.file_path=COALESCE(t.source_file, r.source_file))
        ) AS source_documents
      FROM process_mapping_records r
      LEFT JOIN process_mapping_todos t ON t.mapping_record_id=r.id
      ${where}
      ORDER BY t.id IS NULL, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.dept_name, r.l3_name, r.a1_code, r.id
      LIMIT 1000
    `, params);
    const enrichedRows = rows.map(enrichRowWithMappingEvidence);
    for (const row of enrichedRows) {
      const fileNo = expectedSourceFileNoForRow(row);
      if (!fileNo || !row.source_snapshot_id) continue;
      const fileNoUpper = normalizeSourceFileNo(fileNo);
      const documents = await mysqlQuery(pool, `
        SELECT file_no, file_path
        FROM process_source_files
        WHERE snapshot_id=?
          AND COALESCE(process_status, '') <> '排除'
          AND (
            UPPER(REPLACE(REPLACE(COALESCE(file_no, ''), '_', '-'), '/', '-'))=?
            OR UPPER(REPLACE(REPLACE(COALESCE(file_path, ''), '_', '-'), '/', '-')) LIKE CONCAT('%', ?, '%')
          )
        ORDER BY file_path
        LIMIT 20
      `, [row.source_snapshot_id, fileNoUpper, fileNoUpper]);
      const document = documents.find(item => sourceFileNoMatches(fileNo, inferDocumentSourceFileNo(item.file_no, item.file_path)));
      if (document && document.file_path) {
        const currentDocuments = cleanText(row.source_documents);
        row.source_documents = `${fileNo}||${document.file_path}${currentDocuments ? `;;${currentDocuments}` : ''}`;
      }
    }
    return enrichedRows;
  }

  return {
    async initSchema() {
      for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
        await pool.execute(statement);
      }
    },

    async generateIssuePool(options = {}) {
      const [snapshot] = await mysqlQuery(pool, `
        SELECT id
        FROM process_governance_snapshots
        WHERE status='active'
        ORDER BY imported_at DESC, id DESC
        LIMIT 1
      `);
      const batchKey = options.batchKey || `issue-pool-${Date.now()}`;
      const result = await mysqlRun(pool, `
        INSERT INTO process_governance_issue_batches
          (batch_key, source_type, source_snapshot_id, department_name, status, generated_by, summary_json)
        VALUES (?, ?, ?, ?, 'preparing', ?, ?)
      `, [
        batchKey,
        options.sourceType || 'process_mapping',
        snapshot && snapshot.id || null,
        options.departmentName || null,
        options.generatedBy || null,
        json({})
      ]);
      const batchId = result.insertId;
      let issueCount = 0;
      let pointCount = 0;
      for (const sourceRow of await sourceRows(options.departmentName || '')) {
        const row = { ...sourceRow, source_file: sourceRow.source_file || sourceRow.record_source_file };
        const issue = await upsertIssue(row, batchId);
        const point = await upsertPoint(row, issue.issue_id);
        await addParticipants(row, issue.issue_id, point.point_id);
        issueCount += 1;
        pointCount += 1;
      }
      const summary = { issue_count: issueCount, point_count: pointCount };
      await mysqlRun(pool, `
        UPDATE process_governance_issue_batches
        SET status='ready', summary_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE batch_id=?
      `, [json(summary), batchId]);
      return { batch: { batch_id: batchId, batch_key: batchKey, status: 'ready' }, summary };
    },

    async listQueues({ departmentName } = {}) {
      const queues = [];
      for (const [key, label] of QUEUE_DEFINITIONS) {
        const params = [];
        let countSql = 'SELECT COUNT(DISTINCT i.issue_id) AS count FROM process_governance_issues i';
        let where = ' WHERE 1=1';
        if (key === 'pending_collaboration') {
          countSql += ' JOIN process_governance_issue_points p ON p.issue_id=i.issue_id';
          where += " AND p.point_status='pending_collaboration'";
        } else {
          where += ' AND i.display_status=?';
          params.push(key);
        }
        if (departmentName) {
          where += ' AND (i.primary_dept_name=? OR i.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i.issue_id AND pp.dept_name=?))';
          params.push(departmentName, departmentName, departmentName);
        }
        const [countRow] = await mysqlQuery(pool, `${countSql}${where}`, params);
        const preview = await mysqlQuery(pool, `
          SELECT i.issue_id, i.title, i.a1_code, i.a1_name, i.primary_dept_name, i.priority_score
          FROM process_governance_issues i
          WHERE i.issue_id IN (
            SELECT DISTINCT i2.issue_id
            FROM process_governance_issues i2
            ${key === 'pending_collaboration' ? "JOIN process_governance_issue_points p2 ON p2.issue_id=i2.issue_id AND p2.point_status='pending_collaboration'" : ''}
            WHERE ${key === 'pending_collaboration' ? '1=1' : 'i2.display_status=?'}
            ${departmentName ? 'AND (i2.primary_dept_name=? OR i2.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i2.issue_id AND pp.dept_name=?))' : ''}
          )
          ORDER BY i.priority_score DESC, i.updated_at DESC, i.issue_id
          LIMIT 5
        `, params);
        queues.push({ display_status: key, key, label, count: Number(countRow.count || 0), preview });
      }
      return { items: queues };
    },

    async listIssues({ departmentName, queue, limit, offset } = {}) {
      const params = [];
      let join = '';
      let where = 'WHERE 1=1';
      if (queue === 'pending_collaboration') {
        join = 'JOIN process_governance_issue_points p ON p.issue_id=i.issue_id';
        where += " AND p.point_status='pending_collaboration'";
      } else if (queue) {
        where += ' AND i.display_status=?';
        params.push(queue);
      }
      if (departmentName) {
        where += ' AND (i.primary_dept_name=? OR i.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i.issue_id AND pp.dept_name=?))';
        params.push(departmentName, departmentName, departmentName);
      }
      const safeLimit = positiveInteger(limit, 20, 20) || 20;
      const safeOffset = positiveInteger(offset, 0, 100000);
      const [count] = await mysqlQuery(pool, `SELECT COUNT(DISTINCT i.issue_id) AS count FROM process_governance_issues i ${join} ${where}`, params);
      const items = await mysqlQuery(pool, `
        SELECT DISTINCT i.*
        FROM process_governance_issues i
        ${join}
        ${where}
        ORDER BY i.priority_score DESC, i.updated_at DESC, i.issue_id
        LIMIT ? OFFSET ?
      `, [...params, String(safeLimit), String(safeOffset)]);
      return { items: items.map(mapIssueRow), pagination: { total: Number(count.count || 0), limit: safeLimit, offset: safeOffset } };
    },

    async getIssueDetail(issueId) {
      const [issue] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_id=?', [issueId]);
      if (!issue) return { issue: null, points: [], participants: [], events: [], termTasks: [] };
      const points = await mysqlQuery(pool, 'SELECT * FROM process_governance_issue_points WHERE issue_id=? ORDER BY point_id', [issueId]);
      const participants = await mysqlQuery(pool, 'SELECT * FROM process_governance_issue_participants WHERE issue_id=? ORDER BY participant_id', [issueId]);
      const events = await mysqlQuery(pool, `
        SELECT e.*, u.name AS actor_user_name
        FROM process_governance_issue_events e
        LEFT JOIN users u ON u.id=e.actor_user_id
        WHERE e.issue_id=?
        ORDER BY e.event_id
      `, [issueId]);
      const termTasks = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE issue_id=? ORDER BY term_task_id', [issueId]);
      return {
        issue: mapIssueRow(issue),
        points: points.map(mapPointRow),
        participants: participants.map(mapParticipantRow),
        events: events.map(mapEventRow),
        termTasks: termTasks.map(mapTermTaskRow)
      };
    },

    async getIssueDetailByPoint(pointId) {
      const [point] = await mysqlQuery(pool, 'SELECT issue_id FROM process_governance_issue_points WHERE point_id=?', [pointId]);
      if (!point) return { issue: null, points: [], participants: [], events: [], termTasks: [] };
      return await this.getIssueDetail(point.issue_id);
    },

    async applyPointAction(pointId, options = {}) {
      const [point] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issue_points WHERE point_id=?', [pointId]);
      if (!point) return null;
      const blockedReason = pointActionBlockedReason(point, options);
      if (blockedReason) {
        const detail = await this.getIssueDetail(point.issue_id);
        return {
          blocked: true,
          reason: blockedReason,
          point: detail.points.find(item => Number(item.point_id) === Number(pointId)),
          events: detail.events,
          issue: detail.issue
        };
      }
      const [eventType, nextStep, nextStatus] = normalizeAction(options.action);
      const note = pointActionNote(options);
      const payload = pointActionPayload(options, nextStatus);
      await mysqlRun(pool, `
        UPDATE process_governance_issue_points
        SET selected_option=?, note=?, current_step=?, point_status=?, updated_at=CURRENT_TIMESTAMP
        WHERE point_id=?
      `, [options.selectedOption || options.selected_option || null, note, nextStep, nextStatus, pointId]);
      const issueStatus = nextStatus === 'accepted'
        ? 'completed'
        : nextStatus === 'pending_mdm_decision'
          ? 'waiting_mdm_decision'
          : nextStatus === 'pending_studio_review'
            ? 'waiting_studio_review'
            : nextStatus === 'pending_department_review'
              ? 'waiting_department_review'
              : 'waiting_my_action';
      await mysqlRun(pool, 'UPDATE process_governance_issues SET display_status=?, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?', [issueStatus, point.issue_id]);
      await addEvent(point.issue_id, pointId, eventType, options, note, payload);
      const detail = await this.getIssueDetail(point.issue_id);
      return { point: detail.points.find(item => Number(item.point_id) === Number(pointId)), events: detail.events, issue: detail.issue };
    },

    async addIssueComment(issueId, options = {}) {
      const [issue] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_id=?', [issueId]);
      if (!issue) return null;
      await addEvent(issueId, null, 'commented', options, options.note || null, null);
      return await this.getIssueDetail(issueId);
    },

    async closeIssue(issueId, options = {}) {
      const [issue] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_id=?', [issueId]);
      if (!issue) return null;
      await mysqlRun(pool, "UPDATE process_governance_issues SET display_status='closed', closed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?", [issueId]);
      await addEvent(issueId, null, 'closed', options, options.note || '已关闭问题卡', null);
      return await this.getIssueDetail(issueId);
    },

    async reopenIssue(issueId, options = {}) {
      const [issue] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_id=?', [issueId]);
      if (!issue) return null;
      await mysqlRun(pool, "UPDATE process_governance_issues SET display_status='waiting_my_action', closed_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?", [issueId]);
      await addEvent(issueId, null, 'reopened', options, options.note || '已重新打开问题卡', null);
      return await this.getIssueDetail(issueId);
    },

    async createTermTask(options = {}) {
      const selectedDepartments = asArray(options.selectedDepartments || options.selected_departments);
      const result = await mysqlRun(pool, `
        INSERT INTO process_governance_term_tasks
          (issue_id, point_id, term_text, context_text, selected_departments_json, status, decision_json, created_by)
        VALUES (?, ?, ?, ?, ?, 'pending_departments', ?, ?)
      `, [
        options.issueId || options.issue_id,
        options.pointId || options.point_id || null,
        options.termText || options.term_text,
        options.contextText || options.context_text || '',
        json(selectedDepartments),
        json({ answers: [] }),
        options.createdBy || options.created_by || null
      ]);
      const [task] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [result.insertId]);
      await addEvent(task.issue_id, task.point_id, 'terminology_task_created', { actorUserId: options.createdBy || options.created_by || null }, `已创建术语统一待办：${task.term_text}`, {
        selected_departments: selectedDepartments
      });
      return { task: mapTermTaskRow(task) };
    },

    async getTermTask(termTaskId) {
      const [task] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [termTaskId]);
      return mapTermTaskRow(task);
    },

    async answerTermTask(termTaskId, options = {}) {
      const [task] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [termTaskId]);
      if (!task) return { success: false };
      const decision = parseJsonObject(task.decision_json, { answers: [] });
      const answers = asArray(decision.answers);
      answers.push({
        department_name: options.departmentName || options.department_name || '',
        answer: options.answer || '',
        note: options.note || '',
        actor_user_id: options.actorUserId || options.actor_user_id || null,
        answered_at: new Date().toISOString()
      });
      decision.answers = answers;
      await mysqlRun(pool, `
        UPDATE process_governance_term_tasks
        SET status='pending_mdm_decision', decision_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE term_task_id=?
      `, [json(decision), termTaskId]);
      await addEvent(task.issue_id, task.point_id, 'terminology_answered', { actorUserId: options.actorUserId || options.actor_user_id || null, actorDeptName: options.departmentName || options.department_name || '' }, options.note || options.answer || '已回复术语统一待办', {
        answer: options.answer || ''
      });
      const [updated] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [termTaskId]);
      return { success: true, task: mapTermTaskRow(updated) };
    },

    async decideTermTask(termTaskId, options = {}) {
      const [task] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [termTaskId]);
      if (!task) return { success: false };
      const existing = parseJsonObject(task.decision_json, { answers: [] });
      const decision = { ...existing, decision: options.decision || {}, decided_at: new Date().toISOString() };
      await mysqlRun(pool, `
        UPDATE process_governance_term_tasks
        SET status='decided', decision_json=?, decided_by=?, decided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE term_task_id=?
      `, [json(decision), options.decidedBy || options.decided_by || null, termTaskId]);
      await addEvent(task.issue_id, task.point_id, 'terminology_decided', { actorUserId: options.decidedBy || options.decided_by || null, actorRoleCode: 'decision_group' }, '术语裁决结果将进入术语真源', options.decision || {});
      const [updated] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [termTaskId]);
      return { success: true, decision: options.decision || {}, task: mapTermTaskRow(updated) };
    }
  };
}

module.exports = {
  QUEUE_DEFINITIONS,
  makeProcessGovernanceIssuePoolRepository,
  makeSqliteProcessGovernanceIssuePoolRepository
};
