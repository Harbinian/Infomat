# MDM-AI助手

> 状态：四人试点应用  
> 当前显示名称：`MDM-AI助手`，以后可随功能范围调整  
> 助手端口：`3003`  
> 试点可选网关端口：`3004`  
> 独立3001：默认监听`0.0.0.0:3001`，公司局域网用户直接访问

MDM-AI助手集中部署在一台Windows内网主机。4名试点人员只使用浏览器，不安装Claude Code CLI，不复制Infomat仓库、Schema、配置文件或API Key。张广懿在服务器发布一次后，用户刷新网页即可取得新版本。

本应用通过DeepSeek云端API调用模型，因此属于“内网助手＋云端模型”，不是完全本地化模型。

本应用不属于3001。3001的启动、新建、导入、校验和导出不依赖本应用或端口3004；本应用只能作为3001公开结构规则的一个独立客户端。

## 使用流程

### 填报辅助

1. 用户登录MDM-AI助手。
2. 助手读取3001当前Schema、空白模板、Git提交和结构摘要。
3. 用户可以直接从空白草稿开始，也可以在“补充材料”中导入结构化工具导出的部分完成JSON。导入后，该文件成为当前草稿，旧对话和旧文字材料清空。
4. 用户在对话框说明想梳理的流程、当前已知做法或已有JSON中需要继续完善的部分，不需要先准备完整材料。
5. `deepseek-v4-flash`每轮只提出一个主问题，并沿当前业务行为继续追问实际执行部门和岗位、实际工作、表单或记录、全部数据项、数据来源、数据去向及后续流转。
6. 用户仅在对话说不清时，选择补充经授权、已脱敏的`.docx`、`.txt`、`.md`或粘贴文字。
7. 服务端应用受限Patch后立即调用3001校验；导入的部分完成JSON有硬性结构错误时，模型先修复结构，仍只允许一次修复调用。
8. 页面左侧保留对话，右侧同步显示实际结构化内容和结构状态。
9. 用户下载“未经独立预审”的JSON。

### 独立结构预审

1. 用户进入“独立结构预审”，重新上传待审JSON。
2. 页面不发送填报对话或参考材料，只把当前JSON和当前Schema交给`deepseek-v4-pro`。
3. Schema、字段类型、枚举和单文件引用错误必须修改。
4. 字段归位和对象拆分建议由用户逐条选择“按建议修改”或“保持原值并记录理由”。
5. 页面左侧显示问题处理，右侧同步显示正在处理的同一份3001格式内容、JSON原文和只读跨职能流程图。
6. 每项问题处理后，页面重新校验当前JSON并同步刷新内容和流程图；预审意见及处理方式不进入JSON。
7. 所有硬性错误消除、所有问题完成处置后，用户下载当前3001格式JSON和独立问题处理记录。
8. 用户下载JSON后，通过公司局域网地址手工导入3001；助手不自动写入3001或3000。端口3004只供本试点可选使用，不是3001的必经入口。

AI只检查结构，不判断流程事实、部门责任、业务做法或审批合理性。

## 数据和安全边界

- 材料、对话、草稿和模型答复只在请求与当前页面内存中存在。
- 服务端不保存业务内容，浏览器不使用`localStorage`、`sessionStorage`或IndexedDB。
- 上传单文件上限10MB；一次模型调用的可读文字合计上限240000字符。
- 不处理PDF、扫描件、图片和OCR。
- 页面使用HTTPS；登录Cookie为`HttpOnly`、`Secure`和`SameSite=Strict`。
- 4个账号分别绑定4个DeepSeek API Key；API Key只保存在被Git忽略的本机环境文件中。
- 持久化日志只包含账号、时间、操作、模型、Token、结构版本、结构摘要、校验结果和错误码。
- 试点总结完成后，管理员应在5个工作日内删除用户级元数据日志，仅保留汇总。

## 本机配置

固定非敏感配置位于`config/pilot.config.json`。本机秘密写入：

```text
scripts/structure-pilot.local.env
```

至少配置：

```text
STRUCTURE_ASSISTANT_SESSION_SECRET=长度足够的随机值
STRUCTURE_ASSISTANT_TLS_CERT_PATH=内网证书绝对路径
STRUCTURE_ASSISTANT_TLS_KEY_PATH=证书私钥绝对路径

STRUCTURE_ASSISTANT_PASSWORD_ZGY_HASH=密码哈希
STRUCTURE_ASSISTANT_PASSWORD_DINGSHUO_HASH=密码哈希
STRUCTURE_ASSISTANT_PASSWORD_ENGINEERING_HASH=密码哈希
STRUCTURE_ASSISTANT_PASSWORD_HR_HASH=密码哈希

DEEPSEEK_API_KEY_ZGY=张广懿账号Key
DEEPSEEK_API_KEY_DINGSHUO=丁硕账号Key
DEEPSEEK_API_KEY_ENGINEERING=工程技术部试点账号Key
DEEPSEEK_API_KEY_HR=行政人事部试点账号Key
```

密码哈希通过本应用的`npm run hash-password`生成。命令只输出哈希，不保存明文密码。

## 集中发布

正式启动入口：

```powershell
npm run start:structure-pilot
npm run smoke:structure-pilot
```

启动脚本执行以下控制：

- 拒绝包含未提交修改的服务器工作区；
- 先运行3001、助手和固定配置测试；
- 确认独立运行的3001可达，但不停止、启动或重绑3001；
- 使用同一证书启动助手和试点可选网关；
- 不执行自动`git pull`，不向用户电脑复制任何文件。

发布前，张广懿应先在管理页开启维护状态并通知用户下载当前草稿。完成指定提交更新、测试、重启和烟测后，张广懿解除维护状态。用户只需刷新浏览器。

页面首次进入、每30秒以及每次模型调用前后都会核对Git提交和Schema摘要。版本发生变化时，服务端返回`409 VERSION_CHANGED`，页面只允许先下载当前草稿，再刷新并重新导入。

## 验证

不产生模型费用的自动验证：

```powershell
npm run verify:structure-pilot
```

正式服务烟测需要在本机环境中另配：

```text
STRUCTURE_ASSISTANT_SMOKE_BASE_URL=https://内网主机:3003
STRUCTURE_ASSISTANT_SMOKE_USERNAME=zhangguangyi
STRUCTURE_ASSISTANT_SMOKE_PASSWORD=张广懿试点登录密码
STRUCTURE_ASSISTANT_SMOKE_CA_PATH=私有CA证书路径
```

烟测只检查登录、版本、模板、结构校验、余额和试点可选网关，不调用付费模型。

四账号付费模型烟测必须由管理员显式确认：

```powershell
$env:STRUCTURE_ASSISTANT_LIVE_SMOKE_CONFIRM='YES'
npm --prefix apps/structure-assistant run smoke:models
```

该命令为4个账号分别执行一次Flash填报和一次Pro独立结构预审，只使用合成材料，但会产生实际Token费用。

## 主要接口

| 接口 | 用途 |
|---|---|
| `/api/auth/login`、`/api/auth/logout`、`/api/auth/me` | 登录、退出和当前身份 |
| `/api/context` | Git提交、结构版本、结构摘要、维护状态和试点可选网关 |
| `/api/template` | 读取3001当前空白模板 |
| `/api/source/upload`、`/api/source/paste` | 在当前请求内读取文字材料 |
| `/api/document/validate` | 使用3001当前结构规则校验JSON |
| `/api/fill/turn` | Flash结构化填报对话 |
| `/api/review/run`、`/api/review/apply` | Pro独立预审和逐条处理 |
| `/api/account/balance` | 查询本人DeepSeek余额 |
| `/api/admin/status`、`/api/admin/maintenance` | 管理员查看非内容状态并控制维护模式 |

所有会修改当前结果或调用模型的请求都需要登录Cookie、CSRF令牌、`app_commit`和`schema_digest`。
