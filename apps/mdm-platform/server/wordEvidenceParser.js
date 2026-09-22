// CPU-only DOCX structural extraction; no Office automation, links or document execution.
const crypto = require('node:crypto');
const { SaxesParser } = require('saxes');
const { inspectArchive } = require('./masterDataTemplate');
const { digest } = require('./dataMapDefinitionValues');
const VERSION = 'word-evidence-docx-v1';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, expanded: 32 * 1024 * 1024,
  entries: 1000, nodes: 100000, depth: 128, anchors: 20000, text: 2 * 1024 * 1024,
  snapshot: 12 * 1024 * 1024, requiredParts: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'], validateCrc: true });
const fail = (name, statusCode = 400) => Object.assign(new Error('DEFINITION_WORD_' + name), { code: 'DEFINITION_WORD_' + name, statusCode });
const isWord = node => [W, WS].includes(node.uri);
function xmlTree(bytes) {
  // Restrict to UTF-8 OOXML; do not silently replace malformed byte sequences.
  let xml;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw fail('ENCODING'); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail('ACTIVE_CONTENT');
  const parser = new SaxesParser({ xmlns: true }), stack = [];
  let root, nodes = 0;
  parser.on('error', () => { throw fail('DAMAGED'); });
  parser.on('doctype', () => { throw fail('ACTIVE_CONTENT'); });
  parser.on('opentag', tag => {
    if (++nodes > LIMITS.nodes || stack.length >= LIMITS.depth) throw fail('LIMIT', 413);
    const node = { local: tag.local, uri: tag.uri, attrs: tag.attributes, children: [], text: '' };
    if (stack.length) stack[stack.length - 1].children.push(node); else root = node;
    stack.push(node);
  });
  parser.on('text', text => { if (stack.length) stack[stack.length - 1].text += text; });
  parser.on('cdata', text => { if (stack.length) stack[stack.length - 1].text += text; });
  parser.on('closetag', () => { stack.pop(); });
  parser.write(xml).close();
  if (!root || stack.length) throw fail('DAMAGED');
  return root;
}
function walk(node, fn) { fn(node); for (const child of node.children) walk(child, fn); }
function attribute(node, local) { return Object.values(node.attrs).find(a => a.local === local)?.value ?? null; }
function extract(bytes, originalName) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail('EMPTY');
  if (bytes.length > LIMITS.bytes) throw fail('LIMIT', 413);
  if (typeof originalName !== 'string' || originalName.length > 255 || !/\.docx$/i.test(originalName)) throw fail('TYPE');
  if (bytes.subarray(0,8).toString('hex') === 'd0cf11e0a1b11ae1') throw fail('TYPE');
  const parts = new Map(); let archive;
  try { archive = inspectArchive(bytes, LIMITS, (name, data) => {
    if (/\.xml$|\.rels$/i.test(name)) parts.set(name, xmlTree(data));
  }); } catch (e) {
    if (/^DEFINITION_WORD_/.test(e.code || '')) throw e;
    throw fail(/LIMIT/.test(e.code || '') ? 'LIMIT' : /ACTIVE/.test(e.code || '') ? 'ACTIVE_CONTENT' : 'DAMAGED', e.statusCode || 400);
  }
  const omittedParts = [], notes = new Set();
  for (const [name, root] of parts) {
    walk(root, node => {
      if (node.local === 'Relationship') {
        const type = attribute(node, 'Type') || '';
        if (attribute(node, 'TargetMode')?.toLowerCase() === 'external') {
          if (!type.endsWith('/hyperlink')) throw fail('EXTERNAL_CONTENT');
          notes.add('超链接仅保留显示文字，不跟随目标');
        }
        if (/attachedTemplate|aFChunk|oleObject|activeX|vbaProject/i.test(type)) throw fail('ACTIVE_CONTENT');
      }
      if (node.local === 'Override' && /macroEnabled|vbaProject/i.test(attribute(node, 'ContentType') || '')) throw fail('ACTIVE_CONTENT');
      if (isWord(node) && ['object', 'altChunk', 'subDoc', 'control'].includes(node.local)) throw fail('ACTIVE_CONTENT');
    });
    if (/^word\/(?:header|footer|footnotes|endnotes|comments)/i.test(name)) omittedParts.push(name);
  }
  const root = parts.get('word/document.xml');
  const contentTypes = parts.get('[Content_Types].xml');
  if(contentTypes.local!=='Types'||contentTypes.uri!=='http://schemas.openxmlformats.org/package/2006/content-types')throw fail('TYPE');
  const mainTypes = contentTypes.children.filter(n => n.local === 'Override' && attribute(n, 'PartName') === '/word/document.xml');
  if (mainTypes.length !== 1 || attribute(mainTypes[0], 'ContentType') !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') throw fail('TYPE');
  const relationships=parts.get('_rels/.rels');
  const mainRelationships=relationships.children.filter(n=>n.local==='Relationship'&&(attribute(n,'Type')||'').endsWith('/officeDocument'));
  if(mainRelationships.length!==1||!['word/document.xml','/word/document.xml'].includes(attribute(mainRelationships[0],'Target'))||attribute(mainRelationships[0],'TargetMode')==='External')throw fail('TYPE');
  if (!isWord(root) || root.local !== 'document') throw fail('DAMAGED');
  const bodies = root.children.filter(n => isWord(n) && n.local === 'body');
  if (bodies.length !== 1) throw fail('DAMAGED');
  const anchors = []; let textBytes = 0;
  function visit(node, xpath, parentAnchor = null, excluded = false) {
    if (node.uri === 'http://schemas.openxmlformats.org/markup-compatibility/2006' && node.local === 'AlternateContent') {
      notes.add('替代表示区未提取，避免把Choice与Fallback重复当作正文'); return;
    }
    const word = isWord(node);
    const skip = excluded || (word && ['drawing', 'pict', 'txbxContent', 'del', 'moveFrom'].includes(node.local));
    if (skip) { if (!excluded) notes.add('图片、绘图文字、删除及移出修订未提取'); return; }
    if (word && ['ins', 'moveTo'].includes(node.local)) notes.add('新增及移入修订按现存文字提取，未确认修订接受状态');
    if (word && ['sdt', 'customXml'].includes(node.local)) notes.add('内容控件与自定义XML仅提取现存正文，不更新绑定数据');
    let anchor = null;
    if (word && ['p', 'tbl', 'tr', 'tc'].includes(node.local)) {
      if (anchors.length >= LIMITS.anchors) throw fail('LIMIT', 413);
      anchor = { anchor_id: 'a' + anchors.length, order: anchors.length, kind: { p: 'paragraph', tbl: 'table', tr: 'row', tc: 'cell' }[node.local],
        part: 'word/document.xml', xml_path: xpath, parent_anchor: parentAnchor, text: '', page: null };
      if (node.local === 'p') {
        const collect = n => {
          if (n.uri === 'http://schemas.openxmlformats.org/markup-compatibility/2006' && n.local === 'AlternateContent') { notes.add('替代表示区未提取，避免把Choice与Fallback重复当作正文'); return; }
          if (isWord(n) && ['drawing', 'pict', 'txbxContent', 'del', 'moveFrom', 'p'].includes(n.local) && n !== node) return;
          if (isWord(n) && n.local === 't') anchor.text += n.text;
          if (isWord(n) && ['tab', 'br', 'cr'].includes(n.local)) anchor.text += n.local === 'tab' ? '\t' : '\n';
          if (isWord(n) && ['instrText', 'fldSimple', 'fldChar'].includes(n.local)) notes.add('域代码不执行；只保留已有显示文字，可能过期');
          for (const child of n.children) collect(child);
        };
        collect(node); textBytes += Buffer.byteLength(anchor.text);
        if (textBytes > LIMITS.text) throw fail('LIMIT', 413);
      }
      anchors.push(anchor); parentAnchor = anchor.anchor_id;
    }
    const counts = new Map();
    for (const child of node.children) {
      const key = `{${child.uri}}${child.local}`, index = (counts.get(key) || 0) + 1; counts.set(key, index);
      visit(child, `${xpath}/${isWord(child) ? 'w:' : '{' + child.uri + '}'}${child.local}[${index}]`, parentAnchor, skip);
    }
  }
  visit(bodies[0], '/w:document[1]/w:body[1]');
  const document = { format: VERSION, anchors, coverage: {
    extraction_status: anchors.some(a => a.text.trim()) ? 'extracted' : 'empty',
    paragraph_count: anchors.filter(a => a.kind === 'paragraph').length,
    table_count: anchors.filter(a => a.kind === 'table').length,
    cell_count: anchors.filter(a => a.kind === 'cell').length, rendered: false, page_numbers_available: false,
    omitted_parts: omittedParts, not_covered: ['未经渲染，不提供页码或跨页定位', '不提取页眉页脚、批注、脚注、尾注及图片文字',
      '不计算编号、域、目录或版式；表格保留XML顺序，合并单元格不重建视觉网格',
      '不认定业务事实、主数据、权威来源或对象同一性', ...notes] } };
  if (Buffer.byteLength(JSON.stringify(document)) > LIMITS.snapshot) throw fail('LIMIT', 413);
  return { original_name: originalName.split(/[\\/]/).pop(), raw_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    byte_length: bytes.length, parser_version: VERSION, archive, document, content_digest: digest(document) };
}
function locate(document, anchorId) {
  if (!document || document.format !== VERSION || typeof anchorId !== 'string') throw fail('LOCATOR', 404);
  const anchor = document.anchors.find(a => a.anchor_id === anchorId);
  if (!anchor) throw fail('LOCATOR', 404);
  return anchor;
}
let active = 0;
async function parseWordEvidence(bytes, name) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes) throw fail('LIMIT', 413);
  if (active >= 2) throw fail('BUSY', 503);
  active++;
  const { Worker } = require('node:worker_threads'); let worker, timer;
  try {
    worker = new Worker(require.resolve('./wordEvidenceThread'), { workerData: { bytes, name }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(fail('TIMEOUT', 413)), 15000);
      worker.once('message', m => m.result ? resolve(m.result) : reject(Object.assign(fail('DAMAGED'), m.error)));
      worker.once('error', () => reject(fail('RESOURCE_LIMIT', 413)));
      worker.once('exit', () => reject(fail('RESOURCE_LIMIT', 413)));
    });
  } finally { clearTimeout(timer); if (worker) await worker.terminate(); active--; }
}
module.exports = { VERSION, LIMITS, extract, parseWordEvidence, locate, fail };
