# 信息表收集服务

本应用为内部员工提供可追溯的信息收集入口：4000 负责设计表单、发布任务、查看完成情况和导出；4001 负责本人填报、服务器草稿、提交和截止前修改。

## 系统边界

- 身份来源：只读复用 `infomat_mdm` 的 `person -> user_accounts` 链路。
- 业务数据：只写入 `collection_*` 表，不写 3000 治理业务表。
- 附件正文：写入 `COLLECTION_FILE_ROOT`；MySQL 只保存元数据、哈希和扫描状态。
- 运行依赖：MySQL，不依赖正在运行的 3000、3001 或 PMO 服务。
- 首期非目标：匿名填报、审核退回、消息通知、条件跳转，以及对已有发布历史的表单、任务、答卷和附件执行物理删除。

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
- 一个表单可以包含多个主表分区和多个独立明细表。4001 在桌面端按“字段为列、记录为行”的网格展示明细表；填报人可以逐格录入，也可以从本地 Excel 复制连续单元格后直接粘贴，不需要上传 Excel 文件。
- 系统在粘贴前检查整块数据的行列范围、字段类型和字段校验规则。任一单元格不符合要求时，本次粘贴全部不生效；检查通过后，系统自动补足明细行并保存服务器草稿。填报人可以撤销最近一次粘贴，也可以新增、复制、删除和排序明细行；每个明细表最多 100 行。
- 4001 使用紧凑的表格工作台布局：左侧为窄任务导航，右侧为铺满可用空间的答卷网格，任务标题、状态和保存修订集中显示在顶部工具栏。桌面端页面不再使用大幅留白的纸张式卡片布局。
- 明细表支持文本、数字、日期、选择、是/否、人员和部门字段。附件字段当前只能放在主表中。
- 发布前，页面检查设计稿至少包含一个字段并检查填报范围；当前页面有未保存修改时，先保存设计稿，再由服务端固化发布版本。
- “预览表单”按 4001 的字段控件展示当前页面设计稿；预览输入不保存，也不生成任务或答卷。
- “归档表单”用于从默认列表移除不再使用的表单。系统不物理删除表单，历史任务和答卷保持不变。
- “删除表单”只适用于从未发布、没有版本和任务记录的设计稿。删除操作不可恢复；已经发布过的表单只能归档。
- 同一人员在同一任务中只有一份当前答卷。
- 草稿自动保存到 MySQL。填报人执行“提交”后，答卷才计入已完成。
- 同一答卷发生 `409 REVISION_CONFLICT` 时，页面保留本页内容并读取服务器最新修订。填报人必须明确选择采用服务器内容，或者在服务器答卷仍为开放草稿时选择保留本页内容并重新保存；系统不自动覆盖任一版本。冲突未处理前，页面不允许重新打开或切换任务。
- 截止前，填报人可以重新编辑；系统保留每次正式提交的完整快照。
- 截止后或任务取消后，答卷和附件只读保留。
- Excel 导出把主表字段放在“答卷明细”工作表中，并为每张明细表生成独立工作表。

## 文档入口

- [PRD.md](docs/PRD.md)
- [Tech-Spec.md](docs/Tech-Spec.md)
- [API-Contract.md](docs/API-Contract.md)
- [DB-Schema.md](docs/DB-Schema.md)
- [Permission-Matrix.md](docs/Permission-Matrix.md)
- [Deployment-Runbook.md](docs/Deployment-Runbook.md)
