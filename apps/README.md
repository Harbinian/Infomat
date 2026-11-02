# apps 说明

本目录维护可运行应用、应用源码和应用内维护脚本。业务资料原件、PMO 页面及跨应用脚本按根目录职责分别维护。

## 应用入口

| 应用 | 用途与边界 | 维护入口 |
|---|---|---|
| `mdm-platform/` | 3000 流程与数据治理平台；当前重点为平台内编制、保存草稿、提交、核对和审核发布 | [应用入口](mdm-platform/AGENTS.md)、[README](mdm-platform/README.md) |
| `structured-output-service/` | 3001 独立、无状态的单流程编制工具；用户主动下载后手工上传 3000 | [应用入口](structured-output-service/AGENTS.md)、[README](structured-output-service/README.md) |
| `u8-stock-order-query/` | 3088 U8 出入库订单归属及销售质量编号核查，只读查询；整个目录仅在本机保留，不随 Git 分发 | 本机目录下的 `README.md` |
| `information-collection-service/` | 4000 管理端与 4001 填报端；当前暂缓开发和正式启用，业务数据使用独立 `collection_*` 表 | [应用入口](information-collection-service/AGENTS.md)、[README](information-collection-service/README.md) |
| `slack-bot/` | Slack 问答机器人；读取和写入范围按提问者授权控制 | [应用入口](slack-bot/AGENTS.md)、[README](slack-bot/README.md) |

## 开发边界

- 先进入主责应用，按其局部入口、README 和 `package.json` 选择实现、配置及验证。格式版本、权限、功能开关和恢复条件由应用维护，目录索引不重复保存。
- 3000 为组织与员工信息的唯一维护源，由行政人事维护；Excel 仅作明确导入材料。其他系统逐个接入统一读取接口，不能从旧副本推定职责或授权。
- 当前编制主线为 3000 内编制与治理；JSON 可下载到知识库 AI 对话编辑后导回，导回内容不继承审核状态。3001 人工文件交接兼容保留，两者不自动互写或共享数据库。
- `docs/` 保存技术合同、资料副本及历史记录，不作为业务真源或治理依据。历史消费链只在明确兼容任务中维护，不自动同步数据库。
- 跨应用、跨 PMO 或跨资料的脚本放在根 `scripts/`。新增应用须有独立 README，写清运行命令、数据边界、验证方式和本地状态的保留规则。
- 源码能力不证明应用正在运行、功能已经开启或业务已经验收；目标状态按实际实例核对。
