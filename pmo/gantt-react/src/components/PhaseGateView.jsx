function formatEvidenceTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function PhaseGateView({ phaseGates, gateStatusFilter }) {
  if (!phaseGates || phaseGates.length === 0) {
    return <div className="empty-view">暂无阶段门数据</div>;
  }

  const visibleGates = gateStatusFilter && gateStatusFilter !== 'all'
    ? phaseGates.filter(gate => gate.status === gateStatusFilter)
    : phaseGates;
  const isFiltered = gateStatusFilter && gateStatusFilter !== 'all';

  return (
    <div className="phasegate-view">
      <div className="phasegate-header-row">
        <span className="phasegate-title">阶段门管控视图</span>
        <span className="phasegate-summary">
          {phaseGates.filter(gate => gate.status === '通过').length}/{phaseGates.length} 审批通过
          {' | '}
          <span className="risk-text">{phaseGates.filter(gate => gate.status === '风险').length} 个风险</span>
          {isFiltered && (
            <>
              {' | '}
              <span className="filter-tag">筛选: {gateStatusFilter} ({visibleGates.length})</span>
            </>
          )}
        </span>
      </div>
      {visibleGates.length === 0 ? (
        <div className="empty-view">无 {gateStatusFilter} 状态的阶段门</div>
      ) : (
        <div className="phasegate-grid">
          {visibleGates.map(gate => (
          <div
            key={gate.gateId}
            className={`gate-card gate-status-${gate.status}`}
            style={{ borderLeftColor: gate.statusColor }}
          >
            <div className="gate-card-header">
              <span className="gate-id">{gate.gateId}</span>
              <span className="gate-status-badge" style={{ background: `${gate.statusColor}22`, color: gate.statusColor }}>{gate.status}</span>
            </div>
            <h4 className="gate-name">{gate.gateName}</h4>
            <div className="gate-blocking">
              <span className="gate-label">阻断规则：</span>
              <span>{gate.blockingRule}</span>
            </div>
            <div className="gate-progress">
              <span>
                匹配证据：{gate.confirmedCount}精确 + {gate.suspectedCount}疑似 / {gate.totalRequired}必需
                {'；'}已提交 {gate.confirmedSubmittedCount || 0}，已审批 {gate.confirmedApprovedCount || 0}
              </span>
              <div className="gate-progress-bar">
                <div className="gate-progress-fill confirmed" style={{ width: `${Math.min((gate.confirmedCount / gate.totalRequired) * 100, 100)}%`, background: '#6F8A6A' }} />
                <div className="gate-progress-fill suspected" style={{ width: `${Math.min((gate.suspectedCount / gate.totalRequired) * 100, 100)}%`, background: '#B88919' }} />
              </div>
            </div>
            {gate.confirmed.length > 0 && (
              <div className="gate-matched">
                <span className="gate-label">精确匹配 ({gate.confirmed.length})：</span>
                {gate.confirmed.map((match, index) => (
                  <span key={`${match.required}-${index}`} className="gate-matched-item confirmed" title={match.deliverable.deliverableName}>
                    {match.required}
                  </span>
                ))}
              </div>
            )}
            {gate.suspected.length > 0 && (
              <div className="gate-matched">
                <span className="gate-label">疑似匹配 ({gate.suspected.length})：</span>
                {gate.suspected.map((match, index) => (
                  <span key={`${match.required}-${index}`} className="gate-matched-item suspected" title={`${match.deliverable.deliverableName} [${match.matchType}]`}>
                    {match.required}
                  </span>
                ))}
              </div>
            )}
            {gate.evidenceSummary && gate.evidenceSummary.length > 0 && (
              <div className="gate-evidence">
                <span className="gate-label">证据链：</span>
                <div className="gate-evidence-list">
                  {gate.evidenceSummary.map((evidence, index) => (
                    <div key={`${evidence.required}-${evidence.deliverableId}-${index}`} className="gate-evidence-item">
                      <div className="gate-evidence-main">
                        <span className="gate-required">{evidence.required}</span>
                        <span className={`gate-evidence-match ${evidence.matchType === '精确' ? 'confirmed' : 'suspected'}`}>{evidence.matchType}</span>
                        <span className="gate-evidence-status">{evidence.status || '未提交'}</span>
                      </div>
                      <div className="gate-evidence-meta">
                        <span>{evidence.deliverableId} · {evidence.deliverableName}</span>
                        <span>WBS {evidence.normalizedWbs || '-'} · {evidence.taskName || '-'}</span>
                        <span className={`gate-evidence-file ${evidence.evidenceFileName ? '' : 'missing'}`}>
                          {evidence.evidenceFileName
                            ? `凭证：${evidence.evidenceFileName}${evidence.evidenceUploadedAt ? `，${formatEvidenceTime(evidence.evidenceUploadedAt)}` : ''}`
                            : '凭证：未上传'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {gate.missing.length > 0 && (
              <div className="gate-missing">
                <span className="gate-label">缺失 ({gate.missing.length})：</span>
                {gate.missing.map(item => <span key={item} className="gate-missing-tag">{item}</span>)}
              </div>
            )}
          </div>
        ))}
        </div>
      )}
    </div>
  );
}
