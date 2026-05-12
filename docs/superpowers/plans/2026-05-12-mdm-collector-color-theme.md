# MDM Collector 前端配色方案 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 mdm-collector 前端从灰度单色系改为 logo 驱动的红黑品牌配色（混合模式：深色头部 + 浅内容区）。

**Architecture:** 单文件 CSS 变量替换。仅修改 `mdm-collector/public/index.html` 中的 `:root` 变量、个别硬编码颜色值、topbar 结构（加 logo），以及复制 `logo.png` 到 `public/` 静态目录。

**Tech Stack:** 原生 HTML + CSS，无构建工具。

---

### Task 1: 复制 logo 到 public 静态目录

**Files:**
- Copy: `mdm-collector/logo.png` → `mdm-collector/public/logo.png`

- [ ] **Step 1: 复制文件**

```bash
cp mdm-collector/logo.png mdm-collector/public/logo.png
```

- [ ] **Step 2: 验证文件存在**

```bash
ls -la mdm-collector/public/logo.png
```

- [ ] **Step 3: Commit**

```bash
git add mdm-collector/public/logo.png
git commit -m "feat: add logo asset to public static directory"
```

---

### Task 2: 替换 :root CSS 变量 + 新增头部变量

**Files:**
- Modify: `mdm-collector/public/index.html:9-21`

- [ ] **Step 1: 替换 :root 变量块**

将当前第 9-21 行：

```css
:root {
  --bg: #ffffff;
  --surface: #f9fafb;
  --border: #e5e7eb;
  --text-main: #111827;
  --text-muted: #6b7280;
  --accent: #111827;
  --accent-hover: #374151;
  --focus-ring: rgba(17, 24, 39, 0.1);
  --error: #dc2626;
  --success: #059669;
  --warning: #d97706;
}
```

替换为：

```css
:root {
  --bg: #ffffff;
  --surface: #f3f4f6;
  --border: #e0e0e0;
  --text-main: #1f2937;
  --text-muted: #6b7280;
  --accent: #fc0000;
  --accent-hover: #dc0000;
  --focus-ring: rgba(252, 0, 0, 0.15);
  --error: #b91c1c;
  --success: #059669;
  --warning: #d97706;
  --header-bg: #1a1a2e;
  --header-text: #ffffff;
  --header-text-muted: #9ca3af;
}
```

- [ ] **Step 2: 刷新浏览器验证变量生效**

打开应用，检查 Computed Styles 中 `--accent` 为 `#fc0000`，`--header-bg` 为 `#1a1a2e`。

- [ ] **Step 3: Commit**

```bash
git add mdm-collector/public/index.html
git commit -m "feat: replace CSS color variables with logo-driven red-black palette"
```

---

### Task 3: 改造 topbar 为深色头部 + 加 logo

**Files:**
- Modify: `mdm-collector/public/index.html:36-49` (topbar CSS)
- Modify: `mdm-collector/public/index.html:192` (topbar HTML)

- [ ] **Step 1: 更新 topbar CSS（第 36-49 行）**

将：

```css
.topbar {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 20;
}
.brand { font-weight: 600; font-size: 14px; letter-spacing: -0.01em; }
.session { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--text-muted); }
```

替换为：

```css
.topbar {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--header-bg);
  position: sticky;
  top: 0;
  z-index: 20;
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14px; color: var(--header-text); letter-spacing: -0.01em; }
.brand img { height: 40px; width: auto; }
.session { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--header-text-muted); }
```

- [ ] **Step 2: 更新 topbar HTML（第 192 行）**

将：

```html
<div class="brand">MDM Collector</div>
```

替换为：

```html
<div class="brand"><img src="/logo.png" alt="MDM">MDM Collector</div>
```

- [ ] **Step 3: 刷新浏览器验证**

打开应用，确认 topbar 深色背景、logo 图片显示、文字白色、session 区灰色。

- [ ] **Step 4: Commit**

```bash
git add mdm-collector/public/index.html
git commit -m "feat: dark topbar with logo, header color variables applied"
```

---

### Task 4: 改造 tabs 导航为深色 + 红色激活态

**Files:**
- Modify: `mdm-collector/public/index.html:78-90` (tabs CSS)

- [ ] **Step 1: 替换 tabs CSS（第 78-90 行）**

将：

```css
.tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 40px;
}
.tab {
  padding: 0 0 12px 0;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.2s;
}
.tab:hover { color: var(--text-main); }
.tab.on { color: var(--text-main); border-bottom-color: var(--accent); }
```

替换为：

```css
.tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--header-bg);
  padding: 0 24px;
  margin-bottom: 40px;
}
.tab {
  padding: 14px 0 12px 0;
  color: var(--header-text-muted);
  font-size: 14px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.2s;
}
.tab:hover { color: var(--header-text); }
.tab.on { color: var(--accent); border-bottom-color: var(--accent); }
```

- [ ] **Step 2: 刷新浏览器验证**

打开应用，确认 tabs 深色背景、非激活灰字、激活 tab 红色文字 + 红色底部指示条。

- [ ] **Step 3: Commit**

```bash
git add mdm-collector/public/index.html
git commit -m "feat: dark tabs bar with red active indicator"
```

---

### Task 5: 表格 hover 行微红 + tag.red 色值更新

**Files:**
- Modify: `mdm-collector/public/index.html:152` (table hover)
- Modify: `mdm-collector/public/index.html:162` (tag.red)

- [ ] **Step 1: 替换表格 hover 背景（第 152 行）**

将：

```css
tr:hover td { background: var(--surface); }
```

替换为：

```css
tr:hover td { background: #fefafa; }
```

- [ ] **Step 2: 替换 tag.red 色值（第 162 行）**

将：

```css
.tag.red { color: var(--error); border-color: #fecaca; background: #fef2f2; }
```

替换为：

```css
.tag.red { color: var(--error); border-color: #fecaca; background: #fef2f2; }
```

> `var(--error)` 已随 Task 2 变更为 `#b91c1c`，此处只需确认无硬编码值。若原样无变化则跳过此步。

- [ ] **Step 3: 刷新浏览器验证**

hover 表格行可见微红背景；错误标签文字为暗红 #b91c1c。

- [ ] **Step 4: Commit**

```bash
git add mdm-collector/public/index.html
git commit -m "feat: subtle red table hover + error tag color update"
```

---

### Task 6: ECharts 图表颜色更新

**Files:**
- Modify: `mdm-collector/public/index.html:606` (柱状图 color)
- Modify: `mdm-collector/public/index.html:609` (饼图 color 数组)

- [ ] **Step 1: 替换柱状图颜色（约第 606 行）**

在 `renderDashboard()` 中，将柱状图 `itemStyle`：

```javascript
itemStyle:{color:'#111827'}
```

替换为：

```javascript
itemStyle:{color:'#fc0000'}
```

- [ ] **Step 2: 替换饼图 color 数组（约第 609 行）**

将：

```javascript
color:['#111827', '#4b5563', '#9ca3af', '#d1d5db', '#e5e7eb']
```

替换为：

```javascript
color:['#fc0000', '#dc0000', '#374151', '#6b7280', '#9ca3af']
```

- [ ] **Step 3: 刷新浏览器验证**

登录后查看统计看板，确认柱状图为品牌红色、饼图为红→灰渐变。

- [ ] **Step 4: Commit**

```bash
git add mdm-collector/public/index.html
git commit -m "feat: update ECharts colors to brand red gradient"
```

---

### Task 7: 功能回归验证

**Files:**
- None (手动验证)

- [ ] **Step 1: 启动服务器**

```bash
cd mdm-collector && node server/index.js
```

- [ ] **Step 2: 逐页验证**

打开 `http://localhost:3000`，验证以下功能正常：

| 页面 | 检查点 |
|------|--------|
| 登录 | 白色卡片不变，输入框 focus 红色光晕 |
| 统计看板 | 柱状图红色、饼图红灰渐变 |
| 能力与流程申报 | 表单正常，按钮红色 |
| 报送管理 | 表格 hover 微红，primary 按钮红色 |
| 待办收到 | 标签颜色正常（绿/琥珀/暗红） |
| 评审记录 | Modal 样式不变 |
| 术语词典 | 表单正常 |
| 冲突管理 | 标签正常 |

- [ ] **Step 3: 验证移动端**

Chrome DevTools 切换 375px 宽度，确认 900px 断点正常，颜色变量仍生效。

- [ ] **Step 4: 最终 commit**

```bash
git add mdm-collector/public/index.html
git commit -m "chore: final visual regression check passed"
```
