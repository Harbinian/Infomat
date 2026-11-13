import http from 'node:http';
import { allIps, isAllowedHost, json, port, send } from './http-interface.mjs';
import { batchReportCsv, batchTaskProgress } from './batch-report.mjs';
import { loadBatchPlans, loadCandidates, validateCandidateDraft } from './candidates.mjs';
import { loadPresentation, presentFields } from './presentation.mjs';
import { loadCatalogAudit, pendingNamesCsv } from './catalog-audit.mjs';
import { fieldId, fieldsAt, lineageTarget, loadCatalog, loadFieldCatalog, loadPositionCatalog,
  ReviewError, Store, validateMatrixSubmission, validateSubmission } from './store.mjs';

const material = loadCatalog(process.env.REVIEW_CATALOG_PATH);
const positions = loadPositionCatalog(process.env.REVIEW_POSITION_CATALOG_PATH);
const fieldCatalog = process.env.REVIEW_FIELD_CATALOG_PATH
  ? loadFieldCatalog(process.env.REVIEW_FIELD_CATALOG_PATH, material) : null;
const fieldAddendum = process.env.REVIEW_FIELD_ADDENDUM_PATH
  ? loadFieldCatalog(process.env.REVIEW_FIELD_ADDENDUM_PATH, material, fieldCatalog) : null;
const fieldExtension = process.env.REVIEW_FIELD_EXTENSION_PATH
  ? loadFieldCatalog(process.env.REVIEW_FIELD_EXTENSION_PATH, material, fieldCatalog) : null;
const auditExtension = process.env.REVIEW_FIELD_AUDIT_EXTENSION_PATH
  ? loadFieldCatalog(process.env.REVIEW_FIELD_AUDIT_EXTENSION_PATH, material, fieldCatalog) : null;
const fieldCatalogs = [fieldCatalog, fieldAddendum, fieldExtension, auditExtension].filter(Boolean);
if (auditExtension && [fieldCatalog, fieldAddendum, fieldExtension].some(snapshot =>
  !auditExtension.catalog.precedingDigests?.includes(snapshot.digest))) throw new Error('Audit extension does not preserve previous snapshots');
const { catalog, digest, items } = material;
const baseFields = fieldCatalog?.fields ?? material.fields;
const physicalFields = new Map(baseFields);
for (const snapshot of [fieldAddendum, fieldExtension, auditExtension].filter(Boolean)) {
  for (const [id, field] of snapshot.fields) {
    if (physicalFields.has(id)) throw new Error('Supplemental field overlaps an existing review identity');
    physicalFields.set(id, field);
  }
}
const presentation = loadPresentation(process.env.REVIEW_FIELD_PRESENTATION_PATH, physicalFields);
const fields = presentFields(physicalFields, presentation);
const selectableFields = [...fields.values()].filter(field =>
  !(field.system === '勤哲' && (/^dbo\.ES/i.test(field.table) || /ExcelServer/i.test(field.name))));
const catalogAudit = loadCatalogAudit(process.env.REVIEW_CATALOG_AUDIT_PATH, selectableFields, presentation);
const store = new Store(process.env.REVIEW_DATA_DIR, material, ...fieldCatalogs);
const lineageItems = catalog.items.filter(item => item.group === 'lineage');
const selectableIds = new Set(selectableFields.map(field => field.id));
const lineageByField = new Map();
for (const item of lineageItems) {
  for (const { table, name } of fieldsAt(lineageTarget(item))) {
    const id = fieldId(item.system, table, name);
    if (!selectableIds.has(id)) throw new Error('A lineage target is missing from the selectable catalog');
    if (!lineageByField.has(id)) lineageByField.set(id, []);
    lineageByField.get(id).push(item);
  }
}
const candidates = loadCandidates(process.env.REVIEW_CANDIDATE_CATALOG_PATH, selectableIds, lineageByField);
const firstBatch = { id: 'outline-revision', name: '制造大纲升版', fieldIds: [...lineageByField.keys()] };
const batches = loadBatchPlans(process.env.REVIEW_BATCH_PLANS_PATH, candidates, firstBatch, lineageByField);
const batchByField = new Map(batches.flatMap(batch => batch.fieldIds.map(id => [id, batch.id])));
async function readSubmission(request) {
  if (request.headers['content-type']?.split(';', 1)[0].trim() !== 'application/json') {
    throw new ReviewError(415, '请通过当前评审页面提交。');
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 64 * 1024) {
      request.resume();
      throw new ReviewError(413, '提交内容过长。');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ReviewError(400, '提交内容无法读取。');
  }
}

function reviewDigest(field) {
  return field?.catalogDigest ?? (field?.supplemental ? fieldCatalog.digest : digest);
}

function currentReviews() {
  const records = new Map([digest, ...fieldCatalogs.map(snapshot => snapshot.digest)].map(snapshot =>
    [snapshot, new Map(store.current(snapshot).map(record => [record.itemId, record]))]));
  return field => records.get(reviewDigest(field)).get(field.id);
}

function reviewProgress() {
  const currentReview = currentReviews();
  const emptyCounts = () => ({ total: 0, completed: 0, pending: 0, unreviewed: 0 });
  const total = emptyCounts();
  const systems = new Map();
  const batchCounts = Object.fromEntries(batches.map(batch => [batch.id, {
    ...emptyCounts(), tasks: {}, lineagePending: 0, missingLineage: {},
  }]));
  for (const field of selectableFields) {
    if (!systems.has(field.system)) systems.set(field.system, emptyCounts());
    const system = systems.get(field.system);
    const record = currentReview(field);
    const state = record?.completed === true ? 'completed' : record ? 'pending' : 'unreviewed';
    system.total++;
    system[state]++;
    total.total++;
    total[state]++;
    const references = lineageByField.get(field.id);
    if (references) {
      const batch = batchCounts[batchByField.get(field.id)];
      const { status: batchState, missing } = batchTaskProgress(record, references);
      batch.total++;
      batch[batchState]++;
      batch.tasks[field.id] = batchState;
      if (batchState === 'pending' && missing.length) {
        batch.lineagePending++;
        batch.missingLineage[field.id] = missing.length;
      }
    }
  }
  return { total, systems: [...systems].map(([system, counts]) => ({ system, ...counts })),
    batch: batchCounts[firstBatch.id], batches: batchCounts };
}

const server = http.createServer(async (request, response) => {
  try {
    const host = request.headers.host;
    if (!isAllowedHost(host)) throw new ReviewError(403, '请通过评审服务的 IP 地址和端口打开页面。');
    const pathname = new URL(request.url, `http://${host}`).pathname;
    if (request.method === 'GET') {
      if (pathname === '/api/health') {
        return json(response, 200, { service: 'data-lineage-review-service', scope: allIps ? 'all-ip' : 'local', storage: 'sqlite',
          catalogDigest: digest, fieldCatalogDigest: fieldCatalog?.digest,
          fieldAddendumDigest: fieldAddendum?.digest,
          fieldExtensionDigest: fieldExtension?.digest, fieldPresentationDigest: presentation?.digest,
          fieldAuditExtensionDigest: auditExtension?.digest, catalogAuditDigest: catalogAudit?.digest,
          auditedObjects: catalogAudit?.catalog.tables.length, namingCounts: presentation?.countsBySystem,
          u8LabelCounts: presentation?.countsBySystem?.['用友U8'] ?? presentation?.counts,
          lineageItems: lineageItems.length, keyItems: items.size - lineageItems.length, fieldItems: selectableFields.length,
          positionItems: positions.options.size, candidateTargets: candidates.targets.length, collectionBatches: batches.length });
      }
      if (pathname === '/api/fields') {
        return json(response, 200, { catalogDigest: digest, fieldCatalogDigest: fieldCatalog?.digest,
          fieldAddendumDigest: fieldAddendum?.digest, fieldExtensionDigest: fieldExtension?.digest,
          fieldPresentationDigest: presentation?.digest, fields: selectableFields,
          collection: { name: firstBatch.name, tasks: Object.fromEntries(lineageByField), batches },
          positionCatalog: { digest: positions.digest, source: positions.source, options: [...positions.options.values()] } });
      }
      if (pathname === '/api/progress') return json(response, 200, reviewProgress());
      if (pathname === '/api/catalog-audit') return json(response, 200, catalogAudit ?
        { ...catalogAudit.catalog, namingCounts: presentation.countsBySystem, pendingNameCount: catalogAudit.pendingFields.length,
          auditDigest: catalogAudit.digest } : { available: false });
      if (pathname === '/api/catalog-audit/pending-names.csv' && catalogAudit) {
        return send(response, 200, 'text/csv; charset=utf-8', pendingNamesCsv(catalogAudit),
          { 'Content-Disposition': 'attachment; filename="field-names-to-verify.csv"' });
      }
      const nameRoute = /^\/api\/fields\/([^/]+)\/name-reference$/.exec(pathname);
      if (nameRoute && presentation?.labels.has(nameRoute[1])) return json(response, 200, presentation.labels.get(nameRoute[1]));
      const batchReport = /^\/api\/collection-batches\/([a-z0-9-]+)\/report\.csv$/.exec(pathname);
      if (batchReport) {
        const batch = batches.find(item => item.id === batchReport[1]);
        if (!batch) throw new ReviewError(404, '收集批次不存在。');
        const currentReview = currentReviews();
        const tasks = batch.fieldIds.map(id => {
          const field = fields.get(id);
          return { field, references: lineageByField.get(id), review: currentReview(field) };
        });
        return send(response, 200, 'text/csv; charset=utf-8', batchReportCsv(batch, tasks, new Date().toISOString()),
          { 'Content-Disposition': `attachment; filename="field-review-${batch.id}.csv"` });
      }
      if (pathname === '/api/lineage-candidates') return json(response, 200, candidates);
      if (pathname === '/api/catalog') {
        return json(response, 200, { ...catalog, catalogDigest: digest, current: store.current().filter(record => items.has(record.itemId)) });
      }
      if (pathname === '/api/export') {
        const records = store.exportRecords();
        return json(response, 200, { format: 'field-lineage-review-export-v1', exportedAt: new Date().toISOString(),
          catalogDigest: digest, catalog, fieldCatalogDigest: fieldCatalog?.digest, fieldCatalog: fieldCatalog?.catalog,
          fieldAddendumDigest: fieldAddendum?.digest, fieldAddendum: fieldAddendum?.catalog,
          fieldExtensionDigest: fieldExtension?.digest, fieldExtension: fieldExtension?.catalog,
          fieldPresentationDigest: presentation?.digest, fieldPresentation: presentation?.catalog,
          fieldAuditExtensionDigest: auditExtension?.digest, fieldAuditExtension: auditExtension?.catalog,
          catalogAuditDigest: catalogAudit?.digest, catalogAudit: catalogAudit?.catalog,
          history: records.filter(record => items.has(record.itemId)),
          matrixHistory: [
            ...records.filter(record => fields.has(record.itemId))
              .map(record => ({ ...record, catalogDigest: digest, field: fields.get(record.itemId) })),
            ...fieldCatalogs.flatMap(snapshot => store.exportRecords(snapshot.digest)
              .map(record => ({ ...record, catalogDigest: snapshot.digest, field: fields.get(record.itemId) }))),
          ] },
        { 'Content-Disposition': 'attachment; filename="field-lineage-review-results.json"' });
      }
    }
    if (pathname === '/api/lineage-candidates/validate' && request.method === 'POST') {
      if (request.headers.origin !== `http://${host}`) throw new ReviewError(403, '请通过当前评审页面核验草案。');
      return json(response, 200, validateCandidateDraft(await readSubmission(request), candidates));
    }
    const matrixRoute = /^\/api\/fields\/([^/]+)\/matrix$/.exec(pathname);
    const field = matrixRoute && fields.get(matrixRoute[1]);
    const matrixDigest = reviewDigest(field);
    if (field && request.method === 'GET') return json(response, 200, { review: store.latest(field.id, matrixDigest) });
    if (field && request.method === 'POST') {
      if (request.headers.origin !== `http://${host}`) throw new ReviewError(403, '请通过当前矩阵页面保存。');
      const submission = validateMatrixSubmission(await readSubmission(request), matrixDigest, positions,
        version => store.version(field.id, version, matrixDigest), lineageByField.get(field.id));
      return json(response, 200, { review: store.save(field.id, submission, matrixDigest) });
    }
    const match = /^\/api\/items\/([^/]+)\/reviews$/.exec(pathname);
    const item = match && items.get(match[1]);
    if (item && request.method === 'GET') return json(response, 200, { history: store.history(item.id) });
    if (item && request.method === 'POST') {
      if (request.headers.origin !== `http://${host}`) throw new ReviewError(403, '写入请求必须来自当前评审页面。');
      const submission = validateSubmission(await readSubmission(request), item, digest);
      return json(response, 200, { review: store.save(item.id, submission) });
    }
    throw new ReviewError(404, '评审接口或条目不存在。');
  } catch (error) {
    if (error instanceof ReviewError) return json(response, error.status, { message: error.message });
    console.error(error);
    return json(response, 500, { message: '本地服务暂时无法确认保存。输入可以保留后重试。' });
  }
});

server.listen(port, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => store.close()));
}
