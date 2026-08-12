# 信息表收集服务接口说明

## 1. 通用规则

- 接口前缀：`/api/v1`。
- 认证：HttpOnly 会话 Cookie。4000 与 4001 的会话互不替代。
- 写操作：客户端先读取 `/api/v1/auth/csrf-token`，再通过 `X-CSRF-Token` 提交。
- 时间：请求使用带时区的 ISO 8601；服务按 `Asia/Shanghai` 保存和判断。
- 错误响应：`{ "error": "用户可执行的说明", "code": "STABLE_CODE", "details": [], "requestId": "UUID" }`。

## 2. 身份接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/auth/login` | 使用工号或登录名及现有账号密码登录 |
| GET | `/api/v1/auth/session` | 页面启动时探测当前端口的会话；未登录时返回 `200` 和 `authenticated: false`，不产生控制台 401 噪声 |
| POST | `/api/v1/auth/logout` | 撤销当前端口的会话 |
| GET | `/api/v1/auth/me` | 返回当前人员、部门和本应用授权 |
| GET | `/api/v1/auth/csrf-token` | 返回当前会话的写操作令牌 |

## 3. 4000 管理接口

| 方法 | 路径 | 关键输入或结果 |
|---|---|---|
| GET/POST | `/api/v1/admin/grants` | 查询或授予 `collection_admin`、`collection_designer` |
| POST | `/api/v1/admin/grants/:grantId/revoke` | 撤销授权；最后一名管理员返回 `409 LAST_ADMIN_REQUIRED` |
| GET/POST | `/api/v1/admin/forms` | 查询未归档的可管理表单或创建表单；查询参数 `includeArchived=1` 可包含归档表单 |
| PUT | `/api/v1/admin/forms/:formId/draft` | `{ expectedRevision, schema }` |
| POST | `/api/v1/admin/forms/:formId/archive` | 归档表单并从默认列表隐藏；历史任务和答卷保持不变 |
| DELETE | `/api/v1/admin/forms/:formId` | 永久删除从未发布且没有版本和任务记录的设计稿 |
| GET | `/api/v1/admin/forms/:formId/versions` | 读取不可变版本历史 |
| POST | `/api/v1/admin/tasks/target-preview` | 预检查部门和人员范围，不写数据库 |
| POST | `/api/v1/admin/tasks` | 事务化固化版本、任务和人员快照 |
| POST | `/api/v1/admin/tasks/:taskId/close|reopen|extend|cancel` | 执行明确的任务状态动作 |
| GET | `/api/v1/admin/tasks/:taskId/dashboard` | 返回完成数量和字段统计 |
| GET | `/api/v1/admin/tasks/:taskId/submissions` | 返回目标人员与答卷明细 |
| GET | `/api/v1/admin/tasks/:taskId/export.xlsx` | 流式下载 Excel |
| GET | `/api/v1/admin/tasks/:taskId/export.zip` | 流式下载 Excel 和附件包 |

任务范围结构：

```json
{
  "includeAllActive": false,
  "departmentIds": [1, 2],
  "personIds": [1001, 1002]
}
```

## 4. 4001 填报接口

| 方法 | 路径 | 关键输入或结果 |
|---|---|---|
| GET | `/api/v1/tasks` | 本人任务列表和当前答卷状态 |
| GET | `/api/v1/tasks/:taskId` | 不可变表单结构、本人答卷和附件 |
| PUT | `/api/v1/tasks/:taskId/submission` | `{ expectedRevision, answers }`，保存草稿 |
| POST | `/api/v1/tasks/:taskId/submit` | `{ expectedRevision }`，保存正式提交快照 |
| POST | `/api/v1/tasks/:taskId/edit` | `{ expectedRevision }`，截止前恢复草稿 |
| POST | `/api/v1/tasks/:taskId/files` | `multipart/form-data`：`fieldKey`、`file` |
| DELETE | `/api/v1/tasks/:taskId/files/:fileId` | `{ expectedRevision }`，状态化移除附件 |
| GET | `/api/v1/files/:fileId` | 下载本人答卷附件 |

包含明细表时，`answers` 保留主表字段的原有结构，并增加 `__detailRows`：

```json
{
  "22222222-2222-4222-8222-222222222222": "主表字段值",
  "__detailRows": {
    "66666666-6666-4666-8666-666666666666": [
      {
        "rowKey": "88888888-8888-4888-8888-888888888888",
        "values": {
          "77777777-7777-4777-8777-777777777777": "明细字段值"
        }
      }
    ]
  }
}
```

旧表单没有 `kind` 时，系统按 `main` 处理。明细表的 `kind` 为 `detail`，并包含 `minRows` 和 `maxRows`。写接口拒绝未知明细表、重复或无效 `rowKey`、超出行数限制以及明细表附件字段。

从 Excel 复制粘贴属于 4001 页面内的录入方式，不新增上传或导入接口。页面将剪贴板矩形区域转换为现有 `__detailRows` 结构后，继续调用 `PUT /api/v1/tasks/:taskId/submission` 保存完整服务器草稿；服务端仍执行答卷结构、字段值、任务状态和 `expectedRevision` 校验。

## 5. 稳定错误码

| 错误码 | HTTP | 用户处理 |
|---|---:|---|
| `AUTH_REQUIRED` | 401 | 重新登录 |
| `PASSWORD_CHANGE_REQUIRED` | 403 | 先在 3000 修改首次密码 |
| `FORM_SCOPE_DENIED` / `TASK_SCOPE_DENIED` | 403 | 联系信息收集管理员核对部门授权 |
| `REVISION_CONFLICT` | 409 | 页面保留本页内容并读取服务器最新修订；填报人明确选择采用服务器内容，或者在服务器答卷仍为开放草稿时保留本页内容并重新保存 |
| `FORM_ARCHIVED` | 409 | 已归档表单不能修改或发布新任务 |
| `FORM_HAS_HISTORY` | 409 | 表单已有发布历史，不能永久删除；改用归档 |
| `TASK_NOT_OPEN` | 409 | 查看开始或截止时间，联系任务发起部门 |
| `FORM_SCHEMA_INVALID` / `ANSWERS_INVALID` | 422 | 按 `details` 逐项修改 |
| `ATTACHMENT_DISABLED` | 503 | 运维人员配置生产附件扫描后重试 |
