import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {sharedEditorPresentation} from '../sharedEditorPresentation.js';
const shared = new URL('../../../structured-output-service/frontend/Workbench.jsx',import.meta.url);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
test('3000 changes only four shared visible labels and leaves shared source plus import handlers exact',()=>{
  const bytes=fs.readFileSync(shared),source=bytes.toString('utf8');
  const result=sharedEditorPresentation(source,shared.pathname);
  assert(result);
  assert(!result.code.includes('上传JSON草稿'));
  assert(!result.code.includes('>导入 JSON</Button>'));
  const restored=result.code.replaceAll("'上传草稿'","'上传JSON草稿'").replaceAll("'导入编制文件'","'导入 JSON 文件'").replaceAll('>导入编制文件</Button>','>导入 JSON</Button>');
  assert.equal(restored,source);
  assert.equal(hash(fs.readFileSync(shared)),hash(bytes));
  assert.equal(sharedEditorPresentation(source,'/different/Workbench.jsx'),null);
  assert.throws(()=>sharedEditorPresentation(source.replace("'上传JSON草稿'","'changed upstream'"),shared.pathname),/LABEL_CONTRACT_CHANGED/);
});
