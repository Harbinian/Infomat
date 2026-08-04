# 组织数字化参与度十六维分型模型

本目录保存“组织数字化参与度十六维分型模型”的内容真源、可编辑 SVG、横屏单页 PPT 和预览材料。该模型是 PMO 分析与汇报工具，不属于组织事实真源，也不是正式 DLV 交付物。

## 文件说明

| 文件 | 作用 |
|---|---|
| `组织数字化参与度十六维分型模型.md` | 模型内容真源，保存两个维度、16种类型、成长与退化路径、成因及治理策略 |
| `组织数字化参与度十六维模型_SVG生成提示词.md` | 本次 SVG 生成提示词，保留内容和技术约束 |
| `组织数字化参与度十六维分型模型.svg` | 1600×2400 可编辑矢量信息图 |
| `组织数字化参与度十六维分型模型_横屏单页.pptx` | 16:9 横屏单页汇报版，文字、矩阵和说明区均可在 PowerPoint 中编辑 |
| `index.html` | 本地响应式预览和打印入口 |
| `README.md` | 本目录的使用、修改和验证说明 |
| `../scripts/export-organization-dynamics-png.mjs` | 使用本机 Edge 或 Chrome 导出 PNG 的无依赖脚本 |

## 模型用途

本模型用于观察企业数字化转型过程中，不同部门面对结构化、透明化和责任明确化时的行为变化，并指导项目管理办公室（PMO）采取差异化治理策略。

分类描述部门或角色在特定阶段表现出的可观察行为，不作为部门永久标签或人员绩效结论。PMO使用本模型记录组织事实、识别边界问题并提供决策依据，不替业务部门承担业务责任。

## 内容来源

`组织数字化参与度十六维分型模型.md` 是本目录的内容真源。SVG 和横屏单页 PPT 中的16种类型、核心特征、成长路径、退化路径、退化成因和治理策略均应与该文件保持一致。

标题“组织数字化参与度十六维分型模型”按既定名称保留。副标题和模型说明明确该模型由两个分析维度、每个维度四个等级交叉形成16种类型。

## 查看与打印

使用浏览器直接打开 `index.html`。预览页不加载外部资源，SVG会随窗口宽度等比例缩放。

打印时在浏览器打印对话框中选择A3或A4纵向纸张，并启用背景图形。预览页会隐藏操作栏，并将SVG缩放到可打印区域。

## 使用横屏单页 PPT

`组织数字化参与度十六维分型模型_横屏单页.pptx` 使用16:9横屏版式。左侧是4×4分型矩阵，右侧是成长路径、退化路径和分层治理策略，底部是五类退化成因。

PPT中的中文、矩阵单元和说明区域均为PowerPoint原生文本与形状，不是整页位图。修改模型内容时，先修改Markdown真源，再同步修改SVG和PPT，并重新检查单页渲染结果、文字换行、重叠和画布越界。

## 导出 PNG

从仓库根目录运行：

```powershell
node pmo/scripts/export-organization-dynamics-png.mjs
```

默认输出：

```text
artifacts/pmo/organization-dynamics/组织数字化参与度十六维分型模型.png
```

`artifacts/` 已被仓库忽略，PNG属于可重复生成的本地输出，不应提交。

可选参数：

```powershell
node pmo/scripts/export-organization-dynamics-png.mjs `
  --input "pmo/organization-dynamics/组织数字化参与度十六维分型模型.svg" `
  --output "artifacts/pmo/organization-dynamics/组织数字化参与度十六维分型模型.png" `
  --browser "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```

脚本按以下顺序选择浏览器：

1. `--browser` 参数；
2. `BROWSER_PATH`、`CHROME_PATH` 或 `EDGE_PATH` 环境变量；
3. Windows常见的 Edge 和 Chrome 安装路径；
4. `msedge`、`chrome` 或 `chromium` 命令。

脚本读取SVG画布尺寸并要求其保持为1600×2400。浏览器导出后，脚本再次读取PNG文件头并核对像素尺寸。

## 修改方法

1. 先修改 `组织数字化参与度十六维分型模型.md`。
2. 在SVG中修改对应的 `<text>` 或 `<tspan>` 内容。
3. 如调整布局，保持画布 `width="1600"`、`height="2400"` 和 `viewBox="0 0 1600 2400"` 不变。
4. 重新打开 `index.html`，检查桌面端、窄屏和打印预览。
5. 运行PNG导出脚本并核对渲染结果。

SVG的七个一级分组为：

- `title-section`
- `matrix-section`
- `growth-section`
- `degradation-section`
- `causes-section`
- `governance-section`
- `purpose-section`

16个矩阵单元使用 `cell-A1-B4` 等稳定ID。所有可见中文均使用 `<text>` 或 `<tspan>`，没有文字转路径、嵌入图片、OCR内容或 `<foreignObject>`。

## 修改后自检

- 两个维度和A1—A4、B1—B4顺序没有变化。
- 16个编号、类型名称和核心特征与Markdown真源一致。
- 成长路径和三类退化路径没有新增、删减或调整顺序。
- 所有文字完整显示，没有重叠、截断或乱码。
- SVG不包含 `<image>`、`<foreignObject>`、`<textPath>`、外部字体或外部脚本。
- PNG导出尺寸为1600×2400。
- PPT仅有一页，版式为16:9横屏，全部内容位于幻灯片画布内。
