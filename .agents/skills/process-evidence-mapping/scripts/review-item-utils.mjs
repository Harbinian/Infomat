import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TODO_TYPES = [
  '待确认L3',
  '待确认A1',
  '角色待确认',
  '审批链待确认',
  '受控传递待确认',
  'OCR待复核',
  '验收标准待补',
  '归档要求待补',
  '系统落位待确认',
];

export function parseArgs(argv, defaults = {}) {
  const args = { ...defaults };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unknown argument: ${key}`);
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = next;
      index += 1;
    }
  }
  return args;
}

export function requireArg(args, name) {
  if (!args[name]) throw new Error(`Missing --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  ensureParent(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function writeJsonl(filePath, records) {
  ensureParent(filePath);
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  fs.writeFileSync(filePath, body ? `${body}\n` : '', 'utf8');
}

export function sha1Text(text) {
  return crypto.createHash('sha1').update(String(text ?? '')).digest('hex');
}

export function sha1File(filePath) {
  return sha1Text(fs.existsSync(filePath) ? fs.readFileSync(filePath) : '');
}

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[|｜,，.。;；:："'“”‘’`~!！?？()（）[\]【】{}<>《》、/\\_-]/g, '');
}

export function mappingCovers(mappingText, content) {
  const normalizedMapping = normalizeText(mappingText);
  const normalizedContent = normalizeText(content);
  if (!normalizedContent || normalizedContent.length < 4) return false;
  return normalizedMapping.includes(normalizedContent);
}

export function escapeMarkdownCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

export function shorten(value, max = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function sourceAnchor(chunk) {
  if (!chunk) return '';
  const parts = [];
  if (chunk.doc_no) parts.push(chunk.doc_no);
  if (chunk.clause) parts.push(`§${chunk.clause}`);
  if (chunk.table_id) parts.push(`${chunk.table_id}${chunk.row_id ? `R${chunk.row_id}` : ''}`);
  if (chunk.paragraph_id) parts.push(chunk.paragraph_id);
  return parts.join(' ');
}

export function evidenceFromChunk(chunk) {
  return {
    source_file: chunk?.source_file || '',
    source_anchor: sourceAnchor(chunk),
    source_excerpt: chunk?.raw_text || '',
    chunk_id: chunk?.chunk_id || '',
    evidence_status: 'needs_review',
    verification_status: 'unverified',
    review_required: true,
    allowed_downstream_use: 'review_only',
    source_boundary_flag: chunk?.source_boundary_flag || '',
    source_boundary_label: chunk?.source_boundary_label || '',
    source_acceptance_status: chunk?.source_acceptance_status || '',
    source_boundary_allowed_downstream_use: chunk?.source_boundary_allowed_downstream_use || '',
    customer_acceptance_required: Boolean(chunk?.customer_acceptance_required),
  };
}

export function findChunk(chunks, patterns, options = {}) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return chunks.find((chunk) => {
    const text = `${chunk.raw_text || ''}\n${chunk.clause_title || ''}`;
    return options.all
      ? list.every((pattern) => pattern.test ? pattern.test(text) : text.includes(pattern))
      : list.some((pattern) => pattern.test ? pattern.test(text) : text.includes(pattern));
  }) || null;
}

export function makeReviewItemItem({
  department,
  sourceFile,
  sourceAnchor: anchor,
  issueType,
  content,
  mappingLocation = '未在当前映射中形成受控条目',
  suggestedAction,
  owner = '待部门确认',
}) {
  if (!TODO_TYPES.includes(issueType)) {
    throw new Error(`Unsupported issue type: ${issueType}`);
  }
  const contentHash = sha1Text(content).slice(0, 12);
  const stableKey = sha1Text([
    department,
    sourceFile,
    anchor,
    issueType,
    contentHash,
  ].join('|')).slice(0, 12);
  return {
    id: `IBR-${stableKey.toUpperCase()}`,
    stable_key: stableKey,
    department,
    source_file: sourceFile,
    source_anchor: anchor,
    issue_type: issueType,
    content,
    content_hash: contentHash,
    mapping_location: mappingLocation,
    suggested_action: suggestedAction,
    status: '待处理',
    owner,
  };
}
