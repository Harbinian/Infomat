// Disposable child process. No inherited credentials and no network use case.
globalThis.fetch=()=>Promise.reject(new Error('PDF_NETWORK_DISABLED'));
for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>{throw new Error('PDF_NETWORK_DISABLED');};}
process.once('message',data=>require('./pdfEvidenceParser').extract(Buffer.from(data.bytes),data.name)
 .then(result=>process.send({result}))
 .catch(e=>process.send({error:{code:/^DEFINITION_PDF_/.test(e.code||'')?e.code:'DEFINITION_PDF_DAMAGED',statusCode:e.statusCode||400}})));
