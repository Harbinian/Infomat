# AGENTS.md

本目录是信息表收集服务，4000 提供表单设计与任务管理，4001 提供内部实名填报。

## 修改边界

- 本应用只读取现有 `person`、`user_accounts`、`departments` 身份数据；不得修改 3000 的固定角色、权限和治理业务表。
- 本应用运行数据只写入 `collection_*` 表。附件正文写入 `COLLECTION_FILE_ROOT`，不得提交到仓库。
- 4000 和 4001 使用独立会话和路由。4001 不得调用 4000 的管理接口。
- 不增加匿名填报、自助开户、审核退回、消息通知、条件跳转或重复明细表，除非用户重新确认范围。
- 发布后的表单版本和填报人员快照不可修改。状态变化必须走明确的业务动作接口并写审计记录。
- 任何答卷写入必须在服务端校验表单版本、本人任务、任务状态和 `expectedRevision`。
- 只有从未发布、没有版本和任务记录的表单设计稿可以物理删除，且删除不可恢复。已经发布或已有历史记录的表单只能归档；取消、归档和附件移除只改变状态并保留审计证据。

## 安全要求

- 不读取、输出或保存密码、会话令牌和本机私有环境变量值。
- 生产环境未配置 `COLLECTION_AV_SCAN_COMMAND` 时，服务必须禁用附件上传。
- 附件必须保存在静态目录之外，使用随机存储名；下载前重新校验本人任务或管理部门范围。
- 审计记录不得保存完整答案、附件内容或密码。

## 运行与验证

```powershell
npm test
npm run migrate:dry-run
npm run migrate:apply
npm run bootstrap:admin
npm start
npm run smoke
```

从仓库根目录运行固定入口：

```powershell
npm run test:information-collection
npm run migrate:information-collection:dry-run
npm run migrate:information-collection:apply
npm run start:information-collection
npm run smoke:information-collection
```
