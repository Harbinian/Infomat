# 重复资产迁移提案

> 日期：2026-06-10  
> 范围：`echarts.min.js` 多副本、PMO `tasks.json` 双副本。  
> 边界：本提案只记录事实、引用关系和后续迁移路径；本轮不移动、不删除、不改引用。

## 1. 结论

| 资产 | 事实 | 当前建议 |
|---|---|---|
| `echarts.min.js` | 5 份文件 MD5 完全一致 | 不做一刀切合并；按静态页面约定至少保留根目录、`docs/norms/`、MDM 前端三份。 |
| `pmo/echarts.min.js` | 与根目录同 hash，当前未发现页面引用 | 作为后续低风险删除候选；删除前再跑引用扫描和 PMO 页面校验。 |
| `docs/Demo/echarts.min.js` | 与根目录同 hash，被 Demo HTML 本地引用 | 若 Demo 仍要求离线自包含，保留；若 Demo 可依赖上级资产，再改引用后删除。 |
| `pmo/tasks.json` 与 `pmo/gantt-react/public/tasks.json` | 两份文件 MD5 完全一致，大小和时间一致 | 暂不删除；当前 `convert_xlsx.py` 和文档明确双写，React 应用实际读取 `public/tasks.json`。 |

## 2. `echarts.min.js` 现状

MD5 均为 `38588D6B8C7C30B9941C28C01B389B88`：

| 路径 | 当前引用 / 规则 | 处理建议 |
|---|---|---|
| `echarts.min.js` | PMO 流程驾驶舱 `pmo/procedure-management/dashboard.html` 引用 `../../echarts.min.js`；`docs/contracts/dcm-bbm-contract.json` 也要求根目录资产存在 | 保留。 |
| `docs/norms/echarts.min.js` | `docs/norms/` 下部门桑基图页面按规则引用同目录 `echarts.min.js` | 保留。 |
| `apps/mdm-platform/public/echarts.min.js` | MDM 前端 `public/index.html` 引用本目录 `echarts.min.js`，前端资产测试也检查它 | 保留。 |
| `docs/Demo/echarts.min.js` | `docs/Demo/信息化系统应用与集成说明会V1.0.html` 引用同目录 `echarts.min.js` | 暂保留；后续由 Demo 是否需要离线自包含决定。 |
| `pmo/echarts.min.js` | 当前引用扫描未发现真实页面引用；PMO 文档也指向根目录 `../../echarts.min.js` | 后续可删除候选。 |

当前不能按“重复文件”直接合并的原因：

1. `AGENTS.md` 明确规定 `docs/norms/` 部门桑基图页面必须引用本目录内 `echarts.min.js`。
2. `apps/mdm-platform/public/` 是可运行应用前端静态目录，应保持应用自足。
3. PMO 流程驾驶舱已经按项目根静态资产引用，不能改成 `pmo/echarts.min.js`。
4. Demo 目录是否需要离线单目录打开尚未确认。

## 3. PMO `tasks.json` 现状

MD5 均为 `3A1E7C4AB8352E1A72439CA463C63C4F`：

| 路径 | 当前口径 |
|---|---|
| `pmo/tasks.json` | PMO 根目录备份数据，由 `pmo/convert_xlsx.py` 生成。 |
| `pmo/gantt-react/public/tasks.json` | React 甘特图 / PMO 看板实际读取的数据，由同一脚本生成。 |

现有链路：

```text
pmo/信息化项目_计划管控真源.md
pmo/信息化项目_WBS结构真源.md
  ↓
pmo/convert_xlsx.py
  ↓
pmo/tasks.json
pmo/gantt-react/public/tasks.json
```

当前不建议直接删除任一份：

1. `MAINLINE_MAP.md`、`pmo/README.md`、`pmo/gantt-react/README.md` 都记录了双写口径。
2. React 应用代码读取 `public/tasks.json`。
3. `pmo/tasks.json` 仍被部分脚本或历史检查当作根目录备份入口。

## 4. 迁移路径

| 阶段 | 动作 | 验证 |
|---|---|---|
| P1 | 删除候选预检：再次扫描 `pmo/echarts.min.js` 引用；若仍为 0，删除该文件并更新文档中任何误导性描述 | `rg "pmo/echarts.min.js|src=\"echarts.min.js\"" pmo`、打开 PMO 驾驶舱或运行现有 dashboard 检查 |
| P1 | 保持根目录、`docs/norms/`、MDM 前端三份 `echarts.min.js` | `node scripts/check-dcm-bbm.mjs --no-fail`、`cd apps/mdm-platform && npm run test:frontend` |
| P2 | 判断 `docs/Demo/` 是否仍要求离线自包含；若不要求，改 Demo HTML 引用 `../echarts.min.js` 后删除 Demo 副本 | 直接打开 Demo HTML 或用浏览器 smoke 检查图表加载 |
| P2 | 为 PMO 任务数据增加一致性检查：确认 `pmo/tasks.json` 与 `pmo/gantt-react/public/tasks.json` 同源同 hash | 已新增 `npm run test:pmo-task-data` |
| P3 | 若要减少 PMO 双副本，先改 `convert_xlsx.py` 与文档，把其中一份定义为生成缓存或构建时复制文件 | `python pmo/convert_xlsx.py`、PMO React 应用读取检查、根目录主线合约 |

## 5. 本次未做

- 未删除任何 `echarts.min.js`。
- 未删除或移动任何 `tasks.json`。
- 未修改 PMO、MDM、Demo 或 norms 页面引用。
- 未运行 `pmo/convert_xlsx.py`。
