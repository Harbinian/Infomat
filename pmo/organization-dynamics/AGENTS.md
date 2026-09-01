# AGENTS.md — 组织数字化参与度模型

根目录 `AGENTS.md`、`CODEX.md`、`pmo/AGENTS.md` 和仓库边界文件继续有效。本文件规定 `pmo/organization-dynamics/` 的本地维护边界。

## 目录责任

- `组织数字化参与度十六维分型模型.md` 是模型内容真源。
- SVG、HTML 和 PPTX 是面向展示和汇报的受控资产，内容变化时应与 Markdown 真源保持一致。
- PNG 是本地派生预览，固定输出到被忽略的 `artifacts/pmo/organization-dynamics/`，不得提交为正本。

## 修改规则

1. 模型只用于 PMO 观察和治理沟通，不替代 `docs/organization/` 的组织事实、PMO 计划真源或 DLV 交付物。
2. 不根据模型类型评价具体部门、人员或应用系统，不把观察判断写成已确认事实、绩效结论或责任认定。
3. 修改模型含义、类型名称、维度、路径或治理建议时，先改 Markdown 真源，再同步 SVG、HTML、PPTX 和 README。
4. 修改 SVG、HTML 或导出脚本后，检查文字可读性、元素碰撞、溢出、箭头关系和 16:9 汇报版实际呈现。
5. 不在本目录保存浏览器缓存、调试日志、批量截图或一次性预览。

## 固定验证

需要 PNG 预览时，从仓库根目录运行：

```powershell
node pmo/scripts/export-organization-dynamics-png.mjs
```

导出结果只用于本地视觉核对。若本次不修改可视资产，不应为验证重新生成 PNG、SVG 或 PPTX。
