"""Classify one frozen inventory, or preserve an existing reviewed CSV verbatim.

Inputs are local hashed extracts only. Writes new order-checks files, never SQL or
an existing review. Business applicability remains pending even for numeric facts.
"""
import argparse,csv,hashlib,json,re
from collections import Counter,defaultdict
from datetime import datetime,timezone
from decimal import Decimal,localcontext,ROUND_HALF_UP
from fractions import Fraction
from pathlib import Path

CONFIRMED='已确认数值差异';PENDING='依据不足待核查'
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def number(v):
 return Fraction(str(v)) if v is not None and re.fullmatch(r'[+-]?\d+(?:\.\d+)?',str(v)) else None
def ident(v):return str(int(v)) if v is not None and re.fullmatch(r'\s*\+?\d+\s*',str(v)) else None
def shown(v):
 if v is None:return ''
 v=Fraction(v)
 if v.denominator==1:return str(v.numerator)
 with localcontext() as c:
  c.prec=40;return format(Decimal(v.numerator)/Decimal(v.denominator),'f').rstrip('0').rstrip('.')
def grouped(rows,key):
 d=defaultdict(list)
 for r in rows:d[key(r)].append(r)
 return d
def unique(rows,key):
 d=grouped(rows,key)
 if any(k is None or len(v)!=1 for k,v in d.items()):raise ValueError('NON_UNIQUE_SOURCE_ID')
 return {k:v[0] for k,v in d.items()}
def joined(items):return '；'.join(dict.fromkeys(str(x) for x in items if x is not None and x!=''))
def csvrows(path):
 with path.open(encoding='utf-8-sig',newline='') as f:yield from csv.DictReader(f)
def envelope(v):
 if v['分类'] not in (CONFIRMED,PENDING):raise ValueError('ORDER_CHECK_CLASSIFICATION_INVALID')
 return {'id':v['核查项编号'],'classification':'confirmed_numeric_difference' if v['分类']==CONFIRMED else 'pending_evidence','category':v['核查项目'],'salesOrder':v['销售订单'],'salesDetailId':v['销售明细编号'],
 'productionOrders':list(dict.fromkeys(filter(None,re.split('[；、]',v['生产订单'])))),'values':v}
def save(output,batch,rows,provenance,source_manifest,quantity_hash):
 output.mkdir(exist_ok=False)
 ids=set();counts=Counter();categories=Counter();orders=set();details=set();columns=[]
 with (output/'rows.ndjson').open('w',encoding='utf8',newline='\n') as f:
  for v in rows:
   row=envelope(v)
   if row['id'] in ids or v['盘点编号']!=batch:raise ValueError('ORDER_CHECK_BINDING_INVALID')
   ids.add(row['id']);counts[row['classification']]+=1;categories[row['category']]+=1
   if row['salesOrder']:orders.add(row['salesOrder'])
   if row['salesDetailId']:details.add(row['salesDetailId'])
   for key in v:
    if key not in columns:columns.append(key)
   f.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
 report={'version':1,'batchId':batch,'createdAt':datetime.now(timezone.utc).isoformat(),'status':'available','provenance':provenance,'sourceManifest':source_manifest,'quantityReportSha256':quantity_hash,
 'summary':{'total':len(ids),'confirmed':counts['confirmed_numeric_difference'],'pending':counts['pending_evidence'],'salesOrders':len(orders),'salesDetails':len(details)},'categories':dict(categories),'columns':columns,
 'rows':{'file':'rows.ndjson','count':len(ids),'sha256':sha(output/'rows.ndjson')},'boundary':'已确认数值差异仅确认对应记录数值不同；哪方正确及变更适用仍待核查，不直接判业务错单。'}
 (output/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
 return report
def preserve(source,output):
 summary=json.loads((source/'summary.json').read_text(encoding='utf8'))
 manifest=json.loads((source/'delivery-manifest.json').read_text(encoding='utf8'))
 entry=manifest['files']['all-order-checks.csv'];path=source/'deliverables/all-order-checks.csv'
 if sha(path)!=entry['sha256']:raise ValueError('PRESERVED_REVIEW_HASH_MISMATCH')
 rows=list(csvrows(path))
 if len(rows)!=entry['rows']:raise ValueError('PRESERVED_REVIEW_COUNT_MISMATCH')
 verification=json.loads((source/'source-verification.json').read_text(encoding='utf8'))
 supplementary=[]
 for name,a in verification['supplement'].items():
  p=source/'source'/(name+'.ndjson')
  if sha(p)!=a['sha256']:raise ValueError('SUPPLEMENT_HASH_MISMATCH')
  supplementary.append(a)
 original=source/'source/review.json'
 original_report=json.loads(original.read_text(encoding='utf8'))
 if original_report['batchId']!=summary['batchId']:raise ValueError('ORDER_CHECK_BINDING_INVALID')
 return save(output,summary['batchId'],rows,{'kind':'preserved_review','label':'已保存的逐单补充复核','reviewedSourceStart':summary['sourceReadStart'],'reviewedSourceEnd':summary['sourceReadEnd'],'supplementaryReads':supplementary,'originalCsvSha256':entry['sha256'],'originalSummarySha256':sha(source/'summary.json')},verification['sources'],sha(original))
def analyze(root):
 context=json.loads((root/'quantity-inputs.json').read_text(encoding='utf8'));batch=context['batchId']
 manifests=[]
 def load(key):
  path=root/(key+'.ndjson');a=json.loads(path.with_suffix('.ndjson.audit.json').read_text(encoding='utf-8-sig'))
  if a['status']!='succeeded' or sha(path)!=a['sha256'] or a['querySha256']!=context['queryHashes'][key]:raise ValueError('ORDER_CHECK_SOURCE_MISMATCH')
  manifests.append({**a,'dataset':key})
  def gen():
   count=0
   with path.open(encoding='utf-8-sig') as f:
    for line in f:
     if not line.strip():continue
     r=json.loads(line);count+=1
     if int(r['_expectedCount'])!=a['count']:raise ValueError('ORDER_CHECK_SOURCE_COUNT_MISMATCH')
     yield r
   if count!=a['count']:raise ValueError('ORDER_CHECK_SOURCE_COUNT_MISMATCH')
  return gen()
 qpath=root/'quantity/review.json';q=json.loads(qpath.read_text(encoding='utf8'))
 if q['batchId']!=batch:raise ValueError('ORDER_CHECK_BINDING_INVALID')
 for file in q['files'].values():
  if sha(root/'quantity'/file['file'])!=file['sha256']:raise ValueError('QUANTITY_REVIEW_INVALID')
 def qr(key):return csvrows(root/'quantity'/(key+'.csv'))
 sales=unique(load('u8-sales'),lambda r:ident(r['iSOsID']));prod=unique(load('u8-production'),lambda r:ident(r['MoDId']))
 parts=unique(load('u8-parts'),lambda r:ident(r['PartId']));boms=unique(load('u8-bom'),lambda r:ident(r['BomId']))
 comps=unique(load('u8-bom-components'),lambda r:ident(r['OpComponentId']))
 def sale_of(p):
  s=sales.get(ident(p['OrderDId'])) if ident(p['OrderType'])=='1' else None
  return s if s and (not p['OrderCode'] or p['OrderCode']==s['cSOCode']) else None
 by_sale=grouped(prod.values(),lambda p:ident(sale_of(p)['iSOsID']) if sale_of(p) else None)
 raw_mes=grouped(load('mes-intermediate'),lambda r:(ident(r['u8autoid']),r['ExcelServerRCID'],r['ExcelServerRN']))
 interfaces=grouped(load('kfu-production'),lambda r:ident(r['U8AUTOID']))
 sales_numbers=grouped(sales.values(),lambda r:r['cDefine25']);task_sales=defaultdict(set)
 for t in load('mes-tasks'):
  ss=sales_numbers.get(t['U8生产编号'],[])
  if t['账套号']=='333' and len(ss)==1 and (not t['订单号'] or t['订单号']==ss[0]['cSOCode']):task_sales[t['生产编号']].add(ident(ss[0]['iSOsID']))
 mes=list(qr('mes'));by_mes=grouped([r for r in mes if r['勤哲记录编号']],lambda r:r['生产明细编号'])
 changes=list(load('mes-outline-changes'));by_outline=grouped(changes,lambda r:r['制造大纲编号']);clues=defaultdict(list)
 by_ref=grouped(prod.values(),lambda p:(ident(sale_of(p)['iSOsID']) if sale_of(p) else None,p['Define28']))
 for t in load('mes-travelers'):
  ids=task_sales.get(t['生产编号'],set())
  if len(ids)!=1 or not t['U8零件编号']:continue
  ps=by_ref.get((next(iter(ids)),t['U8零件编号']),[])
  if len(ps)==1:clues[ident(ps[0]['MoDId'])].extend(by_outline.get(t['制造大纲编号'],[]))
 history_count=sum(int(x.get('row_count',0)) for x in q.get('historyEvidence',[]))
 history_note=f'本批读取历史及变更记录{history_count}条；尚未取得可确认的订单适用范围及用量前后关系'
 result=[]
 def build(sid,ps,kind,key):
  s=sales.get(sid,{})
  mr=[r for p in ps for r in by_mes.get(ident(p['MoDId']),[])]
  bs=[boms[ident(p['BomId'])] for p in ps if ident(p['BomId']) in boms]
  cc={r['明细主键']:r for p in ps for r in clues.get(ident(p['MoDId']),[])}
  return {'核查项编号':key,'分类':PENDING,'核查项目':kind,'销售订单':s.get('cSOCode',joined(p['OrderCode'] for p in ps)),'销售行号':s.get('iRowNo',''),'销售明细编号':sid or '', '生产编号':s.get('cDefine25',joined(p['Define25'] for p in ps)),'销售物料':s.get('cInvCode',''),'销售数量':shown(number(s.get('iQuantity'))),
   '生产订单':joined(p['MoCode'] for p in ps),'生产行号':joined(p['MoCode']+'/'+p['SortSeq'] for p in ps),'生产明细编号':joined(ident(p['MoDId']) for p in ps),'生产物料':joined(p['InvCode'] for p in ps),'生产数量':'','生产数量口径':'','核查物料':'','物料单位':'','勤哲投产数量':'','勤哲数量（销售口径）':joined(r['勤哲数量'] for r in mr),
   '勤哲记录逐条数量':json.dumps([{'production':r['生产明细编号'],'record':r['勤哲记录编号'],'row':r['勤哲行号'],'productionQty':r['勤哲投产数量'],'salesQty':r['勤哲数量'],'unit':r['勤哲单位']} for r in mr],ensure_ascii=False,separators=(',',':')),
   '订单应领数量':'','订单用量理论数量':'','当前BOM计算数量':'','计算数量说明':'','差值（实际减基准）':'','数值事实':'','业务判定':'待核查，不直接判业务错单','待核查依据':'','订单采用BOM':joined(p['BomId'] for p in ps),'BOM版本':joined(b['BomId']+':'+b['Version'] for b in bs),'BOM修改日期':joined(b['BomId']+':'+str(b['ModifyDate']) for b in bs),'订单审核日期':joined(p['MoCode']+':'+str(p['RelsDate']) for p in ps),'变更单及适用范围':history_note,
   '关联大纲更改线索':joined(r['明细主键']+':'+str(r['制造大纲编号']) for r in cc.values()),'大纲更改内容':joined(str(r['描述'])+'；适用批架次='+str(r['适用批架次'])+'；更改时间='+str(r['更改时间']) for r in cc.values()),'计算路径或用料行':'','补充只读证据':'','盘点编号':batch}
 def total_mes(ps):
  rr=[by_mes.get(ident(p['MoDId']),[]) for p in ps]
  if not ps or any(len(r)!=1 or number(r[0]['勤哲投产数量']) is None for r in rr):return ''
  if any(not parts.get(ident(p['PartId']),{}).get('cComUnitName') or r[0]['勤哲单位']!=parts[ident(p['PartId'])]['cComUnitName'] for p,r in zip(ps,rr)):return ''
  return shown(sum((number(r[0]['勤哲投产数量']) for r in rr),Fraction()))
 for r in qr('sales'):
  if r['数值比较']=='数值相同':continue
  sid=r['销售明细编号'];s=sales[sid];ps=[p for p in by_sale[sid] if p['InvCode']==s['cInvCode']]
  v=build(sid,ps,'销售与同物料生产数量','S-'+sid)
  if r['数值比较']=='数值不同' and ps and all(number(p['Qty']) is not None for p in ps) and number(s['iQuantity']) is not None:
   total=sum((number(p['Qty']) for p in ps),Fraction())
   if total!=number(r['同物料生产数量合计']) or total==number(s['iQuantity']):raise ValueError('ORDER_CHECK_CALCULATION_MISMATCH')
   v.update({'分类':CONFIRMED,'差值（实际减基准）':shown(total-number(s['iQuantity']))})
  v.update({'生产数量':r['同物料生产数量合计'],'生产数量口径':'同销售明细、同物料生产合计','核查物料':s['cInvCode'],'物料单位':joined(parts.get(ident(p['PartId']),{}).get('cComUnitName') for p in ps),'勤哲投产数量':total_mes(ps),'计算数量说明':'母件基准为销售数量；BOM用于展开子件，不另造母件BOM计算量','数值事实':r['数值比较'],'待核查依据':r['说明']+'；分批、取消及变更适用依据仍待核查'})
  result.append(v)
 mes_cases={};mes_occurrences=Counter()
 for r in mes:
  different='数值不同' in (r['投产数值比较'],r['销售数值比较'])
  if not different and r['投产数值比较']=='数值相同' and r['销售数值比较']=='数值相同':continue
  pid=r['生产明细编号'];p=prod[pid];s=sale_of(p);sid=ident(s['iSOsID']) if s else None
  mid='M-'+pid+'-'+r['勤哲记录编号']+'-'+r['勤哲行号'];mes_occurrences[mid]+=1
  v=build(sid,[p],'用友与勤哲数量',mid+(':'+str(mes_occurrences[mid]) if mes_occurrences[mid]>1 else ''))
  matches=raw_mes.get((pid,r['勤哲记录编号'],r['勤哲行号']),[]);verified=False
  if len(matches)==1 and len(by_mes[pid])==1 and s:
   m=matches[0];scoped=any(k['账套号']=='333' and ident(k['U8ID'])==ident(p['MoId']) and k['BOM编号'] and k['BOM编号']==m['生产订单表编号'] for k in interfaces[pid]) or task_sales.get(m['生产编号'])=={sid}
   verified=scoped and ident(m['u8id'])==ident(p['MoId']) and bool(p['Define28']) and m['零件编号']==p['Define28'] and bool(parts.get(ident(p['PartId']),{}).get('cComUnitName')) and m['单位']==parts[ident(p['PartId'])]['cComUnitName'] and (not task_sales.get(m['生产编号']) or task_sales[m['生产编号']]=={sid})
  if different and verified:v['分类']=CONFIRMED
  v.update({'生产数量':shown(number(p['Qty'])),'生产数量口径':'本生产明细','核查物料':p['InvCode'],'物料单位':r['用友物料单位'],'勤哲投产数量':r['勤哲投产数量'],'数值事实':'投产数量：'+r['投产数值比较']+'；销售数量：'+r['销售数值比较'],'待核查依据':('主单、明细、生产编号引用及单位已核实；正确数量及变更适用仍待核查' if verified else '对应记录唯一性、生产编号引用、单位或销售来源依据不足')+'；'+r['说明'],'计算数量说明':'未取得对应的BOM子件需求基准时留空，不填0'})
  if number(r['勤哲投产数量']) is not None and number(p['Qty']) is not None:v['差值（实际减基准）']=shown(number(r['勤哲投产数量'])-number(p['Qty']))
  result.append(v);mes_cases[pid]=v
 for r in qr('demand'):
  ids=r['用友生产明细编号'].split('、') if r['用友生产明细编号'] else []
  for pid in ids:
   if pid in mes_cases:mes_cases[pid].update({'当前BOM计算数量':r['BOM需求数量'],'计算数量说明':'本销售明细下该子件物料合计需求；多个生产单共享基准，不逐单重复相加','计算路径或用料行':r['计算路径']})
  if '数值不同' not in (r['数值比较'],r['勤哲与BOM数值比较']) and r['数值比较'] not in ('现有子件生产未在当前BOM展开中定位','销售来源待核查'):continue
  ps=[prod[pid] for pid in ids if pid in prod];sid=r['销售明细编号']
  v=build(sid,ps,'销售按BOM展开子件','D-'+sid+'-'+r['子件物料编号']+(':'+joined(ids) if r['数值比较']=='销售来源待核查' else ''))
  v.update({'生产数量':r['用友生产数量合计'],'生产数量口径':'本销售明细下该子件物料合计，不是逐张生产单应下达量','核查物料':r['子件编码'],'物料单位':parts.get(ident(r['子件物料编号']),{}).get('cComUnitName',''),'勤哲投产数量':r['勤哲投产数量合计'],'当前BOM计算数量':r['BOM需求数量'],'计算数量说明':'订单引用BOM的当前结构按销售数量展开；历史适用性待核查','数值事实':r['数值比较']+'；勤哲对比：'+r['勤哲与BOM数值比较'],'待核查依据':r['限制'],'计算路径或用料行':r['计算路径']})
  if r['需求数量分数'] and number(r['用友生产数量合计']) is not None:v['差值（实际减基准）']=shown(number(r['用友生产数量合计'])-Fraction(r['需求数量分数']))
  result.append(v)
 candidates={r['用料明细编号']:r for r in qr('allocation') if r['订单算术比较']!='数值相同'}
 enums=list(load('u8-quantity-enums'))
 supply={r['field_code']:r['caption'] for r in enums if r.get('enum_type')=='BO.WIPType' and r.get('record_kind')=='enum'}
 for a in load('u8-allocations'):
  if a['AllocateId'] not in candidates:continue
  r=candidates.pop(a['AllocateId']);p=prod.get(ident(a['MoDId']));s=sale_of(p) if p else None
  v=build(ident(s['iSOsID']) if s else None,[p] if p else [],'用料精度或取整' if r['订单算术比较']=='精度或取整待核查' else '订单用料算术差异','A-'+a['AllocateId'])
  expected=Fraction(r['理论用量分数']) if r['理论用量分数'] else None;actual=number(a['Qty']);den=number(a['BaseQtyD']);basis=number(a.get('UpperMoQty'));alt=None
  if basis is not None and number(a['BaseQtyN']) is not None and den and den>0:alt=basis*number(a['BaseQtyN'])/den
  notes=[r['说明'],'订单应领数量不等于必须下达的子件生产数量；变更适用范围仍待核查']
  if actual==0:notes.append('应领为0；取消或用量调整依据不足，不能直接判漏领')
  elif alt==actual and p and basis!=number(p['Qty']):notes.append('用料行保留基数（业务名称未核实）='+shown(basis)+'，按该基数试算与应领相同；基数变更及适用规则待核查')
  if r['订单算术比较']=='精度或取整待核查' and expected is not None:
   with localcontext() as c:
    c.prec=50;rounded=(Decimal(expected.numerator)/Decimal(expected.denominator)).quantize(Decimal('0.000001'),rounding=ROUND_HALF_UP)
   notes.append('六位小数四舍五入'+('可解释该数值' if Fraction(rounded)==actual else '仍未吻合')+'；正式取整规则待核查')
  current=None;c=comps.get(ident(a['OpComponentId']));b=boms.get(ident(p['BomId'])) if p else None
  if c and p and b and ident(c['BomId'])==ident(p['BomId']) and ident(c['ComponentId'])==ident(a['ComponentId']) and c['FVFlag']=='1' and number(c['CompScrap'])==number(b['ParentScrap'])==0 and c['ByproductFlag']=='False' and number(c['BaseQtyD']) and number(c['BaseQtyD'])>0 and number(p['Qty']) is not None:current=number(p['Qty'])*number(c['BaseQtyN'])/number(c['BaseQtyD'])
  v.update({'生产数量':shown(number(p['Qty'])) if p else '', '生产数量口径':'用料所属母件明细，不是子件生产量','核查物料':a['InvCode'],'物料单位':parts.get(ident(a['ComponentId']),{}).get('cComUnitName',''),'勤哲投产数量':total_mes([p]) if p else '', '订单应领数量':a['Qty'],'订单用量理论数量':shown(expected),'当前BOM计算数量':shown(current),'计算数量说明':'母件生产数量×订单保留分子÷分母；勤哲数量为母件投产数量，不与子件用料直接比较','差值（实际减基准）':shown(actual-expected) if actual is not None and expected is not None else '', '数值事实':r['订单算术比较']+'；'+r['当前BOM对照'],'待核查依据':'；'.join(notes),'计算路径或用料行':a['AllocateId']+'；分子='+a['BaseQtyN']+'；分母='+a['BaseQtyD']+'；精确分数='+str(expected)+'；路径原值='+str(a['VirOpComponentIds']),
   '补充只读证据':'本批一起读取；供应类型='+supply.get(a.get('WIPType'),'未核实')+'；已领='+str(a.get('IssQty'))+'；补料='+str(a.get('ReplenishQty'))+'；用料行保留基数（业务名称未核实）='+shown(basis)+'；按该基数试算='+shown(alt)})
  result.append(v)
 if candidates:raise ValueError('ORDER_CHECK_ALLOCATION_MISSING')
 result.sort(key=lambda v:(v['销售订单'],v['销售行号'],v['核查项编号']))
 return save(root/'order-checks',batch,result,{'kind':'full_inventory','label':'本次全量盘点只读复核','ruleVersion':context['ruleVersion']},manifests,sha(qpath))

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);parser.add_argument('--preserve',type=Path)
 args=parser.parse_args()
 report=preserve(args.preserve,args.root) if args.preserve else analyze(args.root)
 print(json.dumps(report['summary'],ensure_ascii=False))
