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
| POST | `/api/v1/auth/logout` | 撤销当前端口的会话 |
| GET | `/api/v1/auth/me` | 返回当前人员、部门和本应用授权 |
| GET | `/api/v1/auth/csrf-token` | 返回当前会话的写操作令牌 |

## 3. 4000 管理接口

| 方法 | 路径 | 关键输入或结果 |
|---|---|---|
| GET/POST | `/api/v1/admin/grants` | 查询或授予 `collection_admin`、`collection_designer` |
| POST | `/api/v1/admin/grants/:grantId/revoke` | 撤销授权；最后一名管理员返回 `409 LAST_ADMIN_REQUIRED` |
| GET/POST | `/api/v1/admin/forms` | 查询可管理表单或创建表单 |
| PUT | `/api/v1/admin/forms/:formId/draft` | `{ expectedRevision, schema }` |
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

## 5. 稳定错误码

| 错误码 | HTTP | 用户处理 |
|---|---:|---|
| `AUTH_REQUIRED` | 401 | 重新登录 |
| `PASSWORD_CHANGE_REQUIRED` | 403 | 先在 3000 修改首次密码 |
| `FORM_SCOPE_DENIED` / `TASK_SCOPE_DENIED` | 403 | 联系信息收集管理员核对部门授权 |
| `REVISION_CONFLICT` | 409 | 保留当前内容，刷新后核对 |
| `TASK_NOT_OPEN` | 409 | 查看开始或截止时间，联系任务发起部门 |
| `FORM_SCHEMA_INVALID` / `ANSWERS_INVALID` | 422 | 按 `details` 逐项修改 |
| `ATTACHMENT_DISABLED` | 503 | 运维人员配置生产附件扫描后重试 |
