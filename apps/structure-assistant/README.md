# MDM-AI助手

> 状态：五账号试点应用<br>
> 当前显示名称：`MDM-AI助手`，以后可随功能范围调整<br>
> 登录和运行控制端口：`3003`<br>
> DSH治理工作区端口：`3004`<br>
> 独立3001：默认监听`0.0.0.0:3001`，公司局域网用户直接访问

MDM-AI助手集中部署在一台Windows内网主机。用户从端口3003登录后，默认进入端口3004上的受限DeepSeek Harness（DSH）治理工作区。每个登录会话使用一个隔离DSH进程；业务用户只能使用治理插件，不能使用原生编码Agent、命令、任意文件访问、技能、子Agent、网页检索或模型配置。原页面保留在`/classic`，只作为管理员可切换的应急入口。

5个固定账号的用户只使用浏览器，不复制Infomat仓库、Schema或配置文件。用户登录后输入本人API Key；浏览器和用户电脑不持久化Key。张广懿在服务器发布一次后，用户刷新网页即可取得新版本。

本应用通过DeepSeek云端API调用模型，因此属于“内网助手＋云端模型”，不是完全本地化模型。

本应用不属于3001。3001的启动、新建、导入、校验和导出不依赖本应用或端口3004；本应用只能作为3001公开`process-governance-v5`结构规则的一个独立客户端。助手内部结构客户端显式请求3001的v5健康检查、Schema和空白模板接口，不依赖3001当前默认的v6版本；端口3004的`/structured-tool/`认证代理仍打开3001当前v6页面，不把该页面降级为v5。助手可以询问并保留v5的普通流程关系、数据行为关系、来源线索、表单操作和字段数据关系；字段取值来源可以是本流程数据，也可以是明确的外部系统和来源数据名称。助手不得自行推断这些业务事实，也不得为外部系统来源虚构本流程行为，不得创建或修改`migration`中的旧跨部门记录。

## 用户教程

五账号试点人员按[《MDM-AI助手流程与数据治理使用教程》](../../docs/training/2026-08-17-MDM-AI助手流程与数据治理使用教程.md)完成Key绑定、对话填报、独立结构预审、3001核对和案例验收。教程同时说明助手当前v5成果、3001当前v6成果与3000现行v3承接能力之间的停止边界。

## 使用流程

### 填报辅助

1. 用户从端口3003登录。服务端启动或复用当前登录会话的隔离DSH实例，并把用户带到端口3004。
2. 用户新建治理工作区并填写案例名称。一个工作区只对应一个治理案例。
3. 用户在“DeepSeek API Key”状态卡中输入本人Key。输入框使用密码掩码；验证成功后，页面只显示SHA-256前12位指纹、绑定时间和会话到期时间。
4. 助手读取3001当前Schema、空白模板、Git提交和结构摘要。
5. 用户可以直接从空白草稿开始，也可以在“补充材料”中导入结构化工具导出的部分完成JSON。导入后，该文件成为当前草稿，旧对话和旧文字材料清空。
6. 用户在对话框说明想梳理的流程、当前已知做法或已有JSON中需要继续完善的部分，不需要先准备完整材料。
7. `deepseek-v4-pro`关闭思考模式，每轮只提出一个主问题，并沿当前业务行为继续追问实际执行部门和岗位、实际工作、表单或记录、全部数据项、数据来源、数据去向及后续流转。
8. 用户仅在对话说不清时，选择补充经授权、已脱敏的`.docx`、`.txt`、`.md`或粘贴文字。
9. 服务端应用受限Patch后立即调用3001校验；导入的部分完成JSON有硬性结构错误时，模型先修复结构，仍只允许一次修复调用。
10. 页面左侧保留对话，右侧同步显示实际结构化内容和结构状态。
11. 用户下载“未经独立预审”的JSON。

### 独立结构预审

1. 用户进入“独立结构预审”，重新上传待审JSON。
2. 页面不发送填报对话或参考材料，只把当前JSON和当前Schema交给`deepseek-v4-pro`。
3. Schema、字段类型、枚举和单文件引用错误必须修改。
4. 字段归位和对象拆分建议由用户逐条选择“按建议修改”或“保持原值并记录理由”。
5. 页面左侧显示问题处理，右侧同步显示正在处理的同一份3001格式内容、JSON原文和只读跨职能流程图。
6. 每项问题处理后，页面重新校验当前JSON并同步刷新内容和流程图；预审意见及处理方式不进入JSON。
7. 所有硬性错误消除、所有问题完成处置后，用户下载当前3001格式JSON和独立问题处理记录。
8. 用户下载JSON后，可以点击“打开结构化工具”进入端口3004的`/structured-tool/`，也可以通过公司局域网地址直接访问3001并手工导入。助手不自动写入3001或3000。

AI只检查结构，不判断流程事实、部门责任、业务做法或审批合理性。

## 数据和安全边界

- 材料、对话、草稿、预审问题和核对记录只保存在当前DSH子进程内存中。刷新页面可以恢复；退出、会话到期、实例终止、子进程故障或服务重启后清除。
- 服务端不把业务内容写入文件、数据库、DSH日志数据库或临时工作目录；浏览器不使用`localStorage`、`sessionStorage`或IndexedDB。
- 上传单文件上限10MB；一次模型调用的可读文字合计上限240000字符。
- 不处理PDF、扫描件、图片和OCR。
- 页面使用HTTPS；登录Cookie为`HttpOnly`、`Secure`和`SameSite=Strict`。
- 固定账号为张广懿管理员、丁硕、工程技术部研发、工程技术部批产和行政人事部；研发和批产的部门字段均为“工程技术部”。
- 用户输入的API Key验证成功后只保存在当前登录会话对应的服务端进程内存中。刷新页面继续有效；退出、会话到期、模型认证失败或服务重启后清除。
- 同一账号的不同登录会话不共享Key；共享同一登录Cookie的多个标签页共享Key。
- 完整Key不写入文件、数据库、Cookie、浏览器存储、日志、错误详情或接口响应。管理员只能查看各账号是否存在有效Key会话及有效会话数。
- 余额不足或低于20元时允许绑定并提示，不自动充值。
- 持久化日志只包含账号、时间、操作、模型、Token、结构版本、结构摘要、校验结果和错误码。
- 试点总结完成后，管理员应在5个工作日内删除用户级元数据日志，仅保留汇总。
- 同一Cookie的多个标签页共享治理工作区。旧标签页提交旧`revision`时，页面返回`409 STATE_CONFLICT`，保留尚未提交的输入并要求用户重新加载最新状态。

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
STRUCTURE_ASSISTANT_PUBLIC_HOSTS=内网主机名:3004,内网IP:3004

STRUCTURE_ASSISTANT_PASSWORD_ZGY_HASH=密码哈希
STRUCTURE_ASSISTANT_PASSWORD_DINGSHUO_HASH=密码哈希
STRUCTURE_ASSISTANT_PASSWORD_ENGINEERING_RD_HASH=密码哈希
STRUCTURE_ASSISTANT_PASSWORD_ENGINEERING_PRODUCTION_HASH=密码哈希
STRUCTURE_ASSISTANT_PASSWORD_HR_HASH=密码哈希
```

密码哈希通过本应用的`npm run hash-password`生成。命令只输出哈希，不保存明文密码。DeepSeek API Key不写入本机环境文件，由每名用户登录后在前端输入。正式运行固定使用Node.js 24和`@deepseek-ai/dsh@0.1.0-rc.6`；DSH升级必须单独审核。

## 集中发布

正式启动入口：

```powershell
npm run start:structure-pilot
npm run smoke:structure-pilot
```

启动脚本执行以下控制：

- 拒绝包含未提交修改的服务器工作区；
- 先运行3001、助手和固定配置测试；
- 执行`npm run verify:dsh-entry`，确认受限插件可加载、原生能力已删除、内存状态不落盘；
- 确认独立运行的3001可达，但不停止、启动或重绑3001；
- 使用同一证书启动端口3003和认证后的端口3004；
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

烟测只检查登录、版本、模板、结构校验、当前会话未预置Key、DSH实例启动与治理页面、五账号Key/DSH会话状态和`/structured-tool/`，不调用付费模型。

正式发布后的付费验证不使用管理员集中收集Key的脚本。5名用户分别登录，在前端输入本人Key，并使用合成材料各完成一次填报和一次独立结构预审。实际费用必须在执行前显式确认。业务验收另按4个统一基准案例和3个真实案例执行；第五账号费用已另行批准，全部账号均禁止自动充值。

## 主要接口

| 接口 | 用途 |
|---|---|
| `/api/auth/login`、`/api/auth/logout`、`/api/auth/me` | 登录、退出和当前身份 |
| `/api/context` | Git提交、结构版本、结构摘要、维护状态、全局入口和DSH可用状态 |
| `GET/POST/DELETE /api/dsh/runtime` | 查看、启动或结束当前登录会话的隔离DSH实例；响应不返回内部端口、路径或内容 |
| `/api/template` | 读取3001当前空白模板 |
| `/api/source/upload`、`/api/source/paste` | 在当前请求内读取文字材料 |
| `/api/document/validate` | 使用3001当前结构规则校验JSON |
| `GET /api/account/api-key` | 查看当前登录会话的Key状态、指纹和有效期，不返回完整Key |
| `PUT /api/account/api-key`、`DELETE /api/account/api-key` | 验证并绑定本人Key，或清除当前登录会话的Key |
| `/api/fill/turn` | Pro结构化填报对话，关闭思考模式 |
| `/api/review/run`、`/api/review/apply` | Pro独立预审和逐条处理 |
| `/api/account/balance` | 查询本人DeepSeek余额 |
| `/api/admin/status`、`/api/admin/maintenance` | 管理员查看不含其他账号余额、指纹、案例名称和完整Key的非内容状态，并控制维护模式 |
| `PUT /api/admin/entry-mode` | 管理员填写原因后，在`dsh`和`classic`全局入口之间切换 |

端口3004的`/mdm-api/*`在认证后转发上述助手接口；`/structured-tool/*`转发独立3001；其他路径只转发当前登录会话的DSH实例。DSH实例只监听`127.0.0.1`随机端口，不能绕过认证网关直接访问。

所有会修改当前结果或调用模型的请求都需要登录Cookie、CSRF令牌、`app_commit`和`schema_digest`。
