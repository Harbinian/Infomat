import { useRef, useEffect, useCallback } from 'react';
import {
  parseDate, formatDate, getWbsColor, getTotalMonths, getMonthLabels,
  getXForDate, daysInMonth, PROJECT_START
} from '../utils/dateUtils';

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 44;
const BAR_HEIGHT = 20;
const BAR_Y_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;

export default function GanttChart({ tasks, treeMap, monthWidth, selectedWbs, onSelect, onZoomChange }) {
  const canvasRef = useRef(null);
  const panelRef = useRef(null);
  const positionsRef = useRef([]);
  const tooltipRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const months = getTotalMonths();
    const totalWidth = months * monthWidth + 80;
    const totalHeight = HEADER_HEIGHT + tasks.length * ROW_HEIGHT + 20;

    canvas.width = totalWidth;
    canvas.height = Math.max(totalHeight, 400);
    canvas.style.width = totalWidth + 'px';
    canvas.style.height = Math.max(totalHeight, 400) + 'px';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const positions = [];

    // Background
    ctx.fillStyle = '#141720';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Month header
    const labels = getMonthLabels();
    ctx.fillStyle = '#161822';
    ctx.fillRect(0, 0, totalWidth, HEADER_HEIGHT);

    let currentYear = '';
    for (let i = 0; i < months; i++) {
      const yr = labels[i].split('-')[0];
      const x = i * monthWidth;
      if (yr !== currentYear) {
        currentYear = yr;
        let span = 0;
        for (let j = i; j < months; j++) {
          if (labels[j].split('-')[0] === yr) span++;
          else break;
        }
        const yearWidth = span * monthWidth;
        ctx.fillStyle = '#1c1f2e';
        ctx.fillRect(x, 0, yearWidth, 22);
        ctx.fillStyle = '#8b90a0';
        ctx.font = 'bold 13px -apple-system, "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(yr + '年', x + yearWidth / 2, 16);
      }
    }

    for (let i = 0; i < months; i++) {
      const x = i * monthWidth;
      const mon = labels[i].split('-')[1];
      ctx.fillStyle = (i % 2 === 0) ? '#6b7194' : '#4a4d5a';
      ctx.font = '12px -apple-system, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(mon + '月', x + monthWidth / 2, 40);
    }

    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT);
    ctx.lineTo(totalWidth, HEADER_HEIGHT);
    ctx.stroke();

    // Grid lines
    ctx.strokeStyle = '#1a1d2a';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= months; i++) {
      const x = i * monthWidth;
      ctx.beginPath();
      ctx.moveTo(x, HEADER_HEIGHT);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
    }
    for (let i = 0; i <= tasks.length; i++) {
      const y = HEADER_HEIGHT + i * ROW_HEIGHT;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(totalWidth, y);
      ctx.stroke();
    }

    // Today line
    const now = new Date();
    const todayX = getXForDate(now, monthWidth);
    if (todayX >= 0 && todayX <= months * monthWidth) {
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(todayX, HEADER_HEIGHT);
      ctx.lineTo(todayX, totalHeight);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 11px -apple-system, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('今天', todayX, HEADER_HEIGHT - 6);
    }

    // Task bars
    tasks.forEach((task, rowIndex) => {
      drawTaskBar(ctx, task, rowIndex, monthWidth, positions);
    });

    positionsRef.current = positions;
  }, [tasks, monthWidth]);

  useEffect(() => { draw(); }, [draw]);

  // Hover & click
  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = panelRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas || !panel || !tooltip) return;

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left + panel.scrollLeft;
      const my = e.clientY - rect.top + panel.scrollTop;
      const hit = positionsRef.current.find(p =>
        mx >= p.x && mx <= p.x + p.width && my >= p.y && my <= p.y + p.height
      );
      if (hit) {
        const task = treeMap[hit.wbs];
        if (task) {
          const s = parseDate(task.start), f = parseDate(task.finish);
          tooltip.innerHTML = [
            `<div class="tt-name">${task.name}</div>`,
            `<div class="tt-row">WBS: <span>${task.wbs}</span></div>`,
            `<div class="tt-row">时间: <span>${formatDate(s)} — ${formatDate(f)}</span></div>`,
            `<div class="tt-row">工期: <span>${task.duration || '-'}</span></div>`,
            `<div class="tt-row">类型: <span>${task.type || '-'}</span></div>`,
            `<div class="tt-row">部门: <span>${task.department || '-'}</span></div>`,
            `<div class="tt-row">风险: <span>${task.risk || '-'}</span></div>`
          ].join('');
          tooltip.style.display = 'block';
          tooltip.style.left = (e.clientX + 16) + 'px';
          tooltip.style.top = (e.clientY + 16) + 'px';
        }
      } else {
        tooltip.style.display = 'none';
      }
    };

    const onClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left + panel.scrollLeft;
      const my = e.clientY - rect.top + panel.scrollTop;
      const hit = positionsRef.current.find(p =>
        mx >= p.x && mx <= p.x + p.width && my >= p.y && my <= p.y + p.height
      );
      if (hit) onSelect(hit.wbs);
    };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    canvas.addEventListener('click', onClick);
    return () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
      canvas.removeEventListener('click', onClick);
    };
  }, [treeMap, onSelect]);

  // Wheel: Ctrl=zoom, Shift=horizontal scroll
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) onZoomChange(monthWidth * 1.3);
        else onZoomChange(monthWidth / 1.3);
      } else if (e.shiftKey) {
        e.preventDefault();
        panel.scrollLeft += e.deltaY;
      }
    };
    panel.addEventListener('wheel', onWheel, { passive: false });
    return () => panel.removeEventListener('wheel', onWheel);
  }, [monthWidth, onZoomChange]);

  // Scroll sync: gantt scroll → tree scroll
  useEffect(() => {
    const panel = panelRef.current;
    const tree = document.getElementById('taskTreePanel');
    if (!panel || !tree) return;
    let syncing = false;
    const onScroll = () => {
      if (syncing) return;
      syncing = true;
      tree.scrollTop = panel.scrollTop;
      syncing = false;
    };
    panel.addEventListener('scroll', onScroll);
    return () => panel.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="gantt-panel" ref={panelRef}>
      <div className="zoom-controls">
        <button className="zoom-btn" onClick={() => onZoomChange(monthWidth / 1.3)} title="缩小 (Ctrl+滚轮)">−</button>
        <span className="zoom-label">{Math.round(monthWidth / 82 * 100)}%</span>
        <button className="zoom-btn" onClick={() => onZoomChange(monthWidth * 1.3)} title="放大 (Ctrl+滚轮)">+</button>
        <button className="zoom-btn zoom-reset" onClick={() => onZoomChange(82)} title="重置缩放">↺</button>
      </div>
      <canvas ref={canvasRef} className="gantt-canvas" />
      <div className="gantt-tooltip" ref={tooltipRef} />
    </div>
  );
}

function drawTaskBar(ctx, task, rowIndex, monthWidth, positions) {
  const startDate = parseDate(task.start);
  const finishDate = parseDate(task.finish);
  const y = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;

  const isSummary = task.type === '摘要';
  const isMilestone = task.milestone === '是' || task.duration === '0工作日';
  const isBuffer = task.type === '缓冲';
  const isHighRisk = task.risk === '高';

  if (!startDate && !finishDate) {
    ctx.fillStyle = '#4a4d5a';
    ctx.font = '11px -apple-system, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('(日期未设置)', 10, y + ROW_HEIGHT / 2 + 4);
    return;
  }

  const startX = startDate ? getXForDate(startDate, monthWidth) : 0;
  const finishX = finishDate ? getXForDate(finishDate, monthWidth) + monthWidth / 30 : startX;

  if (isMilestone && finishDate) {
    const cx = finishX, cy = y + ROW_HEIGHT / 2, size = 7;
    ctx.fillStyle = '#f4b400';
    ctx.strokeStyle = '#f4b400';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    positions.push({ wbs: task.wbs, x: cx - size, y: cy - size, width: size * 2, height: size * 2 });
    return;
  }

  const barWidth = Math.max(finishX - startX, 3);
  const barX = startX, barY = y + BAR_Y_OFFSET;
  const color = getWbsColor(task.wbs);

  if (isSummary) {
    ctx.fillStyle = '#3a3d4a';
    ctx.fillRect(barX, barY + 2, barWidth, BAR_HEIGHT - 4);
    ctx.fillStyle = '#6b7194';
    ctx.beginPath(); ctx.arc(barX, barY + BAR_HEIGHT / 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(barX + barWidth, barY + BAR_HEIGHT / 2, 3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.fillRect(barX, barY, barWidth, BAR_HEIGHT);
    ctx.globalAlpha = 1;

    if (isHighRisk) {
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(barX, barY, barWidth, BAR_HEIGHT);
    }
    if (isBuffer) {
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.5;
      for (let ox = barX; ox < barX + barWidth; ox += 4) {
        ctx.beginPath();
        ctx.moveTo(ox, barY);
        ctx.lineTo(ox + BAR_HEIGHT, barY + BAR_HEIGHT);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (barWidth > 40) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px -apple-system, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      const name = task.name.length > 20 ? task.name.slice(0, 20) + '..' : task.name;
      ctx.fillText(name, barX + 6, barY + BAR_HEIGHT / 2 + 4, barWidth - 12);
    }
  }
  positions.push({ wbs: task.wbs, x: barX, y: barY, width: barWidth, height: BAR_HEIGHT });
}
