from __future__ import annotations

import calendar
import argparse
import os
import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH, HEIGHT = 7680, 4320
YEAR = 2026
MONTHS = list(range(5, 13))
ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render the digital project Gantt chart as an 8K PNG.")
    parser.add_argument("--source", type=Path, default=ROOT / "output" / "digital_project_gantt_8k.md")
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "digital_project_gantt_8k.png")
    parser.add_argument(
        "--font",
        action="append",
        default=[],
        help="Font file reviewItem. Can be repeated; GANTT_FONT_PATHS also accepts os.pathsep-separated reviewItems.",
    )
    return parser.parse_args()


ARGS = parse_args()
SOURCE = ARGS.source.resolve()
TARGET = ARGS.output.resolve()

BG = "#061426"
PANEL = "#0A1D35"
PANEL_2 = "#0D2745"
GRID = "#7DD3FC"
GRID_SOFT = "#1E5C86"
TEXT = "#F8FAFC"
TEXT_MUTED = "#B9D8F2"
RED_LINE = "#EF4444"
CRITICAL_STROKE = "#FF5C7A"

COLOR_RULES = {
    "数据标准": ("#245FEA", "#FFFFFF"),
    "MDM底座": ("#22D3EE", "#04121F"),
    "PLM建设": ("#22C55E", "#04121F"),
    "MES建设": ("#FACC15", "#111827"),
    "MES明细-功能开发": ("#245FEA", "#FFFFFF"),
    "MES明细-需求设计": ("#64748B", "#FFFFFF"),
    "MES明细-数据工作": ("#F97316", "#111827"),
    "MES明细-测试上线": ("#10B981", "#04121F"),
    "联调验收": ("#7C3AED", "#FFFFFF"),
    "接口联调": ("#BE123C", "#FFFFFF"),
    "关键任务": ("#7F1D1D", "#FFFFFF"),
}

GROUP_ORDER = ["数据标准", "MDM底座", "PLM建设", "MES建设", "联调验收"]
SUBLANE_ORDER = ["子泳道-主数据", "子泳道-工艺", "子泳道-仓储"]

MILESTONES = [
    (date(2026, 6, 13), "编码锁定"),
    (date(2026, 8, 15), "接口联调"),
    (date(2026, 11, 1), "PLM上线"),
    (date(2026, 12, 1), "正式上线"),
]


@dataclass
class Task:
    group: str
    level: str
    lane: str
    code: str
    name: str
    color_type: str
    start: date
    end: date
    node_date: date | None
    node_only: bool


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    env_reviewItems = [Path(p) for p in os.environ.get("GANTT_FONT_PATHS", "").split(os.pathsep) if p]
    cli_reviewItems = [Path(p) for p in ARGS.font]
    local_reviewItems = [
        ROOT / "assets" / "fonts" / "NotoSansSC-VF.ttf",
        ROOT / "assets" / "fonts" / ("msyhbd.ttc" if bold else "msyh.ttc"),
        ROOT / "assets" / "fonts" / ("Dengb.ttf" if bold else "Deng.ttf"),
        ROOT / "assets" / "fonts" / "simhei.ttf",
    ]
    reviewItems = cli_reviewItems + env_reviewItems + local_reviewItems
    for path in reviewItems:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


F_TITLE = font(84, True)
F_SUBTITLE = font(34, False)
F_MONTH = font(58, True)
F_COL = font(34, True)
F_GROUP = font(48, True)
F_SUBLANE = font(36, True)
F_TASK = font(34, True)
F_TASK_SMALL = font(30, True)
F_BAR = font(32, True)
F_BAR_SMALL = font(28, True)
F_MILESTONE = font(30, True)


def text_size(draw: ImageDraw.ImageDraw, value: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    if not value:
        return 0, 0
    box = draw.textbbox((0, 0), value, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    box: tuple[float, float, float, float],
    value: str,
    fnt: ImageFont.FreeTypeFont,
    fill: str,
) -> None:
    x1, y1, x2, y2 = box
    tw, th = text_size(draw, value, fnt)
    draw.text((x1 + (x2 - x1 - tw) / 2, y1 + (y2 - y1 - th) / 2 - 2), value, font=fnt, fill=fill)


def draw_fit_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    value: str,
    fnt: ImageFont.FreeTypeFont,
    fill: str,
    max_width: int,
) -> None:
    if text_size(draw, value, fnt)[0] <= max_width:
        draw.text(xy, value, font=fnt, fill=fill)
        return
    ellipsis = "..."
    clipped = value
    while clipped and text_size(draw, clipped + ellipsis, fnt)[0] > max_width:
        clipped = clipped[:-1]
    draw.text(xy, clipped + ellipsis if clipped else value[:1], font=fnt, fill=fill)


def parse_source() -> list[Task]:
    text = SOURCE.read_text(encoding="utf-8")
    tasks: list[Task] = []
    current_group: str | None = None
    in_task_section = False

    for raw in text.splitlines():
        line = raw.strip()
        if line == "## 融合甘特任务表":
            in_task_section = True
            continue
        if in_task_section and line.startswith("## ") and line != "## 融合甘特任务表":
            break
        if not in_task_section:
            continue
        if line.startswith("### "):
            heading = line[4:].strip()
            current_group = None
            for group in GROUP_ORDER:
                if heading.startswith(group):
                    current_group = group
                    break
            continue
        if not current_group or not line.startswith("|") or "|---" in line or "层级" in line:
            continue

        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) != 12:
            continue
        level, code, name, color_type = cells[:4]
        month_cells = cells[4:]
        active_months: list[int] = []
        node_date: date | None = None
        for month, cell in zip(MONTHS, month_cells):
            if not cell:
                continue
            if "█" in cell:
                active_months.append(month)
            node_match = re.search(r"(\d{1,2})/(\d{1,2})", cell)
            if node_match:
                node_date = date(YEAR, int(node_match.group(1)), int(node_match.group(2)))
        if active_months:
            start = date(YEAR, min(active_months), 1)
            last_month = max(active_months)
            end = date(YEAR, last_month, calendar.monthrange(YEAR, last_month)[1])
            if node_date and node_date >= start:
                end = node_date
            node_only = False
        elif node_date:
            start = node_date
            end = node_date
            node_only = True
        else:
            continue
        tasks.append(
            Task(
                group=current_group,
                level=level,
                lane=level if level.startswith("子泳道") else "",
                code=code,
                name=name,
                color_type=color_type,
                start=start,
                end=end,
                node_date=node_date,
                node_only=node_only,
            )
        )
    return tasks


def date_to_x(day: date, gantt_x: int, gantt_w: int) -> float:
    axis_start = date(YEAR, 5, 1)
    axis_end = date(YEAR, 12, 31) + timedelta(days=1)
    total = (axis_end - axis_start).days
    return gantt_x + ((day - axis_start).days / total) * gantt_w


def month_end(month: int) -> date:
    return date(YEAR, month, calendar.monthrange(YEAR, month)[1])


def build_rows(tasks: list[Task]) -> list[dict]:
    rows: list[dict] = []
    by_group = {group: [task for task in tasks if task.group == group] for group in GROUP_ORDER}
    for group in GROUP_ORDER:
        group_tasks = by_group[group]
        if group != "MES建设":
            rows.extend({"kind": "task", "task": task, "group": group} for task in group_tasks)
            rows.append({"kind": "gap", "group": group})
            continue

        primary = [task for task in group_tasks if task.level == "一级"]
        rows.extend({"kind": "task", "task": task, "group": group} for task in primary)
        for sublane in SUBLANE_ORDER:
            rows.append({"kind": "sublane", "label": sublane, "group": group})
            rows.extend(
                {"kind": "task", "task": task, "group": group}
                for task in group_tasks
                if task.level == sublane
            )
        rows.append({"kind": "gap", "group": group})
    if rows and rows[-1]["kind"] == "gap":
        rows.pop()
    return rows


def row_height(row: dict) -> int:
    if row["kind"] == "gap":
        return 28
    if row["kind"] == "sublane":
        return 58
    task: Task = row["task"]
    return 76 if task.level == "一级" else 66


def draw_dashed_vertical(draw: ImageDraw.ImageDraw, x: float, y1: int, y2: int, color: str, width: int) -> None:
    dash, gap = 30, 22
    y = y1
    while y < y2:
        draw.line((x, y, x, min(y + dash, y2)), fill=color, width=width)
        y += dash + gap


def draw_group_bands(draw: ImageDraw.ImageDraw, rows: list[dict], y_positions: list[int], group_x: int, group_w: int) -> None:
    group_palette = {
        "数据标准": "#123A78",
        "MDM底座": "#075B6A",
        "PLM建设": "#0D5B31",
        "MES建设": "#6A5506",
        "联调验收": "#3F247B",
    }
    spans: dict[str, list[int]] = {}
    for i, row in enumerate(rows):
        if row["kind"] == "gap":
            continue
        spans.setdefault(row["group"], []).append(i)
    for group in GROUP_ORDER:
        indexes = spans.get(group, [])
        if not indexes:
            continue
        y1 = y_positions[min(indexes)]
        y2 = y_positions[max(indexes)] + row_height(rows[max(indexes)])
        draw.rounded_rectangle((group_x, y1, group_x + group_w, y2), radius=16, fill=group_palette[group], outline="#2B6D99", width=2)
        draw_centered_text(draw, (group_x + 16, y1, group_x + group_w - 16, y2), group, F_GROUP, TEXT)


def draw_bar_label(
    draw: ImageDraw.ImageDraw,
    label: str,
    bar_box: tuple[float, float, float, float],
    fill: str,
    label_color: str,
    gantt_x: int,
    gantt_right: int,
    y_center: float,
) -> None:
    x1, y1, x2, y2 = bar_box
    bar_w = x2 - x1
    label_font = F_BAR if bar_w >= 210 else F_BAR_SMALL
    tw, th = text_size(draw, label, label_font)
    pad = 28
    if tw + pad * 2 <= bar_w:
        draw.text((x1 + (bar_w - tw) / 2, y1 + (y2 - y1 - th) / 2 - 1), label, font=label_font, fill=label_color)
        return

    outside_x = x2 + 24
    outside_w = gantt_right - outside_x - 18
    if outside_w >= max(140, min(tw, 520)):
        draw_fit_text(draw, (outside_x, y_center - th / 2 - 2), label, label_font, TEXT, int(outside_w))
        return

    left_w = x1 - gantt_x - 24
    if left_w >= 180:
        draw_fit_text(draw, (gantt_x + 18, y_center - th / 2 - 2), label, label_font, TEXT, int(left_w))
        return

    draw_fit_text(draw, (x1 + 12, y_center - th / 2 - 2), label, F_BAR_SMALL, fill, max(80, int(bar_w - 24)))


def draw_chart() -> None:
    tasks = parse_source()
    if len(tasks) != 39:
        raise RuntimeError(f"Expected 39 tasks from fusion table, parsed {len(tasks)}")

    rows = build_rows(tasks)
    row_heights = [row_height(row) for row in rows]

    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    margin_x = 150
    top = 98
    header_y = 316
    month_y = 416
    chart_y = 610
    group_x = margin_x
    group_w = 570
    lane_x = group_x + group_w + 22
    lane_w = 500
    task_x = lane_x + lane_w + 18
    task_w = 1460
    gantt_x = task_x + task_w + 28
    gantt_right = WIDTH - 150
    gantt_w = gantt_right - gantt_x
    chart_bottom = chart_y + sum(row_heights)

    # Background structure
    draw.rectangle((0, 0, WIDTH, HEIGHT), fill=BG)
    draw.rectangle((margin_x - 28, header_y - 20, WIDTH - margin_x + 28, chart_bottom + 42), fill=PANEL)
    draw.rectangle((gantt_x, chart_y, gantt_right, chart_bottom), fill="#071A2F")

    draw.text((margin_x, top), "数字化项目实施融合甘特图", font=F_TITLE, fill=TEXT)
    draw.text((margin_x, top + 102), "2026.05 - 2026.12 | 数据标准、MDM、PLM、MES明细、联调验收统一时间轴", font=F_SUBTITLE, fill=TEXT_MUTED)

    # Column headers
    draw.rounded_rectangle((group_x, header_y, group_x + group_w, month_y - 18), radius=14, fill=PANEL_2, outline="#2B6D99", width=2)
    draw.rounded_rectangle((lane_x, header_y, lane_x + lane_w, month_y - 18), radius=14, fill=PANEL_2, outline="#2B6D99", width=2)
    draw.rounded_rectangle((task_x, header_y, task_x + task_w, month_y - 18), radius=14, fill=PANEL_2, outline="#2B6D99", width=2)
    draw_centered_text(draw, (group_x, header_y, group_x + group_w, month_y - 18), "分组", F_COL, TEXT)
    draw_centered_text(draw, (lane_x, header_y, lane_x + lane_w, month_y - 18), "泳道", F_COL, TEXT)
    draw_centered_text(draw, (task_x, header_y, task_x + task_w, month_y - 18), "任务", F_COL, TEXT)

    for month in MONTHS:
        mx1 = date_to_x(date(YEAR, month, 1), gantt_x, gantt_w)
        mx2 = date_to_x(month_end(month) + timedelta(days=1), gantt_x, gantt_w)
        fill = "#0B2746" if month % 2 else "#0E3156"
        draw.rectangle((mx1, month_y, mx2, chart_bottom), fill=fill)
        draw.rectangle((mx1, header_y, mx2, chart_bottom), outline=GRID_SOFT, width=2)
        draw_centered_text(draw, (mx1, header_y, mx2, month_y - 18), f"{month}月", F_MONTH, "#DDF7FF")

    # Month guide lines and row backgrounds
    for month in MONTHS:
        x = date_to_x(date(YEAR, month, 1), gantt_x, gantt_w)
        draw.line((x, month_y, x, chart_bottom), fill="#2C79A8", width=3)
    draw.line((gantt_right, month_y, gantt_right, chart_bottom), fill="#2C79A8", width=3)

    y_positions: list[int] = []
    y = chart_y
    for idx, row in enumerate(rows):
        y_positions.append(y)
        h = row_heights[idx]
        if row["kind"] == "gap":
            y += h
            continue
        row_fill = "#0A1E36" if idx % 2 == 0 else "#082038"
        if row["kind"] == "sublane":
            row_fill = "#11395A"
        draw.rectangle((lane_x, y, gantt_right, y + h), fill=row_fill)
        draw.line((lane_x, y + h, gantt_right, y + h), fill="#174E74", width=1)
        y += h

    draw_group_bands(draw, rows, y_positions, group_x, group_w)

    # Milestone lines behind bars.
    for day, label in MILESTONES:
        x = date_to_x(day, gantt_x, gantt_w)
        draw_dashed_vertical(draw, x, month_y, chart_bottom, RED_LINE, 5)
        tag = f"{day:%Y-%m-%d} {label}"
        tw, th = text_size(draw, tag, F_MILESTONE)
        tx = min(max(x - tw / 2, gantt_x + 8), gantt_right - tw - 8)
        draw.rounded_rectangle((tx - 16, month_y - 60, tx + tw + 16, month_y - 18), radius=10, fill="#7F1D1D", outline="#FF5C7A", width=2)
        draw.text((tx, month_y - 55), tag, font=F_MILESTONE, fill="#FFFFFF")

    # Row labels and bars.
    for idx, row in enumerate(rows):
        y = y_positions[idx]
        h = row_heights[idx]
        if row["kind"] == "gap":
            continue
        if row["kind"] == "sublane":
            label = row["label"]
            draw.rounded_rectangle((lane_x + 26, y + 10, task_x + task_w - 18, y + h - 10), radius=12, fill="#0E4A73", outline="#38BDF8", width=2)
            draw.text((lane_x + 48, y + 13), label, font=F_SUBLANE, fill="#E0F7FF")
            draw.text((task_x + 24, y + 17), "MES 一阶段明细任务", font=F_TASK_SMALL, fill=TEXT_MUTED)
            continue

        task: Task = row["task"]
        is_detail = task.level.startswith("子泳道")
        lane_label = task.code if not is_detail else task.code.replace("MES-", "")
        lane_font = F_TASK_SMALL if is_detail else F_TASK
        task_font = F_TASK_SMALL if is_detail else F_TASK
        indent = 36 if is_detail else 0

        draw_fit_text(draw, (lane_x + 26 + indent, y + (h - 34) / 2 - 2), lane_label, lane_font, TEXT_MUTED, lane_w - 44 - indent)
        draw_fit_text(draw, (task_x + 22 + indent, y + (h - 34) / 2 - 2), task.name, task_font, TEXT, task_w - 44 - indent)

        fill, label_color = COLOR_RULES[task.color_type]
        bar_h = 52 if not is_detail else 44
        bar_y1 = y + (h - bar_h) / 2
        bar_y2 = bar_y1 + bar_h
        if task.node_only:
            x = date_to_x(task.start, gantt_x, gantt_w)
            r = 21 if is_detail else 25
            points = [(x, bar_y1 - 4), (x + r, (bar_y1 + bar_y2) / 2), (x, bar_y2 + 4), (x - r, (bar_y1 + bar_y2) / 2)]
            draw.polygon(points, fill=fill, outline=CRITICAL_STROKE if task.color_type == "关键任务" else "#FFFFFF")
            draw_bar_label(draw, task.name, (x - r, bar_y1, x + r, bar_y2), fill, label_color, gantt_x, gantt_right, (bar_y1 + bar_y2) / 2)
            continue

        x1 = date_to_x(task.start, gantt_x, gantt_w) + 10
        x2 = date_to_x(task.end + timedelta(days=1), gantt_x, gantt_w) - 10
        if x2 - x1 < 42:
            x2 = x1 + 42
        outline = CRITICAL_STROKE if task.color_type == "关键任务" else "#E6F7FF"
        outline_w = 6 if task.color_type == "关键任务" else 2
        draw.rounded_rectangle((x1, bar_y1, x2, bar_y2), radius=14, fill=fill, outline=outline, width=outline_w)
        # A subtle top highlight keeps dark bars readable without adding decoration.
        draw.line((x1 + 14, bar_y1 + 7, x2 - 14, bar_y1 + 7), fill="#FFFFFF", width=2)
        draw_bar_label(draw, task.name, (x1, bar_y1, x2, bar_y2), fill, label_color, gantt_x, gantt_right, (bar_y1 + bar_y2) / 2)

    # Outer borders and compact legend.
    draw.rectangle((gantt_x, header_y, gantt_right, chart_bottom), outline="#66D9FF", width=3)
    draw.rectangle((lane_x, chart_y, task_x + task_w, chart_bottom), outline="#2B6D99", width=2)
    legend_y = chart_bottom + 24
    legend_items = [
        ("关键任务", "#7F1D1D", "#FFFFFF"),
        ("接口联调", "#BE123C", "#FFFFFF"),
        ("MES明细-数据工作", "#F97316", "#111827"),
        ("MES明细-测试上线", "#10B981", "#04121F"),
    ]
    lx = gantt_x
    for label, fill, fg in legend_items:
        draw.rounded_rectangle((lx, legend_y, lx + 54, legend_y + 34), radius=8, fill=fill, outline="#FFFFFF", width=1)
        draw.text((lx + 70, legend_y - 1), label, font=F_TASK_SMALL, fill=TEXT_MUTED)
        lx += 430
    draw.text((margin_x, HEIGHT - 88), "数据源：output/digital_project_gantt_8k.md 的融合甘特任务表；MES 明细按 T+1=2026.05 至 T+6=2026.10 映射。", font=F_SUBTITLE, fill="#8FBAD8")

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    img.save(TARGET, "PNG", optimize=True)


if __name__ == "__main__":
    draw_chart()
