"""Analyze frozen SELECT extracts only; save append-only completion-chain evidence.

Record inconsistencies are distinct from missing historical/business evidence.
No source connection, business API, unlocking, retry, or voucher creation exists.
"""
import argparse,hashlib,json,re
from collections import Counter,defaultdict
from datetime import datetime,timezone
from decimal import Decimal,localcontext
from fractions import Fraction
from pathlib import Path

SOURCES=['kfu-completion','kfu-completion-control','mes-completion-rules','u8-production-links','u8-product-receipts','u8-allocations']
KINDS={
 'backlog':'待入库且仍有剩余数量','outside_automatic_scope':'待入库但不在当前自动扫描范围',
 'production_reference_missing':'接口生产明细引用断链','production_reference_conflict':'接口与生产订单内容不一致',
 'duplicate_part_reference':'零件编号对应多条接口记录','duplicate_production_reference':'生产明细引用对应多条接口记录',
 'completed_without_receipt':'已入库但缺少对应有效凭据依据','completed_with_remaining':'已入库标志与生产剩余量矛盾',
 'pending_with_receipts':'待入库标志与足额入库凭据待核对','receipt_total_difference':'累计入库量与已审核凭据净量不同',
 'receipt_reference_conflict':'入库凭据与生产引用不一致','receipt_audit_pending':'入库凭据审核依据不足',
 'quantity_basis_pending':'数量或关联依据不足','allocation_basis_pending':'待入库订单的用料依据不足',
 'closed_with_remaining':'生产已关闭但仍有剩余数量','material_identity_pending':'接口零件代码与生产产品编码待核对'
}
LABELS={'confirmed_issue':'已确认问题','pending_evidence':'依据不足待核查'}
BOUNDARY='已确认问题限本次记录的引用、状态或数值矛盾，不认定历史未入库、实际缺料或责任。积压不自动判逾期；不解锁、不补单、不调用业务重试。'
COLUMNS=['分类','核查项目','销售订单','生产订单','生产行号','接口原填生产订单','接口零件编号','生产编号','产品编码','接口入库状态','接口领料状态','自动扫描范围','订单创建日期','订单距观察日天数','积压起始时间','生产状态','订单数量','累计入库数量','剩余数量','对应入库凭据数','对应入库净数量','已审核入库净数量','未审核入库凭据数','入库单号','订单采用BOM','现有用料行数','正应领行数','用料未领足','当前入库保护值','最近任务开始时间','最近任务入库受阻','记录事实','判断依据','待核查依据','跨账套线索','关联销售单号','关联生产单号','接口内部编号','生产明细内部编号','完整证据JSON']

def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def num(v):return Fraction(str(v)) if v is not None and re.fullmatch(r'[+-]?\d+(?:\.\d+)?',str(v)) else None
def ident(v):
 if v is None or not re.fullmatch(r'\d+',str(v).strip()):return None
 return str(int(str(v)))
def text(v):return '' if v is None else str(v)
def shown(v):
 if v is None:return None
 if v.denominator==1:return str(v.numerator)
 with localcontext() as c:
  c.prec=60
  return format(Decimal(v.numerator)/Decimal(v.denominator),'f').rstrip('0').rstrip('.')
def calendar(v):
 if not isinstance(v,str) or not re.match(r'^\d{4}-\d{2}-\d{2}(?:T| |$)',v):return None
 try:return datetime.fromisoformat(v[:10]).date()
 except ValueError:return None
def unique(rows,key):
 result={}
 for r in rows:
  k=ident(r.get(key))
  if k is None or k in result:raise ValueError('CHAIN_SOURCE_KEY_CONFLICT')
  result[k]=r
 return result
def joined(values):return '；'.join(dict.fromkeys(str(v) for v in values if v is not None and v!=''))

def analyze_data(batch,data,manifest):
 interfaces=unique(data['kfu-completion'],'ID');orders=unique(data['u8-production-links'],'MoDId')
 receipts=unique(data['u8-product-receipts'],'ReceiptLineId');by_receipt=defaultdict(list)
 for r in receipts.values():by_receipt[ident(r.get('ProductionDetailId'))].append(r)
 alloc=defaultdict(lambda:{'count':0,'positive':0,'unknown':0,'unissued':0,'examples':[]})
 for a in data['u8-allocations']:
  s=alloc[ident(a.get('MoDId'))];s['count']+=1;q=num(a.get('Qty'));issued=num(a.get('IssQty'))
  if q is None:s['unknown']+=1
  elif q>0:s['positive']+=1
  if q is not None and q>(issued if issued is not None else 0):s['unissued']+=1
  if len(s['examples'])<5:s['examples'].append({k:a.get(k) for k in ['AllocateId','InvCode','Qty','IssQty']})
 controls=data['kfu-completion-control'];params=defaultdict(list)
 for r in controls:
  if r.get('Kind')=='parameter':params[r.get('ItemKey')].append(r.get('ItemValue'))
 def param(k):return params[k][0] if len(params[k])==1 else None
 cutoff=calendar(param('AutoUseDate'));guard=param('CCPRKFlag');tasks=[r for r in controls if r.get('Kind')=='task']
 part_groups=defaultdict(list);ref_groups=defaultdict(list)
 for k in interfaces.values():
  if text(k.get('零件编号')).strip():part_groups[text(k.get('PartGroup')) or text(k['零件编号'])].append(k)
  if text(k.get('U8AUTOID')).strip():ref_groups[text(k.get('ReferenceGroup')) or text(k['U8AUTOID'])].append(k)
 coverage=Counter();rows=[]
 for kid,k in interfaces.items():
  if k.get('账套号')!='333':continue
  coverage['interfaceRows']+=1;pid=ident(k.get('U8AUTOID'));p=orders.get(pid);flag=k.get('是否入库');created=calendar(k.get('创建日期'));now=calendar(k.get('ObservedServerTime'))
  eligible=None if cutoff is None or created is None else created>=cutoff
  if flag=='是':coverage['markedPending']+=1
  if flag=='是' and eligible is True:coverage['automaticDateEligiblePending']+=1
  if flag=='已入库':coverage['markedCompleted']+=1
  rr=by_receipt.get(pid,[]) if p else [];a=alloc.get(pid,{'count':0,'positive':0,'unknown':0,'unissued':0,'examples':[]})
  quantity=num(p.get('Qty')) if p else None;qualified=num(p.get('QualifiedInQty')) if p else None
  remaining=quantity-qualified if quantity is not None and qualified is not None else None
  conflicts=[];valid=[];unknown=[];unaudited=[]
  for r in rr:
   bad=[]
   if r.get('HeaderMissing')!='0':bad.append('入库表头缺失或未采集')
   if r.get('cmocode')!=p.get('MoCode'):bad.append('生产单号不符或缺失')
   if ident(r.get('imoseq'))!=ident(p.get('SortSeq')):bad.append('生产行号不符或缺失')
   if r.get('cInvCode')!=p.get('InvCode'):bad.append('产品编码不符或缺失')
   if r.get('bRdFlag')!='1':bad.append('入库方向依据不足')
   if bad:conflicts.append({'receipt':r,'reasons':bad});continue
   valid.append(r)
   if num(r.get('iQuantity')) is None:unknown.append(r)
   if r.get('HasAuditHandler')!='1':unaudited.append(r)
  net=None if unknown else sum((num(r.get('iQuantity')) for r in valid),Fraction(0))
  audited=[r for r in valid if r.get('HasAuditHandler')=='1'];audited_net=None if any(num(r.get('iQuantity')) is None for r in audited) else sum((num(r['iQuantity']) for r in audited),Fraction(0))
  production=text(p.get('MoCode')) if p else text(k.get('BOM编号'));sales=text(p.get('OrderCode')) if p and p.get('OrderType')=='1' else ''
  baseline={'销售订单':sales,'生产订单':production,'生产行号':p.get('SortSeq') if p else None,'接口原填生产订单':k.get('BOM编号'),'接口零件编号':k.get('零件编号'),'生产编号':k.get('生产编号'),'产品编码':p.get('InvCode') if p else k.get('零件代码'),'接口入库状态':flag,'接口领料状态':k.get('是否领料'),'自动扫描范围':'日期依据不足' if eligible is None else '符合起算日期' if eligible else '早于起算日期','订单创建日期':k.get('创建日期'),'订单距观察日天数':(now-created).days if now and created else None,'积压起始时间':'未取得状态变更时间；订单创建日期不能代替','生产状态':p.get('Status') if p else None,'订单数量':shown(quantity),'累计入库数量':shown(qualified),'剩余数量':shown(remaining),'对应入库凭据数':len(rr),'对应入库净数量':shown(net) if p and not conflicts else None,'已审核入库净数量':shown(audited_net) if p and not conflicts else None,'未审核入库凭据数':len(unaudited),'入库单号':joined(r.get('ReceiptCode') for r in rr),'订单采用BOM':p.get('BomId') if p else None,'现有用料行数':a['count'] if p else None,'正应领行数':a['positive'] if p else None,'用料未领足':'依据不足' if a['unknown'] else '存在未领足行' if a['unissued'] else '未见正的未领差量；不证明齐套','当前入库保护值':guard,'最近任务开始时间':joined(t.get('StartedAt') for t in tasks),'最近任务入库受阻':joined(t.get('ReceiptBlocked') for t in tasks),'接口内部编号':kid,'生产明细内部编号':k.get('U8AUTOID')}
  def emit(kind,classification,fact,basis,pending='',peers=None):
   peers=peers or [];evidence={'interface':k,'production':p,'receipts':rr,'receiptConflicts':conflicts,'allocations':a,'peerInterfaces':peers,'controls':controls,'rulesSource':'mes-completion-rules','limits':['独立读取窗口，不是跨库同一时点','缺少历史状态及变更依据时不判历史业务错误','源记录和原始数量保留，不自动纠正']}
   aliases=list(dict.fromkeys(v for v in [production,text(k.get('BOM编号'))] if v))
   values={**baseline,'分类':LABELS[classification],'核查项目':KINDS[kind],'记录事实':fact,'判断依据':basis,'待核查依据':pending,'跨账套线索':joined(x.get('账套号') for x in peers),'关联销售单号':sales,'关联生产单号':joined(aliases),'完整证据JSON':json.dumps(evidence,ensure_ascii=False,separators=(',',':'))}
   rows.append({'id':kind+':'+kid,'classification':classification,'category':kind,'categoryLabel':KINDS[kind],'interfaceId':kid,'salesOrder':sales,'productionOrder':production,'productionOrders':aliases,'values':values,'evidence':evidence})
  if not p:
   emit('production_reference_missing','confirmed_issue','接口引用在当前333生产明细中无对应记录。','按账套333及生产明细引用核对全部当前生产状态。','需查历史恢复、删除、更正及正确身份；不认定历史未入库。')
  else:
   mismatches=[]
   if not p.get('MoCode'):mismatches.append('生产主单缺失')
   if ident(k.get('U8ID'))!=ident(p.get('MoId')):mismatches.append('生产主单引用不同或缺失')
   if k.get('BOM编号')!=p.get('MoCode'):mismatches.append('生产订单号不同或缺失')
   if k.get('零件编号')!=text(p.get('MoCode'))+text(p.get('SortSeq')):mismatches.append('零件编号与生产单/行组合不同或缺失')
   if mismatches:emit('production_reference_conflict','confirmed_issue','；'.join(mismatches),'保留双方当前原值，不按数字引用自动覆盖业务身份。','正确引用与历史形成原因待核查。')
   if k.get('零件代码') is not None and k.get('零件代码')!=p.get('InvCode'):emit('material_identity_pending','pending_evidence','接口零件代码与当前生产产品编码原值不同。','保留接口、生产两方原值；字段对应及历史编码变更尚未完整核实。','需核实两字段对应关系及历史编码变更，不能直接认定错传产品。')
  for kind,groups,field,gfield in [('duplicate_part_reference',part_groups,'零件编号','PartGroup'),('duplicate_production_reference',ref_groups,'U8AUTOID','ReferenceGroup')]:
   peers=groups.get(text(k.get(gfield)) or text(k.get(field)),[]) if text(k.get(field)).strip() else []
   if len(peers)>1:emit(kind,'confirmed_issue',f'同一匹配键对应{len(peers)}条接口记录。','依据源库排序分组保留原比较语义，其他账套仅作冲突线索。','重复引用不等于重复入库；当前日期资格与所有对照行分别保存。',peers)
  if flag=='是' and eligible is not True:emit('outside_automatic_scope','pending_evidence','待入库标志已存在，日期条件未能确认为本轮自动扫描范围。','按本批AutoUseDate与接口创建日期比较。','不能擅自移动起算日期或推定此单应补跑。')
  if not p:continue
  if remaining is None or unknown:emit('quantity_basis_pending','pending_evidence','订单、累计量或入库数量存在缺失/不可计算值。','缺失不按0处理，保持精确原值。','补齐数量或单位、凭据依据后复核。')
  if flag=='是' and remaining is not None and remaining>0:
   if p.get('CloseDate') is None:
    emit('backlog','pending_evidence','已标记待入库，当前生产明细未关闭且尚有剩余量。','剩余量＝订单数量－累计入库数量；保护和任务结果只作同批运行背景。','未取得待处理起始时间或承诺时限，不自动判逾期、应补单或该单执行失败。')
    if a['count']==0 or a['positive']==0:emit('allocation_basis_pending','pending_evidence','无用料清单或没有正应领量。','当前BOM引用及用料汇总已保存；不能用无未领差量证明齐套。','需按订单BOM及明确变更适用、替代和净出库核查。')
   else:emit('closed_with_remaining','pending_evidence','生产明细已有关闭日期，但订单量仍大于累计入库量。','当前关闭与剩余数量记录同时存在；部分关闭可能有业务依据。','允许部分关闭、报废或其他业务处理的依据待核查。')
  if flag=='已入库' and remaining is not None and remaining>0:emit('completed_with_remaining','confirmed_issue','接口标为已入库，但生产明细仍有正剩余量。','仅确认当前状态与数值矛盾。','需核对历史凭据、关闭及状态回写，不自动改回待处理。')
  if flag=='已入库' and (not valid or conflicts):emit('completed_without_receipt','pending_evidence','已入库状态缺少完整、可一致关联的当前入库凭据依据。','凭据按生产明细引用、单号、行号和产品共同核对。','未发现有效凭据不证明历史从未入库。')
  if conflicts:emit('receipt_reference_conflict','confirmed_issue','入库凭据的表头、生产引用或产品存在冲突/缺失。','逐条保留引用指向及原填值；冲突凭据不自动归入净量。','正确归属和历史处理待核查。')
  if unaudited:emit('receipt_audit_pending','pending_evidence','存在没有审核人依据的对应入库凭据。','审核依据与数量合计分开，未审核不等于无记录。','需核实审核、取消或后续处理；不推定已经正式入库。')
  reliable=bool(valid) and not conflicts and not unknown and not unaudited
  if reliable and qualified is not None and net!=qualified:emit('receipt_total_difference','confirmed_issue','生产累计入库量与对应已审核凭据净量不同。','同生产明细、同产品、无引用冲突，使用精确有符号数量相加。','正确累计量及历史删除、更正、红字适用仍待核查。')
  if flag=='是' and reliable and quantity is not None and net>=quantity and quantity>0:emit('pending_with_receipts','pending_evidence','接口仍为待入库，但对应已审核凭据净量已达到订单量。','已存在足额当前凭据的线索；不能只依据待处理标志重跑。','需核对状态回写和原凭据有效性，不自动补单。')
 category_counts=Counter(r['category'] for r in rows);class_counts=Counter(r['classification'] for r in rows)
 summary={'total':len(rows),'confirmed':class_counts['confirmed_issue'],'pending':class_counts['pending_evidence'],'interfaceRows':len({r['interfaceId'] for r in rows}),'salesOrders':len({r['salesOrder'] for r in rows if r['salesOrder']}),'productionOrders':len({r['productionOrder'] for r in rows if r['productionOrder']})}
 report={'version':1,'batchId':batch,'status':'available','createdAt':datetime.now(timezone.utc).isoformat(),'boundary':BOUNDARY,'sourceManifest':manifest,'summary':summary,'categories':dict(category_counts),'coverage':dict(coverage),'controls':controls,'rules':data['mes-completion-rules'],'columns':COLUMNS}
 return report,rows

def checked_rows(path,audit):
 count=0
 with path.open(encoding='utf-8-sig') as f:
  for line in f:
   if not line.strip():continue
   item=json.loads(line);count+=1
   if int(item['_expectedCount'])!=audit['count']:raise ValueError('CHAIN_SOURCE_COUNT_MISMATCH')
   yield item
 if count!=audit['count']:raise ValueError('CHAIN_SOURCE_COUNT_MISMATCH')

def run(root):
 context=json.loads((root/'quantity-inputs.json').read_text(encoding='utf-8'));manifest=[];data={}
 for key in SOURCES:
  path=root/(key+'.ndjson');audit=json.loads((root/(key+'.ndjson.audit.json')).read_text(encoding='utf-8-sig'))
  if audit['status']!='succeeded' or sha(path)!=audit['sha256'] or audit['querySha256']!=context['queryHashes'][key]:raise ValueError('CHAIN_SOURCE_MISMATCH')
  items=checked_rows(path,audit)
  data[key]=items if key=='u8-allocations' else list(items);manifest.append({**audit,'dataset':key})
 report,rows=analyze_data(context['batchId'],data,manifest);folder=root/'chain-checks';folder.mkdir(exist_ok=False)
 with (folder/'rows.ndjson').open('w',encoding='utf-8',newline='\n') as f:
  for row in rows:f.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
 report['rows']={'file':'rows.ndjson','count':len(rows),'sha256':sha(folder/'rows.ndjson')}
 (folder/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'batchId':report['batchId'],'summary':report['summary']}))

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('stage');run(Path(parser.parse_args().stage))
