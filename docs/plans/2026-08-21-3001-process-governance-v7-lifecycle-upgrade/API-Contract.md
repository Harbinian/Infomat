# 接口约定：3001 process-governance-v7

## 1. 版本端点

| 接口 | v7约定 |
|---|---|
| `GET /api/schema` | 默认返回v7结构规则，并设置v7摘要响应头 |
| `GET /api/schema?version=process-governance-v7` | 返回v7结构规则 |
| `GET /api/schema?version=process-governance-v1..v6` | 继续返回对应历史结构规则 |
| `GET /api/template` | 默认返回v7空白模板 |
| `GET /api/template?version=process-governance-v7` | 返回`app_commit`、`schema_version`、`schema_digest`和v7空白数据 |
| `GET /api/template?version=process-governance-v5|v6` | 保留兼容读取，不作为页面新建目标 |
| `GET /api/version-history` | 包含v7候选状态和兼容边界；正式签发前`current_status=candidate` |
| `GET /api/health` | `schema_version=process-governance-v7`、`release_status=candidate`，摘要与默认结构一致；正式签发后才允许改为`released` |

## 2. 校验与迁移

`POST /api/validate`接受v1至v7和`document-structured-output-v2`。该接口只校验请求内容，不迁移、不存储内容。前端迁移目标固定为v7；旧版本文件完成迁移并通过v7校验后，才进入当前页面。

状态码保持：请求缺少数据返回400；不支持的结构版本返回400；结构不合格仍返回可诊断的校验结果，不写服务端业务内容。

## 3. 无状态边界

`/api/session`、`/api/data`和`/api/export`继续返回404。服务端不保存材料、草稿、生命周期建议、否决原因或下载文件。
