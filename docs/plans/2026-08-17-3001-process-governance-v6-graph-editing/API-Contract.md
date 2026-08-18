# 3001流程结构规则v6接口约定

## GET /api/schema

- 默认返回`process-governance-v6`结构规则。
- `version`可指定`process-governance-v1`至`process-governance-v6`或`document-structured-output-v2`。
- 默认响应继续返回`X-Infomat-Schema-Digest`。

## GET /api/template

- 仅支持`version=process-governance-v6`；未传版本时使用v6。
- 返回`app_commit`、`schema_version`、`schema_digest`和空白单流程`data`。

## POST /api/validate

- 请求体保持`{ "data": <单流程文件> }`。
- v1至v5按各自结构规则校验并规范化到v6；v6按当前结构规则校验，并检查数据行为关系、数据来源可用位置、表单行为关系和字段数据关系中的本地引用。
- 响应保持`valid`、`errors`和`data`。校验不写入服务端或浏览器持久化空间。

## GET /api/version-history

- 返回`docs/contracts/process-governance-version-history.json`的只读内容，`current_version`为`process-governance-v6`。
- 响应禁止缓存，不依赖当前页面草稿，不产生副作用。

## GET /api/enums

- 保持现有花名册岗位、组织部门、字段类型枚举，供属性面板和文字编制共用。

## 图编辑接口边界

图编辑是纯前端交互，不新增服务端接口。画布操作写入内存草稿后，复用`POST /api/validate`做即时校验。布局坐标不上送服务端。
