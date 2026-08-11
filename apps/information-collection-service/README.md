# 信息表收集服务

本应用为内部员工提供可追溯的信息收集入口：4000 负责设计表单、发布任务、查看完成情况和导出；4001 负责本人填报、服务器草稿、提交和截止前修改。

## 系统边界

- 身份来源：只读复用 `infomat_mdm` 的 `person -> user_accounts` 链路。
- 业务数据：只写入 `collection_*` 表，不写 3000 治理业务表。
- 附件正文：写入 `COLLECTION_FILE_ROOT`；MySQL 只保存元数据、哈希和扫描状态。
- 运行依赖：MySQL，不依赖正在运行的 3000、3001 或 PMO 服务。
- 首期非目标：匿名填报、审核退回、消息通知、条件跳转、重复明细表和物理删除。

## 首次部署

1. 将 `MYSQL_PASSWORD` 放入仓库已忽略的 `scripts/infomat-services.local.env` 或受控运行环境。
2. 执行 `npm run migrate:information-collection:dry-run`。运维人员确认目标为 `infomat_mdm`、身份结构通过且只计划创建 `collection_*` 表。
3. 执行 `npm run migrate:information-collection:apply`。
4. 显式设置首位管理员工号，然后执行：

```powershell
$env:COLLECTION_BOOTSTRAP_ADMIN_EMPLOYEE_NO='实际工号'
npm --prefix apps/information-collection-service run bootstrap:admin
```

5. 执行 `npm run start:information-collection` 和 `npm run smoke:information-collection`。

不得把 3000 的 `admin` 角色自动映射为信息收集管理员。部署负责人必须确认首位管理员工号后再执行初始化。

## 本地访问

- 后台：`http://127.0.0.1:4000`
- 填报：`http://127.0.0.1:4001`

局域网部署必须通过 HTTPS 反向代理提供访问，并设置：

- `COLLECTION_BIND_HOST=0.0.0.0`
- `COLLECTION_SECURE_COOKIES=1`
- `COLLECTION_TRUST_PROXY=1`
- `COLLECTION_FILE_ROOT=<仓库外受控目录>`
- `COLLECTION_AV_SCAN_COMMAND=<病毒扫描程序>`
- `COLLECTION_AV_SCAN_ARGS=<JSON 参数数组，使用 {file} 代表待扫描文件>`

## 表单与答卷规则

- 表单设计稿可以修改；发布任务时，系统固化不可变版本和填报人员快照。
- 同一人员在同一任务中只有一份当前答卷。
- 草稿自动保存到 MySQL。填报人执行“提交”后，答卷才计入已完成。
- 截止前，填报人可以重新编辑；系统保留每次正式提交的完整快照。
- 截止后或任务取消后，答卷和附件只读保留。

## 文档入口

- [PRD.md](docs/PRD.md)
- [Tech-Spec.md](docs/Tech-Spec.md)
- [API-Contract.md](docs/API-Contract.md)
- [DB-Schema.md](docs/DB-Schema.md)
- [Permission-Matrix.md](docs/Permission-Matrix.md)
- [Deployment-Runbook.md](docs/Deployment-Runbook.md)
