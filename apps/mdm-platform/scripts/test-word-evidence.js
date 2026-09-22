// Synthetic DOCX only. No file conversion, network, database or Office process.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Zip = require('jszip');
const { extract, parseWordEvidence, locate, LIMITS } = require('../server/wordEvidenceParser');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function fixture(body = '<w:p><w:r><w:t>合成文档标题_独有19</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>编号</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>001</w:t><w:br w:type="page"/><w:t>次页显示</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>合成文档标题_独有19</w:t></w:r></w:p>') {
  const zip = new Zip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
module.exports = { fixture };
if (require.main === module) {
  test('ordered paragraph and table anchors survive repeated titles and page breaks without invented pages', async () => {
    const bytes = await fixture(), before = Buffer.from(bytes), value = await parseWordEvidence(bytes, 'fixture.docx');
    assert.deepEqual(bytes, before); const a = value.document.anchors;
    assert.deepEqual(a.map(x => x.kind), ['paragraph','table','row','cell','paragraph','cell','paragraph','paragraph']);
    assert.equal(a[0].text, a[7].text); assert.notEqual(a[0].xml_path, a[7].xml_path);
    assert.equal(a[4].parent_anchor, a[3].anchor_id); assert.match(a[6].text, /001\n次页/);
    assert(a.every(x => x.page === null)); assert.equal(value.document.coverage.page_numbers_available, false);
    assert.deepEqual(locate(value.document, 'a6'), a[6]); assert.throws(() => locate(value.document, 'a999'), e => e.statusCode === 404);
  });
  test('nested tables preserve parents and XML positions', async () => {
    const d = extract(await fixture('<w:tbl><w:tr><w:tc><w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>嵌套</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>'), 'nested.docx').document;
    assert.equal(d.coverage.table_count, 2); assert.equal(d.anchors.at(-1).text, '嵌套');
    assert.match(d.anchors.at(-1).xml_path, /w:tbl\[1\].*w:tbl\[1\]/);
  });
  test('empty extraction and omitted headers are explicit', async () => {
    const z = await Zip.loadAsync(await fixture('<w:p/>')); z.file('word/header1.xml', `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>未覆盖</w:t></w:r></w:p></w:hdr>`);
    const d = extract(await z.generateAsync({type:'nodebuffer'}), 'empty.docx').document;
    assert.equal(d.coverage.extraction_status, 'empty'); assert.deepEqual(d.coverage.omitted_parts, ['word/header1.xml']);
  });
  test('fields remain cached text; deleted and drawing text are excluded, hyperlinks never fetched', async () => {
    const z = await Zip.loadAsync(await fixture('<w:p><w:r><w:instrText>INCLUDETEXT remote</w:instrText><w:t>缓存</w:t></w:r><w:del><w:r><w:delText>删除</w:delText></w:r></w:del><w:r><w:drawing><w:t>图片</w:t></w:drawing></w:r></w:p>'));
    z.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://invalid.example/never" TargetMode="External"/></Relationships>');
    const d = extract(await z.generateAsync({type:'nodebuffer'}), 'fields.docx').document;
    assert.equal(d.anchors[0].text, '缓存'); assert(d.coverage.not_covered.some(x => x.includes('域代码')));
    assert(d.coverage.not_covered.some(x => x.includes('超链接')));
  });
  test('binary DOC and malformed ZIP/XML/UTF8/CRC rejected', async () => {
    await assert.rejects(parseWordEvidence(await fixture(), 'old.doc'), e => e.code === 'DEFINITION_WORD_TYPE');
    await assert.rejects(parseWordEvidence(Buffer.from('d0cf11e0a1b11ae100000000','hex'), 'renamed.docx'), e => e.code === 'DEFINITION_WORD_TYPE');
    await assert.rejects(parseWordEvidence(Buffer.from('bad'), 'bad.docx'));
    for (const data of [Buffer.from(`<w:document xmlns:w="${W}"><w:body>`), Buffer.from([0xff,0xfe,0x00])]) {
      const z = await Zip.loadAsync(await fixture()); z.file('word/document.xml', data);
      assert.throws(() => extract(Buffer.from('bad'),'bad.docx'));
      await assert.rejects(parseWordEvidence(await z.generateAsync({type:'nodebuffer'}), 'bad.docx'));
    }
    const b = await fixture(), end = b.length - 22, central = b.readUInt32LE(end+16); b.writeUInt32LE(b.readUInt32LE(central+16)^1,central+16);
    assert.throws(() => extract(b,'crc.docx'));
  });
  test('macros, embedded objects, external templates and XML entities rejected', async () => {
    const attacks = [ ['word/vbaProject.bin','x'], ['word/embeddings/ole.bin','x'],
      ['word/document.xml','<!DOCTYPE x [<!ENTITY e SYSTEM "file:///never">]><x/>'],
      ['word/_rels/document.xml.rels','<Relationships><Relationship Type="attachedTemplate" TargetMode="External" Target="https://invalid.example/template"/></Relationships>'] ];
    for (const [name,data] of attacks) { const z = await Zip.loadAsync(await fixture()); z.file(name,data);
      await assert.rejects(parseWordEvidence(await z.generateAsync({type:'nodebuffer'}), 'unsafe.docx'), e => /ACTIVE_CONTENT|EXTERNAL_CONTENT/.test(e.code)); }
    await assert.rejects(parseWordEvidence(await fixture('<w:altChunk/>'), 'chunk.docx'), e => e.code === 'DEFINITION_WORD_ACTIVE_CONTENT');
  });
  test('input, depth, anchor and text resource limits enforced', async () => {
    await assert.rejects(parseWordEvidence(Buffer.alloc(LIMITS.bytes+1), 'big.docx'), e => e.statusCode === 413);
    for (const body of ['<w:sdt>'.repeat(129)+'</w:sdt>'.repeat(129), '<w:p/>'.repeat(LIMITS.anchors+1), `<w:p><w:r><w:t>${'x'.repeat(LIMITS.text+1)}</w:t></w:r></w:p>`]) {
      await assert.rejects(parseWordEvidence(await fixture(body), 'limit.docx'), e => e.statusCode === 413);
    }
  });
  test('same bytes produce fixed digest and names do not merge repeated paragraphs', async () => {
    const bytes=await fixture(), a=extract(bytes,'one.docx'), b=extract(bytes,'two.docx');
    assert.equal(a.raw_sha256,b.raw_sha256); assert.equal(a.content_digest,b.content_digest);
    assert.equal(a.document.anchors.filter(x=>x.text==='合成文档标题_独有19').length,2);
  });
  test('concurrency is bounded and becomes available after worker cleanup', async () => {
    const bytes = await fixture();
    const first = parseWordEvidence(bytes,'first.docx'), second = parseWordEvidence(bytes,'second.docx');
    await assert.rejects(parseWordEvidence(bytes,'third.docx'), e => e.code === 'DEFINITION_WORD_BUSY' && e.statusCode === 503);
    await Promise.all([first,second]);
    assert.equal((await parseWordEvidence(bytes,'retry.docx')).document.coverage.table_count,1);
  });
  test('missing main content type is rejected rather than guessed', async () => {
    const z = await Zip.loadAsync(await fixture()); z.file('[Content_Types].xml','<Types/>');
    await assert.rejects(parseWordEvidence(await z.generateAsync({type:'nodebuffer'}),'type.docx'), e => e.code === 'DEFINITION_WORD_TYPE');
  });
  test('alternate representations are reported uncovered without duplicated text', async () => {
    const bytes=await fixture('<w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice><w:r><w:t>重复</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>重复</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>');
    const doc=extract(bytes,'alternate.docx').document;assert.equal(doc.anchors[0].text,'');assert(doc.coverage.not_covered.some(x=>x.includes('Choice')));
  });
  test('rule evidence resolves within the fixed document and business coverage stays incomplete', async () => {
    const doc=extract(await fixture(),'rules.docx').document;doc.links=[];const rules=require('../server/wordEvidenceRules');
    const task={step:{check_ids:rules.CHECKS},inputs:[{input_key:'source',document:doc}]};const result=rules.analyze(task);
    assert.equal(result.status,'partial');assert(!result.checked_ids.includes('word.business'));assert.equal(result.findings.length,2);
    for(const evidence of result.evidence){let value=doc;for(const part of evidence.locator.slice(1).split('/')){assert(Object.hasOwn(value,part));value=value[part];}}
    assert(result.findings.every(f=>f.finding_type==='not_covered'));
  });
}
