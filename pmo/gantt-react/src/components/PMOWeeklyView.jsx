import { useMemo } from 'react';
import { formatDate, getPmoDeliveryWeekRange, parseDate } from '../utils/dateUtils';

function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export default function PMOWeeklyView({ deliverables, phaseGates, tasks, pmoDate, projectGovernance, onSelectDeliverable }) {
  const date = useMemo(() => pmoDate || new Date(), [pmoDate]);
  const { start: weekStart, end: weekEnd } = useMemo(() => getPmoDeliveryWeekRange(date), [date]);
  const projectGovernanceData = projectGovernance?.data || null;
  const governanceSummary = projectGovernanceData?.summary || {};
  const governanceDepartments = Array.isArray(projectGovernanceData?.departments) ? projectGovernanceData.departments : [];

  const weekAB = useMemo(() => deliverables.filter(deliverable => {
    if (!deliverable.plannedFinish || (deliverable.deliverableLevel !== 'A' && deliverable.deliverableLevel !== 'B')) return false;
    const finish = parseDate(deliverable.plannedFinish);
    return finish && finish >= weekStart && finish <= weekEnd;
  }), [deliverables, weekStart, weekEnd]);

  const overdueAB = useMemo(() => deliverables.filter(deliverable => {
    if (!deliverable.plannedFinish || (deliverable.deliverableLevel !== 'A' && deliverable.deliverableLevel !== 'B')) return false;
    if (deliverable.deliverableStatus === '通过' || deliverable.deliverableStatus === '已归档') return false;
    const finish = parseDate(deliverable.plannedFinish);
    return finish && finish < date;
  }).map(deliverable => {
    const finish = parseDate(deliverable.plannedFinish);
    return { ...deliverable, daysOverdue: finish ? Math.floor((date - finish) / (1000 * 60 * 60 * 24)) : 0 };
  }).sort((a, b) => b.daysOverdue - a.daysOverdue), [deliverables, date]);

  const gateMissing = useMemo(() => (phaseGates || []).filter(gate => gate.missing && gate.missing.length > 0), [phaseGates]);
  const highRiskTasks = useMemo(() => tasks.filter(task => task.risk === '高'), [tasks]);

  const renderDeliverableTable = (rows, showOverdue) => (
    <table className="dlv-table">
      <thead>
        <tr>
          <th>计划完成</th>
          <th>交付物名称</th>
          <th>等级</th>
          <th>关联任务</th>
          <th>责任部门</th>
          <th>风险</th>
          {showOverdue && <th>延期天数</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(deliverable => (
          <tr
            key={deliverable.deliverableId}
            className={`dlv-row dlv-level-${deliverable.deliverableLevel} ${deliverable.taskRisk === '高' ? 'dlv-high-risk' : ''}`}
            onClick={() => onSelectDeliverable && onSelectDeliverable(deliverable)}
          >
            <td>{formatDate(parseDate(deliverable.plannedFinish))}</td>
            <td className="dlv-name" title={deliverable.deliverableName}>{deliverable.deliverableName}</td>
            <td><span className={`dlv-level-badge level-${deliverable.deliverableLevel}`}>{deliverable.deliverableLevel}</span></td>
            <td className="dlv-task" title={deliverable.taskName}>{deliverable.taskName}</td>
            <td>{deliverable.department || '-'}</td>
            <td><span className={`dlv-risk risk-${deliverable.taskRisk}`}>{deliverable.taskRisk}</span></td>
            {showOverdue && <td><span className="overdue-days">{deliverable.daysOverdue}天</span></td>}
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={showOverdue ? 7 : 6} className="empty-row">无</td></tr>}
      </tbody>
    </table>
  );

  const renderGovernanceSection = () => (
    <div className="pmo-section pmo-governance-section">
      <h3>1. 项目治理闭环</h3>
      {!projectGovernanceData ? (
        <p className="empty-text">项目治理快照未生成</p>
      ) : (
        <>
          <div className="pmo-governance-meta">
            <span>生成日期：{projectGovernanceData.generatedDate || '-'}</span>
            <span>范围：{projectGovernanceData.scope?.departments?.join('、') || '双部门样板'}</span>
          </div>
          <div className="pmo-governance-summary">
            <div className="pmo-governance-metric">
              <span className="metric-value">{numberValue(governanceSummary.inputBaselineOpen)}</span>
              <span className="metric-label">输入基线待确认</span>
            </div>
            <div className="pmo-governance-metric">
              <span className="metric-value">{numberValue(governanceSummary.qualityBlock)}</span>
              <span className="metric-label">质量 BLOCK</span>
            </div>
            <div className="pmo-governance-metric">
              <span className="metric-value">{numberValue(governanceSummary.fieldLedgerGap)}</span>
              <span className="metric-label">字段台账缺口</span>
            </div>
            <div className="pmo-governance-metric">
              <span className="metric-value">{numberValue(governanceSummary.goldSourceConfirmation)}</span>
              <span className="metric-label">待确认黄金源</span>
            </div>
            <div className="pmo-governance-metric">
              <span className="metric-value">{numberValue(governanceSummary.overdue)}</span>
              <span className="metric-label">超期事项</span>
            </div>
          </div>
          <table className="dlv-table">
            <thead>
              <tr>
                <th>部门</th>
                <th>最终确认人</th>
                <th>输入基线</th>
                <th>BLOCK/WARN</th>
                <th>字段缺口</th>
                <th>黄金源</th>
                <th>超期</th>
                <th>下一步</th>
              </tr>
            </thead>
            <tbody>
              {governanceDepartments.map(row => (
                <tr key={row.department}>
                  <td>{row.department}</td>
                  <td>{row.confirmPerson || '-'}</td>
                  <td>{numberValue(row.inputBaselineOpen)}</td>
                  <td>{numberValue(row.qualityBlock)} / {numberValue(row.qualityWarn)}</td>
                  <td>{numberValue(row.fieldLedgerGap)}</td>
                  <td>{numberValue(row.goldSourceConfirmation)}</td>
                  <td>{numberValue(row.overdue)}</td>
                  <td className="dlv-task" title={row.nextStep}>{row.nextStep || '-'}</td>
                </tr>
              ))}
              {governanceDepartments.length === 0 && <tr><td colSpan={8} className="empty-row">无</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );

  return (
    <div className="pmo-weekly-view">
      <div className="pmo-header">
        <h2>PMO 周会管控视图</h2>
        <span className="pmo-date">{formatDate(weekStart)} - {formatDate(weekEnd)}</span>
      </div>

      <div className="pmo-summary-cards">
        <div className="pmo-summary-card">
          <div className="pmo-summary-value">{weekAB.length}</div>
          <div className="pmo-summary-label">本周A/B交付物</div>
        </div>
        <div className="pmo-summary-card highlight">
          <div className="pmo-summary-value">{overdueAB.length}</div>
          <div className="pmo-summary-label">延期A/B交付物</div>
        </div>
        <div className="pmo-summary-card highlight">
          <div className="pmo-summary-value">{gateMissing.length}</div>
          <div className="pmo-summary-label">阶段门缺失</div>
        </div>
        <div className="pmo-summary-card highlight">
          <div className="pmo-summary-value">{highRiskTasks.length}</div>
          <div className="pmo-summary-label">高风险任务</div>
        </div>
      </div>

      {renderGovernanceSection()}

      <div className="pmo-section">
        <h3>2. 本周应完成的 A/B 类交付物 ({weekAB.length})</h3>
        {renderDeliverableTable(weekAB, false)}
      </div>

      <div className="pmo-section">
        <h3>3. 已延期的 A/B 类交付物 ({overdueAB.length})</h3>
        {renderDeliverableTable(overdueAB, true)}
      </div>

      <div className="pmo-section">
        <h3>4. 阶段门缺失交付物 ({gateMissing.length})</h3>
        {gateMissing.length > 0 ? (
          <div className="gate-missing-list">
            {gateMissing.map(gate => (
              <div key={gate.gateId} className="gate-missing-card">
                <div className="gate-missing-header">
                  <span className="gate-id-tag">{gate.gateId}</span>
                  <span className="gate-name-text">{gate.gateName}</span>
                  <span className="gate-status-badge" style={{ background: `${gate.statusColor}22`, color: gate.statusColor }}>{gate.status}</span>
                </div>
                <div className="gate-missing-tags">
                  {gate.missing.map(item => <span key={item} className="gate-missing-tag">{item}</span>)}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="empty-text">所有阶段门交付物均已匹配</p>}
      </div>

      <div className="pmo-section">
        <h3>5. 高风险任务 ({highRiskTasks.length})</h3>
        {highRiskTasks.length > 0 ? (
          <table className="dlv-table">
            <thead>
              <tr>
                <th>WBS</th>
                <th>任务名称</th>
                <th>责任部门</th>
                <th>计划完成</th>
                <th>交付物</th>
              </tr>
            </thead>
            <tbody>
              {highRiskTasks.map(task => (
                <tr key={task.nodeKey || task.id} className="dlv-high-risk">
                  <td className="dlv-wbs">{task.normalizedWbs || task.wbs}</td>
                  <td className="dlv-name" title={task.name}>{task.name}</td>
                  <td>{task.department || '-'}</td>
                  <td>{formatDate(parseDate(task.finish))}</td>
                  <td className="dlv-task" title={task.deliverable}>{task.deliverable || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="empty-text">无高风险任务</p>}
      </div>
    </div>
  );
}
