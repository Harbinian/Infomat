"""Stream all frozen check results into an immutable, inspectable statistics file.

No database connection or business action is available. A row is a check item,
not a distinct incident. Reference datasets are accounted separately from checks.
"""
import argparse,csv,hashlib,importlib.util,json,re,sqlite3,zlib
from collections import Counter,defaultdict
from datetime import datetime,timezone
from pathlib import Path

spec=importlib.util.spec_from_file_location('risk_context',Path(__file__).with_name('risk-context.py'))
risk=importlib.util.module_from_spec(spec);spec.loader.exec_module(risk)
BASE={'u8-sales','u8-production','kfu-sales','kfu-production','mes-tasks','mes-intermediate','mes-travelers','mes-process'}
ROLES={
 **{k:'订单标识与关联核查' for k in BASE},
 **{k:'数量、BOM及变更适用依据；不逐条认定业务正误' for k in ['u8-bom','u8-bom-components','u8-parts','u8-allocations','u8-component-options','u8-substitutes','u8-bom-history','u8-component-history','u8-order-bom','u8-ecn','u8-ecn-details','u8-ecn-bom','u8-ecn-components','u8-ecn-notes','u8-bom-log','u8-quantity-enums','mes-outline-changes']},
 **{k:'入库领料与链路核查依据；不逐条认定业务正误' for k in ['u8-product-receipts','u8-material-issues','u8-other-issues','u8-production-links','u8-production-copies','u8-copy-metadata','u8-material-history','u8-quantity-write-metadata','kfu-completion','kfu-completion-control','mes-completion-rules']},
 'u8-dispatches':'发货凭据关联、审核与交付阶段依据','u8-sales-issues':'销售出库凭据关联、审核与交付阶段依据',
 'mes-operation-events':'实际加工触发、工序身份与状态依据','mes-inspection-events':'检验结果与合格数量依据'
}
FAMILIES={'ledger':'订单标识与关联','quantity-sales':'销售与生产数量','quantity-mes':'勤哲数量','quantity-bom':'订单BOM适用','quantity-allocation':'订单用料与当前BOM','quantity-demand':'销售BOM子件需求','quantity-changes':'大纲更改适用','quantity-history':'BOM历史与变更','quantity-scope':'数量核查关联范围','material':'入库与领料','chain':'完工到入库链路','processing':'加工流转核查','source':'源记录关联','delivery':'发货与销售出库依据'}
LEDGER_CODES={'PRODUCTION_NUMBER_MISSING','PRODUCTION_NUMBER_LENGTH','QUALITY_MISSING','SALES_NUMBER_REUSED','RAW_DIFFERENCE','SALES_REFERENCE_CONFLICT','SALES_REFERENCE_UNRESOLVED','KFU_PARENT_REFERENCE_CONFLICT','MES_TASK_SOURCE_CONFLICT'}
NORMAL={'sales':{'数值相同'},'mes':set(),'bom':set(),'allocation':{'数值相同'},'demand':set(),'changes':set(),'history':set(),'scope':set()}

def dump(v):return json.dumps(v,ensure_ascii=False,separators=(',',':'))
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def ndjson(p):
 with p.open(encoding='utf-8-sig') as f:
  for line in f:
   if line.strip():yield json.loads(line)
def ids(v):return [s for s in re.split('[；、]',v or '') if s]
def calendar_month(v):
 if not isinstance(v,str) or not re.match(r'^\d{4}-\d{2}-\d{2}(?:T| |$)',v):return 'unknown'
 try:datetime.fromisoformat(v[:10]);return v[:7]
 except ValueError:return 'unknown'
def unescape(v):return v[1:] if isinstance(v,str) and len(v)>1 and v[0]=="'" and v[1] in '=+-@\t\r' else v

def analyze(root):
 context=json.loads((root/'unified-inputs.json').read_text(encoding='utf8'));batch=context['batchId']
 policy=context['policy'];policy_hash=hashlib.sha256(dump(policy).encode()).hexdigest()
 if set(context['queryHashes'])!=set(ROLES):raise ValueError('STATISTICS_SOURCE_CONTRACT_MISMATCH')
 out=root/'unified-statistics';out.mkdir(exist_ok=False)
 db=sqlite3.connect(out/'results.sqlite');db.execute('PRAGMA foreign_keys=ON');db.execute('PRAGMA journal_mode=DELETE')
 db.execute('PRAGMA temp_store=FILE')
 db.executescript('''CREATE TABLE findings(id TEXT PRIMARY KEY,family TEXT NOT NULL,category TEXT NOT NULL,classification TEXT NOT NULL,severity INTEGER NOT NULL,stage INTEGER NOT NULL,priority TEXT NOT NULL,frequency INTEGER NOT NULL,score INTEGER NOT NULL,sales_order TEXT NOT NULL,month TEXT NOT NULL,unit TEXT NOT NULL,payload BLOB NOT NULL);
 CREATE TABLE production_orders(case_id TEXT NOT NULL REFERENCES findings(id),production_order TEXT NOT NULL,PRIMARY KEY(case_id,production_order));
 CREATE TABLE stages(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE refinements(id TEXT PRIMARY KEY,payload TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE manifest(name TEXT PRIMARY KEY,payload TEXT NOT NULL);''')
 manifest=[];coverage={};cached={}
 def load(key,retain=False):
  if key in cached:return iter(cached[key])
  path=root/(key+'.ndjson');audit=json.loads(path.with_suffix('.ndjson.audit.json').read_text(encoding='utf-8-sig'))
  if audit['status']!='succeeded' or audit['querySha256']!=context['queryHashes'][key] or sha(path)!=audit['sha256']:raise ValueError('STATISTICS_SOURCE_MISMATCH:'+key)
  def iterate():
   count=0;items=[]
   for r in ndjson(path):
    count+=1
    if str(audit['count'])!=r.get('_expectedCount'):raise ValueError('STATISTICS_SOURCE_COUNT_MISMATCH:'+key)
    if retain:items.append(r)
    yield r
   if count!=audit['count']:raise ValueError('STATISTICS_SOURCE_COUNT_MISMATCH:'+key)
   if key not in coverage:
    manifest.append({**audit,'dataset':key,'file':key+'.ndjson'})
    coverage[key]={'dataset':key,'read':count,'role':ROLES[key],'dispositions':{'reference_evidence':count}}
   if retain:cached[key]=items
  return iterate()
 sales=risk.unique(load('u8-sales',True),'iSOsID');prod=risk.unique(load('u8-production',True),'MoDId')
 def valid_sale(p):
  s=sales.get(risk.ident(p.get('OrderDId'))) if p and risk.ident(p.get('OrderType'))=='1' else None
  return s if s and (not p.get('OrderCode') or p['OrderCode']==s['cSOCode']) else None
 delivery=risk.delivery_evidence(list(sales.values()),list(load('u8-dispatches')),list(load('u8-sales-issues')))
 receipt=risk.receipt_evidence(list(prod.values()),list(load('u8-product-receipts')))
 stages={}
 for sid,s in sales.items():stages['S:'+sid]={'level':1,'label':policy['stage']['1'],'scope':'sales-line','references':[{'dataset':'u8-sales','key':sid}],'limits':[]}
 for pid,p in prod.items():
  stages['P:'+pid]={'level':2,'label':policy['stage']['2'],'scope':'production-detail','references':[{'dataset':'u8-production','key':pid,'status':p.get('Status')}],'limits':['关闭状态不证明已经交付']}
 for k in load('kfu-completion',True):
  pid=risk.ident(k.get('U8AUTOID'));p=prod.get(pid)
  if p and k.get('账套号')=='333' and risk.ident(k.get('U8ID'))==risk.ident(p.get('MoId')) and k.get('零件编号')==p.get('Define28') and k.get('是否入库') in ['是','已入库']:
   stages['P:'+pid]={'level':3,'label':policy['stage']['3'],'scope':'production-detail','references':[{'dataset':'kfu-completion','key':k['ID'],'status':k.get('是否入库')}],'limits':['接口标志不是有效入库凭据，也不是实际完工时间']}
 for pid,v in receipt['stages'].items():stages['P:'+pid]=v
 for sid,v in delivery['stages'].items():stages['S:'+sid]=v
 for key,v in stages.items():db.execute('INSERT INTO stages VALUES(?,?)',(key,dump(v)))
 domains=defaultdict(lambda:Counter({'units':0,'clear':0,'findingUnits':0,'items':0}));inputs=[]
 for family in FAMILIES:domains[family]
 def output_input(folder,filename,expected_hash,expected_rows):
  path=root/folder/filename
  if sha(path)!=expected_hash:raise ValueError('STATISTICS_RESULT_HASH_MISMATCH')
  count=0
  for r in ndjson(path):count+=1;yield r
  if count!=expected_rows:raise ValueError('STATISTICS_RESULT_COUNT_MISMATCH')
  inputs.append({'file':folder+'/'+filename,'sha256':expected_hash,'rows':count})
 def stage_for(sid,pids,allow=True):
  keys=[]
  if allow:
   keys+=['P:'+p for p in pids if 'P:'+p in stages]
   keys+=['S:'+sid] if sid and 'S:'+sid in stages else []
  return max(keys,key=lambda k:stages[k]['level']) if keys else None
 def emit(family,unit,category,label,classification,severity,values,reference,sid=None,pids=None,orders=None,sales_order=None,allow_stage=True,suffix=''):
  if classification not in ['confirmed_record_difference','pending_evidence']:raise ValueError('STATISTICS_CLASSIFICATION_UNKNOWN')
  pids=list(dict.fromkeys(pids or []));s=sales.get(sid);ps=[prod[p] for p in pids if p in prod]
  if not s:
   ss={risk.ident(valid_sale(p)['iSOsID']) for p in ps if valid_sale(p)}
   if len(ss)==1:sid=next(iter(ss));s=sales[sid]
  orders=list(dict.fromkeys(filter(None,(orders or [])+[p['MoCode'] for p in ps])));so=s.get('cSOCode','') if s else sales_order or ''
  key=stage_for(sid,pids,allow_stage);stage=stages[key]['level'] if key else 0
  months={calendar_month(p.get('CreateDate')) for p in ps};month=next(iter(months)) if len(months)==1 else 'unknown'
  if not ps and s:month=calendar_month(s.get('dDate'))
  item_id=family+':'+hashlib.sha256((unit+'\0'+category+'\0'+suffix).encode()).hexdigest()[:32]
  item={'id':item_id,'family':family,'category':category,'label':label,'classification':classification,'severity':severity,'stage':stage,'stageKey':key,'salesOrder':so,'salesDetailId':sid,'productionOrders':orders,'productionDetailIds':pids,'month':month,'unit':unit,'values':values,'reference':reference,'occurrenceFrequency':'unknown'}
  db.execute('INSERT INTO findings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(item_id,family,category,classification,severity,stage,'pending',0,0,so,month,unit,zlib.compress(dump(item).encode(),6)))
  for order in orders:db.execute('INSERT INTO production_orders VALUES(?,?)',(item_id,order))
  domains[family]['items']+=1
 def refinement(key):
  r=db.execute('SELECT payload FROM refinements WHERE id=?',(key,)).fetchone()
  if r:db.execute('UPDATE refinements SET used=1 WHERE id=?',(key,));return json.loads(r[0])
  return None
 order_report=json.loads((root/'order-checks/review.json').read_text(encoding='utf8'))
 if order_report['batchId']!=batch:raise ValueError('STATISTICS_BATCH_MISMATCH')
 for r in output_input('order-checks','rows.ndjson',order_report['rows']['sha256'],order_report['rows']['count']):db.execute('INSERT INTO refinements(id,payload) VALUES(?,?)',(r['id'],dump(r)))
 # Raw identifier checks retain their established facts. Unresolved scope is pending.
 ledger_meta=context['ledger']
 for r in output_input('','statistics-ledger.ndjson',ledger_meta['sha256'],ledger_meta['rows']):
  family='ledger';domains[family]['units']+=1;found=False
  for n,i in enumerate(r['issues']):
   if i['code'] not in LEDGER_CODES:raise ValueError('STATISTICS_CHECK_UNKNOWN')
   pending=i['code']=='SALES_REFERENCE_UNRESOLVED';severity=3 if pending else 4 if 'REFERENCE' in i['code'] or i['code']=='MES_TASK_SOURCE_CONFLICT' else 2
   emit(family,r['id'],i['code']+'|'+i['label'],i['label'],'pending_evidence' if pending else 'confirmed_record_difference',severity,i,{'kind':'ledger','id':r['id'],'issueIndex':n},r.get('salesDetailId'),[r['productionDetailId']] if r.get('productionDetailId') else [],suffix=':'+str(n));found=True
  if r['status']=='unmatched':
   emit(family,r['id'],'association_pending','订单关联依据不足','pending_evidence',3,{'依据':r['associationBasis']},{'kind':'ledger','id':r['id']},r.get('salesDetailId'),[r['productionDetailId']] if r.get('productionDetailId') else []);found=True
  domains[family]['findingUnits' if found else 'clear']+=1
 # Every row in every quantity output is inspected, including secondary columns.
 q=json.loads((root/'quantity/review.json').read_text(encoding='utf8'))
 if q['batchId']!=batch or set(q['files'])!=set(NORMAL):raise ValueError('STATISTICS_QUANTITY_CONTRACT_MISMATCH')
 secondary=defaultdict(Counter);excluded=Counter();unexpanded=Counter()
 for kind,meta in q['files'].items():
  family='quantity-'+kind;path=root/'quantity'/meta['file']
  if sha(path)!=meta['sha256']:raise ValueError('STATISTICS_RESULT_HASH_MISMATCH')
  n=0;states=Counter();occurrences=Counter()
  with path.open(encoding='utf-8-sig',newline='') as f:
   reader=csv.DictReader(f)
   if reader.fieldnames!=meta['columns']:raise ValueError('STATISTICS_COLUMNS_MISMATCH')
   for raw in reader:
    n+=1;r={k:unescape(v) for k,v in raw.items()};domains[family]['units']+=1
    sid=r.get('销售明细编号');pids=ids(r.get('生产明细编号',r.get('用友生产明细编号','')));refkey=None
    if kind=='sales':state=r['数值比较'];refkey='S-'+sid
    elif kind=='mes':
     left,right=r['投产数值比较'],r['销售数值比较'];state='存在数值差异' if '数值不同' in [left,right] else '数值相同但需核实单位及单据范围' if left==right=='数值相同' else '未取得可核对记录' if not r['勤哲记录编号'] else '待核查'
     refkey=None if left==right=='数值相同' else 'M-'+r['生产明细编号']+'-'+r['勤哲记录编号']+'-'+r['勤哲行号']
    elif kind=='bom':state=r['核查结果'].split('；未取得完整变更单')[0]
    elif kind=='allocation':
     state=r['订单算术比较'];refkey='A-'+r['用料明细编号'];secondary['allocation_current'][r['当前BOM对照']]+=1
    elif kind=='demand':
     state=r['数值比较'];refkey='D-'+str(sid)+'-'+r['子件物料编号']+(':'+'；'.join(pids) if state=='销售来源待核查' else '');secondary['demand_mes'][r['勤哲与BOM数值比较']]+=1
    elif kind=='changes':state='变更适用关系待核查'
    elif kind=='history':state='适用依据待核查'
    else:
     state=r['核查结论']
     if r['资料类别']=='mes-intermediate':excluded[state]+=1
     if state=='未取得唯一可展开的母件数量分配':unexpanded[state]+=1
    states[state]+=1
    issues=[state] if state not in NORMAL[kind] else []
    if kind=='allocation' and r['当前BOM对照']!='当前子件行及基本用量相同':issues.append(r['当前BOM对照'])
    if kind=='demand':issues.append('勤哲：'+r['勤哲与BOM数值比较'])
    if kind=='bom' and state=='当前记录未发现日期或母件引用冲突':issues=['历史BOM及变更适用依据不足']
    if not issues:domains[family]['clear']+=1;continue
    if refkey and kind=='mes':
     occurrences[refkey]+=1
     if occurrences[refkey]>1:refkey+=':'+str(occurrences[refkey])
    rr=refinement(refkey) if refkey else None
    classification='confirmed_record_difference' if rr and rr['classification']=='confirmed_numeric_difference' else 'pending_evidence'
    label='；'.join(dict.fromkeys(issues));category=state
    if kind=='allocation':category=state+' / '+r['当前BOM对照']
    if kind=='demand':category=state+' / '+r['勤哲与BOM数值比较']
    reference={'kind':'quantity','file':meta['file'],'row':n,'sha256':meta['sha256']}
    if rr:reference.update({'refinementId':rr['id'],'refinementFile':'order-checks/rows.ndjson'});r['逐单复核依据']=rr['values']
    emit(family,str(n),category,label,classification,4 if classification=='confirmed_record_difference' else 3,r,reference,sid,pids,ids(r.get('生产订单','')),r.get('销售订单'),allow_stage=kind!='scope')
    domains[family]['findingUnits']+=1
  if n!=meta['rows'] or dict(states)!=q['counts'][kind]:raise ValueError('STATISTICS_QUANTITY_COUNT_MISMATCH:'+kind)
  inputs.append({'file':'quantity/'+meta['file'],'sha256':meta['sha256'],'rows':n})
 for key in ['allocation_current','demand_mes']:
  if dict(secondary[key])!=q['counts'].get(key,{}):raise ValueError('STATISTICS_SECONDARY_COUNT_MISMATCH:'+key)
 if dict(excluded)!=q['summary']['mesExcluded'] or dict(unexpanded)!=q['counts'].get('demand_scope',{}):raise ValueError('STATISTICS_SCOPE_COUNT_MISMATCH')
 # No refined result can disappear when the quantity adapters change.
 unused=list(db.execute('SELECT id FROM refinements WHERE used=0'))
 if unused:raise ValueError('STATISTICS_REFINEMENT_UNACCOUNTED:'+str(len(unused)))
 for family,folder in [('material','material-checks'),('chain','chain-checks'),('processing','processing-checks')]:
  report=json.loads((root/folder/'review.json').read_text(encoding='utf8'))
  if report['batchId']!=batch:raise ValueError('STATISTICS_BATCH_MISMATCH')
  for r in output_input(folder,'rows.ndjson',report['rows']['sha256'],report['rows']['count']):
   v={k:x for k,x in r['values'].items() if k!='完整证据JSON'}
   pid=r.get('productionDetailId') or v.get('生产明细编号',v.get('生产明细内部编号'));unit=r.get('productionDetailId') or r.get('interfaceId',r['id']);domains[family]['units']+=1;domains[family]['findingUnits']+=1
   confirmed=r['classification']=='confirmed_issue';severity=4 if confirmed or r['category'] in ['positive_required_no_issue','issue_net_shortfall','completed_without_receipt'] else 3
   emit(family,unit,r['category'],r['categoryLabel'],'confirmed_record_difference' if confirmed else 'pending_evidence',severity,v,{'kind':family,'id':r['id'],'file':folder+'/rows.ndjson'},pids=[pid] if pid else [],orders=r.get('productionOrders',[r.get('productionOrder','')]),sales_order=r.get('salesOrder'),allow_stage=r['category'] not in ['production_reference_conflict','production_reference_missing'],suffix=r['id'] if family=='processing' else '')
 # Explicit dispositions for all eight original extracts, not only ledger-linked rows.
 dispositions=context['sourceDispositions']
 if set(dispositions)!=BASE:raise ValueError('STATISTICS_DISPOSITION_CONTRACT_MISMATCH')
 for key in BASE:
  rows=list(load(key));dd=dispositions[key];counts=Counter()
  if len(dd)!=len(rows):raise ValueError('STATISTICS_DISPOSITION_COUNT_MISMATCH')
  for ordinal,(r,d) in enumerate(zip(rows,dd),1):
   if d not in ['used_in_check','scope_reference','association_pending']:raise ValueError('STATISTICS_DISPOSITION_INVALID')
   counts[d]+=1
   if d=='association_pending':
    domains['source']['units']+=1;domains['source']['findingUnits']+=1
    emit('source',key+':'+str(ordinal),'association_pending:'+key,'源记录未取得本次核查链的无冲突关联','pending_evidence',3,{k:v for k,v in r.items() if k!='_expectedCount'},{'kind':'source','dataset':key,'ordinal':ordinal,'key':r.get(context['sources'][key]['key'])},allow_stage=False)
  coverage[key]['dispositions']=dict(counts)
 for key in ['u8-dispatches','u8-sales-issues']:
  kind='dispatch' if key=='u8-dispatches' else 'sales_issue';rr=[r for r in delivery['records'] if r['kind']==kind];coverage[key]['dispositions']=dict(Counter(r['state'] for r in rr))
  for r in rr:
   domains['delivery']['units']+=1
   if r['state']=='verified_evidence':domains['delivery']['clear']+=1;continue
   domains['delivery']['findingUnits']+=1
   emit('delivery',key+':'+r['key'],r['state'],{'reference_pending':'发货或销售出库关联依据不足','quantity_pending':'发货或销售出库数量依据不足','audit_pending':'发货凭据尚缺审核依据'}[r['state']],'pending_evidence',3,{'原因':r['reasons'],'原始凭据':r['source'],'关联依据':r['references']},{'kind':'source','dataset':key,'key':r['key']},r['salesDetailId'],allow_stage=False)
 for key in ROLES:
  if key not in coverage:
   for _ in load(key):pass
  c=coverage[key]
  if c['read']!=sum(c['dispositions'].values()):raise ValueError('STATISTICS_COVERAGE_MISMATCH')
 # Denominators come from inspected units, never from a page, sample or filtered list.
 domains['material']['units']=sum(1 for _ in db.execute("SELECT DISTINCT unit FROM findings WHERE family='material'"))
 domains['material']['findingUnits']=domains['material']['units']
 domains['processing']['units']=db.execute("SELECT count(DISTINCT unit) FROM findings WHERE family='processing'").fetchone()[0]
 domains['processing']['findingUnits']=domains['processing']['units']
 domains['chain']['units']=sum(r.get('账套号')=='333' for r in cached['kfu-completion']);domains['chain']['findingUnits']=db.execute("SELECT count(DISTINCT unit) FROM findings WHERE family='chain'").fetchone()[0];domains['chain']['clear']=domains['chain']['units']-domains['chain']['findingUnits']
 domains['source']['units']=sum(coverage[k]['read'] for k in BASE);domains['source']['clear']=domains['source']['units']-domains['source']['findingUnits']
 db.execute('CREATE INDEX grading_lookup ON findings(family,category,stage,severity)')
 categories=[]
 for family,category,count,units in db.execute('SELECT family,category,count(*),count(DISTINCT unit) FROM findings GROUP BY family,category').fetchall():
  denominator=domains[family]['units'];rate=units/denominator if denominator else None
  # Material output is a candidate review, not the universe of possible material checks.
  known_rate=rate if family not in ['material','processing'] else None
  band=next((b['level'] for b in policy['frequency']['bands'] if known_rate is not None and known_rate>=b['minimumRate']),3)
  categories.append({'family':family,'category':category,'items':count,'units':units,'denominator':denominator if known_rate is not None else None,'rate':known_rate,'frequencyBand':band,'occurrenceFrequency':'unknown','rateLimit':'材料或加工核查候选集合不作为全部对象检出率分母' if family in ['material','processing'] else policy['frequency']['boundary']})
  for stage in range(6):
   for severity in range(1,5):
    points=severity*3+int(policy['priority']['stageBand'][str(stage)])*2+band;priority='P'+str(1 if points>=21 else 2 if points>=16 else 3 if points>=11 else 4);score=points*100+stage*10+severity
    db.execute('UPDATE findings SET priority=?,frequency=?,score=? WHERE family=? AND category=? AND stage=? AND severity=?',(priority,band,score,family,category,stage,severity))
 for family,c in domains.items():
  if c['units']!=c['clear']+c['findingUnits']:raise ValueError('STATISTICS_DOMAIN_COVERAGE_MISMATCH:'+family)
 report={'version':1,'batchId':batch,'status':'available','createdAt':datetime.now(timezone.utc).isoformat(),'policy':policy,'policySha256':policy_hash,'analysisSha256':sha(Path(__file__)),'sourceManifest':manifest,'sourceCoverage':list(coverage.values()),'inputs':inputs,'families':FAMILIES,'domains':dict(domains),'categories':categories,
  'summary':{'items':db.execute('SELECT count(*) FROM findings').fetchone()[0],'classifications':dict(db.execute('SELECT classification,count(*) FROM findings GROUP BY classification')),'priorities':dict(db.execute('SELECT priority,count(*) FROM findings GROUP BY priority')),'sources':len(coverage),'sourceRows':sum(c['read'] for c in coverage.values())},
  'limits':['总数按核查条目计，同一业务事实可能在不同核查维度出现，不是去重问题数或实际发生次数。','逐单数量复核附在相应数量检查中，不再次累计。','仅覆盖固定查询范围及已实现检查；依据类资料的完整读取不证明每条业务数据正确。','历史批次不使用本次数据补算；各源读取窗口不同，不是跨系统同一时点。','正常或数值相同只表示该项检查未发现差异，不能替代历史BOM适用或业务验收。']}
 db.execute('DROP TABLE refinements')
 db.executescript('CREATE INDEX findings_filter ON findings(family,classification,priority,category);CREATE INDEX findings_order ON findings(score DESC,sales_order,id);CREATE INDEX findings_sales ON findings(sales_order);CREATE INDEX production_filter ON production_orders(production_order,case_id);')
 db.execute('INSERT INTO manifest VALUES(?,?)',('report',dump(report)));db.commit()
 if db.execute('PRAGMA quick_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchone():raise ValueError('STATISTICS_DATABASE_INVALID')
 db.close();report['database']={'file':'results.sqlite','sha256':sha(out/'results.sqlite')}
 (out/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
 return report

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);args=parser.parse_args();print(dump(analyze(args.root)['summary']))
