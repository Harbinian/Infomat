# 架构扫描

## 系统形态

仓库当前由三个职责明确但耦合较松的部分组成：

1. **交互式可视化前端**
   - `index.html`
   - 提供业务能力、L3 流程、应用系统三列建图界面
   - 负责关系创建、删除、导入导出和本地持久化

2. **离线数据提取工具**
   - `bizmapper.py`
   - 将业务图图片转换为 Excel，再将审核后的 Excel 转换为前端可消费 JSON

3. **布局诊断脚本**
   - `analyze-layout.js`
   - 用于验证静态布局参数，不属于主业务链路

## 逻辑分层

### 1. 展示层

由 `index.html` 中的 HTML 和 CSS 组成：

- 顶部工具栏
- 操作说明栏
- 中央滚动画布
- 底部操作栏
- 删除确认面板

### 2. 前端状态层

`index.html` 中单一 `state` 对象承担所有前端状态：

- 基础主数据：`capabilities`、`processes`、`systems`
- 关系数据：`connections`
- 交互状态：`selectionStep`、`selectedCapName`、`selectedProcName`
- UI 状态：`selectedConnIdx`、`lastSaved`
- 布局参数：`colX`、节点尺寸等

这是一个典型的“单状态对象 + 过程式函数”架构。

### 3. 前端行为层

页面行为围绕几类函数展开：

- **初始化与恢复**: `init()`、`loadState()`、`saveState()`
- **渲染**: `render()`、`renderConnections()`
- **交互**: `onCapClick()`、`onProcClick()`、`onSysClick()`
- **删除流程**: `selectConnection()`、`confirmDelete()`、`cancelDelete()`
- **文件交换**: `exportToFile()`、`importFromFile()`

### 4. 数据处理层

`bizmapper.py` 形成一条顺序式处理流水线：

1. 读取图片
2. 调用 MiniMax API
3. 解析返回 JSON
4. 校验结构完整性
5. 生成 Excel
6. 读取 Excel
7. 输出 Infomat JSON

## 架构优点

- 部署极简，适合快速展示和讨论业务关系
- 数据结构直观，前后处理链条容易理解
- 前端与离线工具边界清楚，便于独立演进

## 当前架构约束

- **单文件前端**: 展示、样式、状态、行为全部耦合在 `index.html`
- **数据源重复**: 前端初始数据与离线工具输出结构一致，但没有统一主数据文件
- **布局实现与文档存在漂移**:
  - `SPEC.md` 仍写固定列坐标与固定行高
  - 当前 `index.html` 实际使用的是按可视高度动态分配行高
- **无自动化验证**: 没有测试来保护导入导出、布局和 JSON 契约

## 适合的演进方向

- 抽离共享数据模型或样例 JSON
- 将前端脚本从 `index.html` 中模块化拆分
- 为 Python 工具补充依赖清单和示例输入
- 为前后 JSON 结构建立最基本的契约测试
