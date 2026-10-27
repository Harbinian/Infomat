// Only the 3000 consumer uses this build-time label projection. Shared source,
// controller behavior, file bytes and the independent 3001 build stay unchanged.
const labels = [
  ["'上传JSON草稿'", "'上传草稿'", 2],
  ["'导入 JSON 文件'", "'导入编制文件'", 1],
  ['>导入 JSON</Button>', '>导入编制文件</Button>', 1]
];

export function sharedEditorPresentation(source, id) {
  const filename = String(id).replaceAll('\\', '/').split('?')[0];
  if (!filename.endsWith('/apps/structured-output-service/frontend/Workbench.jsx')) return null;
  let code = source;
  for (const [before, after, expected] of labels) {
    if (code.split(before).length - 1 !== expected) throw new Error('SHARED_EDITOR_LABEL_CONTRACT_CHANGED');
    code = code.replaceAll(before, after);
  }
  return {code, map:null};
}
