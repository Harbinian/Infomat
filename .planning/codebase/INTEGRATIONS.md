# 集成扫描

> 状态：历史扫描快照，不是当前仓库架构入口
> 适用范围：仅用于追溯早期 `index.html` / `bizmapper.py` 轻量工具形态
> 当前口径：如与 `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md` 或 `MAINLINE_MAP.md` 冲突，以根目录执行规则为准

## 运行时集成

### 浏览器侧

`index.html` 依赖以下浏览器能力：

- **DOM API**: 创建节点、监听点击、键盘和滚动事件
- **SVG**: 渲染能力到流程、流程到系统的两段贝塞尔曲线
- **localStorage**: 保存 `connections`、当前选择步骤和最后保存时间
- **FileReader**: 读取导入的 JSON 文件
- **Blob + Object URL**: 导出本地 JSON 备份文件

### Python 侧

`bizmapper.py` 有两类外部集成：

1. **MiniMax Vision API**
   - 用途: 从 PNG/JPG/WebP 业务图中提取结构化映射
   - 协议: HTTPS
   - 调用方式: `urllib.request` 直接发起 POST
   - 请求内容: `prompt` + base64 `image_url`
   - 风险点: 依赖环境变量、接口可用性和返回 JSON 格式稳定性

2. **Excel 文件读写**
   - 用途: 生成审核用映射表，再读取审核后的表单回写 JSON
   - 库: `pandas` + `openpyxl`
   - 输出目录: `output/`

## 数据流

### 交互式建图

1. 用户在页面中选择业务能力
2. 选择 L3 流程
3. 选择应用系统
4. 浏览器将三元关系写入 `state.connections`
5. 变更自动保存到 `localStorage`
6. 用户可导出为 JSON 文件

### 图片提取到系统数据

1. 用户提供业务图图片
2. `bizmapper.py` 调用 MiniMax 识别结构
3. 脚本校验 `capabilities / systems / connections`
4. 生成 Excel 供人工审核
5. 审核后的 Excel 再转换为 Infomat JSON

## 领域集成文档

`系统集成关系说明.md` 描述的是业务域中的目标系统网络，而不是当前代码直接连接的运行时系统。它为前端展示对象和建模边界提供了业务语义来源，主要涉及：

- ERP（用友U8）
- MES（北京虎蜥）
- OA（华天动力）
- PLM / PDM / CAPP / SCIM / WMS

这些系统目前体现在：

- 文档约束
- 初始系统清单
- 后续扩展方向

并未作为实时 API、数据库或消息集成接入本仓库。

## 集成成熟度判断

- **已落地**: 本地浏览器存储、JSON 文件交换、Excel 读写、MiniMax 图片识别
- **未落地但文档已定义**: 企业业务系统之间的真实接口编排
- **主要缺口**:
  - 没有统一配置文件管理外部依赖
  - 没有集成测试验证 MiniMax 返回结构
  - 前端导出的 JSON 与 Python 生成的 JSON 依赖隐式结构契约
