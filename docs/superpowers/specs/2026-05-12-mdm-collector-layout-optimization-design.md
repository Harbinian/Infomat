# MDM Collector 页面布局空间优化设计

**日期**: 2026-05-12
**来源**: 视觉审计 + 问题澄清访谈
**范围**: 仅 CSS 变更，不动 DOM / JS

---

## 一、问题诊断

当前 `.page-container` 固定 `max-width: 1200px`，在 1920px 标准桌面屏上内容区仅占 62.5%，两侧各 360px 空白。Split 布局左栏固定 320px 与右侧表格比例失衡。Dashboard 图表 300px 高度，在 1080px 视口下图表区仅占 28%，垂直空间大量闲置。

## 二、变更清单

### 1. 容器宽度

保持 `max-width: 1200px`。移除无意义的 `@media (max-width: 900px)` 下对各布局的强制单列回退（此断点过低，21:9+ 超宽屏自然居中即可）。不引入新断点。

**变更**：无需改 CSS 值，仅确认当前居中行为覆盖超宽屏场景。

### 2. Split 左右比例

当前 `.split` 使用 `grid-template-columns: 320px 1fr`，三个 Tab 使用此布局：能力与流程申报、报送管理、术语词典。

**变更**：

```css
.split {
  grid-template-columns: minmax(360px, 30%) minmax(0, 1fr);
}
```

1200px 容器下左栏 ~360px，放大窗口至 1600px 时左栏最大 480px。表单获得合理空间，表格侧不过度拉伸。

### 3. Dashboard 图表高度

**变更**：

```css
.chart { height: 450px; }
```

两个 ECharts 实例并排，图表视觉面积从视口 28% 提升至 42%。

### 4. 容器内边距

**变更**：

```css
.page-container {
  padding: 32px 32px 80px;
}
```

顶部 40→32px 减少不必要留白，水平 24→32px 配合更宽的内部空间。

### 5. (附带) 移除无用断点

```css
/* 删除 */
@media (max-width: 900px) { .split, .g2, .g4 { grid-template-columns: 1fr; } }
```

此断点在最小目标分辨率 (1366px) 下不会触发，属于无效规则。移动端适配不在本次范围。

## 三、不变更范围

- Dashboard 4 指标卡片布局 (`.g4` 四列) — 保持
- 表格列宽策略 — 保持自动分配
- 表单间距 (`.form-group { margin-bottom: 20px }`) — 保持
- 字体大小、颜色、圆角、动画 — 均不涉及

## 四、文件影响

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `mdm-collector/public/index.html` | 修改内联 `<style>` | 仅改 CSS 值，不碰 HTML 结构和 JS |
