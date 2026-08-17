# 3001流程结构规则v4接口约定

## GET /api/schema

- 默认返回`process-governance-v4`结构规则。
- `version`可指定v1、v2、v3、v4或`document-structured-output-v2`。
- 默认响应继续返回`X-Infomat-Schema-Digest`。

## GET /api/template

- 仅支持`version=process-governance-v4`；未传版本时使用v4。
- 返回`app_commit`、`schema_version`、`schema_digest`和空白单流程`data`。

## POST /api/validate

- 请求体保持`{ "data": <单流程文件> }`。
- v1至v4按各自结构规则校验；v4另外检查数据行为关系、数据来源可用位置、表单行为关系和字段数据关系中的本地引用。
- 响应保持`valid`、`errors`和`data`。校验不写入服务端或浏览器持久化空间。

## GET /api/version-history

- 返回`docs/contracts/process-governance-version-history.json`的只读内容。
- 响应禁止缓存，不依赖当前页面草稿，不产生副作用。

