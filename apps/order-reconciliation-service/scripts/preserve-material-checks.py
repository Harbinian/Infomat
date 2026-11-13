"""Package the two authorized 2026-11-06 local investigations without recomputing.

Inputs: original review directory, trace directory, original batch ID, new output
directory. Verifies and copies original source evidence and dated outputs. No SQL.
"""
import argparse,importlib.util,json,shutil
from collections import Counter
from pathlib import Path
spec=importlib.util.spec_from_file_location('materials',Path(__file__).with_name('material-checks.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def preserve(review,trace,batch,out):
 if out.exists():raise ValueError('MATERIAL_PACKAGE_ALREADY_EXISTS')
 manifest=[];attachments=[]
 for label,folder in [('initial',review),('trace',trace)]:
  for path in sorted(folder.glob('*.ndjson.audit.json')):
   a=json.loads(path.read_text(encoding='utf-8-sig'));data=folder/path.name.removesuffix('.audit.json');sql=folder/'sql'/a['queryFile']
   if a['status']!='succeeded' or m.sha(data)!=a['sha256'] or m.sha(sql)!=a['querySha256']:raise ValueError('PRESERVED_SOURCE_MISMATCH')
   count=sum(bool(line.strip()) for line in data.open(encoding='utf-8-sig'))
   if count!=a['count']:raise ValueError('PRESERVED_SOURCE_COUNT_MISMATCH')
   manifest.append({**a,'dataset':label+'-'+data.stem})
 traces={(r['生产明细编号'],r['物料编码']):r for r in m.read_csv(trace/'zero-requirement-trace.csv')}
 standards={r['生产明细编号']:r for r in m.read_csv(trace/'standard-no-bom-trace.csv')}
 cross={}
 for r in m.read_csv(trace/'cross-detail-issue-clues.csv'):cross.setdefault((r['待查生产订单'],r['待查生产行号'],r['物料编码']),[]).append(r)
 stock={r['AutoID']:r for r in (json.loads(l) for l in (trace/'target-other-issues.ndjson').open(encoding='utf-8-sig'))}
 stock_links=json.loads((trace/'related-issue-analysis.json').read_text(encoding='utf-8'))['otherStockDocumentClues']
 gaps={(r['production']['MoDId'],r.get('materialCode') or ''):r for r in (json.loads(l) for l in (review/'bom-gap-candidates.ndjson').open(encoding='utf-8-sig'))}
 rows=[]
 for original in m.read_csv(review/'bom-material-pending.csv'):
  v=dict(original);key=(v['生产明细编号'],v['物料编码']);c=gaps[key];kind=c['category'];evidence={'originalReview':original,'bomAndAllocation':c}
  v['数值及记录事实']=v['核查情形'];v['业务判定']='依据不足待核查'
  extra=traces.get(key) or standards.get(key[0])
  if extra:
   evidence['supplementaryTrace']=extra
   for k,val in extra.items():
    if k not in v:v[k]=val
  evidence['crossDetailClues']=cross.get((v['生产订单'],v['生产行号'],key[1]),[])
  evidence['otherStockClues']=[stock[r['issueLineId']] for r in stock_links if r['productionId']==key[0] and r['material']==key[1]]
  v['其他出库线索']=m.joined(r['IssueCode']+' / '+str(r.get('cRdName'))+' / '+(r.get('cMemo') or '')+(r.get('cbMemo') or '') for r in evidence['otherStockClues'])
  v['其他出库限制']='调拨及其他行号的出库不能自动证明本行已领料。'
  row={'id':kind+':'+key[0]+':'+key[1],'category':kind,'categoryLabel':m.KINDS[kind],'salesOrder':v['销售订单'],'productionOrder':v['生产订单'],'materialCode':key[1],'values':v,'evidence':evidence}
  rows.append(row)
 for i,original in enumerate(m.read_csv(review/'issues-awaiting-audit.csv')):
  v=dict(original);v['分类']='依据不足待核查';v['核查情形']=m.KINDS['issue_awaiting_audit'];v['数值及记录事实']=v['审核情况'];v['业务判定']='依据不足待核查';v['变更及必要性依据']=v['结论']
  v['对应材料出库单号']=v['出库单号'];v['对应材料出库数量']=v['出库单数量'];v['订单应领数量']=v['应领数量']
  rows.append({'id':'issue-awaiting:'+str(i),'category':'issue_awaiting_audit','categoryLabel':m.KINDS['issue_awaiting_audit'],'salesOrder':v['销售订单'],'productionOrder':v['生产订单'],'materialCode':v['物料编码'],'values':v,'evidence':{'originalReview':original}})
 for r in json.loads((review/'bom-basis-unavailable.json').read_text(encoding='utf-8')):
  v={'分类':'依据不足待核查','核查情形':m.KINDS['bom_basis_unavailable'],'销售订单':r['SalesOrder'] or '', '生产订单':r['MoCode'],'生产行号':r['ProductionLine'],'生产明细编号':r['MoDId'],'物料编码':'','产品编码':r['ProductCode'],'产品名称':r['ProductName'],'生产数量':r['ProductionQty'],'已审核入库数量':r['AuditedReceiptQty'],'订单采用BOM':r['BomId'],'数值及记录事实':'已审核入库、存在用料行，未取得可用BOM直接子件对照。','业务判定':'依据不足待核查','变更及必要性依据':m.BOUNDARY}
  rows.append({'id':'bom-basis:'+r['MoDId'],'category':'bom_basis_unavailable','categoryLabel':m.KINDS['bom_basis_unavailable'],'salesOrder':v['销售订单'],'productionOrder':v['生产订单'],'materialCode':'','values':v,'evidence':{'originalReview':r}})
 for r in m.read_csv(review/'issue-reference-conflicts.csv'):
  v={'分类':'依据不足待核查','核查情形':m.KINDS['issue_reference_conflict'],'销售订单':r.get('csocode') or '', '生产订单':r.get('VerifiedProductionCode') or '', '生产行号':r.get('VerifiedProductionLine') or '', '物料编码':r['cInvCode'],'对应材料出库单号':r['IssueCode'],'对应材料出库数量':r['iQuantity'],'数值及记录事实':'出库原填生产单与用料行指向的生产单不一致。','业务判定':'依据不足待核查','变更及必要性依据':'保留双方引用，不能自动认定正确归属或抵扣待查缺口。'}
  rows.append({'id':'issue-ref:'+r['IssueLineId'],'category':'issue_reference_conflict','categoryLabel':m.KINDS['issue_reference_conflict'],'salesOrder':v['销售订单'],'productionOrder':v['生产订单'],'materialCode':v['物料编码'],'values':v,'evidence':{'originalReview':r}})
 for row in rows:row['values']['完整证据JSON']=json.dumps(row['evidence'],ensure_ascii=False,separators=(',',':'))
 summary=json.loads((review/'final-summary.json').read_text(encoding='utf-8'));trace_summary=json.loads((trace/'final-summary.json').read_text(encoding='utf-8'))
 report=m.save(out,'supplement-material-20261106',batch,rows,manifest,{'kind':'preserved_review','label':'2026-11-06入库领料探查及后续追查','readStart':min(a['startedAt'] for a in manifest),'readEnd':max(a['finishedAt'] for a in manifest),'originalBatchUnchanged':True},summary,{'traceSummary':trace_summary})
 for label,folder in [('initial',review),('trace',trace)]:
  destination=out/'originals'/label;destination.mkdir(parents=True)
  for source in folder.rglob('*'):
   if not source.is_file() or source.suffix not in ['.json','.ndjson','.csv','.sql','.md','.py']:continue
   relative=source.relative_to(folder);target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
   attachments.append({'file':str(target.relative_to(out)).replace('\\','/'),'sha256':m.sha(target)})
 report['provenance']['attachments']=attachments
 (out/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'reviewId':report['reviewId'],'summary':report['summary'],'categories':dict(Counter(r['category'] for r in rows)),'originalFiles':len(attachments)},ensure_ascii=False))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('review',type=Path);p.add_argument('trace',type=Path);p.add_argument('batch');p.add_argument('output',type=Path);a=p.parse_args();preserve(a.review,a.trace,a.batch,a.output)
