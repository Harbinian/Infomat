"""Read frozen batch files; append an immutable receipt/material review, never SQL.

Exact fractions retain quantity precision. A disposable local SQLite work file
keeps large allocation/issue extracts out of memory. Findings describe records;
historical necessity, substitutions and responsibility remain pending evidence.
"""
import argparse,csv,hashlib,json,re,sqlite3
from collections import Counter,defaultdict
from datetime import datetime,timezone
from decimal import Decimal,localcontext
from fractions import Fraction
from pathlib import Path

KINDS={
 'zero_required_no_issue':'BOM有正用量、订单应领为零且无对应出库',
 'zero_required_zero_issue_record':'订单应领为零且出库记录数量为零',
 'nonpositive_issue_record':'材料出库净量非正',
 'current_bom_material_not_allocated':'现行BOM子件未进入订单用料清单',
 'no_allocation':'无生产用料清单',
 'bom_basis_unavailable':'订单用料缺少可用BOM对照',
 'positive_required_no_issue':'正应领物料未见对应材料出库',
 'issue_awaiting_audit':'已有材料出库，审核依据不足',
 'issue_reference_conflict':'材料出库的生产单引用不一致',
 'receipt_reference_conflict':'产品入库的生产单引用待核查',
 'quantity_basis_unavailable':'用料或出库数量依据不足',
 'issue_net_shortfall':'已审核材料出库净量小于订单应领'
}
BOUNDARY='当前记录事实不等于历史必要物料实际漏领；按订单采用BOM及变更单明确适用范围核对，依据不足继续待核查。'
HISTORY=['u8-bom-history','u8-component-history','u8-order-bom','u8-ecn','u8-ecn-details','u8-ecn-bom','u8-ecn-components','u8-ecn-notes','u8-bom-log']
SOURCES=['u8-production','u8-sales','u8-parts','u8-bom','u8-bom-components','u8-component-options','u8-allocations','u8-substitutes',
 'u8-product-receipts','u8-material-issues','u8-other-issues','u8-production-links','u8-production-copies','u8-copy-metadata','u8-material-history','u8-quantity-write-metadata',*HISTORY]

def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def number(v):
 return Fraction(str(v)) if v is not None and re.fullmatch(r'[+-]?\d+(?:\.\d+)?',str(v)) else None
def shown(v):
 if v is None:return ''
 with localcontext() as ctx:
  ctx.prec=50
  return format(Decimal(v.numerator)/Decimal(v.denominator),'f').rstrip('0').rstrip('.') if v.denominator!=1 else str(v.numerator)
def total(rows,key):
 values=[number(r.get(key)) for r in rows]
 return sum(values,Fraction(0)) if all(v is not None for v in values) else None
def joined(values):return '；'.join(dict.fromkeys(str(v) for v in values if v is not None and v!=''))
def grouped(rows,key):
 out=defaultdict(list)
 for r in rows:out[r.get(key)].append(r)
 return out
def unique(rows,key):
 result={}
 for r in rows:
  if r.get(key) is None or r[key] in result:raise ValueError('MATERIAL_SOURCE_KEY_CONFLICT')
  result[r[key]]=r
 return result
def read_csv(path):
 with path.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))

def save(folder,review_id,batch,rows,manifest,provenance,coverage,context=None):
 folder.mkdir(exist_ok=False)
 ids=set();categories=Counter();orders=set();productions=set();columns=[]
 with (folder/'rows.ndjson').open('w',encoding='utf-8',newline='\n') as f:
  for row in rows:
   if row['id'] in ids:raise ValueError('MATERIAL_CASE_KEY_CONFLICT')
   ids.add(row['id']);categories[row['category']]+=1
   if row['salesOrder']:orders.add(row['salesOrder'])
   if row['productionOrder']:productions.add(row['productionOrder'])
   row['classification']='pending_evidence';row['factStatus']='confirmed_record_fact'
   for key in row['values']:
    if key not in columns:columns.append(key)
   f.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
 report={'version':1,'reviewId':review_id,'batchId':batch,'status':'available','createdAt':datetime.now(timezone.utc).isoformat(),
  'provenance':provenance,'boundary':BOUNDARY,'sourceManifest':manifest,'coverage':coverage,'context':context or {},
  'summary':{'total':len(ids),'pending':len(ids),'salesOrders':len(orders),'productionOrders':len(productions)},'categories':dict(categories),'columns':columns,
  'rows':{'file':'rows.ndjson','count':len(ids),'sha256':sha(folder/'rows.ndjson')}}
 (folder/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 return report

def analyze(root):
 context=json.loads((root/'quantity-inputs.json').read_text(encoding='utf-8'));batch=context['batchId'];manifest=[]
 def load(key):
  path=root/(key+'.ndjson');audit=json.loads(path.with_suffix('.ndjson.audit.json').read_text(encoding='utf-8-sig'))
  if audit['status']!='succeeded' or sha(path)!=audit['sha256'] or audit['querySha256']!=context['queryHashes'][key]:raise ValueError('MATERIAL_SOURCE_MISMATCH')
  manifest.append({**audit,'dataset':key})
  count=0
  with path.open(encoding='utf-8-sig') as f:
   for line in f:
    if not line.strip():continue
    row=json.loads(line);count+=1
    if int(row['_expectedCount'])!=audit['count']:raise ValueError('MATERIAL_SOURCE_COUNT_MISMATCH')
    yield row
  if count!=audit['count']:raise ValueError('MATERIAL_SOURCE_COUNT_MISMATCH')
 prod=unique(load('u8-production'),'MoDId');sales=unique(load('u8-sales'),'iSOsID')
 parts=unique(load('u8-parts'),'PartId');inv={r['InvCode']:r for r in parts.values()}
 boms=unique(load('u8-bom'),'BomId');components=grouped(load('u8-bom-components'),'BomId');options=unique(load('u8-component-options'),'OptionsId')
 by_product=defaultdict(list)
 for b in boms.values():by_product[parts.get(b['ParentId'],{}).get('InvCode')].append(b)
 receipts=grouped(unique(load('u8-product-receipts'),'ReceiptLineId').values(),'ProductionDetailId')
 links=unique(load('u8-production-links'),'MoDId');children=grouped(links.values(),'PAllocateId')
 history={key:list(load(key)) for key in HISTORY};substitutes=list(load('u8-substitutes'))
 material_history=list(load('u8-material-history'));copy_metadata=list(load('u8-copy-metadata'));write_metadata=list(load('u8-quantity-write-metadata'))
 work=root/'material-work.sqlite'
 if work.exists():raise ValueError('MATERIAL_WORK_ALREADY_EXISTS')
 db=sqlite3.connect(work);db.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE a(id TEXT PRIMARY KEY,pid TEXT,mat TEXT,payload TEXT); CREATE TABLE i(id TEXT PRIMARY KEY,pid TEXT,aid TEXT,mat TEXT,sid TEXT,payload TEXT);')
 try:
  db.executemany('INSERT INTO a VALUES(?,?,?,?)',((r['AllocateId'],r['MoDId'],r['InvCode'],json.dumps(r,ensure_ascii=False)) for r in load('u8-allocations')))
  db.executemany('INSERT INTO i VALUES(?,?,?,?,?,?)',((r['IssueLineId'],r['MoDId'],r['AllocationId'],r['cInvCode'],r['OrderDId'],json.dumps(r,ensure_ascii=False)) for r in load('u8-material-issues')))
  db.executescript('CREATE INDEX ap ON a(pid); CREATE INDEX ip ON i(pid,mat); CREATE INDEX isa ON i(sid,mat); CREATE INDEX ia ON i(aid);');db.commit()
  def query(sql,args):return [json.loads(r[0]) for r in db.execute(sql,args)]
  rows=[];case_alloc={};case_bom={};coverage=Counter();audited_pids=set()
  def emit(kind,p,mat='',aa=None,bb=None,ii=None,rr=None,fact='',extra=None,key=None):
   aa=aa or [];bb=bb or [];ii=ii or [];rr=rr or [];pid=p.get('MoDId','');part=inv.get(mat,{})
   s=sales.get(p.get('OrderDId'),{}) if p.get('OrderType')=='1' else {};b=boms.get(p.get('BomId'),{})
   rid=key or ':'.join([kind,pid,mat]);qty=total(rr,'iQuantity');expected=None
   if bb and qty is not None and all(c['FVFlag']=='1' and number(c['CompScrap'])==0 and number(b.get('ParentScrap'))==0 and number(options.get(c['OptionsId'],{}).get('PlanFactor'))==100 and options.get(c['OptionsId'],{}).get('FeatureRel')=='False' for c in bb):
    expected=sum(qty*number(c['BaseQtyN'])/number(c['BaseQtyD']) for c in bb)
   last=max((r['ReceiptDate'][:10] for r in rr if r.get('ReceiptDate')),default='')
   modified=bool(last and b.get('ModifyDate') and b['ModifyDate'][:10]>last)
   outside=any((c.get('EffBegDate') and c['EffBegDate'][:10]>last) or (c.get('EffEndDate') and c['EffEndDate'][:10]<last) for c in bb) if last else False
   basis=('BOM修改日期晚于入库日期；' if modified else '')+('当前子件有效期不覆盖末次已审核入库日期；' if outside else '')+BOUNDARY
   v={'分类':'依据不足待核查','核查情形':KINDS[kind],'销售订单':p.get('OrderCode') or '', '销售明细编号':p.get('OrderDId') or '', '销售数量':s.get('iQuantity',''),
    '生产订单':p.get('MoCode') or '', '生产行号':p.get('SortSeq') or '', '生产明细编号':pid,'订单类别':{'1':'标准','2':'非标准','3':'重复计划'}.get(p.get('MoClass'),p.get('MoClass','')),
    '生产状态':{'3':'审核','4':'关闭'}.get(p.get('Status'),p.get('Status','')),'产品编码':p.get('InvCode') or '', '产品名称':inv.get(p.get('InvCode'),{}).get('cInvName',''), '生产数量':p.get('Qty',''),
    '已审核入库数量':shown(qty) if rr else '', '已审核入库单号':joined(r['ReceiptCode'] for r in rr),'已审核入库日期':joined(r['ReceiptDate'] for r in rr),'入库类别':joined(r.get('cRdName') for r in rr),
    '物料编码':mat,'物料名称':part.get('cInvName',''),'物料单位':part.get('cComUnitName',''),'存货分类':part.get('cInvCName',''),
    '当前BOM按已审核入库计算数量':shown(expected),'计算精确分数':str(expected) if expected is not None else '',
    '订单应领数量':shown(total(aa,'Qty')) if aa else '', '订单原应领数量':shown(total(aa,'OrgQty')) if aa else '', '订单用料已领汇总':shown(total(aa,'IssQty')) if aa else '',
    '对应材料出库记录数':len(ii) if mat else '', '对应材料出库数量':shown(total(ii,'iQuantity')) if mat else '', '对应材料出库单号':joined(i['IssueCode'] for i in ii),
    '生产用料行编号':joined(a['AllocateId'] for a in aa),'订单采用BOM':p.get('BomId',''),'BOM版本':b.get('Version',''),'BOM建立日期':b.get('CreateDate',''),'BOM修改日期':b.get('ModifyDate',''),
    '订单审核日期':p.get('RelsDate',''),'数值及记录事实':fact,'业务判定':'依据不足待核查','变更及必要性依据':basis,
    '供应类型':joined('领用' if a.get('WIPType')=='3' else '其他供应类型（保留原值于证据）' for a in aa),'表外领料标志':joined('否' if a.get('InvAlloeFlag')=='False' else '是' if a.get('InvAlloeFlag')=='True' else '未取得' for a in aa)}
   if extra:v.update(extra)
   row={'id':rid,'category':kind,'categoryLabel':KINDS[kind],'salesOrder':v['销售订单'],'productionOrder':v['生产订单'],'materialCode':mat,'values':v,
    'evidence':{'production':p,'bom':b,'components':bb,'allocations':aa,'receipts':rr,'issues':ii}}
   rows.append(row);case_alloc[rid]=aa;case_bom[rid]=bb
   return row
  for pid,raw_rr in receipts.items():
   coverage['receiptLines']+=len(raw_rr);rr=[r for r in raw_rr if r['HasAuditHandler']=='1'];coverage['auditedReceiptLines']+=len(rr)
   if not rr:continue
   p=prod.get(pid);bad=[r for r in rr if not p or r['cInvCode']!=p['InvCode'] or r['cmocode']!=p['MoCode'] or r['imoseq']!=p['SortSeq']]
   if bad:
    emit('receipt_reference_conflict',p or {'MoDId':pid or ''},rr=bad,fact='入库引用、产品或生产单行号未能与本批审核/关闭生产明细一致核验。',key='receipt-ref:'+str(pid));coverage['receiptReferenceConflicts']+=len(bad);continue
   if total(rr,'iQuantity') is None:
    emit('quantity_basis_unavailable',p,rr=rr,fact='已审核入库数量存在缺失或不可计算原值。');continue
   if total(rr,'iQuantity')<=0:continue
   audited_pids.add(pid);aa=query('SELECT payload FROM a WHERE pid=?',(pid,));am=grouped(aa,'InvCode');ii=query('SELECT payload FROM i WHERE pid=?',(pid,));im=grouped(ii,'cInvCode')
   if not aa:
    emit('no_allocation',p,rr=rr,fact='已审核入库的生产明细没有用料行；订单BOM引用为'+str(p.get('BomId'))+'。')
    continue
   emitted=set()
   for mat,alloc in am.items():
    issues=im[mat];qty=total(alloc,'Qty')
    if qty is None or qty<0 or total(issues,'iQuantity') is None:
     emit('quantity_basis_unavailable',p,mat,alloc,ii=issues,rr=rr,fact='用料数量缺失、为负，或材料出库数量存在不可计算原值；未填为零。');emitted.add(mat);continue
    normal=all(a.get('WIPType')=='3' and a.get('ByproductFlag')=='False' for a in alloc)
    if normal and qty>0 and not issues:
     emit('positive_required_no_issue',p,mat,alloc,rr=rr,fact='订单应领量大于零，没有对应材料出库记录。');emitted.add(mat)
    elif normal and qty>0 and any(number(i['iQuantity'])>0 for i in issues) and not any(i['HasAuditHandler']=='1' and number(i['iQuantity'])>0 for i in issues):
     emit('issue_awaiting_audit',p,mat,alloc,ii=issues,rr=rr,fact='已有正数量材料出库，但未见已审核的正数量出库；不能列为完全无出库。')
    elif normal and qty>0 and issues and all(i.get('HeaderMissing','0')=='0' and i.get('AllocationMaterial')==mat and i.get('VerifiedProductionCode')==p['MoCode'] and i.get('cmocode')==p['MoCode'] and i.get('imoseq')==p['SortSeq'] for i in issues):
     audited=[i for i in issues if i['HasAuditHandler']=='1'];net=total(audited,'iQuantity')
     if audited and net is not None and net<qty:
      emit('issue_net_shortfall',p,mat,alloc,ii=issues,rr=rr,fact='订单应领量为'+shown(qty)+'，对应已审核材料出库有符号净量为'+shown(net)+'；已抵扣红字，不因存在正出库行而判足额。',extra={'已审核材料出库净量':shown(net)});emitted.add(mat)
   b=boms.get(p.get('BomId'));bc=components.get(p.get('BomId'),[])
   if not b or not bc or parts.get(b['ParentId'],{}).get('InvCode')!=p['InvCode']:
    emit('bom_basis_unavailable',p,aa=aa,rr=rr,fact='存在订单用料行，但未取得与生产产品对应的可用BOM直接子件。');continue
   bm=defaultdict(list)
   for c in bc:
    opt=options.get(c['OptionsId'],{});n=number(c['BaseQtyN']);d=number(c['BaseQtyD']);part=parts.get(c['ComponentId'])
    if c['ByproductFlag']=='False' and opt.get('OptionalFlag')=='False' and n is not None and n>0 and d is not None and d>0 and part:bm[part['InvCode']].append(c)
   for mat,cc in bm.items():
    if mat in emitted:continue
    alloc=am.get(mat,[]);issues=im[mat]
    if issues and total(issues,'iQuantity') is not None and total(issues,'iQuantity')>0:continue
    if alloc and total(alloc,'Qty') is not None and total(alloc,'Qty')>0:continue
    kind='current_bom_material_not_allocated' if not alloc else ('zero_required_zero_issue_record' if all(number(i['iQuantity'])==0 for i in issues) else 'nonpositive_issue_record') if issues else 'zero_required_no_issue'
    fact='当前BOM有正用量；'+('子件不在订单用料清单中。' if not alloc else '订单应领量为零；'+('存在出库记录但有符号净量非正。' if issues else '未见对应材料出库记录。'))
    emit(kind,p,mat,alloc,cc,issues,rr,fact)
  coverage['auditedReceiptProductionDetails']=len(audited_pids)
  for r in query('SELECT payload FROM i',()):
   if r.get('HeaderMissing','0')!='0' or not r.get('MoDId') or r['AllocationMaterial']!=r['cInvCode'] or r['cmocode']!=r['VerifiedProductionCode'] or r['imoseq']!=r['SortSeq']:
    p=prod.get(r['MoDId'],links.get(r['MoDId'],{}));emit('issue_reference_conflict',p,r['cInvCode'],ii=[r],fact='材料出库原填生产单/行号或物料与用料行引用指向的对象不一致，不能自动改归属。',key='issue-ref:'+r['IssueLineId'])
  candidate_pids={r['values']['生产明细编号'] for r in rows};retained=defaultdict(list);copy_keys={};duplicate_copies=0;conflicting_copies=0
  for r in load('u8-production-copies'):
   if r['MoDId'] not in candidate_pids:continue
   k=(r['RetainedTable'],r['MoDId']);old=copy_keys.get(k)
   if old:
    duplicate_copies+=1
    if old!=r:conflicting_copies+=1
   else:copy_keys[k]=r
   retained[r['MoDId']].append(r)
  others=grouped(load('u8-other-issues'),'cInvCode');coverage['retainedDuplicateExtraRows']=duplicate_copies;coverage['retainedConflictingDuplicateRows']=conflicting_copies
  for row in rows:
   p=row['evidence']['production'];pid=p.get('MoDId');mat=row['materialCode'];aa=case_alloc[row['id']];v=row['values'];ev=row['evidence']
   old=retained[pid];valid=[r for r in old if all(r.get(k)==p.get(k) for k in ['MoId','SortSeq','InvCode','OrderType','OrderDId','OrderCode'])]
   ev['retainedCopies']=old;v['旧保留表证据']=('共'+str(len({r['RetainedTable'] for r in old}))+'个表、'+str(len(old))+'行；身份匹配'+str(len(valid))+'行；BOM引用原值：'+joined(r['BomId'] for r in valid)) if old else '未找到对应保留记录'
   v['历史记录限制']='旧保留表不是经核定的操作日志；表建立时间、订单日期不能证明数量形成时间、操作者或原因。'
   same=by_product.get(p.get('InvCode'),[]);ev['sameProductBoms']=same
   v['当前同产品BOM']=joined(b['BomId'] for b in same);v['同产品BOM建立日期']=joined(b.get('CreateDate') for b in same)
   earliest=min((r['RelsDate'] for r in valid if r.get('RelsDate')),default=None)
   v['后建BOM线索']='BOM建立晚于旧表所载审核日期；历史适用待核查' if same and earliest and all(b.get('CreateDate') and b['CreateDate'][:10]>earliest[:10] for b in same) else '未取得后建BOM线索'
   child=[c for a in aa for c in children[a['AllocateId']]];ev['childProductions']=child;v['直接下级生产明细数']=len(child)
   related=[]
   if mat and p.get('OrderType')=='1':
    related=[r for r in query('SELECT payload FROM i WHERE sid=? AND mat=?',(p.get('OrderDId'),mat)) if r['MoDId']!=pid and r['OrderType']=='1' and r['OrderCode']==p.get('OrderCode') and r['cmocode']==r['VerifiedProductionCode'] and number(r['iQuantity']) is not None and number(r['iQuantity'])>0]
   for r in related:
    own=query('SELECT payload FROM i WHERE aid=?',(r['AllocationId'],));r['OwnAllocationNetIssueQty']=shown(total(own,'iQuantity'));r['OwnAllocationIssueLines']=len(own)
   ev['otherDetailIssues']=related;v['同销售明细其他领料单']=joined(r['IssueCode'] for r in related);v['相关领料所属生产明细']=joined(r['VerifiedProductionCode']+'/'+str(r['SortSeq']) for r in related)
   v['跨明细领料判断']='存在其他生产明细领料线索；无明确调剂依据，不自动抵扣本项。' if related else '未见同销售明细的其他领料替代依据'
   stock=[]
   for r in others.get(mat,[]):
    memo=(r.get('cMemo') or '')+(r.get('cbMemo') or '')
    if (p.get('MoCode') and (r.get('iordercode')==p['MoCode'] or p['MoCode'] in memo)) or (p.get('OrderCode') and r.get('csocode')==p['OrderCode']):stock.append(r)
   ev['otherStockClues']=stock;v['其他出库线索']=joined(r['IssueCode']+' / '+str(r.get('cRdName'))+' / '+(r.get('cMemo') or '')+(r.get('cbMemo') or '') for r in stock)
   v['其他出库限制']='调拨、部门领料及备注线索不自动归为本生产明细的材料出库；行号、用途和适用依据须核查。'
   aids={a['AllocateId'] for a in aa};hh=[r for r in material_history if (pid and r.get('ProductionDetailId')==pid) or r.get('AllocationId') in aids or (p.get('MoCode') and r.get('ProductionOrder')==p['MoCode'])]
   ev['materialHistory']=hh;v['关联历史或替代线索数']=len(hh)
   v['BOM及变更依据']='；'.join(k+':'+str(len(history[k])) for k in HISTORY)+'；关联历史或替代线索'+str(len(hh))+'条。存在记录也不自动证明本订单适用。'
   v['完整证据JSON']=json.dumps(ev,ensure_ascii=False,separators=(',',':'))
  coverage['materialIssueLines']=db.execute('SELECT COUNT(*) FROM i').fetchone()[0]
  extra={'historyCounts':{k:len(v) for k,v in history.items()},'materialHistoryCounts':dict(Counter(r['ObjectName'] for r in material_history)),
   'copyMetadata':copy_metadata,'quantityWriteMetadata':write_metadata,'substitutionRows':len(substitutes)}
  if set(r['dataset'] for r in manifest)!=set(SOURCES):raise ValueError('MATERIAL_SOURCE_MANIFEST_INCOMPLETE')
  return save(root/'material-checks',batch,batch,rows,manifest,{'kind':'full_inventory','label':'随本次全量盘点保存'},dict(coverage),extra)
 finally:
  db.close();work.unlink()

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);args=parser.parse_args()
 report=analyze(args.root);print(json.dumps(report['summary'],ensure_ascii=False))
