# 结构扫描

## 仓库结构

```text
E:\CA001\Infomat
├── CONTEXT.md
├── README.md
├── .gitignore
├── apps\
│   └── mdm-platform\
├── docs\
│   ├── samples\
│   ├── superpowers\
│   └── norms\
├── scripts\
│   └── analyze-layout.js
└── .planning\
    └── codebase\
```

## 关键文件职责

### 应用与脚本

- `apps/`
  - 可运行应用目录
  - 目前包含 `apps/mdm-platform/`，后续待业务部门完成流程地图/数据地图梳理后再进入开发迭代

- `scripts/analyze-layout.js`
  - 布局计算辅助脚本
  - 不属于主业务链路

### 规范与规划文档

- `CONTEXT.md`
  - 域语言与仓库规范术语
- `README.md`
  - 仓库入口与目录职责（唯一真源）
- `docs/adr/`
  - 结构与规范的架构决策记录（ADR）

### 过程文档

- `docs/superpowers/specs/`
  - 存放历史设计方案
- `docs/superpowers/plans/`
  - 存放历史实现计划

## 代码组织特征

- **文档**
  - 文档相对完善
  - 设计、路线、业务背景都已沉淀
  - 需要通过 `README.md`/`CONTEXT.md` 固化目录职责与命名规则

## 结构层面的维护信号

- 生成物必须与源码隔离，避免索引噪音与误提交风险
- 样例必须收敛到 `docs/samples/`，并保持可脱敏、可再分发
