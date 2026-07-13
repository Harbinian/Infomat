import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../gantt-react');
const deliverablesDir = path.resolve(root, '../deliverables');
const fixturePath = path.join(deliverablesDir, 'DLV-200-端点测试.md');
const runtimeRoot = path.resolve(root, '../../artifacts/pmo/deliverables/test-plugin-endpoints');
const requireFromApp = createRequire(path.join(root, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromApp.resolve('vite')).href);
const { pmoDeliverablesPlugin } = await import(pathToFileURL(path.join(root, 'plugins/pmoDeliverablesPlugin.js')).href);

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

process.env.PMO_DELIVERABLE_RUNTIME_DIR = runtimeRoot;
await fsp.rm(runtimeRoot, { recursive: true, force: true });
await fsp.rm(path.join(deliverablesDir, '_history', 'DLV-200'), { recursive: true, force: true });

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
  assert.equal(uploadJson.data.runtimeRoot, runtimeRoot);
  assert.ok(uploadJson.data.archivePath.includes('upload-upload.md'));
  assert.ok(fs.existsSync(path.join(runtimeRoot, uploadJson.data.archivePath)));
  assert.equal(
    fs.existsSync(path.join(deliverablesDir, '_history', 'DLV-200')),
    false,
    'runtime uploads must not be written under pmo/deliverables/_history'
  );

  console.log('结果: 6 端点 + If-Match + schema + upload 错误码/归档全部通过');
} finally {
  await server.close();
  await fsp.rm(fixturePath, { force: true });
  await fsp.rm(path.join(deliverablesDir, '_history', 'DLV-200'), { recursive: true, force: true });
  await fsp.rm(runtimeRoot, { recursive: true, force: true });
}

const duplicateRoot = path.resolve(root, '../../artifacts/pmo/deliverables/test-duplicate-upload');
const duplicateDeliverablesDir = path.join(duplicateRoot, 'deliverables');
const duplicateRuntimeRoot = path.join(duplicateRoot, 'runtime');
const duplicateBody = title => `---
deliverableId: DLV-201
title: ${title}
status: 未提交
deliverableType: 方案规范类
deliverableLevel: B
department: 测试部门
plannedFinish: 2026-06-05
workflowHistory: []
---
# ${title}
`;

await fsp.rm(duplicateRoot, { recursive: true, force: true });
await fsp.mkdir(duplicateDeliverablesDir, { recursive: true });
await fsp.writeFile(path.join(duplicateDeliverablesDir, 'DLV-201-正本A.md'), duplicateBody('正本A'), 'utf8');
await fsp.writeFile(path.join(duplicateDeliverablesDir, 'DLV-201-正本B.md'), duplicateBody('正本B'), 'utf8');

const duplicateServer = await createServer({
  configFile: false,
  root,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  logLevel: 'silent',
  plugins: [pmoDeliverablesPlugin({
    deliverablesDir: duplicateDeliverablesDir,
    runtimeRoot: duplicateRuntimeRoot,
  })],
});

try {
  await duplicateServer.listen();
  const address = duplicateServer.httpServer.address();
  const port = typeof address === 'object' ? address.port : 5173;
  const base = `http://127.0.0.1:${port}/api/pmo/deliverables`;
  const form = new FormData();
  form.append('file', new File(['# 上传正文\n'], 'upload.md', { type: 'text/markdown' }));
  const duplicateUpload = await fetch(`${base}/DLV-201/upload`, { method: 'POST', body: form });
  const duplicateJson = await duplicateUpload.json();
  assert.equal(duplicateUpload.status, 409);
  assert.equal(duplicateJson.error.code, 'DUPLICATE_DELIVERABLE');
  assert.deepEqual(
    fs.readdirSync(duplicateDeliverablesDir).filter(name => name.startsWith('DLV-201-')).sort(),
    ['DLV-201-正本A.md', 'DLV-201-正本B.md'],
    'duplicate upload must not create another canonical markdown file',
  );
  assert.equal(
    fs.existsSync(path.join(duplicateRuntimeRoot, '_history', 'DLV-201')),
    false,
    'duplicate upload must not archive evidence before the canonical conflict is resolved',
  );
  console.log('结果: 重复正本上传冲突保护通过');
} finally {
  await duplicateServer.close();
  await fsp.rm(duplicateRoot, { recursive: true, force: true });
}
