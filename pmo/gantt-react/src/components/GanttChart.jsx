import { useRef, useEffect, useCallback } from 'react';
import {
  parseDate, formatDate, getWbsColor, getTotalMonths, getMonthLabels,
  getXForDate
} from '../utils/dateUtils';

const ROW_HEIGHT = 32;
const MONTH_HEADER_HEIGHT = 44;
const BAR_HEIGHT = 20;
const BAR_Y_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const FONT_STACK = '"Source Han Sans SC", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';
const GANTT_THEME = {
  panel: '#f7f1e0',
  panel2: '#fbf6e9',
  line: 'rgba(58, 46, 31, 0.16)',
  lineSoft: 'rgba(58, 46, 31, 0.08)',
  ink: '#2a2014',
  text: '#3d3023',
  muted: '#7a6a56',
  faint: '#b8a88e',
  focus: '#c97050',
  gold: '#9a7a30',
  sage: '#6f7d4e',
  summary: '#c8b999'
};

export default function GanttChart({ tasks, monthWidth, onSelect, onZoomChange }) {
  const canvasRef = useRef(null);
  const panelRef = useRef(null);
  const monthCanvasRef = useRef(null);
  const monthWrapRef = useRef(null);
  const positionsRef = useRef([]);
  const tooltipRef = useRef(null);

  const renderMonthHeader = useCallback((months, totalWidth) => {
    const mCanvas = monthCanvasRef.current;
    if (!mCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = mCanvas.getContext('2d');
    const labels = getMonthLabels();

    mCanvas.width = totalWidth * dpr;
    mCanvas.height = MONTH_HEADER_HEIGHT * dpr;
    mCanvas.style.width = totalWidth + 'px';
    mCanvas.style.height = MONTH_HEADER_HEIGHT + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, totalWidth, MONTH_HEADER_HEIGHT);
    ctx.fillStyle = GANTT_THEME.panel2;
    ctx.fillRect(0, 0, totalWidth, MONTH_HEADER_HEIGHT);

    // Year row
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
        ctx.fillStyle = GANTT_THEME.panel;
        ctx.fillRect(x, 0, yearWidth, 22);
        ctx.fillStyle = GANTT_THEME.ink;
        ctx.font = `bold 13px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.fillText(yr + '年', x + yearWidth / 2, 16);
      }
    }

    // Month row
    for (let i = 0; i < months; i++) {
      const x = i * monthWidth;
      const mon = labels[i].split('-')[1];
      ctx.fillStyle = (i % 2 === 0) ? GANTT_THEME.muted : GANTT_THEME.faint;
      ctx.font = `12px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.fillText(mon + '月', x + monthWidth / 2, 40);
    }

    // Bottom line
    ctx.strokeStyle = GANTT_THEME.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, MONTH_HEADER_HEIGHT);
    ctx.lineTo(totalWidth, MONTH_HEADER_HEIGHT);
    ctx.stroke();
  }, [monthWidth]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    const months = getTotalMonths();
    const totalWidth = months * monthWidth + 80;
    const totalHeight = Math.max(tasks.length * ROW_HEIGHT + 20, 400);

    canvas.width = totalWidth * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.width = totalWidth + 'px';
    canvas.style.height = totalHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const positions = [];

    // Background
    ctx.fillStyle = GANTT_THEME.panel2;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid lines
    ctx.strokeStyle = GANTT_THEME.lineSoft;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= months; i++) {
      const x = i * monthWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
    }
    for (let i = 0; i <= tasks.length; i++) {
      const y = i * ROW_HEIGHT;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(totalWidth, y);
      ctx.stroke();
    }

    // Today line
    const now = new Date();
    const todayX = getXForDate(now, monthWidth);
    if (todayX >= 0 && todayX <= months * monthWidth) {
      ctx.strokeStyle = GANTT_THEME.focus;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(todayX, 0);
      ctx.lineTo(todayX, totalHeight);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = GANTT_THEME.focus;
      ctx.font = `bold 11px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.fillText('今天', todayX, 14);
    }

    // Task bars
    tasks.forEach((task, rowIndex) => {
      drawTaskBar(ctx, task, rowIndex, monthWidth, positions);
    });

    positionsRef.current = positions;

    // Render month header on separate canvas
    renderMonthHeader(months, totalWidth);
  }, [tasks, monthWidth, renderMonthHeader]);

  // Sync month header horizontal scroll with gantt panel
  const syncMonthScroll = useCallback(() => {
    const panel = panelRef.current;
    const wrap = monthWrapRef.current;
    if (panel && wrap) wrap.scrollLeft = panel.scrollLeft;
  }, []);

  useEffect(() => { draw(); syncMonthScroll(); }, [draw, syncMonthScroll]);

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
        const task = tasks.find(t => t.nodeKey === hit.nodeKey);
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
      onSelect(hit ? hit.nodeKey : null);
    };

    const onMouseLeave = () => { tooltip.style.display = 'none'; };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('click', onClick);
    return () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('click', onClick);
    };
  }, [tasks, onSelect]);

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
        const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        panel.scrollLeft += dx;
        const wrap = monthWrapRef.current;
        if (wrap) wrap.scrollLeft = panel.scrollLeft;
      }
    };
    panel.addEventListener('wheel', onWheel, { passive: false });
    return () => panel.removeEventListener('wheel', onWheel);
  }, [monthWidth, onZoomChange]);

  // Scroll sync: gantt panel ↔ task tree (bidirectional) + month header horizontal sync
  useEffect(() => {
    const panel = panelRef.current;
    const tree = document.getElementById('taskTreePanel');
    const wrap = monthWrapRef.current;
    if (!panel || !tree) return;
    let syncing = false;
    const onPanelScroll = () => {
      if (syncing) return;
      syncing = true;
      if (tree.scrollTop !== panel.scrollTop) tree.scrollTop = panel.scrollTop;
      if (wrap && wrap.scrollLeft !== panel.scrollLeft) wrap.scrollLeft = panel.scrollLeft;
      syncing = false;
    };
    const onTreeScroll = () => {
      if (syncing) return;
      syncing = true;
      if (panel.scrollTop !== tree.scrollTop) panel.scrollTop = tree.scrollTop;
      syncing = false;
    };
    panel.addEventListener('scroll', onPanelScroll);
    tree.addEventListener('scroll', onTreeScroll);
    return () => {
      panel.removeEventListener('scroll', onPanelScroll);
      tree.removeEventListener('scroll', onTreeScroll);
    };
  }, []);

  return (
    <div className="gantt-wrapper">
      <div className="gantt-header-bar">
        <div className="month-header-wrap" ref={monthWrapRef}>
          <canvas ref={monthCanvasRef} />
        </div>
      </div>
      <div className="gantt-panel" ref={panelRef}>
        <canvas ref={canvasRef} className="gantt-canvas" />
        <div className="gantt-tooltip" ref={tooltipRef} />
      </div>
      <div className="zoom-controls">
        <button className="zoom-btn" onClick={() => onZoomChange(monthWidth / 1.3)} title="缩小 (Ctrl+滚轮)">−</button>
        <span className="zoom-label">{Math.round(monthWidth / 82 * 100)}%</span>
        <button className="zoom-btn" onClick={() => onZoomChange(monthWidth * 1.3)} title="放大 (Ctrl+滚轮)">+</button>
        <button className="zoom-btn zoom-reset" onClick={() => onZoomChange(82)} title="重置缩放">↺</button>
      </div>
    </div>
  );
}

function drawTaskBar(ctx, task, rowIndex, monthWidth, positions) {
  const startDate = parseDate(task.start);
  const finishDate = parseDate(task.finish);
  const y = rowIndex * ROW_HEIGHT;

  const isSummary = task.type === '摘要';
  const isMilestone = task.milestone === '是' || task.duration === '0工作日';
  const isBuffer = task.type === '缓冲';
  const isHighRisk = task.risk === '高';

  if (!startDate && !finishDate) {
    ctx.fillStyle = GANTT_THEME.faint;
    ctx.font = `11px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText('(日期未设置)', 10, y + ROW_HEIGHT / 2 + 4);
    positions.push({ nodeKey: task.nodeKey, x: 0, y: y + BAR_Y_OFFSET, width: 300, height: BAR_HEIGHT });
    return;
  }

  const startX = startDate ? getXForDate(startDate, monthWidth) : 0;
  const finishX = finishDate ? getXForDate(finishDate, monthWidth) + monthWidth / 30 : startX;

  const labelFont = `11px ${FONT_STACK}`;
  const labelName = task.name && task.name.length > 28 ? task.name.slice(0, 28) + '..' : (task.name || '');

  if (isMilestone && finishDate) {
    const cx = finishX, cy = y + ROW_HEIGHT / 2, size = 7;
    ctx.fillStyle = GANTT_THEME.gold;
    ctx.strokeStyle = GANTT_THEME.gold;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (labelName) {
      ctx.fillStyle = GANTT_THEME.text;
      ctx.font = labelFont;
      ctx.textAlign = 'left';
      ctx.fillText(labelName, cx + size + 6, cy + 4);
    }
    positions.push({ nodeKey: task.nodeKey, x: cx - size, y: cy - size, width: size * 2, height: size * 2 });
    return;
  }

  const barWidth = Math.max(finishX - startX, 3);
  const barX = startX, barY = y + BAR_Y_OFFSET;
  const color = getWbsColor(task.wbs);

  if (isSummary) {
    ctx.fillStyle = GANTT_THEME.summary;
    ctx.fillRect(barX, barY + 2, barWidth, BAR_HEIGHT - 4);
    ctx.fillStyle = GANTT_THEME.muted;
    ctx.beginPath(); ctx.arc(barX, barY + BAR_HEIGHT / 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(barX + barWidth, barY + BAR_HEIGHT / 2, 3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.fillRect(barX, barY, barWidth, BAR_HEIGHT);
    ctx.globalAlpha = 1;

    if (isHighRisk) {
      ctx.strokeStyle = GANTT_THEME.focus;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(barX, barY, barWidth, BAR_HEIGHT);
    }
    if (isBuffer) {
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = GANTT_THEME.panel2;
      ctx.lineWidth = 0.5;
      for (let ox = barX; ox < barX + barWidth; ox += 4) {
        ctx.beginPath();
        ctx.moveTo(ox, barY);
        ctx.lineTo(ox + BAR_HEIGHT, barY + BAR_HEIGHT);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  if (labelName) {
    ctx.fillStyle = isSummary ? GANTT_THEME.muted : GANTT_THEME.text;
    ctx.font = labelFont;
    ctx.textAlign = 'left';
    ctx.fillText(labelName, barX + barWidth + 6, barY + BAR_HEIGHT / 2 + 4);
  }

  positions.push({ nodeKey: task.nodeKey, x: barX, y: barY, width: barWidth, height: BAR_HEIGHT });
}
