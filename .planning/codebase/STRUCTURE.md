# 结构扫描

> 状态：历史扫描快照，不是当前仓库架构入口
> 适用范围：仅用于追溯早期 `index.html` / `bizmapper.py` 轻量工具形态
> 当前口径：如与 `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md` 或 `MAINLINE_MAP.md` 冲突，以根目录执行规则为准

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
  - 历史扫描时的仓库入口描述；当前以根目录三份边界文件为准
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
