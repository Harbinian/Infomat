# 演示文稿四大部分升级 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `信息化系统应用与集成说明会.html` 从扁平 18 章升级为"引言页 + 四大部分分隔页 + 导航徽标"的层次化结构。

**Architecture:** 单文件 HTML 修改——新增 5 个 section（1 引言 + 4 Part 分隔页）、新增 3 组 CSS 规则（分隔页、引言页、导航徽标）、更新顶部导航链接插入 P1–P4 徽标。不修改现有章节内容、ID、交互逻辑。

**Tech Stack:** 原生 HTML/CSS/JavaScript，ECharts CDN（不新增依赖）

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `docs/Demo/信息化系统应用与集成说明会.html` | Modify | 单文件：CSS + 5 新 section + 导航更新 |

## Insertion Points

| 插入点 | 行号 | 内容 |
|--------|------|------|
| A | 574→575 之间 | 引言页 section |
| B | 576→578 之间 | Part 1 分隔页 |
| C | 873→875 之间 | Part 2 分隔页 |
| D | 1177→1179 之间 | Part 3 分隔页 |
| E | 1723→1725 之间 | Part 4 分隔页 |
| CSS | 526 之前 | 新增样式（分隔页、引言页、导航徽标） |
| Nav | 535→540 | 插入 P1–P4 徽标 + 新锚点链接 |

---

### Task 1: 新增 CSS 样式

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (insert before `</style>` at line 526)

- [ ] **Step 1: 在 `</style>` 之前插入分隔页、引言页和导航徽标 CSS**

Insert the following CSS block immediately before line 526 (`</style>`):

```css
/* ── PART DIVIDER (全屏分隔页) ── */
.part-divider{min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:70px 8vw 60px;position:relative;overflow:hidden;scroll-margin-top:50px}
.part-divider.p1{background:linear-gradient(135deg,#0a1e40 0%,#1a56db 70%,#3b82f6 100%)}
.part-divider.p2{background:linear-gradient(135deg,#0a2e3a 0%,#0891b2 70%,#22d3ee 100%)}
.part-divider.p3{background:linear-gradient(135deg,#0a1f0a 0%,#16a34a 70%,#22c55e 100%)}
.part-divider.p4{background:linear-gradient(135deg,#3a1f0a 0%,#d97706 70%,#f59e0b 100%)}
.part-label{font-size:12px;letter-spacing:3px;margin-bottom:14px;text-transform:uppercase}
.p1 .part-label{color:#93c5fd}.p2 .part-label{color:#a5f3fc}
.p3 .part-label{color:#86efac}.p4 .part-label{color:#fcd34d}
.part-title{font-size:clamp(22px,3.5vw,36px);font-weight:800;color:#fff;margin-bottom:10px}
.part-range{font-size:13px;margin-bottom:6px}
.p1 .part-range{color:#bfdbfe}.p2 .part-range{color:#cffafe}
.p3 .part-range{color:#bbf7d0}.p4 .part-range{color:#fde68a}
.part-rule{width:40px;height:3px;margin:20px 0}
.p1 .part-rule{background:rgba(255,255,255,.3)}.p2 .part-rule{background:rgba(255,255,255,.3)}
.p3 .part-rule{background:rgba(255,255,255,.3)}.p4 .part-rule{background:rgba(255,255,255,.3)}
.part-hook{font-size:15px;line-height:1.8}
.p1 .part-hook{color:rgba(255,255,255,.8)}.p2 .part-hook{color:rgba(255,255,255,.8)}
.p3 .part-hook{color:rgba(255,255,255,.8)}.p4 .part-hook{color:rgba(255,255,255,.8)}

/* ── INTRO PAGE (引言页) ── */
#intro{min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:70px 8vw 60px;background:linear-gradient(135deg,#081e4a 0%,#1a56db 55%,#0891b2 100%);position:relative;overflow:hidden;scroll-margin-top:50px}
#intro::before{content:'';position:absolute;top:-40%;right:-10%;width:600px;height:600px;border-radius:50%;background:rgba(255,255,255,.04);pointer-events:none}
.intro-hook{font-size:clamp(18px,3vw,24px);font-weight:800;color:#fff;line-height:1.6;text-align:center;margin-bottom:8px}
.intro-punch{font-size:clamp(24px,4vw,36px);font-weight:900;color:#fde68a;text-align:center;margin-bottom:24px}
.intro-body{font-size:14px;color:#bfdbfe;line-height:1.9;text-align:center;max-width:580px;margin:0 auto 36px}
.intro-agenda{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding-top:22px;border-top:1px solid rgba(255,255,255,.15);font-size:12px}
.intro-agenda .ia-step{color:#93c5fd;font-weight:700}
.intro-agenda .ia-arr{color:rgba(255,255,255,.25);font-size:14px}
.intro-agenda .ia-step:nth-of-type(2){color:#a5f3fc}
.intro-agenda .ia-step:nth-of-type(3){color:#86efac}
.intro-agenda .ia-step:nth-of-type(4){color:#fcd34d}

/* ── NAV PART BADGES ── */
.nav-badge{display:inline-block;font-size:9px;font-weight:800;padding:2px 5px;border-radius:3px;color:#fff;flex-shrink:0;vertical-align:middle;margin:0 2px}
.nav-badge.p1{background:#1a56db}.nav-badge.p2{background:#0891b2}
.nav-badge.p3{background:#16a34a}.nav-badge.p4{background:#d97706}
.nav-sep{color:rgba(255,255,255,.22);font-size:9px;vertical-align:middle;margin:0 1px;user-select:none}
```

- [ ] **Step 2: 验证 CSS 无语法错误**

Open `docs/Demo/信息化系统应用与集成说明会.html` in a browser. Open DevTools → Console. Verify no CSS parse errors.

- [ ] **Step 3: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "style: add part divider, intro page, and nav badge CSS"
```

---

### Task 2: 新增引言页 section

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (insert after line 574, before line 576)

- [ ] **Step 1: 在封面 `</div>` 之后、`<div class="page">` 之前插入引言页**

Insert after line 574 (`</div>` closing cover) and before line 575 (blank line before `<div class="page">`):

```html
<!-- ══ 引言页 ══ -->
<div id="intro">
  <div style="font-size:40px;margin-bottom:22px;text-align:center">&#x1F50D;</div>
  <div class="intro-hook">一个零件，五个系统，五种叫法——</div>
  <div class="intro-punch">追溯链在哪里？</div>
  <div class="intro-body">航空复材制造的命脉是零件编号 + 质量编号的全链路追溯。<br/>今天这场说明会，我们直面 4 套系统的集成路线、<br/>主数据底座的建设路径，以及会后每个部门的行动清单。</div>
  <div class="intro-agenda">
    <span class="ia-step" style="color:#93c5fd">P1 定位与方案</span>
    <span class="ia-arr">→</span>
    <span class="ia-step" style="color:#a5f3fc">P2 系统简介</span>
    <span class="ia-arr">→</span>
    <span class="ia-step" style="color:#86efac">P3 集成之路</span>
    <span class="ia-arr">→</span>
    <span class="ia-step" style="color:#fcd34d">P4 分工行动</span>
  </div>
  <div class="scroll-hint">向下滚动</div>
</div>
```

- [ ] **Step 2: 浏览器验证引言页渲染**

打开 HTML 文件，滚动到封面下方，确认引言页全屏深蓝渐变背景、文字居中、四部分议程箭头正常显示。

- [ ] **Step 3: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: add intro page with problem-oriented narrative hook"
```

---

### Task 3: 新增 Part 1 分隔页

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (insert after line 576, before line 578)

- [ ] **Step 1: 在 `<div class="page">` 之后、第 1 章之前插入 Part 1 分隔页**

Insert after line 576 (`<div class="page">`) and before line 577 (blank line) and line 578 (`<!-- ══ 1 会议定位 ══ -->`):

```html
<!-- ══ Part 1 分隔页 ══ -->
<div class="part-divider p1" id="part1">
  <div class="part-label">P A R T &nbsp;&nbsp; 1</div>
  <div class="part-title">定位、目标与集成方案</div>
  <div class="part-range">第 1–7 章</div>
  <div class="part-rule"></div>
  <div class="part-hook">先说清楚"我们要做什么"<br/>和"系统之间怎么连"</div>
  <div class="scroll-hint" style="position:static;margin-top:40px;transform:none">向下滚动</div>
</div>
```

- [ ] **Step 2: 浏览器验证 Part 1 分隔页渲染**

打开 HTML，确认 Part 1 分隔页：深蓝渐变、居中对齐、"P A R T 1"标签、标题、章节范围、引导语文案正确。

- [ ] **Step 3: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: add Part 1 divider page (定位、目标与集成方案)"
```

---

### Task 4: 新增 Part 2 分隔页

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (insert after line 873, before line 875)

- [ ] **Step 1: 在第 7 章结束后、第 8 章开始前插入 Part 2 分隔页**

Insert after line 873 (`</div>` closing s7) and before line 875 (`<!-- ══ 8 OA 是什么 ══ -->`):

```html
<!-- ══ Part 2 分隔页 ══ -->
<div class="part-divider p2" id="part2">
  <div class="part-label">P A R T &nbsp;&nbsp; 2</div>
  <div class="part-title">系统简介</div>
  <div class="part-range">第 8–11 章</div>
  <div class="part-rule"></div>
  <div class="part-hook">逐系统快速过一遍<br/>"每个系统管什么、不做什么"</div>
  <div class="scroll-hint" style="position:static;margin-top:40px;transform:none">向下滚动</div>
</div>
```

- [ ] **Step 2: 浏览器验证 Part 2 分隔页渲染**

打开 HTML，确认青色渐变背景、标题"系统简介"、引导语正确。

- [ ] **Step 3: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: add Part 2 divider page (系统简介)"
```

---

### Task 5: 新增 Part 3 分隔页

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (insert after line 1177, before line 1179)

- [ ] **Step 1: 在第 11 章结束后、第 12 章开始前插入 Part 3 分隔页**

Insert after line 1177 (`</div>` closing s11) and before line 1179 (`<!-- ══ 12 主数据事故链 ══ -->`):

```html
<!-- ══ Part 3 分隔页 ══ -->
<div class="part-divider p3" id="part3">
  <div class="part-label">P A R T &nbsp;&nbsp; 3</div>
  <div class="part-title">集成执行的必经之路</div>
  <div class="part-range">第 12–16 章</div>
  <div class="part-rule"></div>
  <div class="part-hook">从事故链到 MDM 基石，再到接口设计<br/>和 Q1–Q8 成熟度判断</div>
  <div class="scroll-hint" style="position:static;margin-top:40px;transform:none">向下滚动</div>
</div>
```

- [ ] **Step 2: 浏览器验证 Part 3 分隔页渲染**

打开 HTML，确认绿色渐变背景、标题"集成执行的必经之路"正确。

- [ ] **Step 3: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: add Part 3 divider page (集成执行的必经之路)"
```

---

### Task 6: 新增 Part 4 分隔页

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (insert after line 1723, before line 1725)

- [ ] **Step 1: 在第 16 章结束后、第 17 章开始前插入 Part 4 分隔页**

Insert after line 1723 (`</div>` closing s16) and before line 1725 (`<!-- ══ 17 组织分工确认 ══ -->`):

```html
<!-- ══ Part 4 分隔页 ══ -->
<div class="part-divider p4" id="part4">
  <div class="part-label">P A R T &nbsp;&nbsp; 4</div>
  <div class="part-title">组织分工与行动清单</div>
  <div class="part-range">第 17–18 章</div>
  <div class="part-rule"></div>
  <div class="part-hook">落实"谁确认、谁负责"<br/>和会后的每一条待办事项</div>
  <div class="scroll-hint" style="position:static;margin-top:40px;transform:none">向下滚动</div>
</div>
```

- [ ] **Step 2: 浏览器验证 Part 4 分隔页渲染**

打开 HTML，确认琥珀色渐变背景、标题"组织分工与行动清单"正确。

- [ ] **Step 3: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: add Part 4 divider page (组织分工与行动清单)"
```

---

### Task 7: 更新顶部导航——插入 Part 徽标和新锚点

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (replace lines 535–540, the `<div class="nav-links">` block)

- [ ] **Step 1: 替换导航链接，插入 P1–P4 徽标和新页面锚点**

Replace the existing `<div class="nav-links" id="navLinks">...</div>` block (lines 535–540) with:

```html
  <div class="nav-links" id="navLinks">
    <a href="#cover">首页</a><a href="#intro">引言</a>
    <span class="nav-sep">│</span>
    <span class="nav-badge p1">P1</span><a href="#s1">会议定位</a><a href="#s2">数字化目标</a><a href="#s3">4套系统</a>
    <a href="#s4">排期</a><a href="#s5">里程碑</a><a href="#s6">执行抓手</a>
    <a href="#s7">拓扑数据流</a>
    <span class="nav-sep">│</span>
    <span class="nav-badge p2">P2</span><a href="#s8">OA</a><a href="#s9">PLM</a><a href="#s10">MES</a><a href="#s11">其他系统</a>
    <span class="nav-sep">│</span>
    <span class="nav-badge p3">P3</span><a href="#s12">事故链</a><a href="#s13">MDM基石</a>
    <a href="#s14">黄金源</a><a href="#s15">接口</a>
    <a href="#s16">Q成熟度</a>
    <span class="nav-sep">│</span>
    <span class="nav-badge p4">P4</span><a href="#s17">组织分工</a><a href="#s18">行动清单</a><a href="#appendix">附录</a>
  </div>
```

- [ ] **Step 2: 浏览器验证导航**

打开 HTML：
- 确认顶部导航显示 "引言" 链接和 P1/P2/P3/P4 彩色徽标
- 点击每个徽标后的导航链接，确认跳转对应章节
- 点击 "引言" 链接，确认跳转到新增的引言页
- 点击 "首页" 链接，确认跳转封面
- 移动端宽度下确认导航仍可横向滚动

- [ ] **Step 3: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: update nav with Part badges (P1-P4) and intro link"
```

---

### Task 8: 完整性回归验证

**Files:**
- None (read-only verification)

- [ ] **Step 1: 全量功能检查**

在浏览器中打开 HTML 文件，逐项检查：

| 检查项 | 验证方法 |
|--------|----------|
| 封面正常显示 | 滚动到顶部 |
| 引言页正常显示 | 滚动到封面下方，或点击导航"引言" |
| Part 1 分隔页在 Ch1 前 | 滚动到引言页下方 |
| Part 2 分隔页在 Ch7 后 | 导航点击"拓扑数据流"，向下滚动 |
| Part 3 分隔页在 Ch11 后 | 导航点击"其他系统"，向下滚动 |
| Part 4 分隔页在 Ch16 后 | 导航点击"Q成熟度"，向下滚动 |
| ECharts 桑基图渲染 | 滚动到第 6 章，确认 4 张图可见 |
| 拓扑 SVG 点击弹窗 | 第 7 章点击系统节点，确认弹窗可开可关 |
| 导航 P1–P4 徽标可见 | 顶部导航栏 |
| 导航所有链接跳转正确 | 逐个点击 |
| 移动端表格不溢出 | Chrome DevTools 切 iPhone SE 宽度 |
| 附录和页脚版本日期 | 对比封面日期 |
| 控制台无 JS 报错 | DevTools Console |

- [ ] **Step 2: 如有问题，修复后重新验证**

- [ ] **Step 3: 最终 commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "verify: full regression pass — all sections, nav, charts, modals OK"
```
