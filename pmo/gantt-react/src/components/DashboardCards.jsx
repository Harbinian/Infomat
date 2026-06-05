import { useMemo } from 'react';
import { createDashboardCardIntents } from '../utils/deliverableWorkflow';

export default function DashboardCards({ tasks, deliverables = [], phaseGates = [], pmoDate, onCardClick }) {
  const cards = useMemo(
    () => createDashboardCardIntents({ tasks, deliverables, phaseGates, pmoDate }),
    [tasks, deliverables, phaseGates, pmoDate]
  );

  if (!cards.length) return null;

  return (
    <div className="dashboard">
      {cards.map(card => {
        const className = [
          'stat-card',
          'clickable',
          card.highlight ? 'highlight' : '',
          card.cls || '',
        ].filter(Boolean).join(' ');
        const isClickable = Boolean(onCardClick && card.target);
        return (
          <button
            key={card.key}
            type="button"
            className={className}
            onClick={isClickable ? () => onCardClick(card.target) : undefined}
            disabled={!isClickable}
            aria-label={`${card.label} ${card.value}`}
            title={isClickable ? `查看 ${card.label} 详情` : card.label}
          >
            <span className="stat-value">{card.value}</span>
            <span className="stat-label">{card.label}</span>
            {isClickable && <span className="stat-drill" aria-hidden="true">›</span>}
          </button>
        );
      })}
    </div>
  );
}
