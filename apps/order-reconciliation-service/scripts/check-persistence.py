"""Append observation persistence to a new, unpublished statistics file.

Only frozen local files are read. A count is consecutive verified observations,
never incident frequency. Existing batches and their statistics are read-only.
"""
import argparse,hashlib,json,sqlite3,zlib
from contextlib import ExitStack,closing
from pathlib import Path

VERSION='stable-observation-v1'
SEMANTIC_FILES=['reconcile.mjs','scripts/audit-quantity.py','scripts/order-checks.py','scripts/material-checks.py','scripts/chain-checks.py','scripts/processing-checks.py','scripts/unified-statistics.py','scripts/risk-context.py']
BOUNDARIES={
 'no_previous_batch':'没有更早盘点依据',
 'previous_failed':'本段连续观察之前有失败盘点，不能跨过该记录累计',
 'previous_not_collected':'本段连续观察之前的盘点未采集全域统计',
 'contract_changed':'本段连续观察起点处查询或核查规则变化，不能向前累计',
 'earlier_not_measured':'更早连续性未计量，本数仅为可确认下限',
 'previous_not_observed':'本段连续观察之前未检出同一核查项，不代表业务问题已消除',
 'previous_identity_ambiguous':'本段连续观察之前的对应标识不唯一，不能向前累计',
 'identity_unavailable':'缺少稳定来源标识，连续批数未知',
 'identity_ambiguous':'本批稳定来源标识不唯一，连续批数未知'
}
def dump(v):return json.dumps(v,ensure_ascii=False,separators=(',',':'),sort_keys=True)
def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def present(v):return v is not None and v!=''
def source_identity(dataset,values,key=None):
 if dataset.startswith('mes-'):
  rcid=values.get('ExcelServerRCID');rn=values.get('ExcelServerRN')
  return [dataset,rcid,rn] if present(rcid) else None
 return [dataset,key] if present(key) else None
def identity(item):
 family=item['family'];v=item['values'];ref=item['reference'];parts=None
 if family=='ledger':
  p=item.get('productionDetailIds',[]);s=item.get('salesDetailId')
  parts=['production',p[0]] if len(p)==1 and present(p[0]) else ['sales',s] if present(s) else None
 elif family in ['chain','material','processing']:parts=[ref.get('id')] if present(ref.get('id')) else None
 elif family in ['source','delivery']:parts=source_identity(ref.get('dataset',''),v,ref.get('key'))
 elif family=='quantity-sales':parts=[v.get('销售明细编号')]
 elif family=='quantity-bom':parts=[v.get('生产明细编号')]
 elif family=='quantity-allocation':parts=[v.get('用料明细编号')]
 elif family=='quantity-mes':
  parts=[v.get('生产明细编号'),v.get('勤哲记录编号'),v.get('勤哲行号')] if present(v.get('勤哲记录编号')) else [v.get('生产明细编号'),'no-mes-record']
 elif family=='quantity-demand':
  parts=[v.get('销售明细编号'),v.get('子件物料编号')]
  if v.get('数值比较')=='销售来源待核查':parts.append(v.get('用友生产明细编号'))
 elif family=='quantity-changes':parts=[v.get('记录编号'),v.get('明细编号')]
 elif family=='quantity-history':parts=[v.get('资料类别'),v.get('来源记录编号')]
 elif family=='quantity-scope':
  dataset=v.get('资料类别','')
  if dataset.startswith('mes-'):
   try:parts=source_identity(dataset,json.loads(v.get('原始资料（追溯用）','{}')))
   except (ValueError,TypeError):parts=None
  else:parts=[dataset,v.get('来源记录编号')]
 if not parts or any(not present(x) for x in parts):return None,None
 basis=[family,item['category'],item['classification'],parts]
 return hashlib.sha256(dump(basis).encode()).hexdigest(),dump(basis)
def compatible(current,previous):
 if current.get('queryHashes')!=previous.get('queryHashes'):return False
 return all(current.get('implementationHashes',{}).get(k) and current['implementationHashes'][k]==previous.get('implementationHashes',{}).get(k) for k in SEMANTIC_FILES)
def frozen_database(root,report):
 path=root/'unified-statistics'/'results.sqlite'
 if report.get('database',{}).get('file')!='results.sqlite' or sha(path)!=report['database']['sha256']:raise ValueError('PERSISTENCE_SOURCE_HASH_MISMATCH')
 db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)
 try:
  stored=json.loads(db.execute("SELECT payload FROM manifest WHERE name='report'").fetchone()[0]);expected={k:v for k,v in report.items() if k!='database'}
  if stored!=expected:raise ValueError('PERSISTENCE_MANIFEST_MISMATCH')
 except Exception:db.close();raise
 return db
def analyze(root):
 with ExitStack() as handles:return _analyze(root,handles)
def _analyze(root,handles):
 context=json.loads((root/'persistence-inputs.json').read_text(encoding='utf8'))
 path=root/'unified-statistics'/'review.json';report=json.loads(path.read_text(encoding='utf8'))
 batch=report['batchId'];previous=context.get('previous')
 if context['batchId']!=batch or 'persistence' in report:raise ValueError('PERSISTENCE_BATCH_MISMATCH')
 check=frozen_database(root,report);check.close()
 db=handles.enter_context(closing(sqlite3.connect(root/'unified-statistics'/'results.sqlite')));db.execute('PRAGMA temp_store=FILE')
 db.executescript('''CREATE TABLE persistence(case_id TEXT PRIMARY KEY REFERENCES findings(id),identity TEXT,basis TEXT,consecutive INTEGER,previous_id TEXT,first_batch TEXT,boundary TEXT NOT NULL);
 CREATE TABLE previous_observations(identity TEXT,case_id TEXT,consecutive INTEGER,first_batch TEXT,boundary TEXT);''')
 reason='no_previous_batch'
 if previous:
  reason='previous_failed' if previous['status']!='succeeded' else 'previous_not_collected' if not previous.get('report') else 'contract_changed'
  if previous['status']=='succeeded' and previous.get('report') and compatible(context['rules'],previous['rules']):
   if not previous['batchId'] or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in previous['batchId']):raise ValueError('PERSISTENCE_PREVIOUS_ID_INVALID')
   prior_root=root.parent/previous['batchId'];prior=previous['report']
   if prior['batchId']!=previous['batchId']:raise ValueError('PERSISTENCE_PREVIOUS_ID_INVALID')
   old=handles.enter_context(closing(frozen_database(prior_root,prior)));reason=None
   if prior.get('persistence',{}).get('identityVersion')==VERSION:
    for key,cid,count,first,boundary in old.execute('SELECT identity,case_id,consecutive,first_batch,boundary FROM persistence WHERE identity IS NOT NULL'):
     db.execute('INSERT INTO previous_observations VALUES(?,?,?,?,?)',(key,cid,count,first,boundary))
   else:
    for cid,payload in old.execute('SELECT id,payload FROM findings'):
     key,_=identity(json.loads(zlib.decompress(payload)))
     if key:db.execute('INSERT INTO previous_observations VALUES(?,?,?,?,?)',(key,cid,1,previous['batchId'],'earlier_not_measured'))
   old.close()
 db.execute('CREATE INDEX previous_identity ON previous_observations(identity)')
 for cid,payload in db.execute('SELECT id,payload FROM findings'):
  key,basis=identity(json.loads(zlib.decompress(payload)))
  db.execute('INSERT INTO persistence VALUES(?,?,?,?,?,?,?)',(cid,key,basis,1 if key else None,None,batch if key else None,reason or 'previous_not_observed' if key else 'identity_unavailable'))
 db.execute('CREATE INDEX persistence_identity ON persistence(identity)')
 db.execute("UPDATE persistence SET consecutive=NULL,first_batch=NULL,boundary='identity_ambiguous' WHERE identity IN (SELECT identity FROM persistence WHERE identity IS NOT NULL GROUP BY identity HAVING count(*)>1)")
 if reason is None:
  for cid,key in db.execute('SELECT case_id,identity FROM persistence WHERE consecutive IS NOT NULL'):
   matches=db.execute('SELECT case_id,consecutive,first_batch,boundary FROM previous_observations WHERE identity=? LIMIT 2',(key,)).fetchall()
   if len(matches)==1 and matches[0][1] is not None:
    old_id,count,first,boundary=matches[0]
    db.execute('UPDATE persistence SET consecutive=?,previous_id=?,first_batch=?,boundary=? WHERE case_id=?',(count+1,old_id,first,boundary,cid))
   elif matches:db.execute("UPDATE persistence SET boundary='previous_identity_ambiguous' WHERE case_id=?",(cid,))
 summary={'items':db.execute('SELECT count(*) FROM persistence').fetchone()[0],'continued':db.execute('SELECT count(*) FROM persistence WHERE consecutive>=2').fetchone()[0],'identityUnknown':db.execute('SELECT count(*) FROM persistence WHERE consecutive IS NULL').fetchone()[0],'maxConsecutive':db.execute('SELECT max(consecutive) FROM persistence').fetchone()[0] or 0,'boundaries':dict(db.execute('SELECT boundary,count(*) FROM persistence GROUP BY boundary'))}
 if summary['items']!=report['summary']['items']:raise ValueError('PERSISTENCE_COUNT_MISMATCH')
 report.pop('database');report['persistence']={'version':1,'identityVersion':VERSION,'analysisSha256':sha(Path(__file__)),'batchId':batch,'previousBatch':{k:previous[k] for k in ['batchId','status','startedAt','finishedAt']} if previous else None,'previousStatisticsSha256':(previous.get('report') or {}).get('database',{}).get('sha256') if previous else None,'comparisonAvailable':reason is None,'summary':summary,'boundaries':BOUNDARIES,'limits':['连续可确认批数按同一来源标识、核查情形及证据分类比较，不是实际发生次数。','失败、未采集或核查口径变化阻断连续观察；未检出不证明已消除。','旧批次仅用其冻结结果作比较依据，不修改其原结果或补写旧批连续批数。','稳定来源标识缺失或重复时连续批数未知；更早未计量时显示已确认下限。','连续批数单列展示，不重复计入本批检出率或改写历史优先级。']}
 db.execute('DROP TABLE previous_observations');db.execute("UPDATE manifest SET payload=? WHERE name='report'",(json.dumps(report,ensure_ascii=False,separators=(',',':')),));db.commit()
 if db.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise ValueError('PERSISTENCE_DATABASE_INVALID')
 db.close();report['database']={'file':'results.sqlite','sha256':sha(root/'unified-statistics'/'results.sqlite')};path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');return summary
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);args=parser.parse_args();print(dump(analyze(args.root)))
