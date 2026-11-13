"""Pure evidence helpers for anomaly statistics; never connects to source systems.

Stages describe currently retained, consistently linked records. Shipping evidence
belongs to a sales line and never proves customer acceptance or a component batch.
"""
from collections import defaultdict
from fractions import Fraction
import re

def ident(value):
 if value is None or not re.fullmatch(r'\s*\+?\d+\s*',str(value)):return None
 return str(int(str(value)))

def number(value):
 return Fraction(str(value)) if value is not None and re.fullmatch(r'[+-]?\d+(?:\.\d+)?',str(value)) else None

def unique(rows,key):
 out={}
 for row in rows:
  value=ident(row.get(key))
  if value is None or value in out:raise ValueError('RISK_SOURCE_KEY_CONFLICT:'+key)
  out[value]=row
 return out

def delivery_evidence(sales,dispatches,issues):
 """Partition every queried dispatch/issue row; ambiguous links never raise stage."""
 by_sale=unique(sales,'iSOsID');dispatch=unique(dispatches,'DispatchLineId');stock=unique(issues,'SalesIssueLineId')
 by_link=defaultdict(list)
 for row in dispatch.values():
  if ident(row.get('iDLsID')) is not None:by_link[ident(row['iDLsID'])].append(row)
 records=[];totals=defaultdict(lambda:{'dispatch':Fraction(0),'sales_issue':Fraction(0),'dispatch_unknown':False,'sales_issue_unknown':False,'references':[]})
 for kind,items in [('dispatch',dispatch),('sales_issue',stock)]:
  for key,row in items.items():
   reasons=[];reference=[];sid=ident(row.get('SalesDetailId'));linked=None
   if row.get('SalesDetailId') not in [None,''] and sid is None:reasons.append('直接销售引用格式无效，未以发货来源覆盖')
   if kind=='sales_issue':
    candidates=by_link.get(ident(row.get('iDLsID')),[])
    if len(candidates)==1:
     linked=candidates[0];reference.append({'dataset':'u8-dispatches','key':linked['DispatchLineId'],'field':'iDLsID','value':row.get('iDLsID')})
     if row.get('cInvCode')!=linked.get('cInvCode'):reasons.append('出库与发货明细产品不同')
     linked_sid=ident(linked.get('SalesDetailId'))
     if sid is not None and linked_sid is not None and sid!=linked_sid:reasons.append('出库直接销售引用与发货来源冲突')
     elif sid is None:sid=linked_sid
    elif sid is None:reasons.append('未取得唯一发货明细来源')
   sale=by_sale.get(sid)
   if sale is None:reasons.append('未取得本批已审核销售明细')
   else:
    if row.get('cInvCode')!=sale.get('cInvCode'):reasons.append('凭据产品与销售物料不同')
    codes=[row.get('SalesOrderCode')]+([linked.get('SalesOrderCode')] if linked else [])
    if any(code and code!=sale.get('cSOCode') for code in codes):reasons.append('凭据销售单号与明细来源冲突')
   if row.get('HeaderMissing')!='0':reasons.append('凭据表头缺失或未采集')
   if kind=='sales_issue' and row.get('bRdFlag')!='0':reasons.append('销售出库方向依据不足')
   if kind=='dispatch' and row.get('bReturnFlag') not in ['False','True','0','1']:reasons.append('发货退货标志依据不足')
   quantity=number(row.get('iQuantity'));audited=row.get('HasAuditVerifier' if kind=='dispatch' else 'HasAuditHandler')=='1'
   if kind=='dispatch' and quantity is not None and ((row.get('bReturnFlag') in ['True','1'] and quantity>0) or (row.get('bReturnFlag') in ['False','0'] and quantity<0)):reasons.append('发货退货标志与数量符号不一致')
   if reasons:state='reference_pending'
   elif quantity is None:state='quantity_pending'
   elif not audited:state='audit_pending'
   else:state='verified_evidence'
   item={'kind':kind,'key':key,'state':state,'salesDetailId':sid,'salesOrder':sale.get('cSOCode') if sale else None,'reasons':reasons,'references':reference,'source':row}
   records.append(item)
   if sale and reasons:totals[sid][kind+'_unknown']=True
   if sale and not reasons and audited:
    group=totals[sid]
    if quantity is None:group[kind+'_unknown']=True
    else:group[kind]+=quantity
    group['references'].append({'dataset':'u8-dispatches' if kind=='dispatch' else 'u8-sales-issues','key':key,'code':row.get('DispatchCode',row.get('SalesIssueCode')),'quantity':row.get('iQuantity'),'date':row.get('DispatchDate',row.get('IssueDate')),'linkedBy':reference})
 stages={}
 for sid,group in totals.items():
  positive=[kind for kind in ['dispatch','sales_issue'] if not group[kind+'_unknown'] and group[kind]>0]
  if positive:stages[sid]={'level':5,'label':'关联销售明细已有审核发货或销售出库凭据','scope':'sales-line','basis':positive,'references':group['references'],'limits':['不证明客户签收或实际交付完成','不证明本生产明细、子件或批次已经发出','红字按有符号数量抵扣，未知数量不按0']}
 return {'records':records,'stages':stages}

def receipt_evidence(production,receipts):
 orders=unique(production,'MoDId');groups=defaultdict(list)
 for row in unique(receipts,'ReceiptLineId').values():groups[ident(row.get('ProductionDetailId'))].append(row)
 stages={};unresolved=[]
 for pid,rows in groups.items():
  p=orders.get(pid);valid=[];bad=[]
  for r in rows:
   if not p or r.get('HeaderMissing')!='0' or r.get('cInvCode')!=p.get('InvCode') or r.get('cmocode')!=p.get('MoCode') or ident(r.get('imoseq'))!=ident(p.get('SortSeq')) or r.get('bRdFlag')!='1':bad.append(r)
   elif r.get('HasAuditHandler')=='1':valid.append(r)
  if bad:unresolved.extend(bad)
  values=[number(r.get('iQuantity')) for r in valid]
  if p and not bad and values and all(v is not None for v in values) and sum(values,Fraction(0))>0:
   stages[pid]={'level':4,'label':'已有审核产品入库凭据','scope':'production-detail','references':[{'dataset':'u8-product-receipts','key':r['ReceiptLineId'],'code':r.get('ReceiptCode'),'quantity':r.get('iQuantity'),'date':r.get('ReceiptDate')} for r in valid],'limits':['按本生产明细、单号、行号和产品一致关联','红字净量不为正时不认定当前存在正入库量']}
 return {'stages':stages,'unresolved':unresolved}
