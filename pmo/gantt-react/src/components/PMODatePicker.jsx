import { formatDate } from '../utils/dateUtils';

export default function PMODatePicker({ pmoDate, onDateChange, projectStart }) {
  const handleToday = () => onDateChange(new Date());
  const handleProjectStart = () => onDateChange(projectStart ? new Date(projectStart) : new Date(2026, 5, 1));
  const handleDateInput = (event) => {
    const [year, month, day] = event.target.value.split('-').map(Number);
    if (year && month && day) onDateChange(new Date(year, month - 1, day));
  };

  const dateStr = pmoDate ? formatDate(pmoDate) : '';

  return (
    <div className="pmo-date-picker">
      <span className="pmo-date-label">PMO观察日期</span>
      <span className="pmo-date-value">{formatDate(pmoDate)}</span>
      <button className="pmo-date-btn" onClick={handleToday} type="button">今天</button>
      <button className="pmo-date-btn" onClick={handleProjectStart} type="button">项目开始</button>
      <input type="date" className="pmo-date-input" value={dateStr} onInput={handleDateInput} onChange={handleDateInput} />
    </div>
  );
}
