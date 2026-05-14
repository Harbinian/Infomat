# MDM 平台

## 快速启动

```bash
cd mdm-platform
npm install
set MDM_ADMIN_EMPLOYEE_NO=your-admin-no
set MDM_ADMIN_PASSWORD=your-long-random-password
npm run init-db
npm run smoke
npm start
```

访问 `http://localhost:3000`。

平台不会创建默认管理员。首次初始化前请通过环境变量提供管理员工号和不少于 12 位的初始密码。

## 功能模块

- 统计看板：各部门提交流程数、待办数、冲突数、字段台账完成率
- 数据报送：表单录入 + Excel 批量导入
- 审批流：提交 -> 部门内审 -> 跨部门确认 -> 字段台账确认 -> 终审
- 跨部门待办：给其他部门派发待办
- 冲突管理：字段冲突 + 术语冲突，severity 分级
- 术语词典：术语维护 + 审批流
- 版本记录：映射和字段台账的关键修改历史
- Excel 导入：字段台账模板上传，按角色执行列级权限
- Excel 导出：字段台账 + 黄金源矩阵 + 术语冲突台账

## 技术栈

- 前端：单文件 HTML（原生 JS + CSS，参考演示文件视觉风格）
- 后端：Express.js + SQLite (better-sqlite3)
- 认证：bcryptjs + express-session
- 导入/导出：multer + exceljs

## 常用命令

```bash
npm run init-db
npm run smoke
npm run test:org
npm run test:catalog
npm run test:mappings
npm run test:conflicts
npm run test:terms
npm run test:export
npm run test:import
npm run test:frontend
npm run test:security
```
