# 数字化项目关键里程碑时间轴（4K高可读 Markdown 版）

周期：2026.05 - 2026.12  
主题：关键节点上下交错标注  
原图：`output/digital_project_milestones_8k.png`

本版保留原图的深色科技风，但把里程碑按“上排 / 下排”错开，避免卡片和文字互相压住。关键节点使用红色，普通里程碑使用蓝色。

## 视觉规则

| 项目 | 规则 |
|---|---|
| 画布建议 | 3840 x 2160 或更高 |
| 主标题 | 60-72px，粗体，白色 |
| 副标题 | 30-36px，浅蓝色 |
| 时间轴月份 | 38-44px，粗体，浅蓝白 |
| 节点圆点 | 48-64px，关键节点外圈放大到 84-100px |
| 卡片标题 | 30-36px，粗体 |
| 卡片正文 | 24-30px |
| 卡片日期 | 26-32px，等宽或粗体 |
| 防重叠原则 | 相邻节点卡片上下交错；同月密集节点必须拉开水平间距或拆到下一行 |

## 颜色规则（先定节点颜色，再定文字色）

| 类型 | 节点/卡片颜色 | 文字色 | 对比度 | 用途 |
|---|---|---|---:|---|
| 普通里程碑 | `#22D3EE` | `#04121F` | 10.45:1 | M0、M2、M4、M5、M6 |
| 普通里程碑卡片 | `#082F49` | `#F8FBFF` | 12.90:1 | 普通说明卡 |
| 关键节点 | `#DC2626` | `#FFFFFF` | 4.83:1 | 时间轴圆点，白字可直接承载节点编号 |
| 关键节点卡片 | `#7F1D1D` | `#FFFFFF` | 10.02:1 | M1、M3、M7 |
| 背景 | `#071B35` | `#F8FBFF` | 15.61:1 | 画布底色 |
| 辅助线 | `#93C5FD` | 不承载文字 | - | 时间轴、月份刻度 |

> 关键节点圆点的红色主要用于识别，不建议承载小字；关键节点卡片使用更深的 `#7F1D1D`，白字可读性更高。

## 里程碑清单

| 编号 | 日期 | 节点 | 类型 | 推荐位置 | 说明 |
|---|---:|---|---|---|---|
| M0 | 2026-05-08 | 项目启动 | 普通里程碑 | 下排 | 明确负责人，成立项目组 |
| M1 | 2026-06-13 | 物料编码锁定 | 关键节点 | 上排 | 硬约束节点，不可延期 |
| M2 | 2026-07-01 | 黄金数据源确认 | 普通里程碑 | 下排 | MDM平台就绪，主数据责任落账 |
| M3 | 2026-08-15 | 核心接口联调 | 关键节点 | 上排 | PLM / MES / MDM 三系统互通 |
| M4 | 2026-10-15 | PLM系统上线 | 普通里程碑 | 下排 | 蓝图验收通过，进入上线窗口 |
| M5 | 2026-11-01 | MES系统上线 | 普通里程碑 | 上排 | 产线联调完成，制造执行闭环 |
| M6 | 2026-11-15 | 全链路验收 | 普通里程碑 | 下排 | UAT通过，业务完成签字 |
| M7 | 2026-12-01 | 正式上线 | 关键节点 | 上排 | 全系统切换，旧系统下线 |

## 时间轴结构

| 月份 | 上排节点 | 下排节点 |
|---|---|---|
| 5月 |  | M0 项目启动 |
| 6月 | M1 物料编码锁定 |  |
| 7月 |  | M2 黄金数据源确认 |
| 8月 | M3 核心接口联调 |  |
| 9月 |  |  |
| 10月 |  | M4 PLM系统上线 |
| 11月 | M5 MES系统上线 | M6 全链路验收 |
| 12月 | M7 正式上线 |  |

## 可渲染 HTML 版

> 下方 HTML/CSS 可直接放进 Markdown 预览器或 H5 页面。节点卡片上下错开，并把 11 月的 M5 / M6 拆到上下两排，避免拥挤。

<style>
.milestone4k {
  --bg: #071b35;
  --axis: #93c5fd;
  --normal: #22d3ee;
  --normal-card: #082f49;
  --key: #dc2626;
  --key-card: #7f1d1d;
  --text: #f8fbff;
  --muted: #b7d9ff;
  color: var(--text);
  background: var(--bg);
  border: 1px solid rgba(59, 130, 246, 0.42);
  border-radius: 18px;
  padding: 32px;
  font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
}
.milestone4k .title { font-size: 44px; font-weight: 900; margin-bottom: 8px; }
.milestone4k .subtitle { font-size: 24px; color: var(--muted); margin-bottom: 28px; }
.milestone4k .timeline {
  display: grid;
  grid-template-columns: repeat(8, minmax(130px, 1fr));
  grid-template-rows: 210px 52px 210px;
  gap: 12px;
  align-items: center;
  position: relative;
}
.milestone4k .timeline::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 8px;
  background: var(--axis);
  border-radius: 999px;
  transform: translateY(-50%);
}
.milestone4k .month {
  grid-row: 2;
  align-self: end;
  text-align: center;
  color: #dbeafe;
  font-size: 28px;
  font-weight: 900;
  z-index: 2;
  padding-top: 52px;
}
.milestone4k .card {
  z-index: 3;
  min-height: 150px;
  border-radius: 18px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
}
.milestone4k .card.up { grid-row: 1; align-self: end; }
.milestone4k .card.down { grid-row: 3; align-self: start; }
.milestone4k .card.normal {
  background: var(--normal-card);
  border: 3px solid var(--normal);
}
.milestone4k .card.key {
  background: var(--key-card);
  border: 4px solid var(--key);
}
.milestone4k .card h3 {
  margin: 0;
  font-size: 28px;
  line-height: 1.25;
  color: #ffffff;
}
.milestone4k .card h3 span {
  color: var(--normal);
  margin-right: 18px;
  font-size: 32px;
}
.milestone4k .card.key h3 span { color: #ff6b6b; }
.milestone4k .card p {
  margin: 14px 0;
  color: #eaf4ff;
  font-size: 22px;
  line-height: 1.45;
}
.milestone4k .date {
  color: #93c5fd;
  font-size: 24px;
  font-weight: 900;
}
</style>

<div class="milestone4k">
  <div class="title">数字化项目关键里程碑时间轴</div>
  <div class="subtitle">2026年5月至12月 · 关键节点上下交错标注</div>
  <div class="timeline">
    <div class="month" style="grid-column: 1;">5月</div>
    <div class="month" style="grid-column: 2;">6月</div>
    <div class="month" style="grid-column: 3;">7月</div>
    <div class="month" style="grid-column: 4;">8月</div>
    <div class="month" style="grid-column: 5;">9月</div>
    <div class="month" style="grid-column: 6;">10月</div>
    <div class="month" style="grid-column: 7;">11月</div>
    <div class="month" style="grid-column: 8;">12月</div>

    <div class="card normal down" style="grid-column: 1;"><h3><span>M0</span>项目启动</h3><p>明确负责人，成立项目组</p><div class="date">2026-05-08</div></div>
    <div class="card key up" style="grid-column: 2;"><h3><span>M1</span>物料编码锁定</h3><p>硬约束节点，不可延期</p><div class="date">2026-06-13</div></div>
    <div class="card normal down" style="grid-column: 3;"><h3><span>M2</span>黄金数据源确认</h3><p>MDM平台就绪，主数据责任落账</p><div class="date">2026-07-01</div></div>
    <div class="card key up" style="grid-column: 4;"><h3><span>M3</span>核心接口联调</h3><p>PLM / MES / MDM 三系统互通</p><div class="date">2026-08-15</div></div>
    <div class="card normal down" style="grid-column: 6;"><h3><span>M4</span>PLM系统上线</h3><p>蓝图验收通过，进入上线窗口</p><div class="date">2026-10-15</div></div>
    <div class="card normal up" style="grid-column: 7;"><h3><span>M5</span>MES系统上线</h3><p>产线联调完成，制造执行闭环</p><div class="date">2026-11-01</div></div>
    <div class="card normal down" style="grid-column: 7;"><h3><span>M6</span>全链路验收</h3><p>UAT通过，业务完成签字</p><div class="date">2026-11-15</div></div>
    <div class="card key up" style="grid-column: 8;"><h3><span>M7</span>正式上线</h3><p>全系统切换，旧系统下线</p><div class="date">2026-12-01</div></div>
  </div>
</div>
