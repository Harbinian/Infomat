// Only domain UMD modules are loaded. The legacy page and its DOM event handlers are never loaded.
const MODULES = [
  ['GraphEditorState', 'graph-editor-state.js'], ['EditSessionManager', 'edit-session-manager.js'],
  ['GraphEditCommands', 'graph-edit-commands.js'], ['FormFieldReuse', 'form-field-reuse.js'],
  ['ProcessGovernanceMigration', 'process-governance-migration.js'], ['ImportCompatibility', 'import-compatibility.js'],
  ['WebGridCore', 'web-grid-core.js'], ['ProcessV7GridAdapter', 'process-v7-grid-adapter.js'], ['NativeWebGrid', 'native-web-grid.js'],
  ['ElementReferences', 'element-references.js'], ['ProcessDiagram', 'process-diagram.js'],
  ['DataRelationDiagram', 'data-relation-diagram.js'], ['LifecycleAnalyzer', 'lifecycle-analyzer.js'], ['StructureLearningScore', 'structure-score.js']
];
let loaded;
export function loadDomainModules() {
  if (!loaded) loaded = (async () => {
    for (const [name, file] of MODULES) {
      if (globalThis[name]) continue;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/${file}`; script.async = false;
        script.onload = resolve; script.onerror = () => reject(new Error(`本地领域模块加载失败：${file}`));
        document.head.append(script);
      });
    }
    return Object.freeze(Object.fromEntries(MODULES.map(([name]) => [name, globalThis[name]])));
  })().catch(error => { loaded = undefined; throw error; });
  return loaded;
}
export const DOMAIN_MODULE_FILES = Object.freeze(MODULES.map(([name, file]) => ({ name, file })));
