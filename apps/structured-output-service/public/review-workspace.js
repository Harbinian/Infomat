(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviewWorkspace = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createReviewWorkspaceApi() {
  'use strict';

  const targetKey = target => JSON.stringify([target.kind, target.parentRef || '', target.ref]);

  // Reading/navigation positions only; never evidence that a business step is complete.
  const GUIDE_STEPS = Object.freeze([
    { title: '打开流程文件', step: 'start', view: 'overview', instruction: '先核对顶部流程名称。已有内容正确就继续，不必重新填写。' },
    { title: '核对流程范围', step: 'boundary', view: 'basic', instruction: '核对流程名称、归口部门、从什么情况开始、到什么结果结束。已有内容正确就继续。' },
    { title: '核对人员与动作', step: 'skeleton', view: 'diagram', instruction: '逐个点击环节，查看“人员与动作”。需要补充时点该组的编辑按钮，写清谁做、做什么、做到什么程度。' },
    { title: '核对路线与退回', step: 'skeleton', view: 'list', instruction: '在左侧清单的“关系与条件”中逐条选择路线，核对前后环节、判断条件和退回条件。需要修改时编辑右侧详情。' },
    { title: '核对表单字段', step: 'data', view: 'catalog', instruction: '在“全流程表单”中选择一张实际使用的表单，再逐个查看字段。需要新增或整理时点“整理表单与字段”。确实不用表单时可以继续。' },
    { title: '补齐对象字段与引用', step: 'data', view: 'catalog', instruction: '在“全流程数据”中选择对象并查看字段定义；需要新增字段时点“整理数据对象与关联”。再回表单引用已有对象字段，不能确认的关系先核实。' },
    { title: '核对数据使用关系', step: 'data', view: 'relationships', instruction: '展开数据对象，核对创建、更新、使用及表单字段关系；需要补充时点“返回输出物与数据编辑”，表单的处理方式到“表单、明细和字段”中修改。' },
    { title: '检查并下载', step: 'handoff', view: 'review', instruction: '可以先下载当前草稿，再逐项处理检查提示。涉及跨部门时进入“返回跨部门事实核对”；请在浏览器下载记录中确认已取得文件，下载不代表检查通过。' }
  ].map(Object.freeze));

  // View context only. No document facts or editor patches are stored here.
  function createManager() {
    const contexts = new Map();
    function get(key) {
      if (!contexts.has(key)) contexts.set(key, { trail: [], size: 'split', editingGroup: '', scroll: {} });
      return contexts.get(key);
    }
    function open(key, target, root = false) {
      const context = get(key);
      const entry = { kind: target.kind, ref: target.ref, parentRef: target.parentRef || '' };
      if (root) context.trail = [entry];
      else {
        const previous = context.trail.findIndex(item => targetKey(item) === targetKey(entry));
        if (previous >= 0) context.trail = context.trail.slice(0, previous + 1);
        else context.trail.push(entry);
      }
      context.editingGroup = '';
      return context;
    }
    function back(key, index) {
      const context = get(key);
      context.trail = context.trail.slice(0, index == null ? -1 : Math.max(0, index + 1));
      context.editingGroup = '';
      return context;
    }
    return { get, open, back, clear: key => contexts.delete(key) };
  }

  function resolve(data, target) {
    if (!data || !target) return null;
    const byRef = (items, key, ref) => (items || []).find(item => item[key] === ref);
    if (target.kind === 'behavior') return byRef(data.behaviors, 'behavior_ref', target.ref) || null;
    if (target.kind === 'relation') return byRef(data.flow_relations, 'relation_ref', target.ref) || null;
    if (target.kind === 'data') return byRef(data.data_objects, 'data_ref', target.ref) || null;
    if (target.kind === 'form') return byRef(data.forms, 'form_ref', target.ref) || null;
    if (target.kind === 'data-field') {
      const owner = byRef(data.data_objects, 'data_ref', target.parentRef);
      return byRef(owner?.fields, 'field_ref', target.ref) || null;
    }
    if (target.kind === 'form-item') {
      const owner = byRef(data.forms, 'form_ref', target.parentRef);
      return (owner?.areas || []).flatMap(area => area.items || []).find(item => item.item_ref === target.ref) || null;
    }
    return null;
  }

  function label(data, target) {
    const item = resolve(data, target);
    if (!item) return '对象已不存在';
    if (target.kind === 'relation') {
      const from = resolve(data, { kind: 'behavior', ref: item.from_behavior_ref });
      const to = resolve(data, { kind: 'behavior', ref: item.to_behavior_ref });
      return `${from?.behavior_name || '未命名环节'} → ${to?.behavior_name || '未命名环节'}`;
    }
    return item.behavior_name || item.data_name || item.form_name || item.field_name || item.item_name || '未命名对象';
  }

  function linkedObjects(data, behaviorRef) {
    return {
      data: (data?.data_objects || []).filter(item => (item.behavior_links || []).some(link => link.behavior_ref === behaviorRef)),
      forms: (data?.forms || []).filter(item => (item.behavior_links || []).some(link => link.behavior_ref === behaviorRef)),
      relations: (data?.flow_relations || []).filter(item => item.from_behavior_ref === behaviorRef || item.to_behavior_ref === behaviorRef)
    };
  }

  const EDIT_FIELDS = Object.freeze({
    form: Object.freeze(['form_name', 'form_no', 'form_design_state']),
    'form-item': Object.freeze(['item_name', 'required', 'instructions']),
    'data-field': Object.freeze(['field_name', 'field_type', 'definition'])
  });

  function isEditingTarget(session, target, candidateKey) {
    if (!session || !target || session.candidateKey !== candidateKey) return false;
    const editorKind = { behavior: 'behavior-properties', relation: 'relation-properties', data: 'data-object-properties' }[target.kind]
      || (EDIT_FIELDS[target.kind] ? 'review-properties' : '');
    const entityRef = editorKind === 'review-properties' ? targetKey(target) : target.ref;
    return Boolean(editorKind) && session.editorKind === editorKind && session.entityRef === entityRef;
  }

  // A field's stable reference remains unchanged; update its existing consumers.
  function synchronizeFieldType(data, fieldRef, fieldType) {
    for (const form of data.forms || []) for (const area of form.areas || []) for (const item of area.items || []) {
      if (item.data_field_ref === fieldRef) item.item_type = fieldType;
    }
  }

  return { createManager, targetKey, resolve, label, linkedObjects, EDIT_FIELDS, isEditingTarget, synchronizeFieldType, GUIDE_STEPS };
}));
