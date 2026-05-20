# MDM 平台 H5 使用说明 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MDM平台使用说明.md 转为带截图的单文件 H5 使用说明页

**Architecture:** 单 HTML 文件（`docs/MDM平台使用说明.html`），左侧 240px 固定侧栏 + 右侧正文区，Base64 内嵌 6 张截图，IntersectionObserver 高亮导航，移动端汉堡菜单折叠侧栏

**Tech Stack:** 纯 HTML/CSS/JS，无框架，无构建

---

### Task 1: 截取 MDM 平台 6 张截图

**Files:**
- Create: `docs/screenshots/login.png`
- Create: `docs/screenshots/dashboard.png`
- Create: `docs/screenshots/masterdata.png`
- Create: `docs/screenshots/approval.png`
- Create: `docs/screenshots/quality.png`
- Create: `docs/screenshots/bizmap.png`

- [ ] **Step 1: 确保 MDM 服务运行并打开浏览器**

```bash
npx --no-install playwright-cli open http://localhost:3000
```

- [ ] **Step 2: 登录 admin 账号**

先 snapshot 确认登录表单引用：
```bash
npx --no-install playwright-cli snapshot
```

填工号和密码：
```bash
npx --no-install playwright-cli fill <工号ref> "ADMIN001"
npx --no-install playwright-cli fill <密码ref> "demo12345678"
npx --no-install playwright-cli click <登录按钮ref>
```

- [ ] **Step 3: 截登录页（已登录状态，先登出再截登录表单）**

点击退出后截登录表单：
```bash
npx --no-install playwright-cli click <退出按钮ref>
npx --no-install playwright-cli screenshot --filename=docs/screenshots/login.png
```

- [ ] **Step 4: 截统计看板**

重新登录，确认已在 `#dashboard`：
```bash
npx --no-install playwright-cli screenshot --filename=docs/screenshots/dashboard.png
```

- [ ] **Step 5: 截主数据台账**

```bash
npx --no-install playwright-cli click <主数据台账按钮ref>
npx --no-install playwright-cli screenshot --filename=docs/screenshots/masterdata.png
```

- [ ] **Step 6: 截主数据审批**

```bash
npx --no-install playwright-cli click <主数据审批按钮ref>
npx --no-install playwright-cli screenshot --filename=docs/screenshots/approval.png
```

- [ ] **Step 7: 截数据质量**

```bash
npx --no-install playwright-cli click <数据质量按钮ref>
npx --no-install playwright-cli screenshot --filename=docs/screenshots/quality.png
```

- [ ] **Step 8: 截业务地图**

```bash
npx --no-install playwright-cli click <业务地图按钮ref>
npx --no-install playwright-cli screenshot --filename=docs/screenshots/bizmap.png
```

- [ ] **Step 9: 关闭浏览器**

```bash
npx --no-install playwright-cli close
```

---

### Task 2: 生成 Base64 编码的截图数据

**Files:**
- Modify: `docs/MDM平台使用说明.html`（在 HTML 中内嵌 Base64 数据）

- [ ] **Step 1: 将所有 PNG 转为 Base64 字符串并写入临时 JSON**

```bash
cd E:/CA001/Infomat/docs/screenshots && node -e "
const fs = require('fs');
const imgs = {};
for (const f of ['login','dashboard','masterdata','approval','quality','bizmap']) {
  const buf = fs.readFileSync(f + '.png');
  imgs[f] = 'data:image/png;base64,' + buf.toString('base64');
}
fs.writeFileSync('screenshots-base64.json', JSON.stringify(imgs));
console.log('Base64 map written, total size:', JSON.stringify(imgs).length, 'chars');
"
```

---

### Task 3: 创建 H5 HTML 文件 — 骨架与样式

**Files:**
- Create: `docs/MDM平台使用说明.html`

- [ ] **Step 1: 写入 HTML 骨架 + CSS + 侧栏 HTML 结构**

文件内容包含完整的 `<style>` 块和侧栏 `<nav>` + 主内容 `<main>` 结构。

样式要点：
- CSS 变量定义配色（`--navy: #0f2a5e`, `--blue: #1a56db`, `--bg: #f8fafc`, `--text: #1e293b`）
- `body` 为 flex 布局，左侧 `nav.sidebar` 固定 240px，右侧 `main` 填充剩余
- 侧栏 `position: fixed; top: 0; left: 0; height: 100vh; width: 240px`
- 内容区 `margin-left: 240px; max-width: 900px; padding: 40px 48px`
- 章节标题用深蓝色，左侧加蓝色竖条装饰
- 截图容器：`border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.08); overflow: hidden`
- 用户表格和权限矩阵使用标准 `<table>` + 斑马纹
- 代码块用 `background: #1e293b; color: #e2e8f0` 深色终端风格
- 移动端 `@media (max-width: 768px)` 侧栏隐藏，顶部显示汉堡按钮

HTML 结构：
```html
<nav class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <div class="sidebar-logo">MDM</div>
    <div class="sidebar-title">MDM 平台使用说明</div>
  </div>
  <ul class="sidebar-nav" id="sidebarNav">
    <li><a href="#cover" class="nav-item active">概览</a></li>
    <li><a href="#login" class="nav-item">登录与账号</a></li>
    <li><a href="#dashboard" class="nav-item">统计看板</a></li>
    <li><a href="#masterdata" class="nav-item">主数据台账</a></li>
    <li><a href="#approval" class="nav-item">主数据审批</a></li>
    <li><a href="#quality" class="nav-item">数据质量</a></li>
    <li><a href="#bizmap" class="nav-item">业务地图</a></li>
    <li><a href="#commands" class="nav-item">常用命令</a></li>
  </ul>
  <div class="sidebar-footer">v1.0 · 2026-05-18</div>
</nav>
<button class="menu-toggle" id="menuToggle">☰</button>
<main class="content" id="content">
  <!-- 各节内容 -->
</main>
```

- [ ] **Step 2: 在浏览器中打开验证骨架**

```bash
start E:/CA001/Infomat/docs/MDM平台使用说明.html
```

确认侧栏固定、内容区可滚动、配色正确。

---

### Task 4: 填充章节内容 — 封面 + 登录 + 统计看板 + 业务地图

**Files:**
- Modify: `docs/MDM平台使用说明.html`

- [ ] **Step 1: 写入封面区 `#cover`**

在 `<main>` 中添加：
```html
<section id="cover" class="sec cover-sec">
  <div class="cover-badge">使用说明</div>
  <h1>MDM 平台</h1>
  <p class="cover-sub">航空复材制造 · 主数据管理与业务关系映射</p>
  <div class="cover-meta">
    <span>版本 1.0</span>
    <span>2026-05-18</span>
    <span>昌兴复材</span>
  </div>
</section>
```

封面样式：深蓝渐变背景（`linear-gradient(135deg, #0f2a5e 0%, #1a56db 100%)`），白字，居中对齐，`border-radius: 12px`。

- [ ] **Step 2: 写入登录与账号 `#login`**

内容包含：登录步骤说明、预设账号表格、角色权限矩阵表格。引用 Base64 截图 `login`。

账号表：
```html
<table>
  <thead><tr><th>工号</th><th>姓名</th><th>岗位</th><th>角色</th></tr></thead>
  <tbody>
    <tr><td>ADMIN001</td><td>系统管理员</td><td>系统管理员</td><td>admin</td></tr>
    <tr><td>EMP0001</td><td>张工</td><td>主任工程师</td><td>owner</td></tr>
    <!-- ...共 10 行 -->
  </tbody>
</table>
```

权限矩阵为 4 行 × 11 列表格，用 `✓` / `—` 标记。

- [ ] **Step 3: 写入统计看板 `#dashboard`**

说明 4 个概览指标（流程映射、字段台账、待处理待办、未解决冲突）和 2 张图表（部门流程数柱状图、审批状态饼图）。嵌入截图 `dashboard`。

- [ ] **Step 4: 写入业务地图 `#bizmap`**

说明桑基图展示部门→能力→流程→系统的映射关系，支持交互筛选。嵌入截图 `bizmap`。

- [ ] **Step 5: 浏览器验证已填充的部分**

---

### Task 5: 填充章节内容 — 主数据台账 + 审批 + 质量 + 命令

**Files:**
- Modify: `docs/MDM平台使用说明.html`

- [ ] **Step 1: 写入主数据台账 `#masterdata`**

说明筛选条件（分类/状态/搜索）、操作按钮（新增条目、Excel 导入）、自动编码引擎、去重合并。嵌入截图 `masterdata`。

- [ ] **Step 2: 写入主数据审批 `#approval`**

说明变更审批列表字段、7 状态生命周期（新增→审核中→生效→变更中→停用→归档）、多级会签。附状态流转 ASCII 图示。嵌入截图 `approval`。

状态流转：
```html
<pre>新增 → 审核中 → 生效 → 变更中 → 停用 → 归档
         ↑         ↓
         └── 审核驳回</pre>
```

- [ ] **Step 3: 写入数据质量 `#quality`**

说明四大 KPI（完整率/唯一率/及时率/一致率）和黄金源确认进度条。嵌入截图 `quality`。

- [ ] **Step 4: 写入常用命令 `#commands`**

```html
<pre><code>cd mdm-platform
npm start              # 启动服务 (端口 3000)
npm run dev            # 开发模式
npm run init-db        # 重建数据库
npm run smoke          # 冒烟测试
node scripts/smoke-master-data.js   # 主数据测试
node scripts/smoke-integration.js   # 集成测试</code></pre>
```

- [ ] **Step 5: 浏览器验证完整页面**

---

### Task 6: 添加交互脚本 — 导航高亮与移动端菜单

**Files:**
- Modify: `docs/MDM平台使用说明.html`

- [ ] **Step 1: 写入 IntersectionObserver 导航高亮脚本**

在 `</body>` 前添加：
```html
<script>
(function() {
  const sections = document.querySelectorAll('section[id]');
  const navItems = document.querySelectorAll('.nav-item');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navItems.forEach(item => {
          item.classList.toggle('active', item.getAttribute('href') === '#' + entry.target.id);
        });
      }
    });
  }, { rootMargin: '-20% 0px -60% 0px' });
  sections.forEach(s => observer.observe(s));
})();
</script>
```

- [ ] **Step 2: 写入移动端汉堡菜单切换脚本**

```html
<script>
(function() {
  const toggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  // 点击侧栏内链接后自动折叠
  sidebar.querySelectorAll('.nav-item').forEach(a => {
    a.addEventListener('click', () => sidebar.classList.remove('open'));
  });
})();
</script>
```

对应的移动端 CSS：
```css
@media (max-width: 768px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    z-index: 100;
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .content {
    margin-left: 0;
    padding: 20px 16px;
  }
  .menu-toggle {
    display: flex;
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 110;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--card);
    align-items: center;
    justify-content: center;
    font-size: 20px;
    cursor: pointer;
  }
}
@media (min-width: 769px) {
  .menu-toggle { display: none; }
}
```

- [ ] **Step 3: 浏览器验证交互**

缩窄浏览器窗口到 375px 宽度，确认汉堡菜单出现且可正常展开/收起。点击导航项后菜单自动关闭，页面滚动到目标节。

---

### Task 7: 最终验证

- [ ] **Step 1: 桌面端检查清单**
  - [ ] 侧栏固定在左侧，不随滚动
  - [ ] 滚动正文时当前节导航自动高亮
  - [ ] 点击导航项平滑跳转到对应节
  - [ ] 6 张截图均正常显示
  - [ ] 表格在宽屏下正常
  - [ ] 代码块深色终端风格

- [ ] **Step 2: 移动端检查清单**
  - [ ] 768px 以下侧栏隐藏，汉堡按钮出现
  - [ ] 点击汉堡按钮展开侧栏，有半透明遮罩
  - [ ] 侧栏展开后点链接自动关闭
  - [ ] 截图宽度自适应，不溢出

- [ ] **Step 3: 内容核对**
  - [ ] 所有工号/密码信息正确
  - [ ] 权限矩阵角色与 Tab 对应正确
  - [ ] 命令可直接复制使用
