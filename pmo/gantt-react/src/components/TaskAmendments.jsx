import { amendmentBadge } from '../utils/taskAmendments';

export function AmendmentBadge({ task, index, batch }) {
  const badge = amendmentBadge(task, index, batch);
  return badge ? <span className={`amendment-badge${badge.outlined ? ' outlined' : ''}`} title={badge.description}>{badge.text}</span> : null;
}

export function AmendmentControls({ status, batches, batch, index, onlyAmended, highlight, onBatchChange, onOnlyChange, onHighlightChange }) {
  if (status === 'loading') return <div className="amendment-bar amendment-message" role="status">正在读取增补记录…</div>;
  if (status !== 'ready' || index.issues.length) return <div className="amendment-bar amendment-message" role="status">增补记录暂不可用，当前显示完整任务。</div>;
  if (!batch) return null;
  return <section className="amendment-bar" aria-label="本次增补">
    <strong>本次增补 · {batch.date}</strong>
    <span>{index.leafCount}项任务补充要求</span>
    <span>{index.summaryCount}个摘要调整</span>
    <span className="amendment-schedule-note">原排程保留</span>
    {batches.length > 1 && <label>增补批次 <select aria-label="增补批次" value={batch.id} onChange={event => onBatchChange(event.target.value)}>{batches.map(item => <option key={item.id} value={item.id}>{item.date} {item.title}</option>)}</select></label>}
    <div className="amendment-filter" role="group" aria-label="增补筛选">
      <button type="button" aria-pressed={!onlyAmended} onClick={() => onOnlyChange(false)}>全部任务</button>
      <button type="button" aria-pressed={onlyAmended} onClick={() => onOnlyChange(true)}>仅看本次增补</button>
    </div>
    <label className="amendment-highlight"><input type="checkbox" checked={highlight} onChange={event => onHighlightChange(event.target.checked)} />突出增补</label>
  </section>;
}

const FIELD_NAMES = { completionCriteria: '验收要求', evidenceRequirements: '证据要求', deliverable: '交付物', name: '任务名称' };
const PRIMARY_FIELDS = ['completionCriteria', 'deliverable', 'evidenceRequirements', 'name', 'integrationStartCondition', 'releaseRule'];
const KIND_NAMES = { added:'新增', extended:'补充', changed:'调整', removed:'移除' };

function FieldChange({ change }) {
  const added = change.kind === 'added' || change.kind === 'extended';
  return <div className="amendment-field" data-amendment-field={change.key}>
    <div className="amendment-field-title"><span className={`amendment-badge${added ? '' : ' outlined'}`}>{KIND_NAMES[change.kind]}</span>{FIELD_NAMES[change.key] || change.label}</div>
    <div className={added ? 'amendment-added' : 'amendment-current'}>{change.kind === 'extended' ? change.addition : (String(change.after ?? '') || '本次已移除')}</div>
    {change.kind !== 'added' && <details className="amendment-before">
      <summary>{change.kind === 'extended' ? '查看原内容与补充后全文' : '查看调整前内容'}</summary>
      <div><span>调整前</span><p>{String(change.before ?? '') || '未填写'}</p></div>
      {change.kind === 'extended' && <div><span>补充后全文</span><p>{String(change.after ?? '')}</p></div>}
    </details>}
  </div>;
}

export function AmendmentDetails({ record, batch }) {
  if (!record) return null;
  const primary = PRIMARY_FIELDS.flatMap(key => record.fields.filter(field => field.key === key));
  const other = record.fields.filter(field => !PRIMARY_FIELDS.includes(field.key));
  return <section className="amendment-details" aria-label="本次增补内容">
    <div className="amendment-details-heading"><strong>本次增补内容</strong><span className="amendment-badge">{batch.date}</span></div>
    <p className="amendment-details-note">沿用原任务与排程，标记不表示已完成。</p>
    {primary.map(change => <FieldChange key={change.key} change={change} />)}
    {other.length > 0 && <details className="amendment-other"><summary>其他字段对照（{other.length}）</summary>{other.map(change => <FieldChange key={change.key} change={change} />)}</details>}
  </section>;
}
