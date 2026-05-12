# MDM Collector 布局空间优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 4 项 CSS 变更缓解 1200px 容器、split 比例失衡、图表过矮等空间浪费问题。

**Architecture:** 纯 CSS 变更，修改 `mdm-collector/public/index.html` 内联 `<style>` 块。不动 DOM 结构、JS 逻辑、后端。

**Tech Stack:** 原生 CSS

---

### Task 1: 应用 4 项 CSS 变更

**Files:**
- Modify: `mdm-collector/public/index.html` (内联 `<style>` 块)

- [ ] **Step 1: 修改容器内边距**

找到 `.page-container` 规则（第 55-58 行），将 padding 从 `40px 24px 80px` 改为 `32px 32px 80px`：

```css
.page-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 32px 80px;
}
```

- [ ] **Step 2: 修改 split 左右比例**

找到 `.split` 规则（第 105 行），将 `grid-template-columns` 从 `320px 1fr` 改为 `minmax(360px, 30%) minmax(0, 1fr)`：

```css
.split { display: grid; grid-template-columns: minmax(360px, 30%) minmax(0, 1fr); gap: 64px; }
```

- [ ] **Step 3: 修改图表高度**

找到 `.chart` 规则（第 172 行），将 height 从 `300px` 改为 `450px`：

```css
.chart { height: 450px; width: 100%; margin-top: 24px; }
```

- [ ] **Step 4: 删除无效断点**

找到并删除 `@media (max-width: 900px)` 规则（第 106 行）：

```css
@media (max-width: 900px) { .split, .g2, .g4 { grid-template-columns: 1fr; gap: 32px; } }
```

- [ ] **Step 5: 验证 — 启动服务并检查页面**

```bash
cd mdm-collector
npm start
```

打开 http://localhost:3000，登录后遍历各 Tab 确认布局正常：
- Dashboard：图表 450px，4 指标卡正常，无横向溢出
- 能力与流程申报：左栏 > 320px，表单不挤
- 报送管理：Split 比例正常
- 术语词典：Split 比例正常
- 所有 Tab：21:9 超宽屏下内容居中

- [ ] **Step 6: 提交**

```bash
git add mdm-collector/public/index.html
git commit -m "feat: optimize page layout — wider split, taller charts, tighter padding"
```
