# 数字化底座项目 PMO 管控看板

基于 React + Vite 的交付物驱动项目管控看板，从甘特图升级为 PMO 周会可用工具。

## 快速开始

```bash
npm install
npm run dev
npm run build
npm run preview
```

开发模式默认访问 `http://localhost:5173`。

## 数据来源

`public/tasks.json` 由 `pmo/信息化项目_Project_H5可用.xlsx` 通过 `pmo/convert_xlsx.py` 转换生成。页面实际读取 `public/tasks.json`，同时保留 `pmo/tasks.json` 作为 PMO 根目录备份。

### 替换新任务数据

1. 修改 `pmo/信息化项目_Project_H5可用.xlsx`。
2. 在 `pmo/` 下运行 `python convert_xlsx.py`。
3. 脚本同时写入 `pmo/tasks.json` 和 `pmo/gantt-react/public/tasks.json`。
4. 刷新浏览器。

## 交付物状态维护

通过 `public/deliverable-status.json` 覆盖交付物状态：

```json
[
  {
    "deliverableId": "DLV-001",
    "status": "待评审",
    "actualSubmitDate": "2026-06-20",
    "actualPassDate": "",
    "ownerNote": "已提交初稿，等待 PMO 评审"
  }
]
```

如果不维护该文件，交付物状态默认为 `未提交`。

## 功能视图

| 视图 | 说明 |
|------|------|
| 全部任务 | 甘特图 + 任务树 |
| 交付物台账 | 所有交付物表格，支持等级/类型/部门/月份/状态筛选 |
| 阶段门 | 8个阶段门卡片，区分已满足/疑似匹配/缺失 |
| 本周交付物 | 基于 PMO 观察日期的本周到期交付物 |
| 延期交付物 | 已延期交付物和分级建议动作 |
| PMO周会 | 本周A/B、延期A/B、阶段门缺失、高风险任务四块视图 |

## 阶段门规则

阶段门使用三层匹配：

1. 精确关键词包含，计入已满足。
2. 同 WBS 主线疑似匹配，计入疑似。
3. 别名表疑似匹配，计入疑似。

阶段门风险会随 PMO 观察日期变化重新计算。
