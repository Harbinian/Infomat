// Text extraction only. Uploaded bytes never become a URL or executable document.
const crypto = require('node:crypto');
const { digest } = require('./dataMapDefinitionValues');
const VERSION = 'pdf-evidence-text-v1';
const LIMITS = Object.freeze({ bytes: 5*1024*1024, pages: 300, anchors: 20000, text: 2*1024*1024, snapshot: 12*1024*1024 });
const fail = (name, statusCode=400) => Object.assign(new Error('DEFINITION_PDF_'+name), {code:'DEFINITION_PDF_'+name,statusCode});
async function extract(bytes, name) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail('EMPTY');
  if (bytes.length>LIMITS.bytes) throw fail('LIMIT',413);
  if (typeof name!=='string'||name.length>255||! /\.pdf$/i.test(name)||!/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(bytes.subarray(0,10).toString('ascii'))) throw fail('TYPE');
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = require('node:path').dirname(require.resolve('pdfjs-dist/package.json'));
  const loading = pdf.getDocument({data:new Uint8Array(bytes),verbosity:0,isEvalSupported:false,enableXfa:false,
    disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,useWasm:false,stopAtErrors:true,
    cMapUrl:root+'/cmaps/',cMapPacked:true,standardFontDataUrl:root+'/standard_fonts/'});
  let doc;
  try {
    doc=await loading.promise;
    if(doc.numPages>LIMITS.pages) throw fail('LIMIT',413);
    // Never instantiate a viewer, annotation layer, action handler or scripting manager.
    if(await doc.hasJSActions()) throw fail('ACTIVE_CONTENT');
    if(await doc.getAttachments()) throw fail('ACTIVE_CONTENT');
    const anchors=[], pages=[];let textBytes=0;
    for(let pageNo=1;pageNo<=doc.numPages;pageNo++) {
      const page=await doc.getPage(pageNo), viewport=page.getViewport({scale:1});
      if(await page.getJSActions()) throw fail('ACTIVE_CONTENT');
      const annotations=await page.getAnnotations({intent:'display'});
      if(annotations.some(a=>a.actions||a.file||a.attachment||a.isJSActions))throw fail('ACTIVE_CONTENT');
      const reader=page.streamTextContent({includeMarkedContent:false,disableNormalization:true}).getReader();
      let chars=0,replacements=0,items=0;
      while(true) {
        const {done,value}=await reader.read();if(done)break;
        for(const item of value.items) {
          if(typeof item.str!=='string')continue;
          textBytes+=Buffer.byteLength(item.str);chars+=item.str.trim().length;replacements+=(item.str.match(/\ufffd/g)||[]).length;
          if(textBytes>LIMITS.text||anchors.length>=LIMITS.anchors)throw fail('LIMIT',413);
          const transform=pdf.Util.transform(viewport.transform,item.transform);
          if(![...transform,item.width,item.height].every(Number.isFinite))throw fail('DAMAGED');
          anchors.push({anchor_id:'a'+anchors.length,kind:'text',page:pageNo,item_index:items++,text:item.str,
            transform:item.transform,viewport_transform:transform,width:item.width,height:item.height,
            direction:item.dir,has_eol:item.hasEOL,coordinate_system:'pdf-user-space-and-top-left-viewport',parent_anchor:null});
        }
      }
      pages.push({page:pageNo,width:viewport.width,height:viewport.height,rotation:page.rotate,
        item_count:items,text_char_count:chars,replacement_char_count:replacements,
        extraction_status:chars===0?'insufficient':replacements?'suspect':'text_extracted'});
      page.cleanup();
    }
    const document={format:VERSION,anchors,pages,coverage:{page_count:doc.numPages,text_item_count:anchors.length,
      text_page_count:pages.filter(p=>p.text_char_count>0).length,
      insufficient_pages:pages.filter(p=>p.extraction_status==='insufficient').map(p=>p.page),
      suspect_pages:pages.filter(p=>p.extraction_status==='suspect').map(p=>p.page),
      extraction_status:pages.some(p=>p.text_char_count)?'extracted':'insufficient',rendered:false,ocr_performed:false,
      page_numbers_available:true,not_covered:['页码为PDF物理页序号，不等同印刷页码','仅提取文本层；无文字页无法区分空白页与扫描页，标为提取不足',
        '不执行OCR，不识别图片文字；可提取文字不证明文字完整或正确','文本按提取顺序保存，不推断阅读顺序、表格行列或跨页关系',
        '不执行链接、动作、表单或材料指令；不认定业务事实、主数据、权威来源或对象同一性']}};
    if(Buffer.byteLength(JSON.stringify(document))>LIMITS.snapshot)throw fail('LIMIT',413);
    return {original_name:name.split(/[\\/]/).pop(),raw_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      byte_length:bytes.length,parser_version:VERSION,engine_version:pdf.version,document,content_digest:digest(document)};
  } catch(e) {if(/^DEFINITION_PDF_/.test(e.code||''))throw e;throw fail(e.name==='PasswordException'?'ENCRYPTED':'DAMAGED');}
  finally {await loading.destroy();}
}
function locate(document, anchorId) {
  if(document?.format!==VERSION||typeof anchorId!=='string')throw fail('LOCATOR',404);
  const a=document.anchors.find(a=>a.anchor_id===anchorId);if(!a)throw fail('LOCATOR',404);return a;
}
let active=0;
async function parsePdfEvidence(bytes,name) {
  if(!Buffer.isBuffer(bytes)||bytes.length>LIMITS.bytes)throw fail('LIMIT',413);
  if(active>=2)throw fail('BUSY',503);active++;
  const {fork}=require('node:child_process');let worker,timer;
  try {
    // A PDF engine/native allocation failure must not terminate the HTTP process.
    const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    worker=fork(require.resolve('./pdfEvidenceThread'),[],{env,serialization:'advanced',windowsHide:true,
      execArgv:['--max-old-space-size=256'],stdio:['ignore','ignore','ignore','ipc']});
    return await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(fail('TIMEOUT',413)),15000);
      worker.once('message',m=>m.result?resolve(m.result):reject(Object.assign(fail('DAMAGED'),m.error)));
      worker.once('error',()=>reject(fail('RESOURCE_LIMIT',413)));worker.once('exit',()=>reject(fail('RESOURCE_LIMIT',413)));
      worker.send({bytes,name},e=>{if(e)reject(fail('RESOURCE_LIMIT',413));});
    });
  } finally {
    clearTimeout(timer);
    if(worker&&worker.exitCode===null&&worker.signalCode===null){const stopped=new Promise(r=>worker.once('exit',r));worker.kill();await stopped;}
    active--;
  }
}
module.exports={VERSION,LIMITS,extract,parsePdfEvidence,locate,fail};
