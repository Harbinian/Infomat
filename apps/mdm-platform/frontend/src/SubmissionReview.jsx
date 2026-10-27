import {businessText,businessStatus,businessEvidence,userMessage} from './businessPresentation.js';
import {submissionSummary} from './submissionSummaryPresentation.js';
import {businessDateTime} from './businessGuidance.js';
import {submissionReviewModel,caseChangeTitle,caseChangeFields,submissionIssueText} from './submissionReviewModel.js';
import {submissionNextStep} from './processActionGuidance.js';

export function CaseChangeSummary({change,departments}) {
  return <section aria-label="本次事项具体内容"><h4>{caseChangeTitle(change)}</h4><dl className="review-values">{caseChangeFields(change,departments).map(([title,value],index)=><div key={index}><dt>{title}</dt><dd>{value}</dd></div>)}</dl></section>;
}

export function SubmissionReview({state,detail,departments,disabled,editing,onStart}){
  const review=submissionReviewModel(state,detail.department_accountability?.department_id);
  const canConfirm=review.canConfirm&&detail.department_accountability?.eligible===true;
  const nextStep=submissionNextStep(state,{...review,canConfirm});
  const departmentName=id=>businessText(departments.find(department=>String(department.id)===String(id))?.name||'部门名称未提供','部门名称暂无法直接展示');
  return <><div className="review-task-grid"><div className="review-materials"><section><h3><span className="review-step">1</span> 阅读本次提交材料</h3>
    {state.submission?<><dl className="review-values">{[['编制目的',state.submission.purpose],['修订原因',state.submission.revision_reason],['本次变化',state.submission.change_summary]].map(([title,value])=><div key={title}><dt>{title}</dt><dd>{submissionSummary(value,title)}</dd></div>)}</dl>
    <details className="review-sources"><summary>来源材料 · {state.submission.sources?.length||0}项</summary>{(state.submission.sources||[]).map((source,index)=><article key={index}><h4>{businessText(source.title,'材料名称暂无法直接展示')}</h4><p>{businessText(source.basis,'来源依据含技术内容，请查阅原材料')}</p><small>来源定位：{businessText(source.reference,'定位说明含技术内容，请查阅原材料')}</small></article>)}</details></>:<p>当前提交材料尚未补齐，等待归口主对接人提供。</p>}</section>
    <section><h3><span className="review-step">2</span> 核对本部门责任范围</h3>{review.participants.map(participant=><article key={participant.department_id} className="review-participant"><h4>{businessText(participant.department_name||departmentName(participant.department_id),'部门名称暂无法直接展示')}</h4><p>{businessText(participant.responsibilities,'责任说明含技术内容，请查阅原材料')}</p><p className="review-extent">核对内容：{participant.behavior_refs?.length?participant.behavior_refs.map(ref=>businessText(detail.revision.document.behaviors?.find(behavior=>behavior.behavior_ref===ref)?.behavior_name||'环节名称未记录','环节名称暂无法直接展示')).join('、'):'完整当前流程'}</p><details><summary>参与依据</summary><p>{businessText(participant.basis,'参与依据含技术内容，请查阅原材料')}</p></details></article>)}{!review.participants.length&&<p>参与部门尚未明确。</p>}</section>
    </div><aside className="review-next-action" aria-label="本次需要确认什么"><small>{review.confirmationCompleted?'确认结果':'当前任务'}</small><h3>{review.functionalTestOnly?'测试记录已留存，业务确认待办理':review.confirmed?'本部门已确认':canConfirm?'请确认两件事':'等待有权人员办理'}</h3>
      {review.functionalTestOnly&&<p className="review-confirm-context" role="status">原功能测试记录和依据已保留，不计作部门业务确认。当前提交材料仍须由相关部门已登记且具有有效授权的负责人本人核对并确认。</p>}
      {canConfirm?<><ol><li>提交材料的来源和本次变化符合实际。</li><li>本部门参与范围及责任说明符合实际。</li></ol><p>确认将绑定当前修订和本次提交材料，并记录本人及核对依据。</p><button className="primary" type="button" disabled={disabled||editing} onClick={()=>onStart('confirm_submission',review.material)}>本人确认提交材料及本部门范围</button><p className="review-helper">点击“本人确认提交材料及本部门范围”后填写依据，再点击“保存本次办理”。保存后在“确认结果”核对本部门状态，展开“优化建议、制度版次与历史记录”查看确认时间和依据。{review.functionalTestOnly&&'原测试记录继续保留。'}本次材料确认与正式确认、发布及业务验收分别办理。</p></>:<p>{review.confirmed?'本部门当前有效的负责人确认已保存，其他部门及后续办理状态见下方。':'当前账号没有本次本人确认入口，可阅读已保存材料。请由相应部门已登记且具有有效授权的负责人本人办理；完成后点击“刷新材料与案例状态”，在材料历史核对确认时间和依据。'}</p>}
      <div className="review-deadline"><strong>办理截止日期</strong><p>{state.deadline?.due_date||'待MDM组长与相关部门负责人约定'}</p></div>
      <details><summary>{review.functionalTestOnly?'正式业务流转条件':'全部未完成条件'} · {review.issues.length}项</summary><ul>{review.issues.map((issue,index)=><li key={index}>{submissionIssueText(issue)}</li>)}</ul></details>
      <p className="review-helper">当前状态：{({active:'正常办理',paused:'已暂停',terminated:'已终止'})[state.lifecycle?.state||state.lifecycle]||'见当前案例记录'}</p>
    </aside></div>
    {nextStep&&<section className="review-next-action"><h3>{nextStep.title}</h3><p>{nextStep.message}</p>{!state.allowed_actions?.length&&<p>当前账号在本区只读。请查阅以上材料及缺项，等待对应办理人员保存后，点击“刷新材料与案例状态”核对结果。</p>}{nextStep.action&&<button disabled={disabled||editing} onClick={()=>onStart(nextStep.action)}>{nextStep.actionLabel}</button>}</section>}
    {review.otherChanges.length>0&&<section className="review-other-tasks"><h3>需要确认或登记的具体事项</h3>{review.otherChanges.map(change=><article className="preview-item" key={change.change_id}><CaseChangeSummary change={change} departments={departments}/><p>已确认部门：{(change.confirmations||[]).map(confirmation=>departmentName(confirmation.department_id)).join('、')||'尚未确认'}</p><p>相关部门负责人分别确认后，由MDM组长登记；完成后在本页核对办理结果。</p><div className="import-actions">{change.allowed_actions?.includes('confirm')&&<button disabled={disabled||editing} onClick={()=>onStart('confirm_change',change)}>本人确认此事项</button>}{change.allowed_actions?.includes('register')&&<button disabled={disabled||editing} onClick={()=>onStart('register_change',change)}>登记已确认事项</button>}{change.allowed_actions?.includes('cancel')&&<button disabled={disabled||editing} onClick={()=>onStart('cancel_change',change)}>撤销未登记事项</button>}</div></article>)}</section>}
  </>;
}

export function CaseGovernanceHistory({state,departments=[]}) {
  const records=(state?.changes||[]).filter(record=>['submission','deadline'].includes(record.kind));
  const acceptances=state?.acceptance_history||[];
  const departmentName=id=>businessText(departments.find(department=>String(department.id)===String(id))?.name||'部门名称未读取','部门名称暂无法直接展示');
  return <section data-case-governance-history><h3>提交材料与办理时限历史</h3><p>这里查阅当时提出、确认及登记的记录，不会代为确认或修改材料。当前能否继续办理，以本次核对区的状态为准。确认部门名称按当前目录显示；此处未提供当时人员姓名，不推断办理人。</p>
    {records.length?records.map(record=><article className="preview-item" key={record.change_id}><CaseChangeSummary change={record} departments={departments}/><p>当时办理状态：{({pending:'待确认或登记',registered:'已登记',cancelled:'已取消'})[record.state]||businessStatus(record.state,'状态说明未记录')}；提出时间：{businessDateTime(record.created_at)}；登记时间：{businessDateTime(record.registered_at)}</p>
      <details><summary>查看本事项的部门确认时间</summary>{(record.confirmations||[]).length?record.confirmations.map(confirmation=><p key={confirmation.confirmation_id}>确认部门：{departmentName(confirmation.department_id)}；确认时间：{businessDateTime(confirmation.created_at)}；依据：{businessText(confirmation.basis_text,'确认依据含技术内容，请查阅原材料')}</p>):<p>此事项尚未提供部门确认记录。</p>}</details></article>):<p>当前没有可查阅的提交材料或办理时限历史。</p>}
    <h3>已保存的业务验收结果</h3><p>这里只查阅已保存结论，不会代替业务人员验收。验收时间可在关联办理记录中核对；此处未提供当时姓名。</p>
    {acceptances.length?acceptances.map(record=><article className="preview-item" key={record.event_id}><h4>{({accepted:'验收通过',not_accepted:'验收未通过'})[record.result?.conclusion]||'原验收结论暂无法确认'}</h4><p>适用内容：{record.current?'对应当前流程内容':'对应较早提交的流程内容，不能代替当前验收'}。</p><p>验收依据：{businessText(record.result?.basis,'验收依据含技术内容，请查阅原材料')}</p><p>验收证据：{businessEvidence(record.result?.evidence_refs)}</p></article>):<p>当前没有已保存的业务验收结果。</p>}
  </section>;
}
