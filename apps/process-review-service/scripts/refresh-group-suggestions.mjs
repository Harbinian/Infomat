/** Refresh grouping proposals only for unconfirmed, unfrozen local material; preserve raw snapshots and decisions. */
import { Store } from '../store.mjs';
import { suggestTheme } from '../topics.mjs';
const store = new Store();
try {
  const state = store.read();
  const changes = state.materials.filter(material => material.status === 'pending' && !state.batches.some(batch => batch.status === 'frozen' && batch.materialIds.includes(material.id)))
    .map(material => ({ materialId: material.id, before: material.themeId, after: suggestTheme(material.name, material.sourcePath) }))
    .filter(change => change.after && change.before !== change.after);
  if (process.argv.includes('--apply') && changes.length) {
    store.transaction(state.revision, 'local-pmo', 'material.group_suggestions', current => {
      for (const change of changes) current.materials.find(material => material.id === change.materialId).themeId = change.after;
      return { detail: { changes, rehearsal: true, reason: '候选分组规则更新；有效材料与主题仍待部门确认' } };
    });
  }
  console.log(JSON.stringify({ applied: process.argv.includes('--apply'), changes: changes.length, ungrouped: store.read().materials.filter(material => !material.themeId).length }));
} finally { store.close(); }
