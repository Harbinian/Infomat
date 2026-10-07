(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ElementReferences = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createElementReferencesApi() {
  'use strict';

  const array = value => Array.isArray(value) ? value : [];
  const present = value => typeof value === 'string' && value.length > 0;
  const text = value => value == null ? '' : String(value);
  const targetKey = target => target ? JSON.stringify([target.kind, target.parentRef || '', target.ref]) : '';
  const targetFor = (kind, ref, parentRef = '') => present(ref) ? { kind, ref, parentRef } : null;
  const copyTarget = target => target ? { ...target } : null;
  const addToIndex = (index, key, entry) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(entry);
  };

  // A read-only navigation projection of the existing JSON contract. Names never resolve references.
  // Existence/ownership here is not evidence of business execution or a replacement for schema validation.
  function buildCatalog(documentValue) {
    const document = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const nodes = [];
    const identities = [];
    const references = [];
    const pending = [];
    const identitiesByRef = new Map();
    const identitiesByPath = new Map();
    const nodesByRef = new Map();
    const referencesByPath = new Map();

    function identity(kind, item, key, path, target = null, label = '') {
      const ref = item && item[key];
      if (!present(ref)) return;
      const entry = { kind, ref, path: `${path}/${key}`, target: copyTarget(target), label };
      identities.push(entry);
      addToIndex(identitiesByRef, ref, entry);
      identitiesByPath.set(entry.path, entry);
    }

    function node(kind, item, key, path, label, parentRef = '', ownerRefs = [], scope = {}, legacyIdentityTarget = undefined) {
      const ref = item && item[key];
      const target = targetFor(kind, ref, parentRef);
      identity(kind, item, key, path, legacyIdentityTarget === undefined ? target : legacyIdentityTarget, label);
      if (!target) return null;
      const entry = { id: path, kind, ref, parentRef, label, path, target, ownerRefs: [...ownerRefs], scope: { ...scope }, ambiguous: false };
      nodes.push(entry);
      addToIndex(nodesByRef, ref, entry);
      return target;
    }

    function reference(kind, ref, path, relationLabel, sourceTarget, options = {}) {
      // Nullable references mean "not referenced". Do not invent a missing object for them.
      if (!present(ref)) return;
      pending.push({ kind, ref, path, relationLabel, sourceTarget: copyTarget(sourceTarget), ...options });
    }

    identity('package', document.export_meta, 'package_ref', '/export_meta');
    node('process', document.process, 'process_ref', '/process', text(document.process && document.process.process_name) || '未命名流程');
    array(document.terms).forEach((item, index) => node('term', item, 'term_ref', `/terms/${index}`, text(item && item.term_name) || '未命名术语'));

    array(document.behaviors).forEach((behavior, index) => {
      const path = `/behaviors/${index}`;
      const target = node('behavior', behavior, 'behavior_ref', path, text(behavior && behavior.behavior_name) || '未命名环节');
      reference('data', behavior && behavior.actor_department_data_ref, `${path}/actor_department_data_ref`, '动态执行部门依据', target);
    });

    array(document.flow_relations).forEach((relation, index) => {
      const path = `/flow_relations/${index}`;
      const target = node('relation', relation, 'relation_ref', path, text(relation && relation.relation_ref) || '未命名流程关系');
      reference('behavior', relation && relation.from_behavior_ref, `${path}/from_behavior_ref`, '路线起点', target);
      reference('behavior', relation && relation.to_behavior_ref, `${path}/to_behavior_ref`, '路线终点', target);
    });

    array(document.data_objects).forEach((data, dataIndex) => {
      const path = `/data_objects/${dataIndex}`;
      const dataRef = data && data.data_ref || '';
      const dataLabel = text(data && data.data_name) || '未命名数据对象';
      const target = node('data', data, 'data_ref', path, dataLabel);
      array(data && data.fields).forEach((field, index) => {
        node('data-field', field, 'field_ref', `${path}/fields/${index}`, `${dataLabel} / ${text(field && field.field_name) || '未命名对象字段'}`, dataRef, [dataRef], { dataRef });
      });
      array(data && data.behavior_links).forEach((link, index) => {
        const linkPath = `${path}/behavior_links/${index}`;
        const operation = link && link.operation;
        const operationLabel = { create: '创建', update: '更新', use: '使用', pending_confirmation: '待确认操作' }[operation] || '数据操作';
        node('data-link', link, 'link_ref', linkPath, `${dataLabel} / ${operationLabel}`, dataRef, [dataRef], { dataRef }, target);
        reference('behavior', link && link.behavior_ref, `${linkPath}/behavior_ref`, `${operationLabel}数据的环节`, target);
        array(link && link.updated_field_refs).forEach((ref, fieldIndex) => reference('data-field', ref, `${linkPath}/updated_field_refs/${fieldIndex}`, '更新的对象字段', target, { expectedOwnerRef: dataRef }));
      });
      array(data && data.source_relations).forEach((source, index) => {
        const sourcePath = `${path}/source_relations/${index}`;
        node('data-source', source, 'source_ref', sourcePath, `${dataLabel} / ${text(source && source.source_data_name) || '未命名来源'}`, dataRef, [dataRef], { dataRef }, target);
        reference('behavior', source && source.available_from_behavior_ref, `${sourcePath}/available_from_behavior_ref`, '来源数据在本流程的可用位置', target);
      });
      array(data && data.lifecycle && data.lifecycle.routes).forEach((route, index) => {
        const routePath = `${path}/lifecycle/routes/${index}`;
        const routeRef = route && route.route_ref || '';
        node('lifecycle-route', route, 'route_ref', routePath, `${dataLabel} / ${text(route && route.route_label) || '未命名生命周期路径'}`, dataRef, [dataRef], { dataRef }, target);
        array(route && route.flow_relation_refs).forEach((ref, relationIndex) => reference('relation', ref, `${routePath}/flow_relation_refs/${relationIndex}`, '生命周期路径对应路线', target));
        array(route && route.events).forEach((event, eventIndex) => {
          const eventPath = `${routePath}/events/${eventIndex}`;
          node('lifecycle-event', event, 'event_ref', eventPath, `${dataLabel} / ${text(event && event.action) || '未命名生命周期事件'}`, routeRef, [dataRef, routeRef], { dataRef, routeRef }, target);
          reference('behavior', event && event.trigger && event.trigger.behavior_ref, `${eventPath}/trigger/behavior_ref`, '生命周期事件触发环节', target);
        });
      });
    });

    array(document.forms).forEach((form, formIndex) => {
      const path = `/forms/${formIndex}`;
      const formRef = form && form.form_ref || '';
      const formLabel = text(form && form.form_name) || '未命名表单';
      const target = node('form', form, 'form_ref', path, formLabel);
      array(form && form.behavior_links).forEach((link, index) => {
        const linkPath = `${path}/behavior_links/${index}`;
        node('form-link', link, 'link_ref', linkPath, `${formLabel} / 处理关系`, formRef, [formRef], { formRef }, target);
        reference('behavior', link && link.behavior_ref, `${linkPath}/behavior_ref`, '处理表单的环节', target);
      });
      array(form && form.areas).forEach((area, areaIndex) => {
        const areaPath = `${path}/areas/${areaIndex}`;
        const areaRef = area && area.area_ref || '';
        const areaLabel = text(area && (area.area_title || area.area_type)) || '未命名区域';
        node('form-area', area, 'area_ref', areaPath, `${formLabel} / ${areaLabel}`, formRef, [formRef], { formRef, areaRef });
        array(area && area.items).forEach((item, itemIndex) => {
          const itemPath = `${areaPath}/items/${itemIndex}`;
          const itemTarget = node('form-item', item, 'item_ref', itemPath, `${formLabel} / ${areaLabel} / ${text(item && item.item_name) || '未命名表单字段'}`, formRef, [formRef, areaRef], { formRef, areaRef });
          reference('data', item && item.business_data_ref, `${itemPath}/business_data_ref`, '字段归属的数据对象', itemTarget);
          reference('data-field', item && item.data_field_ref, `${itemPath}/data_field_ref`, '引用的对象字段', itemTarget, { expectedOwnerRef: item && item.business_data_ref || '' });
          array(item && item.source_links).forEach((source, sourceIndex) => {
            const sourcePath = `${itemPath}/source_links/${sourceIndex}`;
            node('field-source', source, 'source_link_ref', sourcePath, `${text(item && item.item_name) || '未命名表单字段'} / ${text(source && source.source_data_name) || '取值来源'}`, item && item.item_ref || '', [formRef, areaRef, item && item.item_ref || ''], { formRef, areaRef, itemRef: item && item.item_ref || '' }, itemTarget);
            reference('data', source && source.source_data_ref, `${sourcePath}/source_data_ref`, source && source.source_type === 'external_system' ? '外部系统来源（不解析本地对象）' : '字段取值来源数据', itemTarget, { external: source && source.source_type === 'external_system' });
          });
        });
      });
    });

    const migration = document.migration || {};
    reference('process', migration.source_process_ref, '/migration/source_process_ref', '来源流程标识（迁移留存）', null, { external: true });
    const migrationIdentityKeys = {
      reference_materials: 'material_ref', internal_process_calls: 'call_ref', work_roles: 'archive_ref',
      unresolved_actor_roles: 'record_ref', unresolved_join_modes: 'record_ref', legacy_cross_department_records: 'record_ref'
    };
    Object.keys(migrationIdentityKeys).forEach(key => array(migration[key]).forEach((record, index) => identity(`migration-${key}`, record, migrationIdentityKeys[key], `/migration/${key}/${index}`)));
    array(migration.internal_process_calls).forEach((call, index) => {
      const path = `/migration/internal_process_calls/${index}`;
      reference('behavior', call && call.caller_behavior_ref, `${path}/caller_behavior_ref`, '迁移留存的调用环节', null);
      reference('process', call && call.target_process_ref, `${path}/target_process_ref`, '迁移留存的目标流程标识', null, { external: true });
      reference('behavior', call && call.return_behavior_ref, `${path}/return_behavior_ref`, '迁移留存的返回环节', null);
      array(call && call.input_data_refs).forEach((ref, refIndex) => reference('data', ref, `${path}/input_data_refs/${refIndex}`, '迁移留存的调用输入数据', null));
      array(call && call.output_data_refs).forEach((ref, refIndex) => reference('data', ref, `${path}/output_data_refs/${refIndex}`, '迁移留存的调用输出数据', null));
    });
    // The archive anchor already participates in existing deletion impact checks; display it only.
    array(migration.work_roles).forEach((record, index) => reference('behavior', record && record.behavior_ref, `/migration/work_roles/${index}/behavior_ref`, '迁移留存的工作角色锚点环节', null));
    array(migration.unresolved_actor_roles).forEach((record, index) => reference('behavior', record && record.behavior_ref, `/migration/unresolved_actor_roles/${index}/behavior_ref`, '待确认执行主体记录对应环节', null));
    array(migration.unresolved_join_modes).forEach((record, index) => reference('relation', record && record.relation_ref, `/migration/unresolved_join_modes/${index}/relation_ref`, '待确认汇合方式记录对应路线', null));
    array(migration.legacy_cross_department_records).forEach((record, index) => {
      const path = `/migration/legacy_cross_department_records/${index}`;
      const source = record && record.source_handoff || {};
      [ ['anchor_behavior_ref', 'behavior', '旧跨部门记录锚点环节'], ['resume_behavior_ref', 'behavior', '旧跨部门记录恢复环节'], ['transfer_data_ref', 'data', '旧跨部门记录传递数据'], ['returned_data_ref', 'data', '旧跨部门记录返回数据'] ].forEach(([key, kind, label]) => reference(kind, source[key], `${path}/source_handoff/${key}`, label, null));
      reference('behavior', record && record.created_behavior_ref, `${path}/created_behavior_ref`, '旧跨部门记录创建环节', null);
      array(record && record.created_relation_refs).forEach((ref, refIndex) => reference('relation', ref, `${path}/created_relation_refs/${refIndex}`, '旧跨部门记录创建路线', null));
      array(record && record.created_data_link_refs).forEach((ref, refIndex) => reference('data-link', ref, `${path}/created_data_link_refs/${refIndex}`, '旧跨部门记录创建数据关系', null));
    });

    const catalog = { nodes, references, identities };
    // Runtime indexes belong only to this projection and never enter the business JSON.
    Object.defineProperty(catalog, '_referenceIndex', { value: { identitiesByRef, nodesByRef } });
    nodes.forEach(entry => { entry.ambiguous = lookup(catalog, entry.target).status === 'ambiguous'; });
    pending.forEach(entry => {
      const candidates = identitiesByRef.get(entry.ref) || [];
      const matching = candidates.filter(identityEntry => identityEntry.kind === entry.kind);
      let status = entry.external ? 'external' : candidates.length > 1 ? 'ambiguous' : matching.length === 0 ? 'missing' : 'valid';
      let identityEntry = status === 'valid' ? matching[0] : null;
      let target = identityEntry && copyTarget(identityEntry.target);
      if (target) {
        const resolved = lookup(catalog, target);
        if (resolved.status !== 'valid') { status = resolved.status; target = null; identityEntry = null; }
      }
      if (status === 'valid' && entry.kind === 'data-field' && Object.prototype.hasOwnProperty.call(entry, 'expectedOwnerRef') && target.parentRef !== entry.expectedOwnerRef) status = 'wrong-owner';
      // Keep the old owner navigation target while exposing the precise structured element.
      // The source projection remains compatible; no path or identity enters the business JSON.
      const actualNode = status === 'valid' ? (nodesByRef.get(entry.ref) || []).find(nodeEntry => nodeEntry.kind === entry.kind) : null;
      let elementTarget = actualNode && copyTarget(actualNode.target);
      if (elementTarget) {
        const actualResolution = lookup(catalog, elementTarget);
        if (actualResolution.status !== 'valid') { status = actualResolution.status; elementTarget = null; }
      }
      const targetLabel = identityEntry && identityEntry.label || (status === 'external' ? `外部或留存标识：${entry.ref}` : status === 'ambiguous' ? `标识重复，无法唯一定位：${entry.ref}` : `当前文件中未找到：${entry.ref}`);
      const referenceEntry = {
        id: entry.path, path: entry.path, ref: entry.ref, relationLabel: entry.relationLabel, status,
        sourceTarget: copyTarget(entry.sourceTarget), target, elementTarget, targetLabel,
        targetPath: identityEntry ? identityEntry.path : null,
        ...(Object.prototype.hasOwnProperty.call(entry, 'expectedOwnerRef') ? { expectedOwnerRef: entry.expectedOwnerRef } : {})
      };
      references.push(referenceEntry);
      referencesByPath.set(referenceEntry.path, referenceEntry);
    });
    // Flow labels use unique endpoint identities, with explicit broken/ambiguous markers.
    nodes.filter(entry => entry.kind === 'relation').forEach(entry => {
      const endpoints = ['from_behavior_ref', 'to_behavior_ref'].map(key => referencesByPath.get(`${entry.path}/${key}`));
      const labels = endpoints.map(endpoint => endpoint ? endpoint.targetLabel : '未引用环节');
      entry.label = `${labels[0]} → ${labels[1]}`;
      const identityEntry = identitiesByPath.get(`${entry.path}/relation_ref`);
      if (identityEntry) identityEntry.label = entry.label;
    });
    references.forEach(entry => {
      const relation = entry.target && entry.target.kind === 'relation' && lookup(catalog, entry.target).node;
      if (relation) entry.targetLabel = relation.label;
    });
    return catalog;
  }

  function lookup(catalog, target) {
    const identities = array(catalog && catalog.identities);
    const nodes = array(catalog && catalog.nodes);
    const index = catalog && catalog._referenceIndex;
    if (!target || !present(target.ref)) return { status: 'missing', node: null, candidates: [] };
    const matchingNodes = (index ? index.nodesByRef.get(target.ref) || [] : nodes.filter(entry => entry.ref === target.ref)).filter(entry => entry.kind === target.kind);
    const allIdentities = index ? index.identitiesByRef.get(target.ref) || [] : identities.filter(entry => entry.ref === target.ref);
    if (allIdentities.length > 1) return { status: 'ambiguous', node: null, candidates: matchingNodes };
    if (matchingNodes.length !== 1) return { status: 'missing', node: null, candidates: matchingNodes };
    const node = matchingNodes[0];
    if (['data-field', 'data-link', 'data-source', 'form-area', 'form-link', 'form-item', 'field-source', 'lifecycle-route', 'lifecycle-event'].includes(node.kind) && (!present(target.parentRef) || !present(node.parentRef))) return { status: 'missing', node: null, candidates: matchingNodes };
    if (target.parentRef && node.parentRef !== target.parentRef) return { status: 'wrong-owner', node, candidates: matchingNodes };
    for (const ownerRef of node.ownerRefs) {
      const owners = index ? index.identitiesByRef.get(ownerRef) || [] : identities.filter(entry => entry.ref === ownerRef);
      if (owners.length > 1) return { status: 'ambiguous', node: null, candidates: matchingNodes };
      if (owners.length !== 1) return { status: 'missing', node: null, candidates: matchingNodes };
    }
    return { status: 'valid', node, candidates: matchingNodes };
  }

  function forTarget(catalog, target, options = {}) {
    const key = targetKey(target);
    if (!key) return { outgoing: [], incoming: [] };
    if (['data-link', 'data-source', 'form-link', 'field-source', 'lifecycle-route', 'lifecycle-event'].includes(target.kind)) {
      const resolution = lookup(catalog, target);
      if (resolution.status !== 'valid') return { outgoing: [], incoming: [] };
      const prefix = `${resolution.node.path}/`;
      return {
        outgoing: array(catalog && catalog.references).filter(entry => entry.path.startsWith(prefix)),
        incoming: array(catalog && catalog.references).filter(entry => targetKey(entry.elementTarget || entry.target) === key)
      };
    }
    const keys = new Set([key]);
    if (options.includeDescendants) {
      array(catalog && catalog.nodes).forEach(node => {
        if ((target.kind === 'data' && node.kind === 'data-field' || target.kind === 'form' && ['form-area', 'form-item'].includes(node.kind)) && node.parentRef === target.ref) keys.add(targetKey(node.target));
        if (target.kind === 'form-area' && node.kind === 'form-item' && node.scope.areaRef === target.ref && node.parentRef === target.parentRef) keys.add(targetKey(node.target));
      });
    }
    const references = array(catalog && catalog.references);
    return {
      outgoing: references.filter(entry => keys.has(targetKey(entry.sourceTarget))),
      incoming: references.filter(entry => keys.has(targetKey(entry.target)))
    };
  }

  return { buildCatalog, lookup, forTarget, targetKey };
}));
