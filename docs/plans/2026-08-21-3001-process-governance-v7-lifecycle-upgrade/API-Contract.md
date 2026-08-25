# 接口约定：3001 process-governance-v7

## 1. 版本端点

| 接口 | v7约定 |
|---|---|
| `GET /api/schema` | 默认返回v7结构规则，并设置v7摘要响应头 |
| `GET /api/schema?version=process-governance-v7` | 返回v7结构规则 |
| `GET /api/schema?version=process-governance-v1..v6` | 继续返回对应历史结构规则 |
| `GET /api/schema?version=<未知版本>` | 返回400和`UNSUPPORTED_SCHEMA_VERSION`，不回退到默认v7 |
| `GET /api/template` | 默认返回v7空白模板 |
| `GET /api/template?version=process-governance-v7` | 返回`app_commit`、`schema_version`、`schema_digest`和v7空白数据 |
| `GET /api/template?version=process-governance-v5|v6` | 保留兼容读取，不作为页面新建目标 |
| `GET /api/version-history` | 包含v7发布状态和兼容边界；`current_status=released`，并记录发布日期 |
| `GET /api/health` | `schema_version=process-governance-v7`、`release_status=released`，摘要与默认结构一致 |

## 2. 校验与迁移

`POST /api/validate`接受v1至v7和`document-structured-output-v2`。该接口只校验请求内容，不迁移、不存储内容。前端迁移目标固定为v7；旧版本文件完成迁移并通过v7校验后，才进入当前页面。

前端导入早期v7时可以提交`validation_profile=early-v7-data-fields`。该配置只放宽`fields`、`data_field_ref`、`value_usage_mode`和`updated_field_refs`的后增必填限制；`schema_version`必须为`process-governance-v7`。非法枚举、额外字段和引用错误继续返回校验失败。未知配置、配置与版本不匹配均返回400。

v7校验同时检查对象字段、表单引用和更新字段引用：`data_field_ref`必须引用`business_data_ref`所指对象下的`fields[]`；表单字段类型必须与对象字段类型一致；`updated_field_refs[]`只能用于`operation=update`，且每项必须引用当前数据对象下的字段。断裂引用、跨对象引用、类型不一致，以及非更新操作保留更新字段，均返回可定位的结构错误。更新操作暂未选择字段、多个权威录入位置、没有建立位置的复用和同名不同类型属于业务提示，不由接口自动选择或改写。

状态码保持：请求缺少数据返回400；不支持的结构版本返回400；正文或上传文件超过10MB返回413；DOCX解析并发已满返回429；结构不合格仍返回可诊断的校验结果，不写服务端业务内容。畸形JSON、超深对象、超长文字、异常Unicode和解析失败均返回稳定JSON错误码。生产响应不包含绝对路径、堆栈、模块名或原始异常详情。

`POST /api/upload`和`POST /api/parse-paste`只保留历史材料解析用途，不是3001草稿保存接口。上传接口只接受一个不超过10MB的`.docx`、`.txt`或`.md`文件；DOCX还执行解压边界、路径和5秒解析时限检查。两项接口都不得记录或持久化材料内容。

## 3. 无状态边界

`/api/session`、`/api/data`和`/api/export`继续返回404。服务端不保存材料、草稿、对象字段、表单引用、生命周期建议、否决原因或下载文件。
