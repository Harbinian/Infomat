# 大体积参考资产迁移提案

> 日期：2026-06-11  
> 范围：仓库内已跟踪的大体积参考资料、历史输出和快照目录。  
> 边界：本提案只记录现状、风险和迁移路径；本轮不移动、不删除、不改引用。

## 1. 现状量化

| 路径 | 文件数 | 已跟踪文件数 | 大小 | 当前定位 |
|---|---:|---:|---:|---|
| `docs/U8SoftHelp/` | 250 | 250 | 203.46 MB | U8 多模块、多语言 CHM 帮助文件 |
| `docs/外部参考/` | 123 | 123 | 26.90 MB | 外部参考、流程图和整理产物 |
| `docs/training/` | 5 | 5 | 17.37 MB | PPTX 培训材料和整理稿 |
| `ai_materials/` | 91 | 91 | 10.77 MB | AI 处理输入材料和扫描索引 |
| `docs/Demo/` | 5 | 5 | 1.26 MB | 说明会演示材料和本地 ECharts |
| `docs/screenshots/` | 8 | 8 | 1.20 MB | 历史截图样例和 base64 汇总 |
| `snapshots/` | 11 | 11 | 1.03 MB | 历史 norms 快照 |
| `.superpowers/` | 52 | 52 | 0.91 MB | 历史 brainstorm 输出 |

合计：545 个已跟踪文件，约 262.90 MB。

## 2. 分流判断

| 路径 | 当前建议 | 理由 |
|---|---|---|
| `docs/U8SoftHelp/` | 优先评估迁出仓库或转 LFS | 体积最大，全部为 `.chm` 参考文件，不是当前真源 |
| `docs/外部参考/` | 先拆分“长期参考”和“整理产物”，再提迁移 | 包含 107 个 `.vsd`，可能仍是流程图参考来源 |
| `docs/training/` | 先保留索引和整理稿，PPTX 后续可外部存储 | 培训材料有参考价值，但不是执行真源 |
| `ai_materials/` | 暂保留，后续按源证据链评估 | 可能是 DCM/BBM 源证据输入，迁移前需确认引用 |
| `docs/Demo/` | 暂保留 | 已有离线演示页，本目录 `echarts.min.js` 是否可去重需另行验证 |
| `docs/screenshots/` | 评估压缩或精选保留 | 截图只能作历史视觉参考，base64 汇总可读性低 |
| `snapshots/` | 暂保留为历史快照 | 体积较小，已补 README，后续可压缩旧快照 |
| `.superpowers/` | 先写专项迁移提案再处理 | 已跟踪历史 brainstorm 输出，不能直接按本地生成物删除 |

## 3. 迁移路径

### 阶段 A：只读确认

1. 对候选目录运行引用扫描，确认是否被脚本、页面或 README 直接读取。
2. 对每个目录确认主责：参考资料、源证据、历史归档、样例或生成物。
3. 对大体积二进制文件确认是否需要版本追溯。

### 阶段 B：提案拆分

| 候选 | 目标路径或策略 | 验证 |
|---|---|---|
| `docs/U8SoftHelp/*.chm` | 外部存储或 Git LFS，仓库保留索引 README | 搜索引用；确认 U8 资料仍可按模块定位 |
| `docs/外部参考/_整理产物/` | 若是生成整理结果，迁入归档或外部存储 | 保留来源说明和复现方法 |
| `docs/training/*.pptx` | 外部存储，仓库保留 Markdown 摘要 | 培训 README 链接或索引可用 |
| `docs/screenshots/screenshots-base64.json` | 若无脚本引用，改为报告引用或归档 | 页面/脚本引用扫描为 0 |
| `.superpowers/brainstorm/*/state/` | 若确认无追溯价值，后续取消跟踪 | 保留必要设计摘要到 `docs/reports/` 或 `docs/superpowers/` |

### 阶段 C：实际迁移

实际迁移必须单独提交，且至少验证：

```powershell
npm run test:process-governance-mainline
```

如迁移影响 PMO、MDM 或 norms 页面，还需按对应目录 README 补充验证命令。

## 4. 本次未做

- 未移动任何大体积目录。
- 未删除任何 `.chm`、`.pptx`、`.vsd`、截图或历史快照。
- 未修改脚本、页面或真源引用。
- 未启用 Git LFS。

## 5. 下一步建议

优先顺序：

1. 对 `docs/U8SoftHelp/` 写专项外部化方案。
2. 对 `.superpowers/` 写历史输出迁移方案。
3. 对 `docs/screenshots/screenshots-base64.json` 做引用扫描和去留判断。
4. 对 `docs/外部参考/` 建立来源索引，区分原始参考和整理产物。
