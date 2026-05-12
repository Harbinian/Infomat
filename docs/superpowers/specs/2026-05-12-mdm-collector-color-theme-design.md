# MDM Collector 前端配色方案设计

**日期**: 2026-05-12  
**来源**: 从 `mdm-collector/logo.png` 提取配色（红 #fc0000 47.7% + 黑 #000000 32.9%），重构前端 CSS 变量以建立品牌一致性。

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 整体模式 | **混合模式** — 深色头部 + 浅色内容区 | 兼顾品牌识别（深头）与可读性（表格/表单白底） |
| 错误色 | **暗红 #b91c1c** | 保留"红色=错误"直觉，但与品牌亮红有足够亮度差 |
| 顶栏黑度 | **蓝调深灰 #1a1a2e** | 比纯黑温和，适合大面积使用 |
| Tabs 区域 | **统一深色头部区** | topbar + tabs 形成完整深色命令区 |
| 红色范围 | **品牌强化** — tab 激活文字、链接、hover 行微红 | 品牌一致性优先 |

## CSS 变量映射

### 修改的变量

```
:root {
  --bg:              #ffffff          // 不变
  --surface:         #f3f4f6          // #f9fafb → 微深
  --border:          #e0e0e0          // #e5e7eb → 微调
  --text-main:       #1f2937          // #111827 → 避免"两种黑"
  --text-muted:      #6b7280          // 不变
  --accent:          #fc0000          // #111827 → 品牌红
  --accent-hover:    #dc0000          // #374151 → 红 hover
  --focus-ring:      rgba(252,0,0,0.15) // 红色光晕
  --error:           #b91c1c          // #dc2626 → 暗红
  --success:         #059669          // 不变
  --warning:         #d97706          // 不变

  /* 新增 — 深色头部的颜色变量 */
  --header-bg:       #1a1a2e
  --header-text:     #ffffff
  --header-text-muted: #9ca3af
}
```

### 标签颜色微调

伴随 error 色变更，tag.red 的 border/background 同步调整：

```
.tag.red {
  color: #b91c1c;
  border-color: #fca5a5;
  background: #fef2f2;
}
```

## 组件级改动

### Topbar
- 背景改为 `var(--header-bg)`
- 左侧新增 logo 图片：将 `mdm-collector/logo.png` 复制到 `mdm-collector/public/logo.png`，HTML 中引用 `/logo.png`，约 40px 高
- session 信息用 `--header-text-muted`

### Tabs 导航
- 背景同 `--header-bg`
- 非激活 tab：`--header-text-muted`
- 激活 tab：文字 **#fc0000**，底部指示条 **#fc0000**

### Buttons
- `.btn.primary`: 背景 #fc0000 白字，hover #dc0000
- secondary / danger / success：不变

### Tables
- `tr:hover td` 背景改为微红 `#fefafa`

### Input focus
- border-color 变红，box-shadow 红色光晕

### ECharts
- 柱状图 itemStyle.color: `#111827` → `#fc0000`
- 饼图 color 数组: `['#111827','#4b5563','#9ca3af','#d1d5db','#e5e7eb']` → `['#fc0000','#dc0000','#374151','#6b7280','#9ca3af']`

### Tags（状态标签）
- 绿/琥珀/红标签保持各自独立色系，与品牌红无关

## 不改动的部分

- 登录页布局和表单
- Modal 遮罩和卡片
- Empty 状态占位
- 动画 keyframes
- 表格、表单结构
- 所有 JavaScript 逻辑
- 后端 server/ 代码
- 数据库

## 涉及文件

仅 `mdm-collector/public/index.html`（单文件应用）。

## 移动端

900px 断点仅改变 grid 列数，颜色变量自动生效，无需额外处理。
