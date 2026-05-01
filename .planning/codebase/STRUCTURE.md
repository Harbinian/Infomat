# 结构扫描

## 仓库结构

```text
E:\CA001\Infomat
├── index.html
├── bizmapper.py
├── analyze-layout.js
├── SPEC.md
├── ROADMAP.md
├── 系统集成关系说明.md
├── docs\
│   └── superpowers\
│       ├── plans\
│       └── specs\
├── output\
│   ├── 映射表_20260429.xlsx
│   └── infomat_data_20260429.json
└── .planning\
    └── codebase\
```

## 关键文件职责

### 应用与脚本

- `index.html`
  - 主应用入口
  - 包含全部页面结构、样式和交互逻辑

- `bizmapper.py`
  - 独立 CLI 工具
  - 负责图片识别、Excel 生成、Excel 回转 JSON

- `analyze-layout.js`
  - 布局计算辅助脚本
  - 用于快速校验三列节点布局参数

### 规范与规划文档

- `SPEC.md`
  - 页面设计规范与交互目标
- `ROADMAP.md`
  - 后续功能路线与技术债记录
- `系统集成关系说明.md`
  - 业务域系统拓扑和集成语义说明

### 过程文档

- `docs/superpowers/specs/`
  - 存放设计方案，如 BizMapper 设计与数据持久化设计
- `docs/superpowers/plans/`
  - 存放实现计划

### 产出物目录

- `output/`
  - 保存 Excel 映射表和 JSON 数据样例
  - 当前目录既承载运行产物，也承担事实样本的角色

## 代码组织特征

- **前端**
  - 无目录拆分
  - 无组件化
  - 无静态资源目录
  - 所有逻辑都在一个 HTML 文件里

- **Python**
  - 单脚本实现全部流程
  - API 调用、解析、校验、Excel 样式和 CLI 入口都在同一文件

- **文档**
  - 文档相对完善
  - 设计、路线、业务背景都已沉淀
  - 文档路径和描述已统一修正

## 结构层面的维护信号

- 当前结构适合快速迭代和演示，不适合复杂功能持续增长
- `output/` 中的样例数据对理解数据结构很有帮助，但需要区分“测试样本”和“正式产出”
- 当进入多业务域、节点编辑、布局算法等阶段后，单文件结构会明显放大维护成本
