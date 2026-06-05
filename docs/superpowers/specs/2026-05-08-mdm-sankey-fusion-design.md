# MDM桑基图融合设计

## 目标

将 `docs/temp/` 下4个桑基图HTML（D1-D4）融合进 `docs/Demo/系统集成说明H5（完整版）.html`，替换现有第13节的"业务能力-流程-系统映射图"（`mdm-map-grid`）。

## 融合位置

- **章节**：第13节 MDM建设路径
- **替换对象**：现有 `.mdm-map-grid` 容器（含 `mdm-map-hd`、`mdm-map-group`、`mdm-map-summary` 等子元素）
- **保留内容**：第13节其他内容（MDM重要性说明、组织先行、字段台账、编码规范、黄金源矩阵）全部保留

## 桑基图顺序（用户确认）

| 顺序 | ID | 标题 |
|-----|----|----|
| 1 | D4 | 工程技术部工艺与制造数据 |
| 2 | D1 | 运维安环部 & 质量管理部 |
| 3 | D3 | 物资保障 & 项目管理 & 生产执行 |
| 4 | D2 | 工装管理 |

## 桑基图数据来源

- **D1**：`docs/temp/D1 - 运维安环部&质量管理部（桑基图）.html`
- **D2**：`docs/temp/D2 - 工装管理（桑基图）.html`
- **D3**：`docs/temp/D3 - 物资保障&项目管理&生产执行（桑基图）.html`
- **D4**：`docs/temp/D4 - 工程技术部工艺与制造数据（桑基图）.html`

## 技术实现

### 依赖
- ECharts CDN：`<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>`
- 已在主文件head中引入，无需重复添加

### 容器结构

每个桑基图使用独立section：

```html
<!-- D4 工程技术部 -->
<div class="sankey-wrap" id="sankey-d4">
  <div class="sankey-title">工程技术部工艺与制造数据</div>
  <div class="sankey-sub">部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 业务流程（L3）→ 应用系统（S1）</div>
  <div id="chart-d4" style="width:100%;height:680px"></div>
</div>

<!-- D1、D3、D2 同理 -->
```

### 样式

```css
.sankey-wrap {
  background: #0f172a;
  border-radius: 12px;
  padding: 24px 20px;
  margin-bottom: 20px;
}
.sankey-title {
  text-align: center;
  font-size: 20px;
  font-weight: 700;
  color: #f8fafc;
  margin-bottom: 4px;
  letter-spacing: 2px;
}
.sankey-sub {
  text-align: center;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 16px;
}
#chart-d4, #chart-d1, #chart-d3, #chart-d2 {
  width: 100%;
  height: 680px;
}
```

### 初始化脚本

在 `</body>` 前统一初始化4个图表，每个图表配置：

```javascript
// 示例：chart-d4
const chartD4 = echarts.init(document.getElementById('chart-d4'), 'dark');
chartD4.setOption({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'item', triggerOn: 'mousemove',
    formatter: p => p.dataType === 'edge' ? `${p.data.source} → ${p.data.target}` : p.name,
    backgroundColor: '#1e293b', borderColor: '#334155', textStyle: { color: '#f1f5f9', fontSize: 12 } },
  series: [{ type: 'sankey', left: 20, right: 120, top: 20, bottom: 20,
    data: nodes, links, orient: 'horizontal', nodeWidth: 16, nodeGap: 8,
    draggable: false, layoutIterations: 64,
    label: { position: 'right', fontSize: 12, color: '#e2e8f0', fontFamily: 'PingFang SC,sans-serif' },
    lineStyle: { color: 'gradient', opacity: 0.3, curveness: 0.5 },
    emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.8 } } }]
});
window.addEventListener('resize', () => chartD4.resize());
```

## 替换步骤

1. 删除现有 `.mdm-map` 容器（第13节中包含 `mdm-map-grid` 的那个 `div`）
2. 在删除位置插入4个桑基图容器
3. 在 `</body>` 前添加4个图表的初始化脚本

## 验证要点

- 4个桑基图均正常渲染，节点和链接无缺失
- 图表随窗口resize自适应
- 主文件导航和其他章节不受影响
- 深色桑基图容器与主页面浅色主题视觉对比明显
