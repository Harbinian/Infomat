import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../gantt-react');
const deliverablesDir = path.resolve(root, '../deliverables');
const fixturePath = path.join(deliverablesDir, 'DLV-200-端点测试.md');

fs.writeFileSync(fixturePath, `---
deliverableId: DLV-200
title: 端点测试
status: 未提交
deliverableType: 过程记录类
deliverableLevel: D
department: 测试部门
plannedFinish: 2026-06-05
workflowHistory: []
---
# 端点测试

正文。

## 变更记录
| 版本 | 状态 | 动作 | 责任人 | 时间 | 备注 |
| --- | --- | --- | --- | --- | --- |
`);

const server = await createServer({
  configFile: path.join(root, 'vite.config.js'),
  root,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  logLevel: 'silent',
});

try {
  await server.listen();
  const address = server.httpServer.address();
  const port = typeof address === 'object' ? address.port : 5173;
  const base = `http://127.0.0.1:${port}/api/pmo/deliverables`;

  const list = await fetch(base).then(r => r.json());
  assert.equal(list.ok, true);
  assert.ok(list.data.find(item => item.deliverableId === 'DLV-200'));

  const one = await fetch(`${base}/DLV-200`).then(r => r.json());
  assert.equal(one.ok, true);
  assert.equal(one.data.frontmatter.status, '未提交');

  const raw = await fetch(`${base}/DLV-200/raw`).then(r => r.text());
  assert.ok(raw.includes('title: 端点测试'));

  const notFound = await fetch(`${base}/DLV-999`);
  assert.equal(notFound.status, 404);

  const updatedRaw = raw.replace('status: 未提交', 'status: 已提交').replace('workflowHistory: []', `workflowHistory:
  - action: submit
    label: 提交
    from: 未提交
    to: 已提交
    actor: 测试部门
    at: 2026-06-05T09:00:00.000Z
    note: 提交`);
  const putOk = await fetch(`${base}/DLV-200`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown', 'If-Match': String(one.data.mtime) },
    body: updatedRaw,
  });
  assert.equal(putOk.status, 200);

  const conflict = await fetch(`${base}/DLV-200`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown', 'If-Match': '0' },
    body: updatedRaw,
  });
  assert.equal(conflict.status, 409);

  const badSchema = await fetch(`${base}/DLV-200`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown' },
    body: '---\ntitle: 缺字段\n---\n# 错',
  });
  assert.equal(badSchema.status, 400);

  const pdfForm = new FormData();
  pdfForm.append('file', new File(['fake'], 'fake.pdf', { type: 'application/pdf' }));
  const pdfUpload = await fetch(`${base}/DLV-200/upload`, { method: 'POST', body: pdfForm });
  assert.equal(pdfUpload.status, 400);
  assert.equal((await pdfUpload.json()).error.code, 'UPLOAD_UNSUPPORTED_EXT');

  const mdForm = new FormData();
  mdForm.append('file', new File(['# 上传正文\n'], 'upload.md', { type: 'text/markdown' }));
  const mdUpload = await fetch(`${base}/DLV-200/upload`, { method: 'POST', body: mdForm });
  assert.equal(mdUpload.status, 200);
  const uploadJson = await mdUpload.json();
  assert.ok(uploadJson.data.archivePath.includes('upload-upload.md'));
  assert.ok(fs.existsSync(path.join(deliverablesDir, uploadJson.data.archivePath)));

  console.log('结果: 6 端点 + If-Match + schema + upload 错误码/归档全部通过');
} finally {
  await server.close();
  await fsp.rm(fixturePath, { force: true });
  await fsp.rm(path.join(deliverablesDir, '_history', 'DLV-200'), { recursive: true, force: true });
}
