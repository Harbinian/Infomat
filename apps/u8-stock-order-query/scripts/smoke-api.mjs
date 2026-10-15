// Read-only integration checks against the explicitly started local query service.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
const base = process.env.U8_QUERY_URL || 'http://127.0.0.1:3088';
const checks = [];
async function get(query) { const response = await fetch(`${base}/api/mappings?${new URLSearchParams(query)}`); assert.equal(response.status, 200); return response.json(); }
const health = await (await fetch(`${base}/api/health`)).json();
assert.equal(health.databaseUser, 'va2'); assert.equal(health.timeZone, 'UTC+8'); assert.equal(health.ok, true);
checks.push('live_health_va2_utc8');
const schema = await (await fetch(`${base}/api/schema`)).json(); assert.equal(schema.fields.length, 24); assert(schema.fields.every(field => field.label && field.comment));
assert.equal(schema.relatedFields.length,16); assert(schema.relatedFields.every(field=>field.storage==='current'&&field.label&&field.comment));
const all = await get({pageSize:100}); assert.equal(all.rows.length, Math.min(100, all.totals.total)); assert.equal(all.totals.receipts + all.totals.issues, all.totals.total);
assert(all.rows.every(row=>/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(row.CapturedAtUtc8)));
assert(all.rows.every(row => schema.fields.every(field => Object.hasOwn(row, field.key)))); checks.push('all_24_fields_and_converted_time');
for (const type of ['10', '11']) { const data = await get({type,pageSize:100}); assert(data.rows.every(row=>row.VoucherType===type)); assert.equal(data.totals.total,type==='10'?all.totals.receipts:all.totals.issues); }
checks.push('type_filters');
const issue = all.rows.find(row=>row.VoucherType==='11'&&row.ResolutionStatus==='resolved');
assert(issue,'A resolved material issue is required for this scoped acceptance check');
const difference = issue.ProductionNumberDiffers===null?'unknown':issue.ProductionNumberDiffers?'different':'same';
const cases = [
  {voucher:issue.VoucherCode}, {productionNumber:issue.AttributedProductionNumber},
  {productionOrder:issue.ProductionOrderCode}, {salesOrder:issue.SalesOrderCode},
  {inventory:issue.InventoryCode}, {status:'resolved'}, {difference},
  {qualityNumber:issue.QualityNumber}, {partNumber:issue.U8PartNumber},
  {dateFrom:issue.VoucherDate,dateTo:issue.VoucherDate},
  {type:'11',voucher:issue.VoucherCode,productionNumber:issue.AttributedProductionNumber,productionOrder:issue.ProductionOrderCode,salesOrder:issue.SalesOrderCode,inventory:issue.InventoryCode,qualityNumber:issue.QualityNumber,partNumber:issue.U8PartNumber,status:'resolved',difference,dateFrom:issue.VoucherDate,dateTo:issue.VoucherDate}
];
for (const filter of cases) { const result=await get({...filter,pageSize:100}); assert(result.totals.total>0); assert(result.rows.some(row=>row.DetailID===issue.DetailID)); }
checks.push('all_filters_and_combined_query');
const receiptProof=await get({voucher:'CCPRK2608311053',pageSize:100}); const receipt=receiptProof.rows.find(row=>row.DetailID==='1000717695');
assert.equal(receipt.QualityNumber,'11AR'); assert.equal(receipt.ProductionQualityNumber,'11AR'); assert.equal(receipt.QualityNumberCheck,'same'); assert.equal(receipt.SalesNumberReferenceStatus,'matched'); assert.equal(receipt.U8PartNumber,'SC26071700591'); assert.equal(receipt.ProductionLineSequence,1); assert.equal(receipt.PartNumberCheck,'same');
const issueProof=await get({voucher:'CLCK2610140020',pageSize:100}); const partIssue=issueProof.rows.find(row=>row.DetailID==='1000717735');
assert.equal(partIssue.QualityNumber,'11AP'); assert.equal(partIssue.U8PartNumber,'SC26051801035'); assert.equal(partIssue.ProductionLineSequence,5); assert.equal(partIssue.AllocationLineSequence,10); assert.equal(partIssue.BomComponentLineSequence,1); assert.equal(partIssue.InventoryCode,'201813'); assert.equal(partIssue.ParentInventoryCode,'5542C10011G71');
assert.equal((await get({partNumber:partIssue.U8PartNumber,qualityNumber:partIssue.QualityNumber,pageSize:100})).rows.some(row=>row.DetailID===partIssue.DetailID),true);
for(const filter of [{qualityNumber:'11AR',partNumber:'SC26051801035'},{qualityNumber:"x' OR 1=1 --"},{partNumber:'%_[~'}]) assert.equal((await get(filter)).totals.total,0);
checks.push('source_quality_part_numbers_and_three_distinct_sequences');
const differenceProof=await get({voucher:'CCPRK2512310021',pageSize:100}); const qualityDifference=differenceProof.rows.find(row=>row.DetailID==='1000439945');
assert.equal(qualityDifference.QualityNumberCheck,qualityDifference.QualityNumber.trim()===qualityDifference.ProductionQualityNumber.trim()?'same':'different'); assert.equal(qualityDifference.ResolutionStatus,'resolved');
assert.equal((await get({voucher:'CCPRK2512310021',qualityNumber:qualityDifference.QualityNumber})).totals.total,1);
if(qualityDifference.QualityNumberCheck==='different') assert.equal((await get({voucher:'CCPRK2512310021',qualityNumber:qualityDifference.ProductionQualityNumber})).totals.total,0);
checks.push('quality_difference_keeps_sales_source_and_production_copy');
const globalAlertsResponse=await fetch(base+'/api/quality-alerts');assert.equal(globalAlertsResponse.status,200);const globalAlerts=await globalAlertsResponse.json();
assert.equal(globalAlerts.ok,true);assert.equal(globalAlerts.timeZone,'UTC+8');assert(globalAlerts.rows.every(row=>row.QualityNumberCheck==='different'&&row.QualityNumber.trim()!==row.ProductionQualityNumber.trim()));assert.equal(globalAlerts.rows.length,Math.min(100,globalAlerts.total));
const onlyDifferences=await get({qualityCheck:'different',pageSize:100});assert.equal(onlyDifferences.totals.total,globalAlerts.total);
assert.equal((await fetch(base+'/api/quality-alerts?voucher=X')).status,400);assert.equal((await fetch(base+'/api/mappings?qualityCheck=invalid')).status,400);
checks.push('global_alerts_and_quality_check_filter');
for (const voucher of ["x' OR 1=1 --", '%', '_', '[', '~', 'NO_MATCH_FOR_U8_QUERY']) { assert.equal((await get({voucher})).totals.total,0); }
checks.push('literal_quotes_wildcards_and_empty_results');
const first=await get({pageSize:20,page:1}); const second=await get({pageSize:20,page:2}); assert.equal(first.rows.length+second.rows.length,Math.min(40,all.totals.total)); assert(!first.rows.some(row=>second.rows.some(other=>row.DetailID===other.DetailID&&row.VoucherType===other.VoucherType)));
checks.push('stable_page_partition');
for (const [path, options, expected] of [
  ['/api/mappings',{method:'POST'},405], ['/scripts/read-query.ps1',{},404],
  ['/api/mappings?sql=SELECT+1',{},400], ['/api/mappings?type=10&type=11',{},400],
  ['/api/mappings?dateFrom=2026-02-30',{},400], ['/api/mappings?pageSize=101',{},400],
  ['/api/mappings',{headers:{Origin:'http://other.invalid'}},403],
  ['/api/mappings',{headers:{Origin:new URL(base).origin}},200],
  ['/api/mappings',{headers:{Origin:'http://192.0.2.1:'+new URL(base).port}},403],
  ['/api/mappings',{headers:{'Sec-Fetch-Site':'cross-site'}},403]
]) { assert.equal((await fetch(base+path,options)).status,expected,path); }
// Use a wire-level request: fetch normalizes the Host header in this runtime.
const hostStatus=await new Promise((resolve,reject)=>{const request=http.get({hostname:'127.0.0.1',port:Number(new URL(base).port),path:'/api/mappings',headers:{Host:'other.invalid'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
assert.equal(hostStatus,403);
checks.push('read_only_route_and_same_origin_boundaries');
const result={status:'passed',checkedAt:new Date().toISOString(),checks,counts:all.totals,source:'live readonly API'};
if (process.argv[2]) await writeFile(process.argv[2],JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
