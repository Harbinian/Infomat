const count=value=>Number.isSafeInteger(value)&&value>=0;
const ratio=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
const invalid=()=>{throw new Error('字段统计内容无法核对，请刷新后重试；未将其解释为没有记录。');};

// Current governed counts and historical identity confirmations describe different facts.
export function qualityProgress(data) {
  const overall=data?.overall;
  if(!overall||!count(overall.total))return invalid();
  if(Object.hasOwn(overall,'governed')) {
    if(data.view!=='current'||data.complete!==true||!count(overall.governed)||overall.governed>overall.total||!count(data.legacy?.total)||data.legacy.governance_status!=='legacy_unapproved')return invalid();
    return {kind:'controlled',total:overall.total,governed:overall.governed,legacyTotal:data.legacy.total};
  }
  if(!count(overall.confirmed)||overall.confirmed>overall.total||!Array.isArray(data.by_domain)||overall.pct!=null&&!ratio(overall.pct))return invalid();
  if(data.by_domain.some(row=>!count(row.total)||!count(row.confirmed)||row.confirmed>row.total||row.pct!=null&&!ratio(row.pct)))return invalid();
  return {kind:'legacy-identities',total:overall.total,confirmed:overall.confirmed,pct:overall.pct,groups:data.by_domain};
}
