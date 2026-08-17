# MDM-AI助手技术说明

## 1. 架构

```text
用户浏览器
  ├─ HTTPS :3003 -> 登录、DSH运行控制、管理员运行状态
  ├─ HTTPS :3004 -> Cookie认证、Host/Origin校验和流式反向代理
  │                  ├─ 当前登录会话的DSH子进程（127.0.0.1随机端口）
  │                  ├─ /mdm-api/* -> structure-assistant API
  │                  └─ /structured-tool/* -> 127.0.0.1:3001
  └─ HTTP :3001 -> structured-output-service（公司局域网仍可直接访问）

0.0.0.0:3001 -> structured-output-service
```

3001独立启动并默认面向公司局域网提供服务。助手从同一个Infomat工作区读取3001公开结构规则，但它是3001的客户端，不得停止、启动、重绑或代管3001。用户电脑没有仓库副本。

DSH固定为`@deepseek-ai/dsh@0.1.0-rc.6`并使用Node.js 24。运行管理器按登录`nonce`维护实例，最多同时运行10个；同一Cookie多标签共享，不同登录会话隔离。每个子进程使用仓库外独立临时`DSH_HOME`和空工作目录，只监听`127.0.0.1`随机端口。启动超时60秒，停止宽限5秒；退出、会话到期、管理员终止、父服务停止或子进程异常时结束。

`config/dsh-governance.patch.yml`通过DSH官方`--patch`装配随部署提供的`infomat-governance`插件。补丁移除默认模型、凭据存储、持久化、Shell、PowerShell、文件工具、技能、子Agent、网页检索、设置、模型选择、插件界面和默认编码页面。业务用户不能选择服务器目录或调用原生编码Agent。

预审页面使用3001同一提交内的Cytoscape静态文件和只读流程图实现。助手只按固定地址提供这两项页面资源，不复制、改写或另行解释流程图规则，因此结构化工具和助手对同一份JSON使用同一套图形含义。

## 2. 版本一致性规则

3001提供：

- `GET /api/schema`：当前Schema；响应头包含结构摘要。
- `GET /api/template`：新生成的空白`process-governance-v5`文件、Git提交和结构摘要。
- `GET /api/health`：服务状态、Git提交、结构版本和结构摘要。

助手的`/api/context`返回`app_commit`、`schema_version`、`schema_digest`、`maintenance_mode`、`entry_mode`、`dsh_version`和`dsh_available`。浏览器在模型请求中回传进入页面时取得的提交和摘要。

服务端在模型调用前检查期望版本；调用完成后再次读取3001状态。任一检查不一致时返回`409 VERSION_CHANGED`，不把模型结果返回为新草稿。集中发布流程先开启维护状态，因此正常发布不会在模型请求进行中切换版本。

## 3. 模型数据流

### 填报

用户在“补充材料”中导入部分完成的`process-governance-v5`文件时，浏览器先限制文件为2MB以内，再调用`/api/document/validate`。通过格式读取后，该文件替换当前页面草稿，旧对话、旧字段状态和旧文字材料清空；文件内容仍只存在于页面内存，不作为普通文字材料重复发送。v1至v4文件由3001先在内存中升级并重新导出。助手不在模型调用中补造流程关系、`form_design_state`、数据行为关系、表单操作、字段归属或字段取值来源，也不向受限Patch开放`migration`和`cross_department_handoffs`。

浏览器每轮发送当前JSON、最近20条对话、本轮回答、此前字段确认状态和当前页面内存中的可选文字材料。AI上一轮显示的唯一主问题会随其说明一起进入对话记录，保证模型能够判断用户本轮在回答什么。补充材料可以为空，页面不得把上传材料作为开始对话的前置条件。服务端先运行3001校验，把当前硬性结构错误与其他输入一起交给`deepseek-v4-pro`：

- `thinking.type=disabled`
- `response_format.type=json_object`
- 模型只返回`assistant_message`、`questions`、`patch`和`field_statuses`

模型每轮只提出一个主问题，并沿当前分支持续追问。每项业务行为的核对范围包括实际执行部门和岗位、实际工作、表单或记录及其全部数据项、数据来源、数据去向、触发条件、前置条件、时限、完成标准和后续流转。字段取值来源为外部系统时，`source_links[]`记录`source_type=external_system`、空`source_data_ref`、系统名称和来源数据名称，不新增本流程行为。用户可以明确标记暂不清楚或不适用；模型不得猜测。服务端对`questions`再次限制为最多1项，避免模型偏离后一次返回多项问题。

页面左侧显示连续对话，右侧从当前JSON生成结构化内容预览；预览不增加JSON字段，也不保存页面状态。服务端只接受`add`、`replace`、`remove`，路径根节点必须属于当前结构。服务端拒绝根级替换、结构版本修改、未知根节点、原型污染路径、100项以上Patch和1MB以上Patch。应用Patch后，服务端调用3001`/api/validate`；失败时把错误交给模型修复一次。

### 独立结构预审

浏览器只发送当前JSON，不发送填报材料或对话。服务端先运行3001校验，再调用`deepseek-v4-pro`：

- `thinking.type=enabled`
- `reasoning_effort=high`
- `response_format.type=json_object`

3001校验错误生成不可忽略的硬性问题。模型只允许补充字段归位和对象拆分建议。预审问题、处置方式和保持原值理由留在浏览器内存；用户明确下载时另存CSV，不写入正式JSON。

页面从导入到下载始终维护同一份`process-governance-v5`文件，不生成单独的预审文件格式。左侧逐条处理问题，右侧同步显示结构化内容、JSON原文和只读跨职能流程图。问题处置产生的受限Patch通过3001校验后，三个预览立即使用新JSON重新生成。流程图只读取JSON，不写回坐标、页面状态或预审意见。

## 4. 认证与安全

- 密码使用Node.js`scrypt`哈希。
- 登录状态使用HMAC签名、8小时有效的`HttpOnly` Cookie。
- 正式环境Cookie同时设置`Secure`和`SameSite=Strict`。
- 写请求使用Cookie内独立CSRF令牌。
- 登录失败按来源地址在内存中限速。
- 助手设置CSP、`X-Content-Type-Options`、`Referrer-Policy`和禁用设备权限。
- 3001默认监听`0.0.0.0:3001`并由公司网络边界限制访问来源；端口3004上的`/structured-tool/`不替代局域网用户直连3001。
- 端口3004在转发前验证现有登录Cookie、固定公共Host和Origin。网关不向3001或DSH子进程转发登录Cookie、Authorization头，也不向浏览器转发DSH子进程Cookie。
- DSH内部端口、运行令牌、临时路径和登录`nonce`不进入接口响应、浏览器或日志。网关只允许本机助手、3001和当前登录会话的本机DSH实例作为目标。
- DSH子进程使用白名单环境，不继承登录密码、会话密钥、TLS私钥或DeepSeek API Key。插件只通过`/mdm-api/*`调用现有助手接口。
- 参考材料中的命令性文字只作为不可信业务数据。

固定账号为张广懿管理员、丁硕、工程技术部研发、工程技术部批产和行政人事部。研发和批产账号的部门字段均为“工程技术部”。登录密码哈希从本机环境读取；配置和启动脚本不读取DeepSeek API Key。

用户登录后通过`PUT /api/account/api-key`提交本人Key。服务端先去除首尾空白，并拒绝空值、控制字符、非字符串和超过512字符的输入；不限制Key前缀。服务端调用余额接口验证Key，认证失败或验证请求失败时不保存新Key。余额不足或低于20元时允许保存并返回提示，不执行自动充值。

验证通过的Key只存入当前服务进程的`Map`，索引为登录令牌中的会话`nonce`，到期时间与认证令牌一致。同一账号的不同登录会话互不共享Key；共享同一登录Cookie的标签页共享Key。退出时立即删除，会话到期由定时清理删除，服务停止或重启时全部丢弃。上游模型返回`MODEL_AUTH_FAILED`时删除当前会话Key；余额不足、模型繁忙、超时和网络中断不删除。

浏览器输入框使用`type="password"`并关闭自动填充、拼写检查和自动大小写。提交完成后立即清空控件和临时变量。页面只接收服务端生成的`SHA-256: <前12位十六进制>`指纹、绑定时间和会话到期时间，不提供完整Key查看接口。Key不得进入文件、数据库、Cookie、浏览器存储、业务日志或错误详情。

### 4.1 会话Key接口

| 接口 | 请求与响应边界 |
|---|---|
| `GET /api/account/api-key` | 返回`configured`、`fingerprint`、`configured_at`和`expires_at`。未配置时后三项为`null`，始终不返回完整Key。 |
| `PUT /api/account/api-key` | 请求为`{"api_key":"..."}`。验证成功后返回当前Key状态和本人余额；低余额或余额不足通过`warning`提示。认证失败或验证请求失败时不替换当前会话原有Key。 |
| `DELETE /api/account/api-key` | 清除当前登录会话的Key，并返回未配置状态。 |
| `/api/fill/turn`、`/api/review/run`、`/api/account/balance` | 从当前登录会话读取Key；未配置时返回`428 API_KEY_REQUIRED`，不得调用DeepSeek。 |
| `/api/admin/status` | 通过`account_key_statuses`返回每个账号是否存在有效Key会话及有效会话数；不返回其他账号余额或任何指纹。 |

### 4.2 DSH运行与入口接口

| 接口 | 请求与响应边界 |
|---|---|
| `GET /api/dsh/runtime` | 返回当前登录会话的`status`、固定DSH版本、工作区数量和到期时间，不返回内部端口、路径、令牌、工作区名称或内容。 |
| `POST /api/dsh/runtime` | 受CSRF保护；启动或复用当前实例，返回端口3004公共入口。全局入口为`classic`时返回`ENTRY_MODE_CLASSIC`。 |
| `DELETE /api/dsh/runtime` | 受CSRF保护；结束当前实例并清除其中的业务内容，不清除仍有效的会话Key。 |
| `PUT /api/admin/entry-mode` | 仅管理员调用。请求包含`mode`和非空`reason`，记录管理员与时间；入口切换不复制业务内容。 |
| `/api/admin/status` | 通过`account_dsh_statuses`返回各账号有效DSH实例数，不返回工作区或案例名称。 |

DSH治理插件在子进程内维护工作区。一个工作区对应一个案例，用户只能填写案例名称。状态写入必须携带当前`revision`；旧版本返回`409 STATE_CONFLICT`，服务端不覆盖新状态，浏览器保留尚未提交的输入。默认入口为`dsh`；经典页面保留在`/classic`供管理员应急切换。

## 5. 状态与日志

材料、对话、草稿、预审问题和核对记录只保存在当前DSH子进程内存中。刷新页面可以恢复；退出、会话到期、实例终止、子进程故障或服务重启后清除。经典入口仍只使用当前页面内存。

业务内容不得进入数据库、SQLite、JSONL、`settings.yaml`、临时工作目录、服务器文件、浏览器Cookie、`localStorage`、`sessionStorage`或IndexedDB。用户主动下载时由浏览器生成本地文件，服务器不保存副本。

运行目录只允许保存：

- `maintenance.json`：维护状态，以及全局入口切换的模式、原因、管理员和时间；
- `usage-metadata.jsonl`：账号、时间、请求编号、操作、模型、Token、结构版本、结构摘要、校验结果、错误码和调用次数。

日志字段采用白名单，调用方即使传入额外字段也不会写入。

## 6. 异常规则

| 情形 | 处理 |
|---|---|
| 空内容、非法JSON、Patch校验失败 | 只调用模型修复一次 |
| `429`、`500`、`503` | 退避后只重试一次 |
| 请求超时或网络中断 | 不自动重试，提示结果不确定 |
| `401`、`403` | 标记API Key不可用 |
| `402` | 保留当前会话Key，标记余额不足，不自动充值 |
| 版本或摘要变化 | 返回`409 VERSION_CHANGED` |
| 维护状态 | 返回`503 MAINTENANCE_MODE` |
| 3001不可用或与助手提交不同 | 阻止模型调用 |
| 结构建议应用后产生硬错误 | 不修改当前JSON |
| 流程图资源或图形生成失败 | 显示图形不可用提示，保留当前JSON，不阻止问题处理和合格文件下载 |
| 当前登录会话未启动DSH | 返回`428 DSH_RUNTIME_REQUIRED`，不调用模型 |
| DSH启动失败或达到实例上限 | 返回`DSH_START_FAILED`或`DSH_RUNTIME_LIMIT`，不驱逐其他有效实例 |
| DSH子进程在会话期间异常结束 | 返回`DSH_RUNTIME_RESTARTED`，保留当前页面尚未下载的内容并要求新建实例 |
| 旧标签页提交旧版本 | 返回`409 STATE_CONFLICT`，保留本页输入并要求重新加载最新状态 |
| 全局入口处于经典模式 | 启动DSH返回`ENTRY_MODE_CLASSIC`，业务用户进入经典页面 |

## 7. 验证

`npm test`覆盖认证、CSRF、版本阻断、维护状态、五账号唯一性、无服务端Key配置、会话Key绑定与隔离、模型参数、JSON修复一次、结构预审、硬错误处置、受限Patch、3001流程图资源复用、预审格式与预览入口、元数据日志白名单、管理员权限边界、DSH运行隔离、入口切换、状态冲突、认证网关和浏览器无持久化。

`npm run verify:dsh-entry`使用Node.js 24启动真实DSH实例，检查固定版本、插件装配、原生能力移除、状态冲突、无凭据文件、无业务内容落盘和进程清理。仓库根目录`npm run verify:structure-pilot`同时运行该门禁、3001结构规则测试、助手测试和固定配置检查。

页面变更还需用真实浏览器验证登录后进入DSH、工作区新建与切换、密码掩码、指纹、Key门禁、刷新恢复、失效后草稿保留、多标签冲突、结构预览、管理员入口切换、桌面与窄屏布局，以及不存在业务内容或Key的浏览器持久化。正式发布后运行`npm run smoke:structure-pilot`；随后由5名用户在前端分别输入本人Key，用合成材料各执行一次填报和一次独立预审。付费验证必须显式确认，不再由管理员集中收集Key或运行跨账号付费烟测脚本。
