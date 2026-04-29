# 数据持久化设计方案

## 概述

为 Infomat 单文件应用添加 localStorage 自动保存 + 文件导入/导出功能，实现数据不丢失和跨环境迁移。

## 设计目标

1. 每次连线操作（增/删）自动保存到 localStorage
2. 页面刷新后完整恢复：连线 + 当前选择状态
3. 支持手动导出 JSON 备份文件
4. 支持导入 JSON 文件追加连线（避免重复）

---

## 实现方案

### 1. 状态持久化结构

```javascript
// localStorage key: 'infomat_state'
{
  connections: [...],           // 连线数组
  selectionStep: 'cap',         // 当前步骤: 'cap' | 'proc' | 'sys'
  selectedCapName: null,        // 已选业务能力名称
  selectedProcName: null,       // 已选L3流程名称
  lastModified: timestamp       // 最后修改时间
}
```

### 2. 自动保存触发点

- `onSysClick()` — 新增连线后
- `confirmDelete()` — 删除连线后
- `clearAll()` — 清空连线后

### 3. 状态恢复流程

页面加载时（`init()` 调用）：

```javascript
function loadState() {
  const saved = localStorage.getItem('infomat_state');
  if (saved) {
    const data = JSON.parse(saved);
    state.connections = data.connections || [];
    state.selectionStep = data.selectionStep || 'cap';
    state.selectedCapName = data.selectedCapName;
    state.selectedProcName = data.selectedProcName;

    // UI恢复：还原已选节点的选中状态
    if (state.selectedCapName) {
      highlightCapNode(state.selectedCapName);
    }
    if (state.selectedProcName) {
      highlightProcNode(state.selectedProcName);
    }
  }
}
```

### 4. 文件导出

点击"导出数据"按钮：

```javascript
function exportToFile() {
  const data = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    capabilities: state.capabilities,
    systems: state.systems,
    connections: state.connections
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `infomat-backup-${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
```

文件命名格式：`infomat-backup-20260429.json`

### 5. 文件导入

点击"导入数据"按钮，触发文件选择：

```javascript
function importFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = JSON.parse(e.target.result);
    if (!data.connections) {
      alert('无效文件格式');
      return;
    }

    // 追加不重复的连线
    const existingKeys = new Set(
      state.connections.map(c => `${c.capName}|${c.procName}|${c.sysId}`)
    );

    let added = 0;
    data.connections.forEach(conn => {
      const key = `${conn.capName || conn.capability}|${conn.procName || conn.process}|${conn.sysId || conn.system}`;
      if (!existingKeys.has(key)) {
        state.connections.push({
          capName: conn.capName || conn.capability,
          procName: conn.procName || conn.process,
          sysId: conn.sysId || conn.system
        });
        added++;
      }
    });

    saveState();  // 保存合并后的状态
    render();     // 重新渲染
    alert(`成功导入 ${added} 条连线`);
  };
  reader.readAsText(file);
}
```

### 6. 去重逻辑

连线唯一性由 `capName + procName + sysId` 三元组确定，导入时跳过已存在的组合。

---

## UI 变更

### 底部栏按钮调整

```
[清空连线] [导出JSON] [导入JSON]  |  状态提示
```

- 将原有的"导出数据"改为"导出JSON"（输出到文件而非控制台）
- 新增"导入JSON"按钮

### 状态栏增强

显示最后保存时间：`已自动保存于 16:30`

---

## 代码位置

- 所有新增代码插入到 `index.html` 的 `<script>` 区块
- 新增函数：`loadState()`, `saveState()`, `exportToFile()`, `importFromFile()`
- 修改函数：`onSysClick()`, `confirmDelete()`, `clearAll()`, `init()`

---

## 测试场景

1. 新增一条连线 → 刷新页面 → 连线和状态均恢复
2. 导出 JSON → 手动删除 localStorage → 导入 JSON → 数据完整
3. 导入包含重复连线的文件 → 仅追加新连线
4. 清空连线 → 刷新 → 确认已清空

---

## 风险与边界

- **空 localStorage**：首次访问时 `loadState()` 正常返回默认状态
- **损坏的 JSON**：try-catch 包裹 parse 操作，失败时 alert 提示
- **导入外来数据**：仅接受含 `connections` 字段的 JSON，其他字段忽略