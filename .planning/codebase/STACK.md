# 技术栈扫描

## 总览

Infomat 当前是一个“零构建前端 + 独立 Python 工具”的轻量项目，没有前端框架、打包器或依赖清单文件。

## 前端

- **HTML**: 单文件应用，入口为 `index.html`
- **CSS**: 内联样式，负责深色主题、三列布局、节点状态和删除面板
- **JavaScript**: 原生浏览器脚本，无外部依赖
- **绘图方式**: 使用 SVG `path` + `marker` 绘制业务关系连线
- **持久化**: 使用浏览器 `localStorage` 保存当前连线与选择状态
- **文件交换**: 使用 `Blob`、下载链接、`FileReader` 完成 JSON 导入导出

## Python 工具链

- **Python**: `bizmapper.py` 为独立 CLI，面向图片分析和 Excel/JSON 转换
- **标准库**:
  - `json`
  - `base64`
  - `urllib.request` / `urllib.error`
  - `pathlib`
  - `os`
  - `sys`
- **第三方库**:
  - `pandas`
  - `openpyxl`

## Node 辅助脚本

- **Node.js**: `analyze-layout.js` 用于快速验证页面布局参数
- **用途**: 计算节点行数、画布高度和列起始位置，不参与正式运行时

## 外部服务与环境变量

- **MiniMax Vision API**
  - 默认地址: `https://api.minimaxi.com`
  - 环境变量: `MINIMAX_API_HOST`
  - 鉴权变量: `MINIMAX_API_KEY`
- `bizmapper.py` 通过 HTTP POST 直接调用 `/v1/coding_plan/vlm`

## 运行形态

- **主应用运行方式**: 直接在浏览器打开 `index.html`
- **布局分析**: `node analyze-layout.js`
- **图片转映射**: `python bizmapper.py <图片路径> [输出目录]`
- **Excel 转 JSON**: `python bizmapper.py --to-json <Excel路径> [输出目录]`

## 当前栈特征

- 无 `package.json`、无前端构建流程、无模块拆分
- 无 Python 依赖锁定文件，如 `requirements.txt`
- 运行门槛低，但环境一致性主要依赖人工约定
- 前端与 Python 共用相近数据模型，但尚未抽出共享数据源
